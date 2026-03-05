import { FilterParser } from './FilterParser';
import type { ParsedFile } from '../interfaces/ParsedFile';
import type { Topic } from '../interfaces/Topic';
import type { Subject } from '../interfaces/Subject';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';

/**
 * Shared service for filter expression processing
 * Handles placeholder expansion, transformation, and record counting
 */
export class FilterExpressionService {
	/**
	 * Count records matching a filter expression (with placeholder expansion)
	 * Supports W: syntax for WHERE clause (file filtering)
	 */
	static countRecordsWithExpression(
		parsedFiles: ParsedFile[],
		filterExpression: string,
		primaryTopic: Topic | null,
		subject?: Subject,
		includesSubjectTag: boolean = false
	): number {
		if (!filterExpression || !filterExpression.trim()) {
			return 0;
		}

		// Expand placeholders in expression
		const expandedExpr = this.expandPlaceholders(filterExpression, primaryTopic, subject);

		// Transform expression to add OR operators between keywords
		const transformedExpr = this.transformFilterExpression(expandedExpr);

		// Split on W: or w: to separate SELECT and WHERE clauses (case-insensitive)
		const hasWhere = /\s+[Ww]:\s+/.test(transformedExpr);
		let selectExpr = transformedExpr;
		let whereExpr = '';

		if (hasWhere) {
			const parts = transformedExpr.split(/\s+[Ww]:\s+/);
			selectExpr = parts[0].trim();
			whereExpr = parts[1]?.trim() || '';
		}

		// Add subject tag to WHERE clause if this is a green cell (AND mode enabled)
		if (includesSubjectTag && subject?.mainTag) {
			// Normalize: strip leading # if present, then add it back
			const subjectTag = subject.mainTag.replace(/^#/, '');
			if (whereExpr) {
				// Add to existing WHERE clause (wrap in parentheses for correct precedence)
				whereExpr = `#${subjectTag} AND (${whereExpr})`;
			} else {
				// Create new WHERE clause with just the subject tag
				whereExpr = `#${subjectTag}`;
			}
		}

		// Compile expressions
		let selectCompiled: import('../interfaces/FilterInterfaces').CompiledFilter;
		let whereCompiled: import('../interfaces/FilterInterfaces').CompiledFilter | null = null;

		try {
			selectCompiled = FilterParser.compile(selectExpr);
			if (whereExpr) {
				whereCompiled = FilterParser.compile(whereExpr);
			}
		} catch (error) {
			console.error(`[FilterExpressionService] Failed to compile expression: ${transformedExpr}`, error);
			return 0;
		}

		// Count matching entries using FlatEntry
		let matchCount = 0;

		for (const file of parsedFiles) {
			for (const entry of file.entries) {
				// First apply WHERE clause (if present)
				if (whereCompiled) {
					if (!FilterParser.evaluateFlatEntry(whereCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, whereCompiled.modifiers)) {
						continue; // Doesn't match WHERE clause, skip
					}
				}

				// Then apply SELECT clause
				if (FilterParser.evaluateFlatEntry(selectCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers)) {
					matchCount++;
				}
			}
		}

		return matchCount;
	}

	/**
	 * Expand placeholders in filter expression
	 * For secondary topics: use topic's own values (or subject's if no topic)
	 * For intersections: use primary topic's values
	 *
	 * Placeholder syntax:
	 * - $TAG → topicTag (e.g., #java)
	 * - $KEY → topicKeyword (e.g., .jav)
	 * - $BLOCK or $CODE → code block language (e.g., `java)
	 * - $TEXT → topicText (e.g., "java")
	 * - #? → topicTag (legacy)
	 * - .? → topicKeyword (legacy)
	 */
	static expandPlaceholders(expression: string, primaryTopic: Topic | null, subject?: Subject): string {
		if (!primaryTopic && !subject) {
			return expression;
		}

		let result = expression;

		// Expand $TAG with topicTag (or subject mainTag)
		const tagSource = primaryTopic?.topicTag || subject?.mainTag;
		if (tagSource) {
			// NORMALIZE: Strip leading # from tag if present (works regardless of storage format)
			const tagValue = tagSource.replace(/^#/, '');
			result = result.replace(/\$TAG/g, `#${tagValue}`);
		}

		// Expand $KEY with topicKeyword (or subject keyword)
		const keywordSource = primaryTopic?.topicKeyword || subject?.keyword;
		if (keywordSource) {
			result = result.replace(/\$KEY/g, `.${keywordSource}`);
		}

		// Expand $BLOCK and $CODE with topicText (language/code block)
		if (primaryTopic?.topicText) {
			result = result.replace(/\$BLOCK/g, `\`${primaryTopic.topicText}`);
			result = result.replace(/\$CODE/g, `\`${primaryTopic.topicText}`);
		}

		// Expand $TEXT with topicText
		if (primaryTopic?.topicText) {
			result = result.replace(/\$TEXT/g, `"${primaryTopic.topicText}"`);
		}

		// Expand #? with topicTag (legacy placeholder)
		if (tagSource) {
			const tagValue = tagSource.replace(/^#/, '');
			result = result.replace(/#\?/g, `#${tagValue}`);
		}

		// Expand .? with topicKeyword (legacy placeholder)
		if (keywordSource) {
			result = result.replace(/\.\?/g, `.${keywordSource}`);
		}

		return result;
	}

	/**
	 * Transform filter expression to add OR operators between keywords
	 * Example: ".def .inc :boo W: #tag" → ".def OR .inc OR :boo W: #tag"
	 */
	static transformFilterExpression(expression: string): string {
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
		const transformedItems: string[] = [];
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
				const term = this.extractNextTerm(selectExpr, i);
				if (term) {
					transformedItems.push(negation + term.value);
					i = term.endPos;
				}
				continue;
			}

			// Extract next term (keyword, tag, category, language, etc.)
			const term = this.extractNextTerm(selectExpr, i);
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

	/**
	 * Extract next filter term from expression (keyword, tag, category, language, etc.)
	 */
	private static extractNextTerm(expr: string, startPos: number): { value: string; endPos: number } | null {
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
}
