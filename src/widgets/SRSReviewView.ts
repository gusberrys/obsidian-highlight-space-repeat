import { App, ItemView, WorkspaceLeaf, Notice, ButtonComponent, MarkdownView } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { SRSCardData, ReviewButton } from '../interfaces/SRSData';
import { RecordEntry, ParsedRecord } from '../interfaces/ParsedRecord';
import { KHEntry } from '../components/KHEntry';

export const SRS_REVIEW_VIEW_TYPE = 'kh-srs-review-view';

/**
 * SRS Review View - displays cards in right sidebar
 */
export class SRSReviewView extends ItemView {
	private plugin: HighlightSpaceRepeatPlugin;
	private cards: SRSCardData[] = [];
	private currentIndex: number = 0;
	private parsedRecords: ParsedRecord[] = [];
	private isAnswerShown: boolean = false;
	private contentContainer: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return SRS_REVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'SRS Review';
	}

	getIcon(): string {
		return 'layers';
	}

	/**
	 * Start review session with cards
	 */
	async startSession(cards: SRSCardData[]): Promise<void> {
		this.cards = cards;
		this.currentIndex = 0;

		if (this.cards.length === 0) {
			new Notice('No cards due for review!');
			return;
		}

		// Load parsed records
		await this.loadParsedRecords();

		new Notice(`Starting review session: ${this.cards.length} cards`);
		await this.render();
	}

	/**
	 * Load parsed records
	 */
	private async loadParsedRecords(): Promise<void> {
		const parsedRecordsPath = '.obsidian/plugins/highlight-space-repeat/app-data/parsed-records.json';
		const exists = await this.app.vault.adapter.exists(parsedRecordsPath);

		if (!exists) {
			console.warn('[SRSReviewView] No parsed records found');
			return;
		}

		const jsonContent = await this.app.vault.adapter.read(parsedRecordsPath);
		this.parsedRecords = JSON.parse(jsonContent);
	}

	/**
	 * Find entry for card
	 */
	private findEntry(card: SRSCardData): { entry: RecordEntry; record: ParsedRecord } | null {
		const record = this.parsedRecords.find(r => r.filePath === card.filePath);
		if (!record) return null;

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

	/**
	 * Render current card
	 */
	private async render(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('srs-review-view');

		if (this.currentIndex >= this.cards.length) {
			// Session complete
			await this.plugin.srsManager.save();
			container.createEl('div', {
				cls: 'srs-session-complete',
				text: `✅ Review session complete! Reviewed ${this.cards.length} cards.`
			});
			return;
		}

		const card = this.cards[this.currentIndex];
		const found = this.findEntry(card);

		let entry: RecordEntry;
		let record: ParsedRecord;

		if (found) {
			entry = found.entry;
			record = found.record;
		} else {
			// Fallback
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

		// Progress indicator with info icon
		const progressContainer = container.createDiv({ cls: 'srs-progress-container' });

		const progressText = progressContainer.createSpan({
			cls: 'srs-progress',
			text: `Card ${this.currentIndex + 1} of ${this.cards.length}`
		});

		// Info icon with tooltip
		const infoIcon = progressContainer.createSpan({ cls: 'srs-info-icon', text: 'ℹ️' });
		infoIcon.setAttribute('aria-label', 'Pattern Priority Information');
		infoIcon.setAttribute('title',
			'Pattern Priority (highest to lowest):\n' +
			'1. {{content}} → "___"\n' +
			'2. `code` or code blocks → "___"\n' +
			'3. ::: → show left side only\n' +
			'4. **bold** → "*___*"\n\n' +
			'Only the highest priority pattern is hidden.'
		);

		// Card info
		const infoContainer = container.createDiv({ cls: 'srs-card-info' });

		// Keyword badge
		const keywordStyle = this.plugin.api.getKeywordStyle(card.keyword);
		const keywordBadge = infoContainer.createSpan({ cls: 'srs-keyword-badge' });
		keywordBadge.textContent = `${keywordStyle?.generateIcon || '🏷️'} ${card.keyword}`;

		if (keywordStyle?.backgroundColor) {
			keywordBadge.style.backgroundColor = keywordStyle.backgroundColor;
		}
		if (keywordStyle?.color) {
			keywordBadge.style.color = keywordStyle.color;
		}

		// Type badge
		const typeBadge = infoContainer.createSpan({ cls: 'srs-type-badge' });
		typeBadge.textContent = card.type;

		// File path - just display, clicking on content will navigate
		const filePath = infoContainer.createDiv({ cls: 'srs-file-path' });
		const fileName = card.filePath.split('/').pop() || card.filePath;
		filePath.textContent = fileName;

		// Header context
		const headerText = this.findHeaderContext(entry, record);
		if (headerText) {
			const headerContext = infoContainer.createDiv({ cls: 'srs-header-context' });
			headerContext.textContent = headerText;
		}

		// Content container - make it clickable to navigate to record
		this.contentContainer = container.createDiv({ cls: 'srs-content-container' });
		this.contentContainer.style.cursor = 'pointer';
		this.contentContainer.addEventListener('click', async () => {
			await this.openFile(card);
		});
		await this.renderContent(card, entry, record);

		// Check if card has anything to hide
		const hasContentToHide = this.hasAnythingToHide(entry, record, card);

		// Show Answer button - only if there's something to hide
		if (hasContentToHide) {
			const answerButtonContainer = container.createDiv({ cls: 'srs-answer-button-container' });
			const answerButton = new ButtonComponent(answerButtonContainer)
				.setButtonText('Show Answer')
				.onClick(() => this.toggleAnswer(card, entry, record));
		}

		// Stats - only show if enabled
		if (this.plugin.srsManager.getShowScores()) {
			const statsContainer = container.createDiv({ cls: 'srs-stats-container' });

			this.createStatItem(statsContainer, 'Reviews', card.totalReviews.toString());
			this.createStatItem(statsContainer, 'Interval', `${card.interval} days`);
			this.createStatItem(statsContainer, 'Ease Factor', card.easeFactor.toFixed(2));
			this.createStatItem(statsContainer, 'Lapses', card.lapseCount.toString());

			const nextReview = new Date(card.nextReviewDate);
			const nextReviewText = this.formatDate(nextReview);
			this.createStatItem(statsContainer, 'Next Review', nextReviewText);
		}

		// Review buttons
		const buttonContainer = container.createDiv({ cls: 'srs-button-container' });

		this.createReviewButton(buttonContainer, 'Again', 'again', 'srs-btn-again', card);
		this.createReviewButton(buttonContainer, 'Hard', 'hard', 'srs-btn-hard', card);
		this.createReviewButton(buttonContainer, 'Good', 'good', 'srs-btn-good', card);
		this.createReviewButton(buttonContainer, 'Easy', 'easy', 'srs-btn-easy', card);

		// Keyboard shortcuts hint - adjust based on whether Show Answer button is shown
		const hintContainer = container.createDiv({ cls: 'srs-keyboard-hint' });
		if (hasContentToHide) {
			hintContainer.textContent = 'Keyboard: Space=Show Answer, 1=Again, 2=Hard, 3=Good, 4=Easy';
		} else {
			hintContainer.textContent = 'Keyboard: 1=Again, 2=Hard, 3=Good, 4=Easy';
		}
	}

	/**
	 * Open file at line and navigate to record (same pattern as Matrix view)
	 */
	private async openFile(card: SRSCardData): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.filePath);
		if (!file) {
			new Notice(`File not found: ${card.filePath}`);
			return;
		}

		// Open the file (or focus if already open) with line state
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file as any, {
			eState: { line: card.lineNumber }
		});

		// Get the editor and navigate to the specific line
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.editor) {
			// Set cursor to the beginning of the line
			view.editor.setCursor({ line: card.lineNumber, ch: 0 });
			// Scroll to a few lines above the target to ensure visibility with padding
			const scrollToLine = Math.max(0, card.lineNumber - 3);
			// Scroll the line into view
			view.editor.scrollIntoView({
				from: { line: scrollToLine, ch: 0 },
				to: { line: scrollToLine, ch: 0 }
			}, true);
		}
	}

	/**
	 * Render content with optional hiding (processes all levels of content)
	 */
	private async renderContent(card: SRSCardData, entry: RecordEntry, record: ParsedRecord): Promise<void> {
		if (!this.contentContainer) return;

		this.contentContainer.empty();

		if (card.type === 'codeblock') {
			let displayText = entry.text;
			if (!this.isAnswerShown) {
				displayText = this.hideContent(displayText);
			}

			const codeBlock = this.contentContainer.createEl('pre');
			const code = codeBlock.createEl('code');
			code.textContent = displayText;

			if (entry.language) {
				code.addClass(`language-${entry.language}`);
			}
		} else {
			// Process entry and all sub-items recursively
			const displayEntry = this.processEntryForDisplay(entry, record, card);

			await KHEntry.renderKeywordEntry(
				this.contentContainer,
				displayEntry,
				record,
				this.plugin,
				false
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
	 * Check if entry has anything to hide (testable patterns or context)
	 */
	private hasAnythingToHide(entry: RecordEntry, record: ParsedRecord, card: SRSCardData): boolean {
		// Check main text for patterns
		if (this.hasTestablePatterns(entry.text)) {
			return true;
		}

		// Check sub-items for patterns
		if (entry.subItems) {
			for (const subItem of entry.subItems) {
				if (this.hasTestablePatterns(subItem.content)) {
					return true;
				}
				if (subItem.nestedCodeBlock && this.hasTestablePatterns(subItem.nestedCodeBlock.content)) {
					return true;
				}
			}
		}

		// If no patterns, check if there's context (header or filename)
		const atTopLevel = this.isEntryAtTopLevel(record.headers, entry.lineNumber);
		const headerWithKeyword = this.findHeaderWithKeyword(record.headers, entry.lineNumber, card.keyword);

		// Has context to hide if there's a matching header OR entry is at top level
		return headerWithKeyword !== null || atTopLevel;
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
	private processEntryForDisplay(entry: RecordEntry, record: ParsedRecord, card: SRSCardData): RecordEntry {
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
			const atTopLevel = this.isEntryAtTopLevel(record.headers, entry.lineNumber);

			// Check if header has same keyword
			const headerWithKeyword = this.findHeaderWithKeyword(record.headers, entry.lineNumber, card.keyword);

			if (headerWithKeyword) {
				// Use header as context
				mainText = `**${headerWithKeyword}**: ${mainText}`;
			} else if (atTopLevel) {
				// Use filename as context
				const fileNameWithoutExt = record.fileName.replace(/\.[^/.]+$/, '');
				mainText = `**${fileNameWithoutExt}**: ${mainText}`;
			}
		}

		// Check if there's anything to hide
		const hasContentToHide = this.hasAnythingToHide(entry, record, card);

		// Deep copy the entry with modified text
		// Only apply hiding if there's something to hide AND answer is not shown
		const displayEntry: RecordEntry = {
			...entry,
			text: (hasContentToHide && !this.isAnswerShown) ? this.hideContent(mainText) : mainText
		};

		// Process sub-items recursively
		if (entry.subItems && entry.subItems.length > 0) {
			displayEntry.subItems = entry.subItems.map(subItem => {
				const processedSubItem = { ...subItem };

				// Hide content in sub-item only if there's something to hide
				if (hasContentToHide && !this.isAnswerShown) {
					processedSubItem.content = this.hideContent(subItem.content);
				}

				// Hide nested code block content if present and there's something to hide
				if (subItem.nestedCodeBlock && hasContentToHide && !this.isAnswerShown) {
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
	private async toggleAnswer(card: SRSCardData, entry: RecordEntry, record: ParsedRecord): Promise<void> {
		this.isAnswerShown = !this.isAnswerShown;

		const answerButton = this.containerEl.querySelector('.srs-answer-button-container button');
		if (answerButton) {
			answerButton.textContent = this.isAnswerShown ? 'Hide Answer' : 'Show Answer';
		}

		await this.renderContent(card, entry, record);
	}

	/**
	 * Detect highest priority pattern
	 */
	private getHighestPriorityPattern(text: string): 'curly' | 'code' | 'triple' | 'bold' | null {
		if (/\{\{[^}]+\}\}/.test(text)) {
			return 'curly';
		}

		if (/`[^`]+`/.test(text) || /```[\s\S]+?```/.test(text)) {
			return 'code';
		}

		if (/:::/.test(text)) {
			return 'triple';
		}

		if(/\*\*[^*]+\*\*/.test(text)) {
			return 'bold';
		}

		return null;
	}

	/**
	 * Hide content based on pattern
	 */
	private hideContent(text: string): string {
		const pattern = this.getHighestPriorityPattern(text);

		if (!pattern) {
			return text;
		}

		switch (pattern) {
			case 'curly':
				return text.replace(/\{\{[^}]+\}\}/g, '___');

			case 'code':
				return text
					.replace(/```[\s\S]+?```/g, '___')
					.replace(/`[^`]+`/g, '___');

			case 'triple':
				const parts = text.split(':::');
				return parts[0] || text;

			case 'bold':
				return text.replace(/\*\*([^*]+)\*\*/g, '*___*');

			default:
				return text;
		}
	}

	/**
	 * Find header context
	 */
	private findHeaderContext(entry: RecordEntry, record: ParsedRecord): string | null {
		if (!record || !record.headers) {
			return null;
		}

		const findInHeaders = (headers: any[]): string | null => {
			for (const header of headers) {
				if (header.entries) {
					for (const e of header.entries) {
						if (e.lineNumber === entry.lineNumber &&
						    e.keywords?.includes(entry.keywords?.[0])) {
							return header.text || null;
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

		return findInHeaders(record.headers);
	}

	/**
	 * Create stat item
	 */
	private createStatItem(container: HTMLElement, label: string, value: string): void {
		const statItem = container.createDiv({ cls: 'srs-stat-item' });
		statItem.createSpan({ cls: 'srs-stat-label', text: label + ': ' });
		statItem.createSpan({ cls: 'srs-stat-value', text: value });
	}

	/**
	 * Create review button
	 */
	private createReviewButton(
		container: HTMLElement,
		label: string,
		button: ReviewButton,
		className: string,
		card: SRSCardData
	): void {
		new ButtonComponent(container)
			.setButtonText(label)
			.setCta()
			.setClass(className)
			.onClick(() => this.handleReview(button, card));
	}

	/**
	 * Handle review
	 */
	private async handleReview(button: ReviewButton, card: SRSCardData): Promise<void> {
		this.plugin.srsManager.reviewCard(card.cardId, button);

		const intervals = {
			again: 1,
			hard: 6,
			good: card.interval * card.easeFactor,
			easy: card.interval * card.easeFactor * 1.3
		};
		const nextInterval = Math.round(intervals[button]);
		new Notice(`Reviewed as "${button}". Next review in ${nextInterval} days. (${this.currentIndex + 1}/${this.cards.length})`);

		// Reset answer state for next card
		this.isAnswerShown = false;

		// Move to next card
		this.currentIndex++;
		await this.render();
	}

	/**
	 * Format date
	 */
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

	async onOpen(): Promise<void> {
		// Register keyboard shortcuts
		this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
			// Only handle if this view is visible
			if (!this.containerEl.isShown()) return;

			// Don't trigger if user is typing in an input field
			const target = evt.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
				return;
			}

			if (evt.key === ' ' || evt.key === 'Spacebar') {
				// Space bar for Show Answer
				evt.preventDefault(); // Prevent page scroll
				const answerButton = this.containerEl.querySelector('.srs-answer-button-container button');
				if (answerButton) {
					(answerButton as HTMLElement).click();
				}
			} else if (evt.key === '1') {
				const card = this.cards[this.currentIndex];
				if (card) this.handleReview('again', card);
			} else if (evt.key === '2') {
				const card = this.cards[this.currentIndex];
				if (card) this.handleReview('hard', card);
			} else if (evt.key === '3') {
				const card = this.cards[this.currentIndex];
				if (card) this.handleReview('good', card);
			} else if (evt.key === '4') {
				const card = this.cards[this.currentIndex];
				if (card) this.handleReview('easy', card);
			}
		});
	}

	async onClose(): Promise<void> {
		// Cleanup
	}
}
