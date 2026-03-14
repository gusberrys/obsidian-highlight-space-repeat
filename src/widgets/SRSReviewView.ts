import { App, ItemView, WorkspaceLeaf, Notice, ButtonComponent, MarkdownView } from 'obsidian';
import { DATA_PATHS } from '../shared/data-paths';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { SRSCardData, ReviewButton } from '../interfaces/SRSData';
import { ParsedEntry, ParsedFile, FlatEntry } from '../interfaces/ParsedFile';
import { KHEntry } from '../components/KHEntry';
import { getFileNameFromPath } from '../utils/file-helpers';
import { getAllKeywords } from '../utils/parse-helpers';

export const SRS_REVIEW_VIEW_TYPE = 'kh-srs-review-view';

/**
 * SRS Review View - displays cards in right sidebar
 */
export class SRSReviewView extends ItemView {
	private plugin: HighlightSpaceRepeatPlugin;
	private cards: SRSCardData[] = [];
	private currentIndex: number = 0;
	private parsedRecords: ParsedFile[] = [];
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
		const parsedRecordsPath = DATA_PATHS.PARSED_FILES;
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
	private findEntry(card: SRSCardData): { entry: FlatEntry; record: ParsedFile } | null {
		const record = this.parsedRecords.find(r => r.filePath === card.filePath);
		if (!record) return null;

		// Entries are now flat in record.entries
		const entry = record.entries.find(e =>
			e.lineNumber === card.lineNumber &&
			e.keywords?.includes(card.keyword)
		);

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

		let entry: FlatEntry;
		let record: ParsedFile;

		if (found) {
			entry = found.entry;
			record = found.record;
		} else {
			// Fallback
			entry = {
				type: card.type,
				lineNumber: card.lineNumber,
				text: card.contentPreview,
				keywords: [card.keyword],
				filePath: card.filePath,

				fileTags: []
			};
			record = {
				filePath: card.filePath,

				tags: [],
								aliases: [],
				entries: []
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
			'2. ::: → show left side only\n' +
			'3. `code` or code blocks → "___"\n' +
			'4. **bold** → "*___*"\n\n' +
			'Main text: hides its highest priority pattern.\n' +
			'Subitems: find highest priority across ALL subitems, hide only that pattern.\n\n' +
			'Keyboard Shortcuts:\n' +
			'Space = Show/Hide Answer\n' +
			'Shift+Space = Close SRS Review\n' +
			'1/2/3/4 = Answer (Again/Hard/Good/Easy)\n' +
			'Shift+1/2/3/4 = Answer & Close'
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
			hintContainer.textContent = 'Keyboard: Space=Show Answer, Shift+Space=Close, 1/2/3/4=Answer, Shift+1/2/3/4=Answer & Close';
		} else {
			hintContainer.textContent = 'Keyboard: 1=Again, 2=Hard, 3=Good, 4=Easy, Shift+1/2/3/4=Answer & Close, Shift+Space=Close';
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
	private async renderContent(card: SRSCardData, entry: FlatEntry, record: ParsedFile): Promise<void> {
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
	private hasAnythingToHide(entry: FlatEntry, record: ParsedFile, card: SRSCardData): boolean {
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
		const atTopLevel = this.isEntryAtTopLevel(entry);
		const headerWithKeyword = this.findHeaderWithKeyword(entry, card.keyword);

		// Has context to hide if there's a matching header OR entry is at top level
		return headerWithKeyword !== null || atTopLevel;
	}

	/**
	 * Check if entry is at top level (no meaningful header)
	 */
	private isEntryAtTopLevel(entry: FlatEntry): boolean {
		// Entry is at top level if all headers are null or have empty text
		const h1Empty = !entry.h1 || !entry.h1.text || entry.h1.text.trim() === '';
		const h2Empty = !entry.h2 || !entry.h2.text || entry.h2.text.trim() === '';
		const h3Empty = !entry.h3 || !entry.h3.text || entry.h3.text.trim() === '';

		return h1Empty && h2Empty && h3Empty;
	}

	/**
	 * Find header with same keyword
	 */
	private findHeaderWithKeyword(entry: FlatEntry, keyword: string): string | null {
		// Check each header level (h1, h2, h3) for the keyword
		const headerLevels = [
			entry.h3 ? { info: entry.h3 } : null,  // Check h3 first (most specific)
			entry.h2 ? { info: entry.h2 } : null,
			entry.h1 ? { info: entry.h1 } : null
		].filter(h => h !== null);

		for (const headerLevel of headerLevels) {
			const header = headerLevel!.info;
			const headerKeywords = getAllKeywords(header);
			const headerHasKeyword = headerKeywords.includes(keyword);
			if (headerHasKeyword) {
				// Return text if available, otherwise return keywords joined
				return header.text || (header.keywords ? header.keywords.join(' ') : null);
			}
		}

		return null;
	}

	/**
	 * Process entry and all sub-items for display (recursive hiding)
	 */
	private processEntryForDisplay(entry: FlatEntry, record: ParsedFile, card: SRSCardData): FlatEntry {
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
			const atTopLevel = this.isEntryAtTopLevel(entry);

			// Check if header has same keyword
			const headerWithKeyword = this.findHeaderWithKeyword(entry, card.keyword);

			if (headerWithKeyword) {
				// Use header as context
				mainText = `**${headerWithKeyword}**: ${mainText}`;
			} else if (atTopLevel) {
				// Use filename as context
				const fileNameWithoutExt = getFileNameFromPath(record.filePath).replace(/\.[^/.]+$/, '');
				mainText = `**${fileNameWithoutExt}**: ${mainText}`;
			}
		}

		// Check if there's anything to hide
		const hasContentToHide = this.hasAnythingToHide(entry, record, card);

		// Helper to get numeric priority (lower = higher priority)
		const getPatternPriority = (pattern: 'curly' | 'code' | 'triple' | 'bold' | null): number => {
			if (pattern === 'curly') return 1;
			if (pattern === 'triple') return 2;
			if (pattern === 'code') return 3;
			if (pattern === 'bold') return 4;
			return 999; // No pattern
		};

		// RULE 1: Find highest priority pattern in MAIN text only
		const mainPattern = this.getHighestPriorityPattern(mainText);

		// RULE 2: Find highest priority pattern across ALL subitems
		let subitemsHighestPattern: 'curly' | 'code' | 'triple' | 'bold' | null = null;
		let subitemsHighestPriority = 999;

		if (entry.subItems) {
			for (const subItem of entry.subItems) {
				const subPattern = this.getHighestPriorityPattern(subItem.content);
				if (subPattern) {
					const priority = getPatternPriority(subPattern);
					if (priority < subitemsHighestPriority) {
						subitemsHighestPriority = priority;
						subitemsHighestPattern = subPattern;
					}
				}
				if (subItem.nestedCodeBlock) {
					const nestedPattern = this.getHighestPriorityPattern(subItem.nestedCodeBlock.content);
					if (nestedPattern) {
						const priority = getPatternPriority(nestedPattern);
						if (priority < subitemsHighestPriority) {
							subitemsHighestPriority = priority;
							subitemsHighestPattern = nestedPattern;
						}
					}
				}
			}
		}

		// Process main text - hide its pattern
		const displayEntry: FlatEntry = {
			...entry,
			text: (hasContentToHide && !this.isAnswerShown && mainPattern)
				? this.hideContent(mainText)
				: mainText
		};

		// Process subitems - only hide the highest priority pattern found across ALL subitems
		if (entry.subItems && entry.subItems.length > 0) {
			displayEntry.subItems = entry.subItems.map(subItem => {
				const processedSubItem = { ...subItem };

				// Only hide if this subitem has the highest priority pattern
				const subPattern = this.getHighestPriorityPattern(subItem.content);
				if (hasContentToHide && !this.isAnswerShown && subPattern === subitemsHighestPattern) {
					processedSubItem.content = this.hideContent(subItem.content);
				}

				if (subItem.nestedCodeBlock) {
					const nestedPattern = this.getHighestPriorityPattern(subItem.nestedCodeBlock.content);
					if (hasContentToHide && !this.isAnswerShown && nestedPattern === subitemsHighestPattern) {
						processedSubItem.nestedCodeBlock = {
							...subItem.nestedCodeBlock,
							content: this.hideContent(subItem.nestedCodeBlock.content)
						};
					}
				}

				return processedSubItem;
			});
		}

		return displayEntry;
	}

	/**
	 * Toggle answer visibility
	 */
	private async toggleAnswer(card: SRSCardData, entry: FlatEntry, record: ParsedFile): Promise<void> {
		this.isAnswerShown = !this.isAnswerShown;

		const answerButton = this.containerEl.querySelector('.srs-answer-button-container button');
		if (answerButton) {
			answerButton.textContent = this.isAnswerShown ? 'Hide Answer' : 'Show Answer';
		}

		await this.renderContent(card, entry, record);
	}

	/**
	 * Detect highest priority pattern in text
	 */
	private getHighestPriorityPattern(text: string): 'curly' | 'code' | 'triple' | 'bold' | null {
		// Priority 1: {{content}}
		if (/\{\{[^}]+\}\}/.test(text)) {
			return 'curly';
		}

		// Priority 2: :::
		if (/:::/.test(text)) {
			return 'triple';
		}

		// Priority 3: `code` or ```code blocks```
		if (/`[^`]+`/.test(text) || /```[\s\S]+?```/.test(text)) {
			return 'code';
		}

		// Priority 4: **bold**
		if (/\*\*[^*]+\*\*/.test(text)) {
			return 'bold';
		}

		return null;
	}

	/**
	 * Hide content based on pattern
	 * Priority: {{}} > ::: > backticks > bold
	 */
	private hideContent(text: string): string {
		// Priority 1: {{content}} - replace with ___
		if (/\{\{[^}]+\}\}/.test(text)) {
			return text.replace(/\{\{[^}]+\}\}/g, '___');
		}

		// Priority 2: ::: - show ONLY left side (everything before :::), NO OTHER HIDING
		if (/:::/.test(text)) {
			const parts = text.split(':::');
			return parts[0] || text;
		}

		// Priority 3: `code` - replace with ___
		if (/`[^`]+`/.test(text) || /```[\s\S]+?```/.test(text)) {
			return text
				.replace(/```[\s\S]+?```/g, '___')
				.replace(/`[^`]+`/g, '___');
		}

		// Priority 4: **bold** - replace with *___*
		if (/\*\*[^*]+\*\*/.test(text)) {
			return text.replace(/\*\*([^*]+)\*\*/g, '*___*');
		}

		// No pattern found
		return text;
	}

	/**
	 * Find header context
	 */
	private findHeaderContext(entry: FlatEntry, record: ParsedFile): string | null {
		// Check header levels from most specific to least specific (h3 -> h2 -> h1)
		// Use text if available, otherwise use keywords
		if (entry.h3?.text || entry.h3?.keywords) {
			return entry.h3.text || (entry.h3.keywords ? entry.h3.keywords.join(' ') : null);
		}
		if (entry.h2?.text || entry.h2?.keywords) {
			return entry.h2.text || (entry.h2.keywords ? entry.h2.keywords.join(' ') : null);
		}
		if (entry.h1?.text || entry.h1?.keywords) {
			return entry.h1.text || (entry.h1.keywords ? entry.h1.keywords.join(' ') : null);
		}
		return null;
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
				evt.preventDefault(); // Prevent page scroll

				if (evt.shiftKey) {
					// Shift+Space = Close SRS review
					this.leaf.detach();
				} else {
					// Space = Show/Hide Answer
					const answerButton = this.containerEl.querySelector('.srs-answer-button-container button');
					if (answerButton) {
						(answerButton as HTMLElement).click();
					}
				}
			} else if (evt.key === '1') {
				const card = this.cards[this.currentIndex];
				if (card) {
					this.handleReview('again', card);
					if (evt.shiftKey) {
						// Shift+1 = Answer and close
						this.leaf.detach();
					}
				}
			} else if (evt.key === '2') {
				const card = this.cards[this.currentIndex];
				if (card) {
					this.handleReview('hard', card);
					if (evt.shiftKey) {
						// Shift+2 = Answer and close
						this.leaf.detach();
					}
				}
			} else if (evt.key === '3') {
				const card = this.cards[this.currentIndex];
				if (card) {
					this.handleReview('good', card);
					if (evt.shiftKey) {
						// Shift+3 = Answer and close
						this.leaf.detach();
					}
				}
			} else if (evt.key === '4') {
				const card = this.cards[this.currentIndex];
				if (card) {
					this.handleReview('easy', card);
					if (evt.shiftKey) {
						// Shift+4 = Answer and close
						this.leaf.detach();
					}
				}
			}
		});
	}

	async onClose(): Promise<void> {
		// Cleanup
	}
}
