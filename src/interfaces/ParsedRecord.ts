/**
 * RecordParser data structures for highlight-space-repeat
 *
 * Hierarchical file structure supporting H1, H2, and H3 headers
 * Uses new syntax: foo bar baz :: content (all keywords space-separated before ::)
 */

/**
 * Entry in a file (keyword record or code block)
 */
export interface RecordEntry {
	/** Entry type */
	type: 'keyword' | 'codeblock';

	/** Line number where entry starts */
	lineNumber: number;

	/** Main text content (without sub-items) */
	text: string;

	/** All keywords (space-separated before ::) */
	keywords?: string[];

	/** Language (for code blocks) */
	language?: string;

	/** Sub-items (list items, code blocks) */
	subItems?: RecordSubItem[];
}

/**
 * Sub-item within an entry
 */
export interface RecordSubItem {
	/** All keywords for sub-item (space-separated before ::) */
	keywords?: string[];

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
export interface RecordHeader {
	/** Header text (null if entries have no header) */
	text: string | null;

	/** Header level (0=no header, 1=H1, 2=H2, 3=H3) */
	level: number;

	/** All keywords parsed from header (e.g., ["def", "do", "don"] from "## def do don :: Title") */
	keywords?: string[];

	/** Tags parsed from header line */
	tags: string[];

	/** Entries directly under this header */
	entries: RecordEntry[];

	/** Child headers (H2s under H1, H3s under H2) */
	children?: RecordHeader[];
}

/**
 * Parsed file structure
 */
export interface ParsedRecord {
	/** File path */
	filePath: string;

	/** File name (with extension) */
	fileName: string;

	/** Tags from frontmatter (excludes header tags) */
	tags: string[];

	/** Aliases from frontmatter */
	aliases: string[];

	/** Headers with hierarchical structure (H1 → H2 → H3) */
	headers: RecordHeader[];
}
