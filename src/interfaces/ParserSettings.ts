/**
 * Parser scan result containing file statistics
 */
export interface ParserScanResult {
	/** Total number of files found */
	totalFiles: number;

	/** Number of files that will be read */
	includedFiles: number;

	/** Number of files that will be excluded */
	excludedFiles: number;

	/** List of excluded file paths (up to a limit) */
	excludedFilePaths: string[];

	/** List of included file paths (up to a limit) */
	includedFilePaths: string[];

	/** Scan duration in milliseconds */
	scanDuration: number;

	/** Path that was scanned */
	scannedPath: string;

	/** Patterns used for exclusion */
	excludePatterns: string[];

	/** Keyword counts - map of keyword to count */
	keywordCounts?: Record<string, number>;
}

/**
 * Parser configuration settings
 */
export interface ParserConfig {
	/** Path to scan (relative to vault root) */
	scanPath: string;

	/** Patterns to exclude (e.g., "_/", "templates/") */
	excludePatterns: string[];

	/** File extensions to include (e.g., [".md"]) */
	fileExtensions: string[];

	/** Maximum depth to scan (-1 for unlimited) */
	maxDepth: number;

	/** Whether to follow symbolic links */
	followSymlinks: boolean;
}

/**
 * Parser configuration settings for highlight-space-repeat (simplified)
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
