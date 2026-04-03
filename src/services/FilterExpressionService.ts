import { FilterParser } from './FilterParser';
import type { ParsedFile } from '../interfaces/ParsedFile';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';

/**
 * Shared service for filter expression processing
 * Handles transformation and record counting
 * NOTE: Placeholder expansion ($TAG, $KEY, etc.) is handled by the calling plugin
 */
export class FilterExpressionService {
	/**
	 * Get matching records
	 * SINGLE SOURCE OF TRUTH - returns actual matching entries
	 * Supports W: syntax for WHERE clause (file filtering)
	 * @param filterExpression - Already expanded filter expression (no placeholders)
	 */
	static getMatchingRecords(
		parsedFiles: ParsedFile[],
		filterExpression: string
	): Array<{ entry: import('../interfaces/ParsedFile').FlatEntry; file: ParsedFile }> {
		if (!filterExpression || !filterExpression.trim()) {
			// Empty expression = show all records
			const allRecords: Array<{ entry: import('../interfaces/ParsedFile').FlatEntry; file: ParsedFile }> = [];
			for (const file of parsedFiles) {
				for (const entry of file.entries) {
					allRecords.push({ entry, file });
				}
			}
			return allRecords;
		}

		// Transform expression to add OR operators between keywords
		const transformedExpr = this.transformFilterExpression(filterExpression);

		// If all chips were deactivated, transformed expression is empty - show all results
		if (!transformedExpr || !transformedExpr.trim()) {
			const allRecords: Array<{ entry: import('../interfaces/ParsedFile').FlatEntry; file: ParsedFile }> = [];
			for (const file of parsedFiles) {
				for (const entry of file.entries) {
					allRecords.push({ entry, file });
				}
			}
			return allRecords;
		}

		// Split on W: or w: to separate SELECT and WHERE clauses (case-insensitive)
		const hasWhere = /\s+[Ww]:\s+/.test(transformedExpr);
		let selectExpr = transformedExpr;
		let whereExpr = '';

		if (hasWhere) {
			const parts = transformedExpr.split(/\s+[Ww]:\s+/);
			selectExpr = parts[0].trim();
			whereExpr = parts[1]?.trim() || '';
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
			return [];
		}

		// Collect matching entries using FlatEntry
		const matchingEntries: Array<{ entry: import('../interfaces/ParsedFile').FlatEntry; file: ParsedFile }> = [];

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
					matchingEntries.push({ entry, file });
				}
			}
		}

		return matchingEntries;
	}

	/**
	 * Count records matching a filter expression
	 * Uses getMatchingRecords() - ensures count and display use same logic
	 * @param filterExpression - Already expanded filter expression (no placeholders)
	 */
	static countRecordsWithExpression(
		parsedFiles: ParsedFile[],
		filterExpression: string
	): number {
		return this.getMatchingRecords(parsedFiles, filterExpression).length;
	}

	/**
	 * Transform filter expression to add OR operators between keywords
	 * Deactivated chips (_.keyword) are separated and ANDed as negations
	 * Examples:
	 *   ".def .inc :boo W: #tag" → ".def OR .inc OR :boo W: #tag"
	 *   "_.pos .neg .goa" → "(.neg OR .goa) AND !.pos"
	 * NOTE: Placeholder expansion ($TAG, $KEY, etc.) should be done BEFORE calling this
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

		// Filter out deactivated chips (just ignore them, don't exclude)
		const activatedItems: string[] = [];

		for (const item of transformedItems) {
			if (!item.startsWith('_')) {
				activatedItems.push(item);
			}
			// Deactivated items (starting with _) are simply ignored
		}

		// Join activated items with OR
		let transformedSelect = '';
		for (let j = 0; j < activatedItems.length; j++) {
			const item = activatedItems[j];
			const nextItem = activatedItems[j + 1];

			transformedSelect += item;

			if (nextItem !== undefined &&
				item !== 'AND' && item !== 'OR' &&
				nextItem !== 'AND' && nextItem !== 'OR' &&
				item !== '(' && nextItem !== ')') {
				transformedSelect += ' OR ';
			}
		}

		// Reconstruct expression
		const result = whereExpr ? `${transformedSelect} W: ${whereExpr}` : transformedSelect;
		return result;
	}

	/**
	 * Extract next filter term from expression (keyword, tag, category, language, etc.)
	 */
	private static extractNextTerm(expr: string, startPos: number): { value: string; endPos: number } | null {
		let i = startPos;
		if (i >= expr.length) return null;

		let char = expr[i];

		// Check for deactivated chip prefix
		let hasUnderscore = false;
		if (char === '_') {
			hasUnderscore = true;
			i++;
			if (i >= expr.length) return null;
			char = expr[i]; // Get next character after underscore
		}

		// Keyword (.foo or .foo.bar)
		if (char === '.') {
			let value = hasUnderscore ? '_.' : '.';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_.-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Tag (#foo)
		if (char === '#') {
			let value = hasUnderscore ? '_#' : '#';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Category (:foo)
		if (char === ':') {
			let value = hasUnderscore ? '_:' : ':';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Language (`java)
		if (char === '`') {
			let value = hasUnderscore ? '_`' : '`';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Path (/foo/bar)
		if (char === '/') {
			let value = hasUnderscore ? '_/' : '';
			while (i < expr.length && /[a-zA-Z0-9_\-\/.]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// File name (f"filename")
		if (char === 'f' && i + 1 < expr.length && expr[i + 1] === '"') {
			let value = hasUnderscore ? '_f"' : 'f"';
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
			let value = hasUnderscore ? '_"' : '"';
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
			return { value: (hasUnderscore ? '_.' : '.') + bareWord, endPos: i };
		}

		return null;
	}
}
