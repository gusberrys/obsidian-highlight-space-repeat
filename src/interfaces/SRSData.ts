/**
 * SRS (Spaced Repetition System) data for keyword records
 * Based on SM-2 algorithm with fuzzy matching support
 */

/**
 * SRS card data for a single keyword/codeblock record
 */
export interface SRSCardData {
	// Identification
	/** Unique identifier: filePath::lineNumber::keyword::type */
	cardId: string;

	/** File path where the record is located */
	filePath: string;

	/** Current line number (updated on fuzzy match) */
	lineNumber: number;

	/** Keyword being reviewed (e.g., "def", "java") */
	keyword: string;

	/** Record type */
	type: 'keyword' | 'codeblock';

	// Fuzzy matching fields
	/** MD5 hash of entry.text (trimmed, normalized) */
	contentHash: string;

	/** First 100 chars of content for debugging */
	contentPreview: string;

	// SM-2 algorithm data
	/** Ease factor (quality of recall, 1.3 to 2.5+) */
	easeFactor: number;

	/** Interval in days until next review */
	interval: number;

	/** Successful repetition count */
	repetitions: number;

	// Review tracking
	/** Next review date (ISO string) */
	nextReviewDate: string;

	/** Last reviewed date (ISO string) */
	lastReviewedDate?: string;

	/** Total number of reviews */
	totalReviews: number;

	/** Number of times marked as "again" or "hard" */
	lapseCount: number;
}

/**
 * SRS settings
 */
export interface SRSSettings {
	/** Show scores (reviews, interval, ease factor, etc.) in review modal */
	showScores: boolean;
}

/**
 * SRS database structure
 */
export interface SRSDatabase {
	/** Database version for migration */
	version: string;

	/** Last updated timestamp (ISO string) */
	lastUpdated: string;

	/** All active SRS cards indexed by cardId */
	cards: Record<string, SRSCardData>;

	/** Fast lookup: contentHash → cardIds[] */
	hashIndex: Record<string, string[]>;

	/** Fast lookup: filePath → cardIds[] */
	fileIndex: Record<string, string[]>;

	/** Orphaned cards (moved/deleted content) */
	orphans?: Record<string, SRSCardData>;

	/** SRS settings */
	settings?: SRSSettings;
}

/**
 * Quality of recall rating (SM-2 algorithm)
 * 0 = Complete blackout
 * 1 = Incorrect response, correct one remembered
 * 2 = Incorrect response, correct one seemed easy to recall
 * 3 = Correct response recalled with serious difficulty
 * 4 = Correct response after hesitation
 * 5 = Perfect response
 */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Simplified review buttons
 */
export type ReviewButton = 'again' | 'hard' | 'good' | 'easy';

/**
 * SRS statistics
 */
export interface SRSStats {
	/** Total number of cards */
	total: number;

	/** Cards due for review today */
	due: number;

	/** Cards never reviewed */
	new: number;

	/** Orphaned cards count */
	orphans: number;

	/** Average ease factor */
	avgEaseFactor: number;

	/** Average interval */
	avgInterval: number;
}
