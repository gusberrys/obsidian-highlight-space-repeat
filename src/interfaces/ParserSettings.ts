/**
 * Parser configuration settings for highlight-space-repeat
 */
export interface ParserSettings {
	/** Patterns to exclude (e.g., ["_/", "templates/"]) */
	excludePatterns: string[];
}

/**
 * Default parser settings
 */
export const DEFAULT_PARSER_SETTINGS: ParserSettings = {
	excludePatterns: ['_/']
};
