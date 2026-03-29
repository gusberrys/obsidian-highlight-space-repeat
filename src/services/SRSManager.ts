import { App } from 'obsidian';
import { ReviewButton, ReviewQuality } from '../interfaces/SRSData';
import { FlatEntry, ParsedFile } from '../interfaces/ParsedFile';
import { isSpaced } from '../shared/collecting-status';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';

/**
 * SRS (Spaced Repetition System) Manager - File-based system
 * SRS data stored as HTML comments directly in markdown files
 */
export class SRSManager {
	constructor(private app: App) {}

	/**
	 * Check if entry has any SPACED keywords
	 */
	private hasSpacedKeyword(entry: FlatEntry): boolean {
		if (!entry.keywords || entry.keywords.length === 0) return false;

		const categories = (HighlightSpaceRepeatPlugin as any).settings?.categories || [];

		for (const keyword of entry.keywords) {
			for (const category of categories) {
				const keywordDef = category.keywords?.find((k: any) => k.keyword === keyword);
				if (keywordDef && isSpaced(keywordDef.collectingStatus)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Get entries due for review from parsed records
	 * Includes:
	 * 1. Entries with SRS data where nextReviewDate <= today
	 * 2. Entries with SPACED keywords but no SRS data yet (new entries)
	 */
	getDueEntries(parsedRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const today = new Date();
		today.setHours(0, 0, 0, 0); // Start of today

		const dueEntries: Array<{ entry: FlatEntry; file: ParsedFile }> = [];
		let newCount = 0;
		let dueCount = 0;

		for (const file of parsedRecords) {
			for (const entry of file.entries) {
				// Only keyword entries can have SRS data
				if (entry.type !== 'keyword') {
					continue;
				}

				if (entry.srs) {
					// Has SRS data - check if due
					const nextReview = new Date(entry.srs.next);
					nextReview.setHours(0, 0, 0, 0);

					if (nextReview <= today) {
						dueEntries.push({ entry, file });
						dueCount++;
					}
				} else if (this.hasSpacedKeyword(entry)) {
					// No SRS data yet, but has SPACED keyword - it's a new entry, due for first review
					dueEntries.push({ entry, file });
					newCount++;
				}
			}
		}

		return dueEntries;
	}

	/**
	 * Get all entries with SRS data (for statistics)
	 * Includes:
	 * 1. Entries with SRS data (being tracked)
	 * 2. Entries with SPACED keywords but no SRS data yet (new entries)
	 */
	getAllSRSEntries(parsedRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const allEntries: Array<{ entry: FlatEntry; file: ParsedFile }> = [];
		let withSRS = 0;
		let withoutSRS = 0;

		for (const file of parsedRecords) {
			for (const entry of file.entries) {
				if (entry.type === 'keyword') {
					// Include if has SRS data OR has SPACED keyword
					if (entry.srs) {
						allEntries.push({ entry, file });
						withSRS++;
					} else if (this.hasSpacedKeyword(entry)) {
						allEntries.push({ entry, file });
						withoutSRS++;
					}
				}
			}
		}

		return allEntries;
	}

	/**
	 * Review an entry using SM-2 algorithm and update the file
	 * @param filePath Path to the file containing the entry
	 * @param lineNumber Line number of the entry (1-based)
	 * @param button Review button pressed
	 */
	async reviewEntry(filePath: string, lineNumber: number, button: ReviewButton): Promise<void> {
		try {
			// Read file content
			const fileContent = await this.app.vault.adapter.read(filePath);
			const lines = fileContent.split('\n');

			// Find the entry line (convert to 0-based index)
			const lineIndex = lineNumber - 1;
			if (lineIndex < 0 || lineIndex >= lines.length) {
				console.error(`[SRS] Invalid line number: ${lineNumber} in ${filePath}`);
				return;
			}

			let entryLine = lines[lineIndex];

			// Extract existing SRS data
			const srsMatch = entryLine.match(/<!--\s*srs:\s*(\{[^}]+\})\s*-->/);
			let srsData: { ef: number; i: number; r: number; next: string };

			if (srsMatch) {
				// Parse existing SRS data
				srsData = JSON.parse(srsMatch[1]);
				// Remove old comment
				entryLine = entryLine.replace(srsMatch[0], '').trim();
			} else {
				// Initialize new SRS data
				srsData = {
					ef: 2.5, // Initial ease factor
					i: 0,    // Initial interval
					r: 0,    // Initial repetitions
					next: new Date().toISOString().split('T')[0] // Today
				};
			}

			// Apply SM-2 algorithm
			const quality = this.buttonToQuality(button);

			// Update interval and repetitions
			if (quality >= 3) {
				// Correct response
				if (srsData.r === 0) {
					srsData.i = 1;
				} else if (srsData.r === 1) {
					srsData.i = 6;
				} else {
					srsData.i = Math.round(srsData.i * srsData.ef);
				}
				srsData.r++;
			} else {
				// Incorrect response - reset and show again today
				srsData.r = 0;
				srsData.i = 0;
			}

			// Update ease factor (minimum 1.3, rounded to 2 decimal places)
			srsData.ef = Math.round(
				Math.max(
					1.3,
					srsData.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
				) * 100
			) / 100;

			// Calculate next review date (YYYY-MM-DD format)
			const nextReview = new Date();
			nextReview.setDate(nextReview.getDate() + srsData.i);
			srsData.next = nextReview.toISOString().split('T')[0];

			// Format SRS comment (compact JSON on same line)
			const srsComment = `<!-- srs: ${JSON.stringify(srsData)} -->`;

			// Add comment to end of line
			entryLine = `${entryLine} ${srsComment}`;

			// Update line in file
			lines[lineIndex] = entryLine;

			// Write back to file
			const updatedContent = lines.join('\n');
			await this.app.vault.adapter.write(filePath, updatedContent);

			console.log(`[SRS] Reviewed entry at ${filePath}:${lineNumber}`);
			console.log(`  Quality: ${quality}, Interval: ${srsData.i} days, Ease: ${srsData.ef.toFixed(2)}, Next: ${srsData.next}`);
		} catch (error) {
			console.error(`[SRS] Error reviewing entry:`, error);
			throw error;
		}
	}

	/**
	 * Convert review button to quality rating (SM-2 algorithm)
	 */
	private buttonToQuality(button: ReviewButton): ReviewQuality {
		switch (button) {
			case 'again': return 0;
			case 'hard': return 2;
			case 'good': return 4;
			case 'easy': return 5;
		}
	}

	/**
	 * Get SRS statistics from parsed records
	 */
	getStats(parsedRecords: ParsedFile[]): {
		total: number;
		due: number;
		new: number;
		avgEaseFactor: number;
		avgInterval: number;
	} {
		const allEntries = this.getAllSRSEntries(parsedRecords);
		const dueEntries = this.getDueEntries(parsedRecords);

		// New entries = entries with no SRS data OR entries with r=0
		const newEntries = allEntries.filter(({ entry }) => !entry.srs || entry.srs.r === 0);

		let totalEase = 0;
		let totalInterval = 0;
		let entriesWithSRS = 0;

		for (const { entry } of allEntries) {
			if (entry.srs) {
				totalEase += entry.srs.ef;
				totalInterval += entry.srs.i;
				entriesWithSRS++;
			} else {
				// New entry - use default values for stats
				totalEase += 2.5; // Default ease factor
				totalInterval += 0; // Default interval
			}
		}

		return {
			total: allEntries.length,
			due: dueEntries.length,
			new: newEntries.length,
			avgEaseFactor: allEntries.length > 0 ? totalEase / allEntries.length : 2.5,
			avgInterval: allEntries.length > 0 ? totalInterval / allEntries.length : 0
		};
	}

	/**
	 * No-op methods for backward compatibility (used by plugin initialization)
	 */
	async load(): Promise<void> {
		// SRS data now loaded from files during parsing - nothing to do
		console.log('[SRS] Using file-based SRS system (no database to load)');
	}

	async save(): Promise<void> {
		// SRS data saved directly to files during review - nothing to do
		console.log('[SRS] SRS data saved to files during review');
	}

	isLoaded(): boolean {
		// Always "loaded" since we read from files
		return true;
	}
}
