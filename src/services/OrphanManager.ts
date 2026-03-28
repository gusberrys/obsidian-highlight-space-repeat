import { App } from 'obsidian';
import { SRSManager } from './SRSManager';
import { ParsedFile, ParsedHeader, ParsedEntry } from '../interfaces/ParsedFile';
import { ContentHasher } from './ContentHasher';
import { SRSCardData } from '../interfaces/SRSData';

/**
 * Orphan Manager - Detects and manages orphaned SRS cards
 * Orphaned cards are review records that no longer match any parsed entry
 */
export class OrphanManager {
	constructor(
		private app: App,
		private srsManager: SRSManager
	) {}

	/**
	 * Scan database for orphaned cards
	 *
	 * @param parsedRecords All parsed records from cache
	 */
	async detectOrphans(parsedRecords: ParsedFile[]): Promise<void> {
		console.log('[Orphan] Starting orphan detection...');

		// Build index of all current entries
		const activeEntries = this.buildEntryIndex(parsedRecords);
		console.log(`[Orphan] Found ${activeEntries.size} active entries`);

		const database = this.srsManager.getDatabase();
		let orphaned = 0;
		let verified = 0;

		for (const [cardId, card] of Object.entries(database.cards)) {
			const key = `${card.filePath}::${card.lineNumber}::${card.keyword}::${card.type}`;

			// Check if entry still exists at this location
			const entry = activeEntries.get(key);

			if (!entry) {
				// Entry not found at expected location
				// Try fuzzy match in same file
				const fuzzyMatch = this.findFuzzyMatchInFile(
					card,
					parsedRecords.find(r => r.filePath === card.filePath)
				);

				if (!fuzzyMatch) {
					// No match found - mark as orphan
					console.warn(`[Orphan] Card orphaned: ${cardId}`);
					console.warn(`  File: ${card.filePath}`);
					console.warn(`  Keyword: ${card.keyword}`);
					console.warn(`  Preview: ${card.contentPreview}`);

					if (!database.orphans) {
						database.orphans = {};
					}

					database.orphans[cardId] = card;
					delete database.cards[cardId];
					orphaned++;
				} else {
					verified++;
				}
			} else {
				// Entry exists - verify content hash
				const currentHash = ContentHasher.hashContent(entry.text);

				if (currentHash === card.contentHash) {
					verified++;
				} else {
					console.warn(`[Orphan] Content mismatch at ${cardId}`);
					console.warn(`  Expected hash: ${card.contentHash}`);
					console.warn(`  Current hash:  ${currentHash}`);
					// Card stays active but content has changed
					verified++;
				}
			}
		}

		console.log(`[Orphan] Detection complete: ${verified} verified, ${orphaned} orphaned`);

		// Save if orphans were found
		if (orphaned > 0) {
			await this.srsManager.save();
		}
	}

	/**
	 * Build index of all entries from parsed records
	 * Key format: "filePath::lineNumber::keyword::type"
	 */
	private buildEntryIndex(parsedRecords: ParsedFile[]): Map<string, ParsedEntry> {
		const index = new Map<string, ParsedEntry>();

		for (const record of parsedRecords) {
			// Entries are already flat in record.entries
			for (const entry of record.entries) {
				if (entry.keywords) {
					for (const keyword of entry.keywords) {
						const key = `${record.filePath}::${entry.lineNumber}::${keyword}::${entry.type}`;
						index.set(key, entry);
					}
				}
			}
		}

		return index;
	}

	/**
	 * Try to find fuzzy match for a card within the same file
	 */
	private findFuzzyMatchInFile(
		card: any,
		parsedRecord: ParsedFile | undefined
	): ParsedEntry | null {
		if (!parsedRecord) {
			return null;
		}

		// Search all entries in this file for matching content hash
		// Entries are already flat in record.entries
		for (const entry of parsedRecord.entries) {
			if (entry.type === card.type && entry.keywords?.includes(card.keyword)) {
				const entryHash = ContentHasher.hashContent(entry.text);
				if (entryHash === card.contentHash) {
					return entry;
				}
			}
		}

		return null;
	}

	/**
	 * Cleanup orphans older than X days
	 *
	 * @param daysOld Orphans older than this many days will be deleted
	 * @returns Number of orphans cleaned up
	 */
	async cleanupOldOrphans(daysOld: number = 90): Promise<number> {
		const database = this.srsManager.getDatabase();
		if (!database.orphans) {
			return 0;
		}

		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - daysOld);

		let cleaned = 0;

		for (const [cardId, orphan] of Object.entries(database.orphans)) {
			const lastReview = orphan.lastReviewedDate
				? new Date(orphan.lastReviewedDate)
				: new Date(0);

			if (lastReview < cutoffDate) {
				delete database.orphans[cardId];
				cleaned++;
				console.log(`[Orphan] Cleaned old orphan: ${cardId}`);
			}
		}

		if (cleaned > 0) {
			await this.srsManager.save();
			console.log(`[Orphan] Cleaned ${cleaned} old orphans (${daysOld}+ days)`);
		}

		return cleaned;
	}

	/**
	 * Attempt to reconnect all orphans
	 * Runs fuzzy matching on orphaned cards
	 *
	 * @param parsedRecords All parsed records from cache
	 * @returns Number of orphans reconnected
	 */
	async attemptReconnection(parsedRecords: ParsedFile[]): Promise<number> {
		const database = this.srsManager.getDatabase();
		if (!database.orphans) {
			return 0;
		}

		let reconnected = 0;
		const orphanIds = Object.keys(database.orphans);

		for (const orphanId of orphanIds) {
			const orphan: SRSCardData = database.orphans[orphanId];
			if (!orphan) continue;

			// Find matching entry in parsed records
			const parsedRecord = parsedRecords.find(r => r.filePath === orphan.filePath);
			if (!parsedRecord) {
				continue;
			}

			// Search all entries in this file for matching content hash
			// Entries are already flat in record.entries
			let matchedEntry: ParsedEntry | null = null;
			for (const entry of parsedRecord.entries) {
				if (entry.type === orphan.type && entry.keywords?.includes(orphan.keyword)) {
					const entryHash = ContentHasher.hashContent(entry.text);
					if (entryHash === orphan.contentHash) {
						matchedEntry = entry;
						break;
					}
				}
			}

			if (matchedEntry) {
				// Found match! Restore orphan
				const newCardId = `${orphan.filePath}::${matchedEntry.lineNumber}::${orphan.keyword}::${orphan.type}`;

				orphan.lineNumber = matchedEntry.lineNumber;
				orphan.cardId = newCardId;

				database.cards[newCardId] = orphan;
				delete database.orphans[orphanId];

				reconnected++;
				console.log(`[Orphan] Reconnected: ${orphanId} → ${newCardId}`);
			}
		}

		if (reconnected > 0) {
			await this.srsManager.save();
			console.log(`[Orphan] Reconnected ${reconnected} orphans`);
		}

		return reconnected;
	}

	/**
	 * Get orphan statistics
	 */
	getOrphanStats(): { count: number; totalReviews: number; avgInterval: number } {
		const database = this.srsManager.getDatabase();
		if (!database.orphans) {
			return { count: 0, totalReviews: 0, avgInterval: 0 };
		}

		const orphans = Object.values(database.orphans);
		const totalReviews = orphans.reduce((sum, o) => sum + o.totalReviews, 0);
		const totalInterval = orphans.reduce((sum, o) => sum + o.interval, 0);

		return {
			count: orphans.length,
			totalReviews,
			avgInterval: orphans.length > 0 ? totalInterval / orphans.length : 0
		};
	}
}
