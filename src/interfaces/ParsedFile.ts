/**
 * File parser data structures for highlight-space-repeat
 *
 * Hierarchical file structure supporting H1, H2, and H3 headers
 * Uses new syntax: foo bar baz :: content (all keywords space-separated before ::)
 */

/**
 * Entry in a file (keyword line or code block)
 */
export interface ParsedEntry {
	/** Entry type */
	type: 'keyword' | 'codeblock';

	/** Line number where entry starts */
	lineNumber: number;

	/** Main text content (without sub-items) */
	text: string;

	/** All keywords (space-separated before ::) */
	keywords?: string[];

	/** Inline keywords extracted from <mark class="xxx"> tags (for filtering only) */
	inlineKeywords?: string[];

	/** Inline code languages extracted from `{language options} code` syntax (for filtering only) */
	inlineCodeLanguages?: string[];

	/** Language (for code blocks) */
	language?: string;

	/** Sub-items (list items, code blocks) */
	subItems?: ParsedEntrySubItem[];
}

/**
 * Sub-item within an entry
 */
export interface ParsedEntrySubItem {
	/** All keywords for sub-item (space-separated before ::) */
	keywords?: string[];

	/** Inline keywords extracted from <mark class="xxx"> tags (for filtering only) */
	inlineKeywords?: string[];

	/** Inline code languages extracted from `{language options} code` syntax (for filtering only) */
	inlineCodeLanguages?: string[];

	/** Sub-item content */
	content: string;

	/** Type of list marker */
	listType: 'dash' | 'asterisk' | 'numbered' | 'checkbox' | 'code-block' | 'blockquote';

	/** Checkbox state (for checkbox items) */
	checked?: boolean;

	/** Code block language (for code-block items) */
	codeBlockLanguage?: string;

	/** Nested code block (only for list items: dash, asterisk, numbered, checkbox) */
	nestedCodeBlock?: {
		language: string;
		content: string;
	};
}

/**
 * Header at any level (H1, H2, or H3)
 * Supports recursive nesting
 */
export interface ParsedHeader {
	/** Header text (null if entries have no header) */
	text: string | null;

	/** Header level (0=no header, 1=H1, 2=H2, 3=H3) */
	level: number;

	/** All keywords parsed from header (e.g., ["def", "do", "don"] from "## def do don :: Title") */
	keywords?: string[];

	/** Tags parsed from header line */
	tags: string[];

	/** Entries directly under this header */
	entries: ParsedEntry[];

	/** Child headers (H2s under H1, H3s under H2) */
	children?: ParsedHeader[];
}

/**
 * Header context information stored with each flat entry
 */
export interface HeaderInfo {
	/** Header text */
	text: string;

	/** Tags from this header line (optional - omitted if empty) */
	tags?: string[];

	/** Keywords from this header line (optional - omitted if empty) */
	keywords?: string[];

	/** Inline keywords extracted from <mark class="xxx"> tags (optional - for filtering only) */
	inlineKeywords?: string[];

	/** Inline code languages extracted from `{language options} code` syntax (for filtering only) */
	inlineCodeLanguages?: string[];
}

/**
 * Flat entry structure - combines entry data with full header context
 * Replaces hierarchical ParsedHeader structure for efficient filtering/rendering
 *
 * Note: filePath, fileTags are NOT stored in parsed-files.json.
 * They are added at runtime when the file is loaded (as references to ParsedFile properties).
 */
export interface FlatEntry {
	// Entry data
	type: 'keyword' | 'codeblock';
	keywords?: string[];
	inlineKeywords?: string[];
	inlineCodeLanguages?: string[];
	text: string;
	lineNumber: number;
	language?: string;
	subItems?: ParsedEntrySubItem[];

	// Header context (optional - only if entry is under headers)
	h1?: HeaderInfo;
	h2?: HeaderInfo;
	h3?: HeaderInfo;

	// File context (added at runtime, not stored on disk)
	filePath?: string;
	fileTags?: string[];
}

/**
 * Parsed file structure
 */
export interface ParsedFile {
	/** File path */
	filePath: string;

	/** Tags from frontmatter (excludes header tags) */
	tags: string[];

	/** Aliases from frontmatter (optional - omitted if empty) */
	aliases?: string[];

	/** Flat entries array - all entries with header context embedded */
	entries: FlatEntry[];
}
