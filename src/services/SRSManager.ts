import { App } from 'obsidian';
import { SRSCardData, SRSDatabase, ReviewButton, ReviewQuality, SRSStats } from '../interfaces/SRSData';
import { RecordEntry } from '../interfaces/ParsedRecord';
import { ContentHasher } from './ContentHasher';

/**
 * SRS (Spaced Repetition System) Manager with fuzzy matching
 * Manages review data with content-based card identification
 */
export class SRSManager {
	private database: SRSDatabase;
	private dataPath: string;
	private loaded: boolean = false;

	constructor(private app: App) {
		this.dataPath = '.obsidian/plugins/highlight-space-repeat/app-data/srs-data.json';
		this.database = this.createEmptyDatabase();
	}

	/**
	 * Create empty database structure
	 */
	private createEmptyDatabase(): SRSDatabase {
		return {
			version: '1.0.0',
			cards: {},
			hashIndex: {},
			fileIndex: {},
			orphans: {},
			lastUpdated: new Date().toISOString(),
			settings: {
				showScores: true
			}
		};
	}

	/**
	 * Load SRS database from disk
	 */
	async load(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (await adapter.exists(this.dataPath)) {
				const data = await adapter.read(this.dataPath);
				this.database = JSON.parse(data);

				// Initialize settings if missing (backward compatibility)
				if (!this.database.settings) {
					this.database.settings = {
						showScores: true
					};
				}

				// Rebuild indices for fast lookup
				this.rebuildIndices();

				const cardCount = Object.keys(this.database.cards).length;
				const orphanCount = this.database.orphans ? Object.keys(this.database.orphans).length : 0;

				console.log(`[SRS] Loaded ${cardCount} cards, ${orphanCount} orphans`);
			} else {
				console.log('[SRS] No existing database, starting fresh');
			}

			this.loaded = true;
		} catch (error) {
			console.error('[SRS] Error loading database:', error);
			this.database = this.createEmptyDatabase();
			this.loaded = true;
		}
	}

	/**
	 * Save SRS database to disk
	 */
	async save(): Promise<void> {
		try {
			this.database.lastUpdated = new Date().toISOString();
			const adapter = this.app.vault.adapter;

			// Ensure directory exists
			const dir = this.dataPath.substring(0, this.dataPath.lastIndexOf('/'));
			if (!await adapter.exists(dir)) {
				await adapter.mkdir(dir);
			}

			await adapter.write(this.dataPath, JSON.stringify(this.database, null, 2));

			const cardCount = Object.keys(this.database.cards).length;
			console.log(`[SRS] Saved ${cardCount} cards`);
		} catch (error) {
			console.error('[SRS] Error saving database:', error);
		}
	}

	/**
	 * Rebuild hash and file indices for fast lookup
	 */
	private rebuildIndices(): void {
		this.database.hashIndex = {};
		this.database.fileIndex = {};

		for (const [cardId, card] of Object.entries(this.database.cards)) {
			// Hash index
			if (!this.database.hashIndex[card.contentHash]) {
				this.database.hashIndex[card.contentHash] = [];
			}
			this.database.hashIndex[card.contentHash].push(cardId);

			// File index
			if (!this.database.fileIndex[card.filePath]) {
				this.database.fileIndex[card.filePath] = [];
			}
			this.database.fileIndex[card.filePath].push(cardId);
		}
	}

	/**
	 * Generate card ID from components
	 */
	private generateCardId(
		filePath: string,
		lineNumber: number,
		keyword: string,
		type: 'keyword' | 'codeblock'
	): string {
		return `${filePath}::${lineNumber}::${keyword}::${type}`;
	}

	/**
	 * Get or create SRS card with FUZZY MATCHING
	 * This is the core fuzzy matching algorithm
	 *
	 * @param filePath File path where record is located
	 * @param lineNumber Current line number
	 * @param keyword Keyword being reviewed
	 * @param type Record type
	 * @param entry Full entry for content hash generation
	 * @returns SRS card (existing or new)
	 */
	getCard(
		filePath: string,
		lineNumber: number,
		keyword: string,
		type: 'keyword' | 'codeblock',
		entry: RecordEntry
	): SRSCardData {
		const contentHash = ContentHasher.hashContent(entry.text);
		const currentCardId = this.generateCardId(filePath, lineNumber, keyword, type);

		// STEP 1: Try exact match (fast path)
		if (this.database.cards[currentCardId]) {
			const card = this.database.cards[currentCardId];

			// Verify content hasn't changed
			if (card.contentHash === contentHash) {
				// Perfect match - same location, same content
				return card;
			} else {
				// Content changed at this line - treat as new card
				console.warn(`[SRS] Content changed at ${currentCardId}`);
				console.warn(`  Old hash: ${card.contentHash}`);
				console.warn(`  New hash: ${contentHash}`);
				return this.createNewCard(filePath, lineNumber, keyword, type, entry);
			}
		}

		// STEP 2: Fuzzy match by content hash (content moved)
		const hashMatches = this.database.hashIndex[contentHash] || [];

		for (const candidateId of hashMatches) {
			const candidate = this.database.cards[candidateId];

			// Match conditions:
			// - Same file path
			// - Same keyword
			// - Same type
			// - Same content hash
			if (
				candidate.filePath === filePath &&
				candidate.keyword === keyword &&
				candidate.type === type
			) {
				// FOUND! Content moved to different line
				console.log(`[SRS] Fuzzy match found!`);
				console.log(`  Old: ${candidateId}`);
				console.log(`  New: ${currentCardId}`);
				console.log(`  Line changed: ${candidate.lineNumber} → ${lineNumber}`);

				// Reconnect card to new location
				return this.reconnectCard(candidate, lineNumber, currentCardId);
			}
		}

		// STEP 3: Check orphaned cards
		const orphan = this.findOrphanedCard(filePath, keyword, type, contentHash);
		if (orphan) {
			console.log(`[SRS] Restored orphan card!`);
			console.log(`  Old: ${orphan.cardId}`);
			console.log(`  New: ${currentCardId}`);
			return this.restoreOrphan(orphan, lineNumber, currentCardId);
		}

		// STEP 4: No match found, create new card
		console.log(`[SRS] Creating new card: ${currentCardId}`);
		return this.createNewCard(filePath, lineNumber, keyword, type, entry);
	}

	/**
	 * Reconnect existing card to new location
	 */
	private reconnectCard(
		card: SRSCardData,
		newLineNumber: number,
		newCardId: string
	): SRSCardData {
		const oldCardId = card.cardId;

		// Remove old card
		delete this.database.cards[oldCardId];

		// Update card
		card.lineNumber = newLineNumber;
		card.cardId = newCardId;

		// Add back with new ID
		this.database.cards[newCardId] = card;

		// Rebuild indices
		this.rebuildIndices();

		return card;
	}

	/**
	 * Create new card with default SM-2 values
	 */
	private createNewCard(
		filePath: string,
		lineNumber: number,
		keyword: string,
		type: 'keyword' | 'codeblock',
		entry: RecordEntry
	): SRSCardData {
		const cardId = this.generateCardId(filePath, lineNumber, keyword, type);
		const contentHash = ContentHasher.hashContent(entry.text);
		const contentPreview = ContentHasher.getPreview(entry.text);

		const card: SRSCardData = {
			cardId,
			filePath,
			lineNumber,
			keyword,
			type,
			contentHash,
			contentPreview,
			easeFactor: 2.5,
			interval: 0,
			repetitions: 0,
			nextReviewDate: new Date().toISOString(),
			totalReviews: 0,
			lapseCount: 0
		};

		this.database.cards[cardId] = card;
		this.rebuildIndices();

		return card;
	}

	/**
	 * Find orphaned card by content hash
	 */
	private findOrphanedCard(
		filePath: string,
		keyword: string,
		type: 'keyword' | 'codeblock',
		contentHash: string
	): SRSCardData | null {
		if (!this.database.orphans) {
			return null;
		}

		for (const orphan of Object.values(this.database.orphans)) {
			if (
				orphan.filePath === filePath &&
				orphan.keyword === keyword &&
				orphan.type === type &&
				orphan.contentHash === contentHash
			) {
				return orphan;
			}
		}

		return null;
	}

	/**
	 * Restore orphaned card to active cards
	 */
	private restoreOrphan(
		orphan: SRSCardData,
		newLineNumber: number,
		newCardId: string
	): SRSCardData {
		// Remove from orphans
		if (this.database.orphans) {
			delete this.database.orphans[orphan.cardId];
		}

		// Update and add to active cards
		orphan.lineNumber = newLineNumber;
		orphan.cardId = newCardId;
		this.database.cards[newCardId] = orphan;

		this.rebuildIndices();

		return orphan;
	}

	/**
	 * Review card using SM-2 algorithm
	 * Based on: https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
	 */
	reviewCard(cardId: string, button: ReviewButton): void {
		const card = this.database.cards[cardId];
		if (!card) {
			console.error(`[SRS] Card not found: ${cardId}`);
			return;
		}

		const quality = this.buttonToQuality(button);

		// Update statistics
		card.totalReviews++;
		card.lastReviewedDate = new Date().toISOString();

		// SM-2 Algorithm
		if (quality >= 3) {
			// Correct response
			if (card.repetitions === 0) {
				card.interval = 1;
			} else if (card.repetitions === 1) {
				card.interval = 6;
			} else {
				card.interval = Math.round(card.interval * card.easeFactor);
			}
			card.repetitions++;
		} else {
			// Incorrect response - reset
			card.repetitions = 0;
			card.interval = 1;
			card.lapseCount++;
		}

		// Update ease factor (minimum 1.3)
		card.easeFactor = Math.max(
			1.3,
			card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
		);

		// Calculate next review date
		const nextReview = new Date();
		nextReview.setDate(nextReview.getDate() + card.interval);
		card.nextReviewDate = nextReview.toISOString();

		console.log(`[SRS] Reviewed ${cardId}:`);
		console.log(`  Quality: ${quality}, Interval: ${card.interval} days, Ease: ${card.easeFactor.toFixed(2)}`);
	}

	/**
	 * Convert review button to quality rating
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
	 * Get all cards due for review
	 */
	getDueCards(): SRSCardData[] {
		const now = new Date();
		return Object.values(this.database.cards).filter(card => {
			const nextReview = new Date(card.nextReviewDate);
			return nextReview <= now;
		});
	}

	/**
	 * Get cards due for review filtered by keywords
	 */
	getFilteredDueCards(keywords: Set<string>): SRSCardData[] {
		const dueCards = this.getDueCards();
		return dueCards.filter(card => keywords.has(card.keyword));
	}

	/**
	 * Get all cards for a specific file
	 */
	getCardsForFile(filePath: string): SRSCardData[] {
		const cardIds = this.database.fileIndex[filePath] || [];
		return cardIds.map(cardId => this.database.cards[cardId]).filter(card => card !== undefined);
	}

	/**
	 * Get statistics
	 */
	getStats(): SRSStats {
		const cards = Object.values(this.database.cards);
		const now = new Date();

		const dueCards = cards.filter(c => new Date(c.nextReviewDate) <= now);
		const newCards = cards.filter(c => c.totalReviews === 0);
		const orphanCount = this.database.orphans ? Object.keys(this.database.orphans).length : 0;

		const totalEase = cards.reduce((sum, c) => sum + c.easeFactor, 0);
		const totalInterval = cards.reduce((sum, c) => sum + c.interval, 0);

		return {
			total: cards.length,
			due: dueCards.length,
			new: newCards.length,
			orphans: orphanCount,
			avgEaseFactor: cards.length > 0 ? totalEase / cards.length : 2.5,
			avgInterval: cards.length > 0 ? totalInterval / cards.length : 0
		};
	}

	/**
	 * Get database (for OrphanManager)
	 */
	getDatabase(): SRSDatabase {
		return this.database;
	}

	/**
	 * Check if database is loaded
	 */
	isLoaded(): boolean {
		return this.loaded;
	}

	/**
	 * Reset all cards (for testing)
	 */
	async resetAll(): Promise<void> {
		this.database = this.createEmptyDatabase();
		await this.save();
		console.log('[SRS] Database reset');
	}

	/**
	 * Get show scores setting (default true for backward compatibility)
	 */
	getShowScores(): boolean {
		return this.database.settings?.showScores ?? true;
	}

	/**
	 * Set show scores setting
	 */
	async setShowScores(value: boolean): Promise<void> {
		if (!this.database.settings) {
			this.database.settings = {
				showScores: value
			};
		} else {
			this.database.settings.showScores = value;
		}
		await this.save();
		console.log(`[SRS] Show scores setting updated to: ${value}`);
	}
}
