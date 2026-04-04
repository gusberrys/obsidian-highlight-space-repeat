
/**
 * Filter expression syntax:
 * .keyword - Match keyword
 * #tag - Match file tag
 * /path - Match file path
 * f"filename" - Match file name (not full path)
 * "text" - Match plaintext in code
 * `language - Match code block language
 * \h - Modifier: also match tokens in headers
 * AND - Logical AND
 * OR - Logical OR
 * ! - Negation prefix
 *
 * Examples:
 * - .foo - Records with keyword "foo"
 * - #project - Records from files with tag "project"
 * - /notes - Records from files under path "notes"
 * - f"addiction" - Records from files named containing "addiction"
 * - `java - Code blocks in Java
 * - .foo.bar - Records with BOTH "foo" AND "bar" in keywords array
 * - `java OR `python - Java or Python code
 * - .foo AND #project - foo keyword AND project tag
 * - !#draft - Records from files WITHOUT tag "draft"
 */

/**
 * Parsed filter token types
 */
export enum FilterTokenType {
	KEYWORD = 'keyword',           // .foo (entry keyword)
	TAG = 'tag',                   // #foo (file OR header tag)
	HEADER_KEYWORD = 'header_keyword',  // ..foo (header keyword only)
	HEADER_TAG = 'header_tag',     // ##foo (header tag only)
	PATH = 'path',                 // /foo/bar
	FILENAME = 'filename',         // f"foo" - file name match
	TEXT = 'text',                 // "plaintext"
	LANGUAGE = 'language',         // `java
	CATEGORY = 'category',         // :fun-category - expands to all keywords with categoryClass
	AND = 'and',
	OR = 'or',
	NOT = 'not',                   // !
	LPAREN = 'lparen',             // (
	RPAREN = 'rparen',             // )
	MODIFIER = 'modifier'          // \h, \a, \s, \t
}

/**
 * Filter token
 */
export interface FilterToken {
	type: FilterTokenType;
	value: string;
	negated?: boolean;
	combinedKeyword?: string; // For .def.foo syntax
}

/**
 * Filter expression AST node
 */
export interface FilterNode {
	type: 'keyword' | 'tag' | 'header_keyword' | 'header_tag' | 'path' | 'filename' | 'text' | 'language' | 'category' | 'and' | 'or' | 'not';
	value?: string;
	combinedKeyword?: string; // For .def.foo syntax - match combined keyword
	multiKeywords?: string[]; // For .foo.bar syntax - match ALL keywords in array
	negated?: boolean;
	includeHeaders?: boolean; // + prefix: match headers too
	left?: FilterNode;
	right?: FilterNode;
	child?: FilterNode;
}

/**
 * Filter modifiers extracted from expression
 */
export interface FilterModifiers {
	/** \h - Enable header-level matching (all keywords/tags check headers too) */
	enableHeaders?: boolean;

	/** \s - Trim subelement (affects display) */
	trimSubelement?: boolean;

	/** \t - Top-level only (affects matching) */
	topLevelOnly?: boolean;
}

/**
 * Compiled filter result with AST and modifiers
 */
export interface CompiledFilter {
	/** Abstract syntax tree for the filter expression */
	ast: FilterNode | null;

	/** Extracted modifiers */
	modifiers: FilterModifiers;
}
