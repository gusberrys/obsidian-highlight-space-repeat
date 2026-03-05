/**
 * Test to show how filter expression is transformed and parsed
 * Expression: :fun .def W: #philosophy OR #linux
 * Note: W: or w: both work (case-insensitive)
 */

// Mock FilterExpressionService.transformFilterExpression
function transformFilterExpression(expression) {
	// Remove modifiers from ENTIRE expression first (before splitting on W:)
	expression = expression.replace(/\\[hast]/g, '').trim();

	// Extract SELECT and WHERE clauses (case-insensitive: W: or w:)
	const hasWhere = /\s+[Ww]:\s+/.test(expression);
	let selectExpr = expression;
	let whereExpr = '';

	if (hasWhere) {
		const parts = expression.split(/\s+[Ww]:\s+/);
		selectExpr = parts[0].trim();
		whereExpr = parts[1]?.trim() || '';
	}

	// Parse SELECT expression to find individual filter terms
	const transformedItems = [];
	let i = 0;

	while (i < selectExpr.length) {
		const char = selectExpr[i];

		// Skip whitespace
		if (/\s/.test(char)) {
			i++;
			continue;
		}

		// Check for existing AND/OR operators - keep them
		if (selectExpr.substring(i).match(/^(AND|OR)\b/)) {
			const opMatch = selectExpr.substring(i).match(/^(AND|OR)\b/);
			if (opMatch) {
				transformedItems.push(opMatch[0]);
				i += opMatch[0].length;
				continue;
			}
		}

		// Parentheses - preserve as-is
		if (char === '(' || char === ')') {
			transformedItems.push(char);
			i++;
			continue;
		}

		// Negation
		if (char === '!' || char === '-') {
			const negation = char;
			i++;
			// Skip whitespace after negation
			while (i < selectExpr.length && /\s/.test(selectExpr[i])) {
				i++;
			}
			// Get the next term
			const term = extractNextTerm(selectExpr, i);
			if (term) {
				transformedItems.push(negation + term.value);
				i = term.endPos;
			}
			continue;
		}

		// Extract next term (keyword, tag, category, language, etc.)
		const term = extractNextTerm(selectExpr, i);
		if (term) {
			transformedItems.push(term.value);
			i = term.endPos;
		} else {
			i++;
		}
	}

	// Join items with OR if they don't already have operators between them
	let transformedSelect = '';
	for (let j = 0; j < transformedItems.length; j++) {
		const item = transformedItems[j];
		const nextItem = transformedItems[j + 1];

		transformedSelect += item;

		// Add OR between items if:
		// - Not the last item
		// - Current item is not an operator
		// - Next item is not an operator
		// - Current item is not an opening paren
		// - Next item is not a closing paren
		if (nextItem !== undefined &&
			item !== 'AND' && item !== 'OR' &&
			nextItem !== 'AND' && nextItem !== 'OR' &&
			item !== '(' && nextItem !== ')') {
			transformedSelect += ' OR ';
		} else if (nextItem !== undefined) {
			transformedSelect += ' ';
		}
	}

	// Reconstruct expression
	return whereExpr ? `${transformedSelect} W: ${whereExpr}` : transformedSelect;
}

function extractNextTerm(expr, startPos) {
	let i = startPos;
	if (i >= expr.length) return null;

	const char = expr[i];

	// Keyword (.foo or .foo.bar)
	if (char === '.') {
		let value = '.';
		i++;
		while (i < expr.length && /[a-zA-Z0-9_.-]/.test(expr[i])) {
			value += expr[i];
			i++;
		}
		return { value, endPos: i };
	}

	// Tag (#foo)
	if (char === '#') {
		let value = '#';
		i++;
		while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
			value += expr[i];
			i++;
		}
		return { value, endPos: i };
	}

	// Category (:foo)
	if (char === ':') {
		let value = ':';
		i++;
		while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
			value += expr[i];
			i++;
		}
		return { value, endPos: i };
	}

	// Language (`java)
	if (char === '`') {
		let value = '`';
		i++;
		while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
			value += expr[i];
			i++;
		}
		return { value, endPos: i };
	}

	// Path (/foo/bar)
	if (char === '/') {
		let value = '';
		while (i < expr.length && /[a-zA-Z0-9_\-\/.]/.test(expr[i])) {
			value += expr[i];
			i++;
		}
		return { value, endPos: i };
	}

	// File name (f"filename")
	if (char === 'f' && i + 1 < expr.length && expr[i + 1] === '"') {
		let value = 'f"';
		i += 2;
		while (i < expr.length && expr[i] !== '"') {
			value += expr[i];
			i++;
		}
		value += '"';
		i++;
		return { value, endPos: i };
	}

	// Quoted text ("plaintext")
	if (char === '"') {
		let value = '"';
		i++;
		while (i < expr.length && expr[i] !== '"') {
			value += expr[i];
			i++;
		}
		value += '"';
		i++;
		return { value, endPos: i };
	}

	// Bare keyword (no prefix) - treat as .keyword
	if (/[a-zA-Z0-9_]/.test(char)) {
		let bareWord = '';
		while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
			bareWord += expr[i];
			i++;
		}
		// Don't prefix AND/OR
		if (bareWord === 'AND' || bareWord === 'OR') {
			return { value: bareWord, endPos: i };
		}
		// Add . prefix for keywords
		return { value: '.' + bareWord, endPos: i };
	}

	return null;
}

// Test the expression
const originalExpr = ':fun .def W: #philosophy OR #linux';
console.log('='.repeat(80));
console.log('ORIGINAL EXPRESSION:');
console.log(originalExpr);
console.log('='.repeat(80));

const transformed = transformFilterExpression(originalExpr);
console.log('\nTRANSFORMED EXPRESSION:');
console.log(transformed);
console.log('='.repeat(80));

// Split SELECT and WHERE
const parts = transformed.split(/W:/);
const selectExpr = parts[0]?.trim() || '';
const whereExpr = parts[1]?.trim() || '';

console.log('\nSELECT CLAUSE:');
console.log(`"${selectExpr}"`);
console.log('\nWHERE CLAUSE:');
console.log(`"${whereExpr}"`);
console.log('='.repeat(80));

console.log('\nEXPECTED BEHAVIOR:');
console.log('SELECT should match: entries with (:fun category OR .def keyword)');
console.log('WHERE should match: files with (#philosophy tag OR #linux tag)');
console.log('='.repeat(80));

console.log('\nQUESTION:');
console.log('Why does Matrix only use :fun from SELECT?');
console.log('Why does Dashboard not understand which is SELECT vs WHERE?');
console.log('='.repeat(80));
