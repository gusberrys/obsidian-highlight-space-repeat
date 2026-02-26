import { App, Modal, ButtonComponent, Notice } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { SRSCardData, ReviewButton } from '../interfaces/SRSData';
import { RecordEntry, ParsedRecord } from '../interfaces/ParsedRecord';
import { KHEntry } from './KHEntry';

/**
 * SRS Review Modal
 * Shows entry content and review buttons for spaced repetition
 */
export class SRSReviewModal extends Modal {
	private card: SRSCardData;
	private entry: RecordEntry;
	private record: ParsedRecord;
	private onReview: (button: ReviewButton) => void;
	private isAnswerShown: boolean = false;
	private contentContainer: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: HighlightSpaceRepeatPlugin,
		card: SRSCardData,
		entry: RecordEntry,
		record: ParsedRecord,
		onReview: (button: ReviewButton) => void
	) {
		super(app);
		this.card = card;
		this.entry = entry;
		this.record = record;
		this.onReview = onReview;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('srs-review-modal');

		// Header with info icon
		const header = contentEl.createDiv({ cls: 'srs-review-header' });
		const headerTitle = header.createDiv({ cls: 'srs-header-title-row' });
		headerTitle.createEl('h2', { text: 'SRS Review' });

		// Info icon with tooltip
		const infoIcon = headerTitle.createSpan({ cls: 'srs-info-icon', text: 'ℹ️' });
		infoIcon.setAttribute('aria-label', 'Pattern Priority Information');
		infoIcon.setAttribute('title',
			'Pattern Priority (highest to lowest):\n' +
			'1. {{content}} → "___"\n' +
			'2. `code` or code blocks → "___"\n' +
			'3. ::: → show left side only\n' +
			'4. **bold** → "*___*"\n\n' +
			'Only the highest priority pattern is hidden.'
		);

		// Card info with styled keyword badge
		const infoContainer = contentEl.createDiv({ cls: 'srs-card-info' });

		// Get keyword styling
		const keywordStyle = this.plugin.api.getKeywordStyle(this.card.keyword);

		const keywordBadge = infoContainer.createSpan({ cls: 'srs-keyword-badge' });
		keywordBadge.textContent = `${keywordStyle?.generateIcon || '🏷️'} ${this.card.keyword}`;

		// Apply styling if available
		if (keywordStyle?.backgroundColor) {
			keywordBadge.style.backgroundColor = keywordStyle.backgroundColor;
		}
		if (keywordStyle?.color) {
			keywordBadge.style.color = keywordStyle.color;
		}

		const typeBadge = infoContainer.createSpan({ cls: 'srs-type-badge' });
		typeBadge.textContent = this.card.type;

		// File path - show only filename
		const filePath = infoContainer.createDiv({ cls: 'srs-file-path' });
		const fileName = this.card.filePath.split('/').pop() || this.card.filePath;
		filePath.textContent = fileName;

		// Header context - find which header contains this entry
		const headerText = this.findHeaderContext();
		if (headerText) {
			const headerContext = infoContainer.createDiv({ cls: 'srs-header-context' });
			headerContext.textContent = headerText;
			headerContext.style.fontSize = '0.9em';
			headerContext.style.opacity = '0.7';
			headerContext.style.marginTop = '4px';
		}

		// Content display using KHEntry for proper rendering
		this.contentContainer = contentEl.createDiv({ cls: 'srs-content-container' });
		await this.renderContent();

		// Show Answer button
		const answerButtonContainer = contentEl.createDiv({ cls: 'srs-answer-button-container' });
		const answerButton = new ButtonComponent(answerButtonContainer)
			.setButtonText('Show Answer')
			.onClick(() => this.toggleAnswer());

		// Stats - only show if enabled in settings
		if (this.plugin.srsManager.getShowScores()) {
			const statsContainer = contentEl.createDiv({ cls: 'srs-stats-container' });

			this.createStatItem(statsContainer, 'Reviews', this.card.totalReviews.toString());
			this.createStatItem(statsContainer, 'Interval', `${this.card.interval} days`);
			this.createStatItem(statsContainer, 'Ease Factor', this.card.easeFactor.toFixed(2));
			this.createStatItem(statsContainer, 'Lapses', this.card.lapseCount.toString());

			// Next review date
			const nextReview = new Date(this.card.nextReviewDate);
			const nextReviewText = this.formatDate(nextReview);
			this.createStatItem(statsContainer, 'Next Review', nextReviewText);
		}

		// Review buttons
		const buttonContainer = contentEl.createDiv({ cls: 'srs-button-container' });

		this.createReviewButton(buttonContainer, 'Again', 'again', 'srs-btn-again');
		this.createReviewButton(buttonContainer, 'Hard', 'hard', 'srs-btn-hard');
		this.createReviewButton(buttonContainer, 'Good', 'good', 'srs-btn-good');
		this.createReviewButton(buttonContainer, 'Easy', 'easy', 'srs-btn-easy');

		// Keyboard shortcuts hint
		const hintContainer = contentEl.createDiv({ cls: 'srs-keyboard-hint' });
		hintContainer.textContent = 'Keyboard: 1=Again, 2=Hard, 3=Good, 4=Easy';

		// Register keyboard shortcuts
		this.scope.register([], '1', () => this.handleReview('again'));
		this.scope.register([], '2', () => this.handleReview('hard'));
		this.scope.register([], '3', () => this.handleReview('good'));
		this.scope.register([], '4', () => this.handleReview('easy'));
	}

	private createStatItem(container: HTMLElement, label: string, value: string): void {
		const statItem = container.createDiv({ cls: 'srs-stat-item' });
		statItem.createSpan({ cls: 'srs-stat-label', text: label + ': ' });
		statItem.createSpan({ cls: 'srs-stat-value', text: value });
	}

	private createReviewButton(
		container: HTMLElement,
		label: string,
		button: ReviewButton,
		className: string
	): void {
		new ButtonComponent(container)
			.setButtonText(label)
			.setCta()
			.setClass(className)
			.onClick(() => this.handleReview(button));
	}

	private handleReview(button: ReviewButton): void {
		this.onReview(button);
		this.close();
	}

	private formatDate(date: Date): string {
		const now = new Date();
		const diffTime = date.getTime() - now.getTime();
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

		if (diffDays < 0) {
			return 'Overdue';
		} else if (diffDays === 0) {
			return 'Today';
		} else if (diffDays === 1) {
			return 'Tomorrow';
		} else if (diffDays < 7) {
			return `In ${diffDays} days`;
		} else {
			return date.toLocaleDateString();
		}
	}

	/**
	 * Render content with optional hiding based on answer state (processes all levels)
	 */
	private async renderContent(): Promise<void> {
		if (!this.contentContainer) return;

		this.contentContainer.empty();

		if (this.card.type === 'codeblock') {
			let displayText = this.entry.text;
			if (!this.isAnswerShown) {
				displayText = this.hideContent(displayText);
			}

			const codeBlock = this.contentContainer.createEl('pre');
			const code = codeBlock.createEl('code');
			code.textContent = displayText;

			if (this.entry.language) {
				code.addClass(`language-${this.entry.language}`);
			}
		} else {
			// Process entry and all sub-items recursively
			const displayEntry = this.processEntryForDisplay(this.entry);

			await KHEntry.renderKeywordEntry(
				this.contentContainer,
				displayEntry,
				this.record,
				this.plugin,
				false // full mode for SRS review
			);
		}
	}

	/**
	 * Check if text has testable patterns
	 */
	private hasTestablePatterns(text: string): boolean {
		return /\{\{[^}]+\}\}/.test(text) ||
		       /`[^`]+`/.test(text) ||
		       /```[\s\S]+?```/.test(text) ||
		       /:::/.test(text) ||
		       /\*\*[^*]+\*\*/.test(text);
	}

	/**
	 * Check if entry is at top level (no meaningful header)
	 */
	private isEntryAtTopLevel(headers: any[], targetLineNumber: number): boolean {
		for (const header of headers) {
			if (header.entries) {
				for (const entry of header.entries) {
					if (entry.lineNumber === targetLineNumber) {
						return !header.text || header.text.trim() === '';
					}
				}
			}
			if (header.children) {
				const result = this.isEntryAtTopLevel(header.children, targetLineNumber);
				if (result !== null) return result;
			}
		}
		return false;
	}

	/**
	 * Find header with same keyword
	 */
	private findHeaderWithKeyword(headers: any[], targetLineNumber: number, keyword: string): string | null {
		for (const header of headers) {
			const headerHasKeyword = header.keywords?.includes(keyword);
			if (header.entries) {
				for (const entry of header.entries) {
					if (entry.lineNumber === targetLineNumber) {
						if (headerHasKeyword && header.text) {
							return header.text;
						}
						return null;
					}
				}
			}
			if (header.children) {
				const found = this.findHeaderWithKeyword(header.children, targetLineNumber, keyword);
				if (found) return found;
			}
		}
		return null;
	}

	/**
	 * Process entry and all sub-items for display (recursive hiding)
	 */
	private processEntryForDisplay(entry: RecordEntry): RecordEntry {
		let mainText = entry.text;

		// Check if entry has testable patterns
		let hasExplicitPatterns = this.hasTestablePatterns(mainText);

		// Check if sub-items have patterns
		let subItemsHavePatterns = false;
		if (entry.subItems) {
			for (const subItem of entry.subItems) {
				if (this.hasTestablePatterns(subItem.content)) {
					subItemsHavePatterns = true;
					break;
				}
				if (subItem.nestedCodeBlock && this.hasTestablePatterns(subItem.nestedCodeBlock.content)) {
					subItemsHavePatterns = true;
					break;
				}
			}
		}

		// If no explicit patterns, add context (header or filename) as bold
		if (!hasExplicitPatterns && !subItemsHavePatterns) {
			// Check if entry is at top level
			const atTopLevel = this.isEntryAtTopLevel(this.record.headers, entry.lineNumber);

			// Check if header has same keyword
			const headerWithKeyword = this.findHeaderWithKeyword(this.record.headers, entry.lineNumber, this.card.keyword);

			if (headerWithKeyword) {
				// Use header as context
				mainText = `**${headerWithKeyword}**: ${mainText}`;
			} else if (atTopLevel) {
				// Use filename as context
				const fileNameWithoutExt = this.record.fileName.replace(/\.[^/.]+$/, '');
				mainText = `**${fileNameWithoutExt}**: ${mainText}`;
			}
		}

		// Deep copy the entry with modified text
		const displayEntry: RecordEntry = {
			...entry,
			text: this.isAnswerShown ? mainText : this.hideContent(mainText)
		};

		// Process sub-items recursively
		if (entry.subItems && entry.subItems.length > 0) {
			displayEntry.subItems = entry.subItems.map(subItem => {
				const processedSubItem = { ...subItem };

				// Hide content in sub-item
				if (!this.isAnswerShown) {
					processedSubItem.content = this.hideContent(subItem.content);
				}

				// Hide nested code block content if present
				if (subItem.nestedCodeBlock && !this.isAnswerShown) {
					processedSubItem.nestedCodeBlock = {
						...subItem.nestedCodeBlock,
						content: this.hideContent(subItem.nestedCodeBlock.content)
					};
				}

				return processedSubItem;
			});
		}

		return displayEntry;
	}

	/**
	 * Toggle answer visibility
	 */
	private async toggleAnswer(): Promise<void> {
		this.isAnswerShown = !this.isAnswerShown;

		// Update button text
		const answerButton = this.contentEl.querySelector('.srs-answer-button-container button');
		if (answerButton) {
			answerButton.textContent = this.isAnswerShown ? 'Hide Answer' : 'Show Answer';
		}

		// Re-render content
		await this.renderContent();
	}

	/**
	 * Detect highest priority pattern in text
	 * Priority: {{}} > backticks/code > ::: > bold
	 */
	private getHighestPriorityPattern(text: string): 'curly' | 'code' | 'triple' | 'bold' | null {
		// Priority 1: {{content}}
		if (/\{\{[^}]+\}\}/.test(text)) {
			return 'curly';
		}

		// Priority 2: `code` or ```code blocks```
		if (/`[^`]+`/.test(text) || /```[\s\S]+?```/.test(text)) {
			return 'code';
		}

		// Priority 3: :::
		if (/:::/.test(text)) {
			return 'triple';
		}

		// Priority 4: **bold**
		if(/\*\*[^*]+\*\*/.test(text)) {
			return 'bold';
		}

		return null;
	}

	/**
	 * Hide content based on highest priority pattern
	 */
	private hideContent(text: string): string {
		const pattern = this.getHighestPriorityPattern(text);

		if (!pattern) {
			return text; // No pattern to hide
		}

		switch (pattern) {
			case 'curly':
				// Replace {{content}} with ___
				return text.replace(/\{\{[^}]+\}\}/g, '___');

			case 'code':
				// Replace `code` and ```code blocks``` with ___
				return text
					.replace(/```[\s\S]+?```/g, '___')
					.replace(/`[^`]+`/g, '___');

			case 'triple':
				// Show left side only (before :::)
				const parts = text.split(':::');
				return parts[0] || text;

			case 'bold':
				// Replace **bold** with *___*
				return text.replace(/\*\*([^*]+)\*\*/g, '*___*');

			default:
				return text;
		}
	}

	/**
	 * Find the header that contains this entry for context
	 */
	private findHeaderContext(): string | null {
		if (!this.record || !this.record.headers) {
			return null;
		}

		// Recursively search for the header containing this entry
		const findInHeaders = (headers: any[]): string | null => {
			for (const header of headers) {
				if (header.entries) {
					for (const entry of header.entries) {
						if (entry.lineNumber === this.entry.lineNumber &&
						    entry.keywords?.includes(this.card.keyword)) {
							// Found the entry in this header
							return header.text || null;
						}
					}
				}
				// Check children recursively
				if (header.children) {
					const found = findInHeaders(header.children);
					if (found) return found;
				}
			}
			return null;
		};

		return findInHeaders(this.record.headers);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * SRS Review Session
 * Manages multiple card reviews in sequence
 */
export class SRSReviewSession {
	private cards: SRSCardData[];
	private currentIndex: number = 0;
	private reviewedCount: number = 0;
	private parsedRecords: ParsedRecord[] = [];

	constructor(
		private app: App,
		private plugin: HighlightSpaceRepeatPlugin,
		cards: SRSCardData[]
	) {
		this.cards = cards;
	}

	async start(): Promise<void> {
		if (this.cards.length === 0) {
			new Notice('No cards due for review!');
			return;
		}

		// Load parsed records
		await this.loadParsedRecords();

		new Notice(`Starting review session: ${this.cards.length} cards`);
		this.reviewNext();
	}

	private async loadParsedRecords(): Promise<void> {
		const parsedRecordsPath = '.obsidian/plugins/highlight-space-repeat/app-data/parsed-records.json';
		const exists = await this.app.vault.adapter.exists(parsedRecordsPath);

		if (!exists) {
			console.warn('[SRSReviewSession] No parsed records found');
			return;
		}

		const jsonContent = await this.app.vault.adapter.read(parsedRecordsPath);
		this.parsedRecords = JSON.parse(jsonContent);
	}

	private findEntry(card: SRSCardData): { entry: RecordEntry; record: ParsedRecord } | null {
		// Find the record for this card
		const record = this.parsedRecords.find(r => r.filePath === card.filePath);
		if (!record) return null;

		// Search through headers to find the entry
		const findInHeaders = (headers: any[]): RecordEntry | null => {
			for (const header of headers) {
				if (header.entries) {
					for (const entry of header.entries) {
						if (entry.lineNumber === card.lineNumber &&
						    entry.keywords?.includes(card.keyword)) {
							return entry;
						}
					}
				}
				if (header.children) {
					const found = findInHeaders(header.children);
					if (found) return found;
				}
			}
			return null;
		};

		const entry = findInHeaders(record.headers);
		if (!entry) return null;

		return { entry, record };
	}

	private async reviewNext(): Promise<void> {
		if (this.currentIndex >= this.cards.length) {
			// Session complete
			await this.plugin.srsManager.save();
			new Notice(`Review session complete! Reviewed ${this.cards.length} cards.`);
			return;
		}

		const card = this.cards[this.currentIndex];

		// Find the full entry from parsed records
		const found = this.findEntry(card);

		let entry: RecordEntry;
		let record: ParsedRecord;

		if (found) {
			entry = found.entry;
			record = found.record;
		} else {
			// Fallback: create a mock entry from the preview
			entry = {
				type: card.type,
				lineNumber: card.lineNumber,
				text: card.contentPreview,
				keywords: [card.keyword]
			};
			record = {
				filePath: card.filePath,
				fileName: card.filePath.split('/').pop() || card.filePath,
				tags: [],
				headers: [],
				aliases: []
			};
		}

		const modal = new SRSReviewModal(
			this.app,
			this.plugin,
			card,
			entry,
			record,
			async (button: ReviewButton) => {
				// Review the card
				this.plugin.srsManager.reviewCard(card.cardId, button);

				// Show feedback with progress
				this.reviewedCount++;
				const intervals = { again: 1, hard: 6, good: card.interval * card.easeFactor, easy: card.interval * card.easeFactor * 1.3 };
				const nextInterval = Math.round(intervals[button]);
				new Notice(`Reviewed as "${button}". Next review in ${nextInterval} days. (${this.reviewedCount}/${this.cards.length})`);

				// Move to next card
				this.currentIndex++;
				this.reviewNext();
			}
		);

		modal.open();
	}
}
