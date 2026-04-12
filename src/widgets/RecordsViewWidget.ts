import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { RecordsRenderer } from './renderers/RecordsRenderer';
import type { ParsedFile } from '../interfaces/ParsedFile';
import type { ActiveChip } from '../interfaces/ActiveChip';

export const RECORDS_VIEW_TYPE = 'records-view';

/**
 * RecordsViewWidget - Standalone view for filtering and displaying records
 * Extracted from MatrixWidget's bottom half (records section)
 */
export class RecordsViewWidget extends ItemView {
	private plugin: HighlightSpaceRepeatPlugin;

	// Widget filter state
	private widgetFilterType: 'F' | 'H' | 'R' | 'D' | null = 'R'; // Default to Records
	private widgetFilterExpression: string = ''; // Manual text filter expression
	private widgetFilterText: string = ''; // Text filter for entries
	private widgetFileSearchText: string = ''; // File search input text
	private collapsedFiles: Set<string> = new Set();
	private recordsRenderer: RecordsRenderer | null = null;

	// Track expanded headers
	private expandedHeaders: Set<string> = new Set();

	// Prevent concurrent renders
	private isRendering: boolean = false;
	private pendingRender: boolean = false;

	// Chips and flags
	private activeChips: Map<string, ActiveChip> = new Map();
	private trimSubItems: boolean = false;
	private topRecordOnly: boolean = false;
	private colorFilterMode: boolean = false; // \c flag active
	private showLegend: boolean = false;

	// Debounce timer for file search
	private fileSearchDebounceTimer: NodeJS.Timeout | null = null;

	// Color filter CSS element
	private colorFilterStyleElement: HTMLStyleElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return RECORDS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Records View';
	}

	getIcon(): string {
		return 'list-filter';
	}

	async onOpen() {
		await this.render();
	}

	async onClose() {
		// Cleanup color filter CSS
		if (this.colorFilterStyleElement) {
			this.colorFilterStyleElement.remove();
		}
		document.body.removeClass('cc-filtered');
	}

	/**
	 * Main render method
	 */
	async render() {
		// Prevent concurrent renders
		if (this.isRendering) {
			this.pendingRender = true;
			return;
		}

		this.isRendering = true;
		this.pendingRender = false;

		try {
			const container = this.containerEl.children[1];
			container.empty();
			container.addClass('records-view-container');

			// Render records section
			await this.renderRecordsSection(container as HTMLElement);
		} finally {
			this.isRendering = false;

			// If a render was requested while we were rendering, execute it now
			if (this.pendingRender) {
				this.pendingRender = false;
				this.render();
			}
		}
	}

	/**
	 * Render records section (widget filter)
	 */
	private async renderRecordsSection(container: HTMLElement): Promise<void> {
		await this.renderWidgetFilter(container);
	}

	/**
	 * Render widget filter (individual records display with search)
	 * Extracted from MatrixWidget
	 */
	private async renderWidgetFilter(container: HTMLElement): Promise<void> {
		const parsedRecords = this.getParsedRecords();

		this.recordsRenderer = new RecordsRenderer(
			this.app,
			this.plugin,
			parsedRecords,
			{
				filterType: this.widgetFilterType,
				filterExpression: this.widgetFilterExpression,
				filterText: '',  // Don't filter records before render - use DOM filtering instead
				fileSearchText: this.widgetFileSearchText
			},
			{
				activeChips: this.activeChips,
				trimSubItems: this.trimSubItems,
				topRecordOnly: this.topRecordOnly,
				colorFilterMode: this.colorFilterMode
			},
			{
				collapsedFiles: this.collapsedFiles,
				expandedHeaders: this.expandedHeaders
			},
			{
				onFilterTextChange: (text: string) => {
					this.widgetFilterText = text;
					this.renderRecordsOnly();
				},
				onExpressionSearch: (expression: string) => {
					this.widgetFilterExpression = expression;
					// Keep the user's selected filter type (F/H/R) - don't force to R

					// Safety check
					if (!HighlightSpaceRepeatPlugin.settings) {
						this.render();
						return;
					}

					// Extract and create chips from expression
					const extracted = this.extractChipsFromFilterExpression(expression);
					this.activeChips.clear();

					// Add keyword chips
					extracted.keywords.forEach(kw => {
						const keywordStyle = HighlightSpaceRepeatPlugin.settings.categories
							.flatMap((cat: any) => cat.keywords)
							.find((k: any) => k.keyword === kw.value);

						if (keywordStyle) {
							this.activeChips.set(kw.value, {
								type: 'keyword',
								value: kw.value,
								label: kw.value,
								mode: kw.mode,
								active: true,
								backgroundColor: keywordStyle.backgroundColor,
								color: keywordStyle.color
							});
						}
					});

					// Add category chips
					extracted.categoryIds.forEach(cat => {
						const category = HighlightSpaceRepeatPlugin.settings.categories.find((c: any) => c.id === cat.value);
						if (category) {
							this.activeChips.set(`cat-${cat.value}`, {
								type: 'category',
								value: cat.value,
								label: category.icon || cat.value,
								mode: cat.mode,
								active: true
							});
						}
					});

					// Add language chips
					extracted.languages.forEach(lang => {
						this.activeChips.set(`lang-${lang.value}`, {
							type: 'language',
							value: lang.value,
							label: lang.value,
							mode: lang.mode,
							active: true
						});
					});

					this.render();
				},
				onExpressionInput: (expression: string) => {
					this.widgetFilterExpression = expression;
					this.syncButtonsFromExpression();
				},
				onFilterTypeChange: (type: 'F' | 'H' | 'R' | 'D') => {
					this.widgetFilterType = type;
					this.render();
				},
				onTrimToggle: () => {
					this.trimSubItems = !this.trimSubItems;
					this.toggleFilterModifier('\\s', this.trimSubItems);
					this.render();
				},
				onTopToggle: () => {
					this.topRecordOnly = !this.topRecordOnly;
					this.toggleFilterModifier('\\t', this.topRecordOnly);
					this.render();
				},
				onColorFilterToggle: () => {
					this.colorFilterMode = !this.colorFilterMode;
					this.toggleFilterModifier('\\c', this.colorFilterMode);
					this.updateColorFilterCSS();
					this.render();
				},
				onToggleAllFiles: () => {
					if (this.widgetFilterType === 'H') {
						// Headers mode: expandedHeaders set (default collapsed)
						if (this.expandedHeaders.size > 0) {
							this.expandedHeaders.clear();
						} else {
							// Expand all - would need header data, skip for now
						}
					} else {
						// Files mode: collapsedFiles set (default expanded)
						const parsedRecords = this.getParsedRecords();
						const allFilePaths = parsedRecords.map(f => f.filePath);
						const allCollapsed = allFilePaths.length > 0 && allFilePaths.every(path => this.collapsedFiles.has(path));

						if (allCollapsed) {
							this.collapsedFiles.clear();
						} else {
							allFilePaths.forEach(path => this.collapsedFiles.add(path));
						}
					}
					this.renderRecordsOnly();
				},
				onLegendToggle: () => {
					this.showLegend = !this.showLegend;
					this.render();
				},
				onChipClick: (chipId: string) => {
					this.handleChipClick(chipId);
				},
				onSRSReview: async () => {
					await this.startSRSReview();
				},
				onFileSearchChange: (text: string) => {
					this.widgetFileSearchText = text;

					// Debounce re-render to avoid losing focus on every keystroke
					if (this.fileSearchDebounceTimer) {
						clearTimeout(this.fileSearchDebounceTimer);
					}

					this.fileSearchDebounceTimer = setTimeout(async () => {
						// Only refresh results, keep controls intact
						if (this.recordsRenderer) {
							this.recordsRenderer.setFileSearchText(text);
							await this.recordsRenderer.refreshResults();
						}
					}, 300); // 300ms debounce
				}
			}
		);

		await this.recordsRenderer.render(container);
	}

	/**
	 * Render only the records section (faster than full render)
	 */
	private async renderRecordsOnly(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;

		// Clear and re-render records section
		container.empty();
		await this.renderRecordsSection(container);
	}

	/**
	 * Public method to refresh the view after a rescan
	 * Preserves all filter state and re-renders with fresh data
	 */
	public async refreshAfterRescan(): Promise<void> {
		await this.renderRecordsOnly();
	}

	/**
	 * Get parsed records from plugin RAM cache
	 */
	private getParsedRecords(): ParsedFile[] {
		return this.plugin.parsedRecords;
	}

	/**
	 * Start SRS review session with currently filtered records
	 */
	public async startSRSReview(): Promise<void> {
		if (!this.recordsRenderer) {
			new Notice('No records renderer available');
			return;
		}

		const displayedRecords = this.recordsRenderer.getCurrentlyDisplayedRecords();

		// Get all due entries
		const parsedFiles = this.getParsedRecords();
		const dueEntries = this.plugin.srsManager.getDueEntries(parsedFiles);

		// Intersect: only due entries that are also currently displayed
		const displayedDueEntries = dueEntries.filter(({ entry: dueEntry, file: dueFile }) =>
			displayedRecords.some(
				({ entry: displayedEntry, file: displayedFile }) =>
					displayedEntry.lineNumber === dueEntry.lineNumber &&
					displayedFile.filePath === dueFile.filePath
			)
		);

		if (displayedDueEntries.length === 0) {
			const allSRSEntries = this.plugin.srsManager.getAllSRSEntries(parsedFiles);
			if (dueEntries.length > 0) {
				new Notice(`${dueEntries.length} entries due, but none are currently displayed.`);
			} else if (allSRSEntries.length === 0) {
				new Notice('No entries have SRS data yet. To start: review an entry and rate it (Again/Hard/Good/Easy).');
			} else {
				new Notice(`No entries due for review today. ${allSRSEntries.length} entries being tracked.`);
			}
			return;
		}

		// Start SRS review with filtered due entries
		await this.plugin.activateSRSReviewView(displayedDueEntries);
	}

	/**
	 * Handle chip click (toggle include/exclude mode)
	 */
	private handleChipClick(chipId: string): void {
		const chip = this.activeChips.get(chipId);
		if (!chip) return;

		// Get chip syntax
		let chipBase = '';
		if (chip.type === 'category') {
			chipBase = chipId.replace('cat-', '');
		} else if (chip.type === 'keyword') {
			chipBase = chip.label;
		} else if (chip.type === 'language') {
			chipBase = chip.label;
		}

		// Get prefix for chip type
		let prefix = '';
		if (chip.type === 'category') {
			prefix = ':';
		} else if (chip.type === 'keyword') {
			prefix = '.';
		} else if (chip.type === 'language') {
			prefix = '`';
		}

		const includeChip = `${prefix}${chipBase}`;
		const excludeChip = `_${prefix}${chipBase}`;

		// 2-state toggle: activated (.pos) ↔ deactivated (_.pos)
		if (chip.mode === 'include') {
			// Currently activated: Change to deactivated
			this.widgetFilterExpression = this.removeChipFromExpression(
				this.widgetFilterExpression || '',
				includeChip
			);
			this.widgetFilterExpression = this.addChipToExpression(
				this.widgetFilterExpression || '',
				excludeChip
			);
			chip.mode = 'exclude';
		} else {
			// Currently deactivated: Change to activated
			this.widgetFilterExpression = this.removeChipFromExpression(
				this.widgetFilterExpression || '',
				excludeChip
			);
			this.widgetFilterExpression = this.addChipToExpression(
				this.widgetFilterExpression || '',
				includeChip
			);
			chip.mode = 'include';
		}

		// Update chip state in map
		this.activeChips.set(chipId, chip);

		this.syncButtonsFromExpression();

		// Update color filter CSS if flag is active
		this.updateColorFilterCSS();

		// Re-render records section
		this.renderRecordsOnly();
	}

	/**
	 * Toggle filter modifier (\\s, \\t, etc.)
	 */
	private toggleFilterModifier(modifier: string, enable: boolean): void {
		if (enable) {
			if (!this.widgetFilterExpression.includes(modifier)) {
				this.widgetFilterExpression = this.widgetFilterExpression.trim() + ' ' + modifier;
				this.widgetFilterExpression = this.widgetFilterExpression.trim();
			}
		} else {
			this.widgetFilterExpression = this.widgetFilterExpression.replace(new RegExp('\\s*' + modifier.replace(/\\/g, '\\\\') + '\\s*', 'g'), ' ');
			this.widgetFilterExpression = this.widgetFilterExpression.trim();
		}

		// Update CSS if color filter flag changed
		if (modifier === '\\c') {
			this.updateColorFilterCSS();
		}
	}

	/**
	 * Update CSS to only colorize active chip keywords when \c flag enabled
	 */
	private updateColorFilterCSS(): void {
		// Remove existing style element
		if (this.colorFilterStyleElement) {
			this.colorFilterStyleElement.remove();
			this.colorFilterStyleElement = null;
		}

		// If flag disabled, restore default colors (remove body class)
		if (!this.colorFilterMode) {
			document.body.removeClass('cc-filtered');
			return;
		}

		// Add body class to enable filter mode
		document.body.addClass('cc-filtered');

		// Get active keywords from chips (include mode only)
		const activeKeywords = new Set<string>();

		for (const [key, chip] of this.activeChips) {
			if (chip.mode === 'include') {
				if (chip.type === 'keyword') {
					activeKeywords.add(chip.value);
				} else if (chip.type === 'category') {
					// Get all keywords in this category
					const category = HighlightSpaceRepeatPlugin.settings.categories.find(
						cat => cat.id === chip.value
					);
					if (category) {
						category.keywords.forEach(kw => {
							if (kw.keyword) activeKeywords.add(kw.keyword);
						});
					}
				}
			}
		}

		// Generate CSS rules
		const cssRules: string[] = [];

		// Base rule: hide all colors when filter mode active
		cssRules.push(`
body.cc-enabled.cc-filtered .kh-highlighted {
  color: inherit !important;
  background-color: transparent !important;
}

body.cc-enabled.cc-filtered mark {
  color: inherit !important;
  background-color: transparent !important;
}
		`);

		// Restore colors for active keywords only
		for (const keyword of activeKeywords) {
			// Get keyword metadata for colors
			const kwData = this.getKeywordData(keyword);
			if (kwData) {
				cssRules.push(`
body.cc-enabled.cc-filtered .kh-highlighted.${keyword} {
  color: ${kwData.color} !important;
  background-color: ${kwData.backgroundColor} !important;
}

body.cc-enabled.cc-filtered mark.${keyword} {
  color: ${kwData.color} !important;
  background-color: ${kwData.backgroundColor} !important;
}
				`);
			}
		}

		// Inject CSS
		this.colorFilterStyleElement = document.head.createEl('style');
		this.colorFilterStyleElement.textContent = cssRules.join('\n');
	}

	/**
	 * Get keyword color/background from settings
	 */
	private getKeywordData(keyword: string): { color: string; backgroundColor: string } | null {
		for (const category of HighlightSpaceRepeatPlugin.settings.categories) {
			const kw = category.keywords.find(k => k.keyword === keyword);
			if (kw) {
				return {
					color: kw.color,
					backgroundColor: kw.backgroundColor
				};
			}
		}
		return null;
	}

	/**
	 * Sync button states from filter expression
	 */
	private syncButtonsFromExpression(): void {
		this.trimSubItems = this.widgetFilterExpression.includes('\\s');
		this.topRecordOnly = this.widgetFilterExpression.includes('\\t');
		this.colorFilterMode = this.widgetFilterExpression.includes('\\c');
	}

	/**
	 * Extract keywords/categories/languages from filter expression
	 */
	private extractChipsFromFilterExpression(expression: string): {
		keywords: Array<{value: string, mode: 'include' | 'exclude'}>,
		categoryIds: Array<{value: string, mode: 'include' | 'exclude'}>,
		languages: Array<{value: string, mode: 'include' | 'exclude'}>
	} {
		if (!expression || expression.trim() === '') {
			return { keywords: [], categoryIds: [], languages: [] };
		}

		// Extract SELECT clause (everything before W:)
		let selectClause = expression;
		if (expression.includes('W:')) {
			const parts = expression.split(/W:/);
			selectClause = parts[0].replace(/^S:/, '').trim();
		} else if (expression.startsWith('S:')) {
			selectClause = expression.substring(2).trim();
		}

		// Remove modifiers
		selectClause = selectClause.replace(/\\[satc]/g, '').trim();

		if (!selectClause) {
			return { keywords: [], categoryIds: [], languages: [] };
		}

		const keywords: Array<{value: string, mode: 'include' | 'exclude'}> = [];
		const categoryIds: Array<{value: string, mode: 'include' | 'exclude'}> = [];
		const languages: Array<{value: string, mode: 'include' | 'exclude'}> = [];

		// Split by space and OR to get individual tokens
		const tokens = selectClause.split(/\s+/).filter(t => t.length > 0 && t !== 'OR' && t !== 'AND');

		for (const token of tokens) {
			const isExclude = token.startsWith('_');
			const cleanToken = isExclude ? token.substring(1) : token;

			if (cleanToken.startsWith('.')) {
				// Keyword
				keywords.push({ value: cleanToken.substring(1), mode: isExclude ? 'exclude' : 'include' });
			} else if (cleanToken.startsWith(':')) {
				// Category
				categoryIds.push({ value: cleanToken.substring(1), mode: isExclude ? 'exclude' : 'include' });
			} else if (cleanToken.startsWith('`')) {
				// Language
				languages.push({ value: cleanToken.substring(1), mode: isExclude ? 'exclude' : 'include' });
			}
		}

		return { keywords, categoryIds, languages };
	}

	/**
	 * Get SELECT clause from filter expression
	 */
	private getSelectClause(expression: string): string {
		if (expression.includes('W:')) {
			const parts = expression.split(/\s+W:\s+/);
			return parts[0].replace(/^S:\s*/, '').trim();
		}
		return expression.replace(/^S:\s*/, '').trim();
	}

	/**
	 * Add chip to filter expression
	 */
	private addChipToExpression(expression: string, chip: string): string {
		if (!expression || expression.trim() === '') {
			return chip;
		}

		// Check if chip already exists
		const selectClause = this.getSelectClause(expression);
		const tokens = selectClause.split(/\s+/).filter(t => t.length > 0 && t !== 'OR' && t !== 'AND');

		if (tokens.includes(chip)) {
			return expression; // Already in expression
		}

		// Add chip to SELECT clause with space (implicit OR)
		const whereMatch = expression.match(/\s+W:\s+/);
		if (whereMatch) {
			const parts = expression.split(/\s+W:\s+/);
			const newSelect = parts[0] + ' ' + chip;
			return newSelect + ' W: ' + parts[1];
		} else {
			return expression + ' ' + chip;
		}
	}

	/**
	 * Remove chip from filter expression
	 */
	private removeChipFromExpression(expression: string, chip: string): string {
		if (!expression) return '';

		// Get SELECT and WHERE clauses
		const whereMatch = expression.match(/\s+W:\s+/);
		let selectClause = expression;
		let whereClause = '';

		if (whereMatch) {
			const parts = expression.split(/\s+W:\s+/);
			selectClause = parts[0];
			whereClause = parts[1] || '';
		}

		// Remove chip from SELECT clause
		let tokens = selectClause.split(/\s+/).filter(t => t.length > 0);

		// Filter out the chip to remove
		tokens = tokens.filter(t => t !== chip);

		// Clean up orphaned OR/AND operators
		tokens = tokens.filter((t, i, arr) => {
			if (t === 'OR' || t === 'AND') {
				// Remove if at start, end, or consecutive operators
				if (i === 0 || i === arr.length - 1) return false;
				if (arr[i - 1] === 'OR' || arr[i - 1] === 'AND') return false;
			}
			return true;
		});

		const newSelect = tokens.join(' ');

		if (whereClause) {
			return newSelect ? `${newSelect} W: ${whereClause}` : `W: ${whereClause}`;
		}
		return newSelect;
	}

	/**
	 * Set filter expression from external source (e.g., Matrix View)
	 */
	public setFilterExpression(expression: string, type?: 'F' | 'H' | 'R' | 'D') {
		this.widgetFilterExpression = expression;
		this.widgetFilterType = type || 'R'; // Default to Record filter if not specified

		// Safety check
		if (!HighlightSpaceRepeatPlugin.settings) {
			this.render();
			return;
		}

		// Extract and create chips from expression
		const extracted = this.extractChipsFromFilterExpression(expression);
		this.activeChips.clear();

		// Add keyword chips
		extracted.keywords.forEach(kw => {
			const keywordStyle = HighlightSpaceRepeatPlugin.settings.categories
				.flatMap((cat: any) => cat.keywords)
				.find((k: any) => k.keyword === kw.value);

			if (keywordStyle) {
				this.activeChips.set(kw.value, {
					type: 'keyword',
					value: kw.value,
					label: kw.value,
					mode: kw.mode,
					active: true,
					backgroundColor: keywordStyle.backgroundColor,
					color: keywordStyle.color
				});
			}
		});

		// Add category chips
		extracted.categoryIds.forEach(cat => {
			const category = HighlightSpaceRepeatPlugin.settings.categories.find((c: any) => c.id === cat.value);
			if (category) {
				this.activeChips.set(`cat-${cat.value}`, {
					type: 'category',
					value: cat.value,
					label: category.icon || cat.value,
					mode: cat.mode,
					active: true
				});
			}
		});

		// Add language chips
		extracted.languages.forEach(lang => {
			this.activeChips.set(`lang-${lang.value}`, {
				type: 'language',
				value: lang.value,
				label: lang.value,
				mode: lang.mode,
				active: true
			});
		});

		this.render();
	}

	/**
	 * Trigger re-search with current filter expression (for updating color filters, etc.)
	 */
	public triggerSearch() {
		// Re-process current expression to update chips and color filters
		this.setFilterExpression(this.widgetFilterExpression, this.widgetFilterType || undefined);
	}
}
