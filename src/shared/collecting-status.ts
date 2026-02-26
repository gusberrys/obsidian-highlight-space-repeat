/**
 * Collecting status for keywords
 * Determines how keywords are collected from notes
 */
export enum CollectingStatus {
	/** Keyword is ignored - not collected from notes */
	IGNORED = 'IGNORED',

	/** Keyword is parsed/collected from notes */
	PARSED = 'PARSED',

	/** Keyword is parsed AND included in spaced repetition system */
	SPACED = 'SPACED'
}

/**
 * Helper to check if a keyword is collected (parsed or spaced)
 */
export function isCollected(status: CollectingStatus | undefined): boolean {
	return status === CollectingStatus.PARSED || status === CollectingStatus.SPACED;
}

/**
 * Helper to check if a keyword is in SRS
 */
export function isSpaced(status: CollectingStatus | undefined): boolean {
	return status === CollectingStatus.SPACED;
}
