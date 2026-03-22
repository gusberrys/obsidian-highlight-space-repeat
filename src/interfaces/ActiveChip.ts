/**
 * Active chip for filtering (adapted from knowledge-base)
 */
export interface ActiveChip {
	type: 'keyword' | 'language' | 'category';
	value: string; // The actual keyword, language, or category value
	mode: 'include' | 'exclude'; // Positive or negative filtering
	label: string; // Display text
	icon?: string; // Emoji/icon
	color?: string; // Text color
	backgroundColor?: string; // Background color
	active: boolean; // Whether chip is currently active (clickable on/off)
	badge?: string; // Badge icon (for category keywords)
	isTemporary?: boolean; // Temporary chip created by "Show All" mode
}
