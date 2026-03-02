import { FilterToken, FilterTokenType, FilterNode, FilterModifiers, CompiledFilter } from '../interfaces/FilterInterfaces';
import type { FlatEntry } from '../interfaces/ParsedFile';
import { getFileNameFromPath } from '../utils/file-helpers';

/**
 * Parses and evaluates filter expressions
 *
 * Syntax:
 * - .keyword - Match entry keyword
 * - #tag - Match file tag
 * - /path - Match path
 * - f"filename" - Match file name (not full path)
 * - "text" - Match plaintext
 * - `language - Match language
 * - :category - Expands to all keywords with matching categoryClass (entry level only)
 * - \h - Modifier: also match in headers (e.g., .keyword \h, #tag \h)
 * - AND, OR - Logical operators
 * - ! - Negation
 * - .parent.child - Nested keywords
 */
export class FilterParser {
	/**
	 * Tokenize filter expression
	 */
	static tokenize(expression: string): FilterToken[] {
		const tokens: FilterToken[] = [];
		let i = 0;

		while (i < expression.length) {
			const char = expression[i];

			// Skip whitespace
			if (/\s/.test(char)) {
				i++;
				continue;
			}

			// Negation
			if (char === '!') {
				tokens.push({ type: FilterTokenType.NOT, value: '!' });
				i++;
				continue;
			}

			// Backslash modifiers (\h, \a, \s, \t)
			if (char === '\\' && i + 1 < expression.length) {
				const nextChar = expression[i + 1];
				if (nextChar === 'h' || nextChar === 'a' || nextChar === 's' || nextChar === 't') {
					tokens.push({ type: FilterTokenType.MODIFIER, value: nextChar });
					i += 2; // Skip backslash and letter
					continue;
				}
			}

			// Parentheses
			if (char === '(') {
				tokens.push({ type: FilterTokenType.LPAREN, value: '(' });
				i++;
				continue;
			}

			if (char === ')') {
				tokens.push({ type: FilterTokenType.RPAREN, value: ')' });
				i++;
				continue;
			}

			// Keyword (.foo or .foo.bar for multi-keyword matching)
			if (char === '.') {
				i++;
				const keywords: string[] = [];
				let keyword = '';

				// Read first keyword part
				while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
					keyword += expression[i];
					i++;
				}
				keywords.push(keyword);

				// Check for additional keywords (.foo.bar.baz)
				while (i < expression.length && expression[i] === '.') {
					i++; // Skip the dot
					keyword = '';
					while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
						keyword += expression[i];
						i++;
					}
					if (keyword) {
						keywords.push(keyword);
					}
				}

				// Check for hyphenated keyword (.keyword-extrakeyword)
				if (i < expression.length && expression[i] === '-') {
					keyword = keywords[keywords.length - 1] + '-';
					i++; // Skip the hyphen
					while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
						keyword += expression[i];
						i++;
					}
					keywords[keywords.length - 1] = keyword;
				}

				// Create token
				if (keywords.length === 1) {
					// Simple keyword
					tokens.push({ type: FilterTokenType.KEYWORD, value: keywords[0] });
				} else {
					// Multi-keyword: .foo.bar means BOTH foo AND bar must be in keywords array
					tokens.push({ type: FilterTokenType.KEYWORD, value: keywords.join('.') });
				}
				continue;
			}

			// Tag (#foo)
			if (char === '#') {
				i++;
				let tag = '';
				while (i < expression.length && /[a-zA-Z0-9_-]/.test(expression[i])) {
					tag += expression[i];
					i++;
				}
				tokens.push({ type: FilterTokenType.TAG, value: tag });
				continue;
			}

			// Path (/foo/bar)
			if (char === '/') {
				let path = '';
				while (i < expression.length && /[a-zA-Z0-9_\-\/.]/.test(expression[i])) {
					path += expression[i];
					i++;
				}
				tokens.push({ type: FilterTokenType.PATH, value: path });
				continue;
			}

			// File name match (f"filename")
			if (char === 'f' && i + 1 < expression.length && expression[i + 1] === '"') {
				i += 2; // Skip f and opening quote
				let filename = '';
				while (i < expression.length && expression[i] !== '"') {
					filename += expression[i];
					i++;
				}
				i++; // Skip closing quote
				tokens.push({ type: FilterTokenType.FILENAME, value: filename });
				continue;
			}

			// Quoted text ("plaintext")
			if (char === '"') {
				i++;
				let text = '';
				while (i < expression.length && expression[i] !== '"') {
					text += expression[i];
					i++;
				}
				i++; // Skip closing quote
				tokens.push({ type: FilterTokenType.TEXT, value: text });
				continue;
			}

			// Language (`java)
			if (char === '`') {
				i++;
				let language = '';
				while (i < expression.length && /[a-zA-Z0-9_-]/.test(expression[i])) {
					language += expression[i];
					i++;
				}
				tokens.push({ type: FilterTokenType.LANGUAGE, value: language });
				continue;
			}

			// Category (:fun-category - expands to keywords with categoryClass)
			if (char === ':') {
				i++; // Skip colon
				let category = '';
				while (i < expression.length && /[a-zA-Z0-9_-]/.test(expression[i])) {
					category += expression[i];
					i++;
				}
				tokens.push({ type: FilterTokenType.CATEGORY, value: category });
				continue;
			}

			// AND / OR keywords
			const remaining = expression.substring(i);
			if (remaining.startsWith('AND')) {
				tokens.push({ type: FilterTokenType.AND, value: 'AND' });
				i += 3;
				continue;
			}

			if (remaining.startsWith('OR')) {
				tokens.push({ type: FilterTokenType.OR, value: 'OR' });
				i += 2;
				continue;
			}

			// Bare keyword (no prefix) - treat as .keyword for WHERE clauses
			if (/[a-zA-Z0-9_]/.test(char)) {
				let bareWord = '';
				while (i < expression.length && /[a-zA-Z0-9_-]/.test(expression[i])) {
					bareWord += expression[i];
					i++;
				}
				// Check if this is actually AND or OR (in case we missed them)
				if (bareWord === 'AND') {
					tokens.push({ type: FilterTokenType.AND, value: 'AND' });
				} else if (bareWord === 'OR') {
					tokens.push({ type: FilterTokenType.OR, value: 'OR' });
				} else {
					// Treat as keyword (implicit dot prefix)
					tokens.push({ type: FilterTokenType.KEYWORD, value: bareWord });
				}
				continue;
			}

			// Unknown character, skip
			i++;
		}

		return tokens;
	}

	/**
	 * Parse tokens into AST
	 */
	static parse(tokens: FilterToken[]): FilterNode | null {
		if (tokens.length === 0) return null;

		let pos = 0;

		const parseExpression = (): FilterNode | null => {
			return parseOr();
		};

		const parseOr = (): FilterNode | null => {
			let left = parseAnd();

			while (pos < tokens.length && tokens[pos].type === FilterTokenType.OR) {
				pos++; // Skip OR
				const right = parseAnd();
				if (!right) break;
				left = { type: 'or', left: left!, right };
			}

			return left;
		};

		const parseAnd = (): FilterNode | null => {
			let left = parsePrimary();

			while (pos < tokens.length && tokens[pos].type === FilterTokenType.AND) {
				pos++; // Skip AND
				const right = parsePrimary();
				if (!right) break;
				left = { type: 'and', left: left!, right };
			}

			return left;
		};

		const parsePrimary = (): FilterNode | null => {
			if (pos >= tokens.length) return null;

			const token = tokens[pos];

			// Negation
			if (token.type === FilterTokenType.NOT) {
				pos++;
				const child = parsePrimary();
				return { type: 'not', child: child! };
			}

			// Parentheses
			if (token.type === FilterTokenType.LPAREN) {
				pos++;
				const expr = parseExpression();
				if (pos < tokens.length && tokens[pos].type === FilterTokenType.RPAREN) {
					pos++;
				}
				return expr;
			}

			// Leaf nodes
			pos++;
			switch (token.type) {
				case FilterTokenType.KEYWORD: {
					const node: FilterNode = { type: 'keyword', value: token.value };
					// Check if this is multi-keyword syntax (.foo.bar)
					if (token.value && token.value.includes('.')) {
						node.multiKeywords = token.value.split('.');
					}
					if (token.auxiliaryKeyword) {
						node.auxiliaryKeyword = token.auxiliaryKeyword;
					}
					return node;
				}
				case FilterTokenType.TAG:
					return { type: 'tag', value: token.value };
				case FilterTokenType.PATH:
					return { type: 'path', value: token.value };
				case FilterTokenType.FILENAME:
					return { type: 'filename', value: token.value };
				case FilterTokenType.TEXT:
					return { type: 'text', value: token.value };
				case FilterTokenType.LANGUAGE:
					return { type: 'language', value: token.value };
				case FilterTokenType.CATEGORY:
					return { type: 'category', value: token.value };
				default:
					return null;
			}
		};

		return parseExpression();
	}

	/**
	 * Helper: Extract all keywords from entry (entry keywords + all subItem keywords)
	 */
	private static getAllKeywords(entry: import('../interfaces/ParsedFile').ParsedEntry): string[] {
		const keywords = [...(entry.keywords || [])];
		if (entry.subItems) {
			for (const subItem of entry.subItems) {
				if (subItem.keywords) {
					keywords.push(...subItem.keywords);
				}
			}
		}
		return keywords;
	}

	/**
	 * Helper: Extract all languages from entry subItems
	 */
	private static getAllLanguages(entry: import('../interfaces/ParsedFile').ParsedEntry): string[] {
		const languages: string[] = [];
		if (entry.type === 'codeblock' && entry.language) {
			languages.push(entry.language);
		}
		if (entry.subItems) {
			for (const subItem of entry.subItems) {
				if (subItem.codeBlockLanguage) {
					languages.push(subItem.codeBlockLanguage);
				}
				if (subItem.nestedCodeBlock?.language) {
					languages.push(subItem.nestedCodeBlock.language);
				}
			}
		}
		return languages;
	}

	/**
	 * Helper: Normalize tags (ensure # prefix)
	 */
	private static normalizeTags(tags: string[]): string[] {
		return tags.map(tag => tag.startsWith('#') ? tag : '#' + tag);
	}

	/**
	 * Match keyword (supports nested keywords like .goa.foo for goa :: foo)
	 */
	private static matchKeyword(pattern: string, keywords: string[]): boolean {
		// Split pattern by dots for nested keywords
		const parts = pattern.split('.');

		if (parts.length === 1) {
			// Simple keyword match
			return keywords.some(k => k.toLowerCase() === pattern.toLowerCase());
		} else {
			// Nested keyword match (e.g., .goa.foo matches "goa :: foo")
			const nestedPattern = parts.join(' :: ');
			return keywords.some(k => k.toLowerCase() === nestedPattern.toLowerCase());
		}
	}

	/**
	 * Compile filter expression into AST and modifiers for reuse
	 */
	static compile(expression: string): CompiledFilter {
		const tokens = this.tokenize(expression);

		// Extract modifiers from tokens
		const modifiers: FilterModifiers = {};
		const nonModifierTokens: FilterToken[] = [];

		for (const token of tokens) {
			if (token.type === FilterTokenType.MODIFIER) {
				switch (token.value) {
					case 'h':
						modifiers.enableHeaders = true;
						break;
					case 'a':
						modifiers.showAll = true;
						break;
					case 's':
						modifiers.trimSubelement = true;
						break;
					case 't':
						modifiers.topLevelOnly = true;
						break;
				}
			} else {
				nonModifierTokens.push(token);
			}
		}

		// Parse the non-modifier tokens into AST
		const ast = this.parse(nonModifierTokens);

		return { ast, modifiers };
	}

	/**
	 * Test if expression is valid
	 */
	static isValid(expression: string): boolean {
		try {
			const compiled = this.compile(expression);
			return compiled.ast !== null;
		} catch {
			return false;
		}
	}

	/**
	 * Evaluate filter against FlatEntry (optimized for flat data structure)
	 * Replaces the need for flatEntryToContext() conversion
	 * @param node - Filter AST node
	 * @param entry - The flat entry to evaluate (must have filePath, fileName, fileTags added at load time)
	 * @param categories - Categories for category matching
	 * @param modifiers - Filter modifiers
	 */
	static evaluateFlatEntry(
		node: FilterNode | null,
		entry: FlatEntry,
		categories?: any[],
		modifiers?: FilterModifiers
	): boolean {
		if (!node) return true;

		// Collect header keywords and tags from all header levels
		const headerKeywords: string[] = [];
		const headerTags: string[] = [];

		if (entry.h1) {
			headerKeywords.push(...(entry.h1.keywords || []));
			headerTags.push(...(entry.h1.tags || []));
		}
		if (entry.h2) {
			headerKeywords.push(...(entry.h2.keywords || []));
			headerTags.push(...(entry.h2.tags || []));
		}
		if (entry.h3) {
			headerKeywords.push(...(entry.h3.keywords || []));
			headerTags.push(...(entry.h3.tags || []));
		}

		const entryKeywords = entry.keywords || [];
		const languages = entry.language ? [entry.language] : [];
		const filePath = entry.filePath || '';
		const fileName = getFileNameFromPath(entry.filePath!) || '';
		const fileTags = entry.fileTags || [];

		switch (node.type) {
			case 'keyword':
				// Multi-keyword syntax (.foo.bar) - ALL keywords must be present
				if (node.multiKeywords && node.multiKeywords.length > 0) {
					const allKeywordsMatch = node.multiKeywords.every(kw =>
						entryKeywords.some(ck => ck.toLowerCase() === kw.toLowerCase())
					);

					const shouldCheckHeaders = node.includeHeaders || modifiers?.enableHeaders;
					if (shouldCheckHeaders && headerKeywords.length > 0) {
						const headerAllKeywordsMatch = node.multiKeywords.every(kw =>
							headerKeywords.some(hk => hk.toLowerCase() === kw.toLowerCase())
						);
						return allKeywordsMatch || headerAllKeywordsMatch;
					}
					return allKeywordsMatch;
				}

				// Regular keyword matching
				const entryKeywordMatch = this.matchKeyword(node.value!, entryKeywords);

				const shouldCheckHeaders = node.includeHeaders || modifiers?.enableHeaders;
				if (shouldCheckHeaders && headerKeywords.length > 0) {
					const headerKeywordMatch = headerKeywords.some(hk =>
						hk.toLowerCase() === node.value!.toLowerCase()
					);
					return entryKeywordMatch || headerKeywordMatch;
				}
				return entryKeywordMatch;

			case 'tag':
				// FlatEntry stores tags WITHOUT # prefix, so strip it for comparison
				const tagValue = node.value!.startsWith('#') ? node.value!.slice(1).toLowerCase() : node.value!.toLowerCase();
				const fileTagMatch = fileTags.some(tag => tag.toLowerCase() === tagValue);

				const shouldCheckHeaderTags = node.includeHeaders || modifiers?.enableHeaders;
				if (shouldCheckHeaderTags && headerTags.length > 0) {
					const headerTagMatch = headerTags.some(tag => tag.toLowerCase() === tagValue);
					return fileTagMatch || headerTagMatch;
				}
				return fileTagMatch;

			case 'path':
				const pathToMatch = node.value!.startsWith('/') ? node.value!.slice(1) : node.value!;
				return filePath.includes(pathToMatch);

			case 'filename':
				return fileName.toLowerCase().includes(node.value!.toLowerCase());

			case 'text':
				return entry.text.includes(node.value!);

			case 'language':
				return languages.some(lang => lang.toLowerCase() === node.value!.toLowerCase());

			case 'category':
				if (!categories) return false;
				const categoryId = node.value!.toLowerCase();
				const categoryKeywords: string[] = [];
				for (const category of categories) {
					if (category.id?.toLowerCase() === categoryId) {
						for (const keyword of category.keywords) {
							categoryKeywords.push(keyword.keyword.toLowerCase());
						}
					}
				}
				return categoryKeywords.length > 0 && entryKeywords.some(k =>
					categoryKeywords.includes(k.toLowerCase())
				);

			case 'and':
				return this.evaluateFlatEntry(node.left!, entry, categories, modifiers) &&
				       this.evaluateFlatEntry(node.right!, entry, categories, modifiers);

			case 'or':
				return this.evaluateFlatEntry(node.left!, entry, categories, modifiers) ||
				       this.evaluateFlatEntry(node.right!, entry, categories, modifiers);

			case 'not':
				return !this.evaluateFlatEntry(node.child!, entry, categories, modifiers);

			default:
				return false;
		}
	}
}
