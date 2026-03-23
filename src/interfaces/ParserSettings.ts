/**
 * Parser configuration settings for highlight-space-repeat
 */
export interface ParserSettings {
	/** Patterns to exclude (e.g., ["_/", "templates/"]) */
	excludePatterns: string[];

	/**
	 * Parse inline <mark> tags to extract keywords
	 * When enabled, text like "foo :: bar <mark class="baz">text</mark>" will include "baz" as a keyword
	 */
	parseInlines?: boolean;
}

/**
 * Default parser settings
 */
export const DEFAULT_PARSER_SETTINGS: ParserSettings = {
	excludePatterns: ['_/'],
	parseInlines: true
};
