import { FilterToken, FilterTokenType, FilterNode, FilterModifiers, CompiledFilter } from '../interfaces/FilterInterfaces';
import type { FlatEntry, ParsedEntrySubItem } from '../interfaces/ParsedFile';
import { getFileNameFromPath } from '../utils/file-helpers';
import { getAllKeywords } from '../utils/parse-helpers';

/**
 * Variables for topic expansion
 */
export interface TopicVariables {
	keyword?: string;
	text?: string;
	block?: string;
	tag?: string;
}

/**
 * Result of splitting expression into SELECT and WHERE clauses
 */
export interface SplitExpression {
	select: string;
	where: string;
	error?: string;
}

/**
 * Parsed SELECT item
 */
export interface SelectItem {
	type: 'keyword' | 'category' | 'language';
	value: string;
	unchecked: boolean;
}

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
 *
 * Variables (expanded before tokenization):
 * - $KEY - Expands to .keyword
 * - $TEXT - Expands to "text"
 * - $BLOCK - Expands to `language
 * - $TAG - Expands to #tag
 */
export class FilterParser {
	/**
	 * Expand variables in filter expression (happens BEFORE tokenization)
	 * Variables are case-insensitive
	 */
	static expandVariables(expression: string, variables: TopicVariables): string {
		let result = expression;

		if (variables.keyword) {
			result = result.replace(/\$KEY/gi, `.${variables.keyword}`);
		}

		if (variables.text) {
			result = result.replace(/\$TEXT/gi, `"${variables.text}"`);
		}

		if (variables.block) {
			result = result.replace(/\$BLOCK/gi, `\`${variables.block}`);
		}

		if (variables.tag) {
			const tagValue = variables.tag.replace(/^#/, '');
			result = result.replace(/\$TAG/gi, `#${tagValue}`);
		}

		return result;
	}

	/**
	 * Parse SELECT clause items
	 * Extracts individual items with unchecked flag
	 *
	 * Syntax:
	 * - .keyword - Checked keyword (default)
	 * - _.keyword - Unchecked keyword (chip created but hidden)
	 * - :category - Checked category
	 * - _:category - Unchecked category
	 * - `language - Checked code block
	 * - _`language - Unchecked code block
	 */
	static parseSelectItems(selectClause: string): SelectItem[] {
		if (!selectClause || selectClause.trim() === '') {
			return [];
		}

		const items: SelectItem[] = [];
		// Split by space or comma
		const tokens = selectClause.split(/[,\s]+/).filter(t => t.trim().length > 0);

		for (const token of tokens) {
			let cleaned = token.trim();
			let unchecked = false;

			// Check for underscore prefix
			if (cleaned.startsWith('_')) {
				unchecked = true;
				cleaned = cleaned.substring(1);
			}

			// Determine type and extract value
			if (cleaned.startsWith('.')) {
				// Keyword (including combined keywords like .foo.bar)
				items.push({
					type: 'keyword',
					value: cleaned.substring(1), // foo or foo.bar
					unchecked
				});
			} else if (cleaned.startsWith(':')) {
				// Category
				items.push({
					type: 'category',
					value: cleaned.substring(1),
					unchecked
				});
			} else if (cleaned.startsWith('`')) {
				// Language
				items.push({
					type: 'language',
					value: cleaned.substring(1),
					unchecked
				});
			}
			// Ignore invalid tokens
		}

		return items;
	}

	/**
	 * Split filter expression into SELECT and WHERE clauses
	 * Happens AFTER variable expansion, BEFORE tokenization
	 *
	 * Syntax:
	 * - <expression> - SELECT only (what to show)
	 * - S: <select> - Explicit SELECT clause
	 * - S: <select> W: <where> - SELECT what to show, WHERE to search
	 * - <select> W: <where> - S: prefix optional
	 * - W: <where> - WHERE only (no SELECT filtering)
	 *
	 * SELECT clause can only contain:
	 * - Keywords: .keyword or _.keyword (unchecked)
	 * - Categories: :category or _:category (unchecked)
	 * - Code blocks: `language or _`language (unchecked)
	 * - Spaces or commas as separators
	 *
	 * WHERE clause can contain full filter syntax (AND, OR, NOT, etc.)
	 */
	static splitExpression(expression: string): SplitExpression {
		expression = expression.trim();

		if (!expression) {
			return { select: '', where: '' };
		}

		const hasWhere = expression.includes('W:');
		let select = expression;
		let where = '';

		if (hasWhere) {
			const parts = expression.split(/W:/);
			select = parts[0].trim();
			where = parts[1]?.trim() || '';
		}

		// Remove S: prefix if present
		if (select.startsWith('S:')) {
			select = select.substring(2).trim();
		}

		// Validate SELECT clause - should NOT contain operators
		if (select && /\b(AND|OR|NOT)\b|[()!]/.test(select)) {
			return {
				select: '',
				where: '',
				error: 'SELECT clause cannot contain operators (AND, OR, NOT, !, ()). Use W: for filtering.'
			};
		}

		// Validate SELECT clause - should NOT contain filtering syntax (tags, paths, text, filenames)
		if (select && /#|\/|"|f"/.test(select)) {
			return {
				select: '',
				where: '',
				error: 'SELECT clause can only contain keywords (.), categories (:), and languages (`). Use W: for tags, paths, text, and filenames.'
			};
		}

		// Validate WHERE clause - should NOT contain underscore prefix
		if (where && /_[.:`]/.test(where)) {
			return {
				select: '',
				where: '',
				error: 'WHERE clause cannot contain underscore prefix (_). Unchecked flag only works in SELECT.'
			};
		}

		return { select, where };
	}

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

			// Header keyword (..foo) or regular keyword (.foo or .foo.bar for multi-keyword matching)
			if (char === '.') {
				// Check for double dot (..foo = header keyword)
				if (i + 1 < expression.length && expression[i + 1] === '.') {
					i += 2; // Skip both dots
					let keyword = '';
					while (i < expression.length && /[a-zA-Z0-9_-]/.test(expression[i])) {
						keyword += expression[i];
						i++;
					}
					tokens.push({ type: FilterTokenType.HEADER_KEYWORD, value: keyword });
					continue;
				}

				// Regular keyword (.foo or .foo.bar)
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

			// Header tag (##foo) or regular tag (#foo)
			if (char === '#') {
				// Check for double hash (##foo = header tag only)
				if (i + 1 < expression.length && expression[i + 1] === '#') {
					i += 2; // Skip both hashes
					let tag = '';
					while (i < expression.length && /[a-zA-Z0-9_-]/.test(expression[i])) {
						tag += expression[i];
						i++;
					}
					tokens.push({ type: FilterTokenType.HEADER_TAG, value: tag });
					continue;
				}

				// Regular tag (#foo = file OR header tag)
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
					if (token.combinedKeyword) {
						node.combinedKeyword = token.combinedKeyword;
					}
					return node;
				}
				case FilterTokenType.HEADER_KEYWORD:
					return { type: 'header_keyword', value: token.value };
				case FilterTokenType.TAG:
					return { type: 'tag', value: token.value };
				case FilterTokenType.HEADER_TAG:
					return { type: 'header_tag', value: token.value };
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
	 * Helper: Extract all keywords from entry (entry keywords + inlineKeywords + all subItem keywords + inlineKeywords)
	 */
	private static getAllKeywords(entry: import('../interfaces/ParsedFile').ParsedEntry): string[] {
		const keywords = [...(entry.keywords || [])];
		if (entry.inlineKeywords) {
			keywords.push(...entry.inlineKeywords);
		}
		if (entry.subItems) {
			for (const subItem of entry.subItems) {
				if (subItem.keywords) {
					keywords.push(...subItem.keywords);
				}
				if (subItem.inlineKeywords) {
					keywords.push(...subItem.inlineKeywords);
				}
			}
		}
		return keywords;
	}

	/**
	 * Helper: Extract all languages from entry (code blocks + inline code languages)
	 */
	/**
	 * Recursively collect languages from subItems and their children
	 */
	private static collectSubItemLanguages(subItems: ParsedEntrySubItem[]): string[] {
		const languages: string[] = [];
		for (const subItem of subItems) {
			if (subItem.codeBlockLanguage) {
				languages.push(subItem.codeBlockLanguage);
			}
			if (subItem.nestedCodeBlock?.language) {
				languages.push(subItem.nestedCodeBlock.language);
			}
			if (subItem.inlineCodeLanguages) {
				languages.push(...subItem.inlineCodeLanguages);
			}
			// Recursively collect from children
			if (subItem.children && subItem.children.length > 0) {
				languages.push(...this.collectSubItemLanguages(subItem.children));
			}
		}
		return languages;
	}

	private static getAllLanguages(entry: import('../interfaces/ParsedFile').ParsedEntry): string[] {
		const languages: string[] = [];
		if (entry.type === 'codeblock' && entry.language) {
			languages.push(entry.language);
		}
		// Add inline code languages from entry
		if (entry.inlineCodeLanguages) {
			languages.push(...entry.inlineCodeLanguages);
		}
		if (entry.subItems) {
			languages.push(...this.collectSubItemLanguages(entry.subItems));
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
	 * Extract SELECT items from filtered entries
	 *
	 * @param selectItems - Parsed SELECT items
	 * @param entries - Entries to extract from (should already be filtered by WHERE clause)
	 * @returns Unique keywords/languages found in entries matching SELECT items
	 */
	static extractSelectItems(selectItems: SelectItem[], entries: FlatEntry[]): string[] {
		const results = new Set<string>();

		for (const entry of entries) {
			for (const item of selectItems) {
				if (item.type === 'keyword') {
					const entryKeywords = getAllKeywords(entry);
					for (const keyword of entryKeywords) {
						if (keyword.toLowerCase() === item.value.toLowerCase()) {
							results.add(keyword);
						}
					}
				} else if (item.type === 'language') {
					const entryLanguages = FilterParser.getAllLanguages(entry);
					for (const lang of entryLanguages) {
						if (lang.toLowerCase() === item.value.toLowerCase()) {
							results.add(lang);
						}
					}
				}
			}
		}

		return Array.from(results).sort();
	}

	/**
	 * Evaluate filter against FlatEntry (optimized for flat data structure)
	 * Replaces the need for flatEntryToContext() conversion
	 * @param node - Filter AST node
	 * @param entry - The flat entry to evaluate (must have filePath, fileName, fileTags added at load time)
	 * @param categories - Categories for category matching
	 * @param modifiers - Filter modifiers
	 */
	/**
	 * Recursively collect keywords from subItems and their children
	 */
	private static collectSubItemKeywords(subItems: ParsedEntrySubItem[]): string[] {
		const keywords: string[] = [];
		for (const subItem of subItems) {
			if (subItem.keywords) {
				keywords.push(...subItem.keywords);
			}
			if (subItem.inlineKeywords) {
				keywords.push(...subItem.inlineKeywords);
			}
			// Recursively collect from children
			if (subItem.children && subItem.children.length > 0) {
				keywords.push(...this.collectSubItemKeywords(subItem.children));
			}
		}
		return keywords;
	}

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
			if (entry.h1.inlineKeywords) headerKeywords.push(...entry.h1.inlineKeywords);
			headerTags.push(...(entry.h1.tags || []));
		}
		if (entry.h2) {
			headerKeywords.push(...(entry.h2.keywords || []));
			if (entry.h2.inlineKeywords) headerKeywords.push(...entry.h2.inlineKeywords);
			headerTags.push(...(entry.h2.tags || []));
		}
		if (entry.h3) {
			headerKeywords.push(...(entry.h3.keywords || []));
			if (entry.h3.inlineKeywords) headerKeywords.push(...entry.h3.inlineKeywords);
			headerTags.push(...(entry.h3.tags || []));
		}

		// Collect keywords from entry and subItems (recursively)
		const entryKeywords = [...(entry.keywords || [])];
		if (entry.inlineKeywords) {
			entryKeywords.push(...entry.inlineKeywords);
		}
		// Only include subItem keywords if topLevelOnly modifier is NOT set
		if (!modifiers?.topLevelOnly && entry.subItems) {
			entryKeywords.push(...this.collectSubItemKeywords(entry.subItems));
		}

		const languages = this.getAllLanguages(entry);
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
				// #tag - Match file tags OR header tags (always checks both)
				const tagValue = node.value!.startsWith('#') ? node.value!.slice(1).toLowerCase() : node.value!.toLowerCase();
				const fileTagMatch = fileTags.some(tag => tag.toLowerCase() === tagValue);
				const headerTagMatch = headerTags.some(tag => tag.toLowerCase() === tagValue);
				const result = fileTagMatch || headerTagMatch;

				return result;

			case 'header_tag':
				// ##tag - Match ONLY header tags
				const headerTagValue = node.value!.startsWith('#') ? node.value!.slice(1).toLowerCase() : node.value!.toLowerCase();
				return headerTags.some(tag => tag.toLowerCase() === headerTagValue);

			case 'header_keyword':
				// ..keyword - Match ONLY header keywords
				return headerKeywords.some(hk => hk.toLowerCase() === node.value!.toLowerCase());

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
				const childResult = this.evaluateFlatEntry(node.child!, entry, categories, modifiers);
				const notResult = !childResult;

				return notResult;

			default:
				return false;
		}
	}
}
