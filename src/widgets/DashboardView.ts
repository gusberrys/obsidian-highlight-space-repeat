import { ItemView, WorkspaceLeaf, MarkdownRenderer, Modal, Setting, App } from 'obsidian';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';
import type { ParsedRecord, RecordHeader, RecordEntry } from '../interfaces/ParsedRecord';
import { FilterParser } from '../services/FilterParser';
import type { FilterMatchContext } from '../interfaces/FilterInterfaces';
import { FilterTokenType } from '../interfaces/FilterInterfaces';
import { KHEntry } from '../components/KHEntry';
import type { ActiveChip } from '../interfaces/ActiveChip';

export const DASHBOARD_VIEW_TYPE = 'kh-dashboard-view';

type ViewMode = 'F' | 'H' | 'R'; // Files, Headers, Records

export class DashboardView extends ItemView {
	private plugin: HighlightSpaceRepeatPlugin;
	private currentSubject: Subject | null = null;
	private currentPrimaryTopic: Topic | null = null;
	private currentSecondaryTopic: Topic | null = null;
	private viewMode: ViewMode = 'R'; // Default to Records
	private filterExpression: string = '';
	private resultsContainer: HTMLElement | null = null;
	private currentPage: number = 1;
	private itemsPerPage: number = 50;
	private totalItems: number = 0;

	// Chips and flags
	private activeChips: Map<string, ActiveChip> = new Map();
	private disableTabs: boolean = false; // Disable H1 tab grouping
	private trimSubItems: boolean = false; // Filter sub-items to matching keywords only
	private topRecordOnly: boolean = false; // Only show records where keyword is top-level
	private showAll: boolean = false; // Show all records (ignore SELECT clause, apply only WHERE)

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'KH Dashboard';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		// Clean up
	}

	/**
	 * Set current context from matrix widget
	 */
	setContext(subject: Subject | null, primaryTopic: Topic | null, secondaryTopic: Topic | null): void {
		this.currentSubject = subject;
		this.currentPrimaryTopic = primaryTopic;
		this.currentSecondaryTopic = secondaryTopic;
		this.render();
	}

	/**
	 * Render the dashboard
	 */
	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('kh-dashboard-container');

		// Toolbar
		this.renderToolbar(container);

		// Chips and flag buttons container
		const chipsSection = container.createDiv({ cls: 'kh-chips-section' });
		chipsSection.id = 'kh-chips-container';
		this.renderChipsAndFlags();

		// Results
		this.resultsContainer = container.createDiv({ cls: 'kh-dashboard-results' });

		// Trigger initial search
		this.triggerSearch();
	}

	/**
	 * Render toolbar with context indicators and filter
	 */
	private renderToolbar(container: HTMLElement): void {
		const toolbar = container.createDiv({ cls: 'kh-dashboard-toolbar' });

		// Context indicators (subject and topic icons)
		const contextDiv = toolbar.createDiv({ cls: 'kh-dashboard-context' });

		if (this.currentSubject) {
			const subjectIcon = contextDiv.createEl('span', {
				text: this.currentSubject.icon || '📁',
				cls: 'kh-context-icon kh-context-subject'
			});
			subjectIcon.title = `Subject: ${this.currentSubject.name}`;
		}

		if (this.currentPrimaryTopic) {
			const primaryIcon = contextDiv.createEl('span', {
				text: this.currentPrimaryTopic.icon || '📌',
				cls: 'kh-context-icon kh-context-primary'
			});
			primaryIcon.title = `Primary Topic: ${this.currentPrimaryTopic.name}`;
		}

		if (this.currentSecondaryTopic) {
			const secondaryIcon = contextDiv.createEl('span', {
				text: this.currentSecondaryTopic.icon || '🔗',
				cls: 'kh-context-icon kh-context-secondary'
			});
			secondaryIcon.title = `Secondary Topic: ${this.currentSecondaryTopic.name}`;
		}

		// Mode selector (F/H/R)
		const modeDiv = toolbar.createDiv({ cls: 'kh-dashboard-mode' });

		const modeSelect = modeDiv.createEl('select', {
			cls: 'kh-dashboard-mode-select'
		});

		[
			{ value: 'F', label: 'Files' },
			{ value: 'H', label: 'Headers' },
			{ value: 'R', label: 'Records' }
		].forEach(({ value, label }) => {
			const option = modeSelect.createEl('option', {
				value: value,
				text: label
			});
			if (this.viewMode === value) {
				option.selected = true;
			}
		});

		modeSelect.addEventListener('change', (e) => {
			this.viewMode = (e.target as HTMLSelectElement).value as ViewMode;
			this.render();
		});

		// Filter expression input
		const filterDiv = toolbar.createDiv({ cls: 'kh-dashboard-filter' });

		const filterInput = filterDiv.createEl('input', {
			type: 'text',
			cls: 'kh-filter-input',
			placeholder: 'Filter expression...'
		});
		filterInput.value = this.filterExpression;

		const searchBtn = filterDiv.createEl('button', {
			text: '🔍',
			cls: 'kh-filter-search-btn'
		});

		const performSearch = () => {
			this.filterExpression = filterInput.value;
			this.parseFilterExpression();
			this.renderChipsAndFlags(); // Render chips after parsing
			this.triggerSearch();
		};

		// Sync button states as user types
		filterInput.addEventListener('input', () => {
			this.filterExpression = filterInput.value;
			this.syncButtonsFromExpression();
		});

		filterInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				performSearch();
			}
		});

		searchBtn.addEventListener('click', performSearch);
	}

	/**
	 * Trigger search and render results
	 */
	private async triggerSearch(): Promise<void> {
		if (!this.resultsContainer) return;

		this.resultsContainer.empty();

		// Reset to first page on new search
		this.currentPage = 1;

		// Load parsed records
		const parsedRecords = await this.loadParsedRecords();

		if (parsedRecords.length === 0) {
			this.resultsContainer.createDiv({
				text: 'No records found. Please run scan in settings.',
				cls: 'kh-empty-message'
			});
			return;
		}

		// Filter records based on current context (subject/topics)
		let filteredRecords = this.filterByContext(parsedRecords);

		// Apply filter expression for Files (F) and Records (R) modes only
		// Header mode (H) does its own filtering in renderHeaders
		if (this.filterExpression && this.viewMode !== 'H') {
			filteredRecords = this.applyFilterExpression(filteredRecords);
		}

		// Render based on mode
		if (this.viewMode === 'F') {
			await this.renderFiles(filteredRecords);
		} else if (this.viewMode === 'H') {
			await this.renderHeaders(filteredRecords);
		} else {
			await this.renderRecords(filteredRecords);
		}
	}

	/**
	 * Filter records by current context (subject/topics)
	 */
	private filterByContext(records: ParsedRecord[]): ParsedRecord[] {
		if (!this.currentSubject) return records;

		const tags: string[] = [];

		// Add subject tag
		if (this.currentSubject.mainTag) {
			tags.push(this.currentSubject.mainTag);
		}

		// Add primary topic tag
		if (this.currentPrimaryTopic?.topicTag) {
			tags.push(this.currentPrimaryTopic.topicTag);
		}

		// Add secondary topic tag
		if (this.currentSecondaryTopic?.topicTag) {
			tags.push(this.currentSecondaryTopic.topicTag);
		}

		if (tags.length === 0) return records;

		// Filter records that have ALL tags
		return records.filter(record => {
			const fileTags = this.getRecordTags(record);
			return tags.every(tag => fileTags.includes(tag));
		});
	}

	/**
	 * Get all tags from a record
	 */
	private getRecordTags(record: ParsedRecord): string[] {
		const tags = new Set<string>();

		// File-level tags
		record.tags.forEach(tag => {
			tags.add(tag.startsWith('#') ? tag : '#' + tag);
		});

		// Header tags
		const collectHeaderTags = (headers: RecordHeader[]) => {
			for (const header of headers) {
				header.tags.forEach(tag => {
					tags.add(tag.startsWith('#') ? tag : '#' + tag);
				});
				if (header.children) {
					collectHeaderTags(header.children);
				}
			}
		};

		collectHeaderTags(record.headers);

		return Array.from(tags);
	}

	/**
	 * Transform filter expression to replace category/language syntax with FilterParser syntax
	 * Example: "def str :boo W: #tag" → ".def | .str | .keyword1 | .keyword2 W: #tag"
	 */
	private transformFilterExpression(expression: string): string {
		// Remove modifiers from ENTIRE expression first (before splitting on W:)
		expression = expression.replace(/\\[sat]/g, '').trim();

		// Extract SELECT and WHERE clauses
		const hasWhere = expression.includes('W:');
		let selectExpr = expression;
		let whereExpr = '';

		if (hasWhere) {
			const parts = expression.split(/W:/);
			selectExpr = parts[0].trim();
			whereExpr = parts[1]?.trim() || '';
		}

		// Remove S: prefix if present
		if (selectExpr.startsWith('S:')) {
			selectExpr = selectExpr.substring(2).trim();
		}

		if (!selectExpr) {
			return whereExpr ? `W: ${whereExpr}` : '';
		}

		// Parse items
		const items = selectExpr.split(/[,\s]+/).map(item => item.trim()).filter(item => item);

		// Transform items
		const transformedItems: string[] = [];
		for (const item of items) {
			// Check for negation
			const isExclude = item.startsWith('!') || item.startsWith('-');
			const cleanItem = isExclude ? item.substring(1).trim() : item;
			const negation = isExclude ? '-' : '';

			// Category syntax: :category-id - pass through to FilterParser
			if (cleanItem.startsWith(':')) {
				transformedItems.push(`${negation}${cleanItem}`);
			}
			// Language syntax: `language
			else if (cleanItem.startsWith('`')) {
				const language = cleanItem.substring(1);
				transformedItems.push(`${negation}\`${language}`);
			}
			// Keyword syntax: plain text
			else {
				// Check if already has . prefix (user using raw FilterParser syntax)
				if (cleanItem.startsWith('.')) {
					// Already has . prefix, use as-is
					transformedItems.push(`${negation}${cleanItem}`);
				} else {
					// Add . prefix for FilterParser keyword syntax
					transformedItems.push(`${negation}.${cleanItem}`);
				}
			}
		}

		// Join with OR operator
		const transformedSelect = transformedItems.length > 0 ? transformedItems.join(' OR ') : '';

		// Reconstruct expression
		return whereExpr ? `${transformedSelect} W: ${whereExpr}` : transformedSelect;
	}

	/**
	 * Apply filter expression to records
	 * WHERE and SELECT both filter at ENTRY level - not file level
	 */
	private applyFilterExpression(records: ParsedRecord[]): ParsedRecord[] {
		try {
			// Transform expression to replace category/language syntax with FilterParser syntax
			const transformedExpr = this.transformFilterExpression(this.filterExpression);

			// Split on W: to separate SELECT and WHERE clauses
			const hasWhere = transformedExpr.includes('W:');
			let selectExpr = transformedExpr;
			let whereExpr = '';

			if (hasWhere) {
				const parts = transformedExpr.split(/W:/);
				selectExpr = parts[0].trim();
				whereExpr = parts[1]?.trim() || '';
			}

			// Compile expressions
			const selectCompiled = FilterParser.compile(selectExpr);
			const whereCompiled = whereExpr ? FilterParser.compile(whereExpr) : null;

			const matchingRecords: ParsedRecord[] = [];

			for (const record of records) {
				// Check if ANY entry matches BOTH WHERE and SELECT
				const contexts = this.parsedRecordToContexts(record);
				const hasMatch = contexts.some(({ context }) => {
					// WHERE clause filters entries (if present)
					if (whereCompiled) {
						if (!FilterParser.evaluate(whereCompiled.ast, context, whereCompiled.modifiers)) {
							return false; // Entry doesn't match WHERE
						}
					}
					// SELECT clause filters entries
					return FilterParser.evaluate(selectCompiled.ast, context, selectCompiled.modifiers);
				});

				if (hasMatch) {
					matchingRecords.push(record);
				}
			}

			return matchingRecords;
		} catch (error) {
			console.error('[Dashboard] Filter expression error:', error);
			return records;
		}
	}

	/**
	 * Convert ParsedRecord to FilterMatchContext array
	 */
	private parsedRecordToContexts(record: ParsedRecord): Array<{ context: FilterMatchContext; entry: RecordEntry }> {
		const results: Array<{ context: FilterMatchContext; entry: RecordEntry }> = [];

		const processHeaders = (headers: RecordHeader[]) => {
			for (const header of headers) {
				if (header.entries && header.entries.length > 0) {
					for (const entry of header.entries) {
						const context: FilterMatchContext = {
							filePath: record.filePath,
							fileName: record.fileName,
							tags: [...record.tags, ...header.tags],
							keywords: entry.keywords || [],
							code: entry.text || '',
							languages: entry.type === 'codeblock' && entry.language ? [entry.language] : [],
							auxiliaryKeywords: [],
							keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
						};

						results.push({ context, entry });
					}
				}

				if (header.children && header.children.length > 0) {
					processHeaders(header.children);
				}
			}
		};

		processHeaders(record.headers);

		return results;
	}

	/**
	 * Render files mode with H1 tabs
	 */
	private async renderFiles(records: ParsedRecord[]): Promise<void> {
		if (!this.resultsContainer) return;

		if (records.length === 0) {
			this.resultsContainer.createDiv({
				text: 'No files found',
				cls: 'kh-empty-message'
			});
			return;
		}

		// If \a flag is active, discover all keywords from WHERE-matching entries
		if (this.showAll && this.filterExpression) {
			this.discoverAndCreateTemporaryChips(records);
		}

		// Render all files in PARALLEL
		await Promise.all(records.map(record => {
			return this.renderSingleFileWithTabs(record);
		}));
	}

	/**
	 * Render a single file with H1 header tabs
	 */
	private async renderSingleFileWithTabs(record: ParsedRecord): Promise<void> {
		if (!this.resultsContainer) return;

		// Collect all entries and group by H1 headers
		const h1Groups = this.groupEntriesByH1(record);

		// Skip files with no entries (pointless to show empty files)
		if (h1Groups.size === 0) {
			return;
		}

		// Check if any group has entries
		let hasAnyEntries = false;
		for (const [_, entries] of h1Groups) {
			if (entries.length > 0) {
				hasAnyEntries = true;
				break;
			}
		}

		// Skip if no entries found
		if (!hasAnyEntries) {
			return;
		}

		const fileGroup = this.resultsContainer.createDiv({ cls: 'kh-file-group' });

		// File header (clickable to open file)
		const fileHeader = fileGroup.createDiv({ cls: 'kh-file-header' });
		fileHeader.createEl('span', {
			text: record.fileName,
			cls: 'kh-file-name'
		});

		fileHeader.addEventListener('click', () => {
			const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
			if (file) {
				this.plugin.app.workspace.getLeaf().openFile(file as any);
			}
		});

		// If tabs are disabled OR there's only one H1 group, render all entries on one page
		if (this.disableTabs || h1Groups.size <= 1) {
			const entriesContainer = fileGroup.createDiv({ cls: 'kh-file-entries' });

			// Collect all entries from all groups
			const allEntries: RecordEntry[] = [];
			for (const [_, entries] of h1Groups) {
				allEntries.push(...entries);
			}

			// Filter entries by active chips before rendering
			const filteredEntries = allEntries.filter(entry => {
				const context = this.createContextForEntry(entry, record);
				return this.applyChipsFilter(entry, context);
			});

			// Render filtered entries
			await Promise.all(filteredEntries.map(entry => {
				return this.renderEntry(entriesContainer, entry, record);
			}));
		} else {
			// Multiple H1 groups AND tabs enabled - create tabs
			const tabsContainer = fileGroup.createDiv({ cls: 'kh-h1-tabs-container' });
			const tabButtons = tabsContainer.createDiv({ cls: 'kh-h1-tabs-buttons' });
			const tabContents = tabsContainer.createDiv({ cls: 'kh-h1-tabs-contents' });

			const h1Array = Array.from(h1Groups.entries());
			let firstTabActivated = false;

			for (const [h1Header, h1Entries] of h1Array) {
				// Filter entries by active chips FIRST
				const filteredH1Entries = h1Entries.filter(entry => {
					const context = this.createContextForEntry(entry, record);
					return this.applyChipsFilter(entry, context);
				});

				// Skip this tab if no entries after filtering
				if (filteredH1Entries.length === 0) {
					continue;
				}

				const isFirstTab = !firstTabActivated;

				// Create tab button
				const tabButton = tabButtons.createEl('button', {
					cls: 'kh-h1-tab-button' + (isFirstTab ? ' kh-h1-tab-button-active' : '')
				});

				const headerText = h1Header === '__no_header__' ? 'No Header' : h1Header;
				// Render header text with markdown support for keywords and backticks
				MarkdownRenderer.renderMarkdown(
					headerText,
					tabButton,
					'',
					this.plugin
				);
				tabButton.title = headerText;

				// Create tab content
				const tabContent = tabContents.createDiv({
					cls: 'kh-h1-tab-content' + (isFirstTab ? ' kh-h1-tab-content-active' : '')
				});

				// Tab button click handler
				tabButton.onclick = () => {
					// Deactivate all tabs
					tabButtons.querySelectorAll('.kh-h1-tab-button').forEach(btn => {
						btn.removeClass('kh-h1-tab-button-active');
					});
					tabContents.querySelectorAll('.kh-h1-tab-content').forEach(content => {
						content.removeClass('kh-h1-tab-content-active');
					});

					// Activate this tab
					tabButton.addClass('kh-h1-tab-button-active');
					tabContent.addClass('kh-h1-tab-content-active');
				};

				// Render filtered entries for this H1 group
				await Promise.all(filteredH1Entries.map(entry => {
					return this.renderEntry(tabContent, entry, record);
				}));

				if (isFirstTab) {
					firstTabActivated = true;
				}
			}
		}
	}

	/**
	 * Group entries by H1 headers
	 */
	private groupEntriesByH1(record: ParsedRecord): Map<string, RecordEntry[]> {
		const h1Groups = new Map<string, RecordEntry[]>();
		let currentH1 = '__no_header__';

		// Process headers recursively
		const processHeaders = (headers: RecordHeader[], parentH1?: string) => {
			for (const header of headers) {
				if (header.level === 1) {
					// This is an H1 header
					const headerText = header.text || '__no_header__';
					currentH1 = headerText;

					if (!h1Groups.has(currentH1)) {
						h1Groups.set(currentH1, []);
					}

					// Add entries directly under this H1
					if (header.entries && header.entries.length > 0) {
						h1Groups.get(currentH1)!.push(...header.entries);
					}

					// Process children (H2, H3)
					if (header.children && header.children.length > 0) {
						processHeaders(header.children, currentH1);
					}
				} else {
					// H2 or H3 - belongs to current H1 (or parent H1)
					const targetH1 = parentH1 || currentH1;

					if (!h1Groups.has(targetH1)) {
						h1Groups.set(targetH1, []);
					}

					// Add entries under this header
					if (header.entries && header.entries.length > 0) {
						h1Groups.get(targetH1)!.push(...header.entries);
					}

					// Process children recursively
					if (header.children && header.children.length > 0) {
						processHeaders(header.children, targetH1);
					}
				}
			}
		};

		processHeaders(record.headers);

		return h1Groups;
	}

	/**
	 * Render a single entry
	 */
	private async renderEntry(container: HTMLElement, entry: RecordEntry, record: ParsedRecord): Promise<void> {
		if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
			const primaryKeyword = entry.keywords[0];
			const entryItem = container.createDiv({
				cls: `kh-file-entry ${primaryKeyword}`
			});

			entryItem.addEventListener('click', () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					this.plugin.app.workspace.getLeaf().openFile(file as any);
				}
			});

			// Render entry using KHEntry component - let it handle icons inline
			await KHEntry.renderKeywordEntry(
				entryItem,
				entry,
				record,
				this.plugin,
				false // full mode for dashboard
			);
		} else if (entry.type === 'codeblock') {
			const entryItem = container.createDiv({ cls: 'kh-file-entry kh-codeblock-entry' });

			// Render code block with syntax highlighting
			const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
			MarkdownRenderer.renderMarkdown(
				codeMarkdown,
				entryItem,
				record.filePath,
				this
			);

			entryItem.addEventListener('click', () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					this.plugin.app.workspace.getLeaf().openFile(file as any);
				}
			});
		}
	}

	/**
	 * Render headers mode
	 * Check if HEADER matches filter (using FilterParser with \h flag support), then show ALL entries under that header
	 */
	private async renderHeaders(records: ParsedRecord[]): Promise<void> {
		if (!this.resultsContainer) return;

		if (!this.filterExpression) {
			this.resultsContainer.createDiv({
				text: 'No filter expression',
				cls: 'kh-empty-message'
			});
			return;
		}

		const headers: { record: ParsedRecord; header: RecordHeader }[] = [];

		try {
			// Auto-enable \h flag in Header mode
			const exprWithHeaderFlag = this.filterExpression.includes('\\h')
				? this.filterExpression
				: this.filterExpression + ' \\h';
			// DO NOT transform - Header mode uses raw FilterParser syntax
			const compiled = FilterParser.compile(exprWithHeaderFlag);

			// Collect matching headers
			for (const record of records) {
				const checkHeaders = (headerList: RecordHeader[]) => {
					for (const header of headerList) {
						// Create context for this header
						const headerContext: FilterMatchContext = {
							filePath: record.filePath,
							fileName: record.fileName,
							tags: record.tags || [],
							keywords: [],
							code: '',
							languages: [],
							auxiliaryKeywords: [],
							headerKeywords: header.keywords || [],
							headerTags: header.tags || [],
							keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
						};

						console.log('[Dashboard Header Mode] Evaluating header:', header.text);
						console.log('  Filter AST:', JSON.stringify(compiled.ast, null, 2));
						console.log('  Context tags:', headerContext.tags);
						console.log('  Context headerTags:', headerContext.headerTags);
						console.log('  Context headerKeywords:', headerContext.headerKeywords);

						// Evaluate filter against header context
						const match = FilterParser.evaluate(compiled.ast, headerContext, compiled.modifiers);
						console.log('  Match result:', match);

						if (match) {
							headers.push({ record, header });
						}

						if (header.children) {
							checkHeaders(header.children);
						}
					}
				};

				checkHeaders(record.headers);
			}
		} catch (error) {
			console.error('[Dashboard] Header filter error:', error);
			this.resultsContainer.createDiv({
				text: 'Invalid filter expression',
				cls: 'kh-empty-message'
			});
			return;
		}

		if (headers.length === 0) {
			this.resultsContainer.createDiv({
				text: 'No headers found',
				cls: 'kh-empty-message'
			});
			return;
		}

		// Render each header with ALL its entries
		for (const { record, header } of headers) {
			const headerGroup = this.resultsContainer!.createDiv({ cls: 'kh-header-group' });

			// Header title (clickable to open file)
			const headerTitle = headerGroup.createDiv({ cls: 'kh-header-title' });
			headerTitle.createEl('span', {
				text: `${record.fileName}: ${header.text}`,
				cls: 'kh-header-text'
			});

			headerTitle.addEventListener('click', () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					this.plugin.app.workspace.getLeaf().openFile(file as any);
				}
			});

			// Render ALL entries under this header
			if (header.entries && header.entries.length > 0) {
				const entriesContainer = headerGroup.createDiv({ cls: 'kh-header-entries' });

				// Filter entries by active chips before rendering
				const filteredEntries = header.entries.filter(entry => {
					const context = this.createContextForEntry(entry, record);
					return this.applyChipsFilter(entry, context);
				});

				// Render entries in PARALLEL
				await Promise.all(filteredEntries.map(entry => {
					return this.renderEntry(entriesContainer, entry, record);
				}));
			}
		}
	}

	/**
	 * Create a FilterMatchContext from an entry and record
	 */
	private createContextForEntry(entry: RecordEntry, record: ParsedRecord): FilterMatchContext {
		return {
			filePath: record.filePath,
			fileName: record.fileName,
			tags: record.tags,
			keywords: entry.keywords || [],
			code: entry.text || '',
			languages: entry.type === 'codeblock' && entry.language ? [entry.language] : [],
			auxiliaryKeywords: [],
			keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
		};
	}

	/**
	 * Apply active chips filtering to an entry
	 * Returns true if entry should be shown, false if filtered out
	 */
	private applyChipsFilter(entry: RecordEntry, context: FilterMatchContext): boolean {
		// Get active chips (exclude inactive ones)
		const activeKeywordChips = Array.from(this.activeChips.values())
			.filter(chip => chip.active && chip.type === 'keyword');

		const activeCategoryChips = Array.from(this.activeChips.values())
			.filter(chip => chip.active && chip.type === 'category');

		const activeLanguageChips = Array.from(this.activeChips.values())
			.filter(chip => chip.active && chip.type === 'language');

		// If no active chips, show all
		if (activeKeywordChips.length === 0 && activeCategoryChips.length === 0 && activeLanguageChips.length === 0) {
			return true;
		}

		// Separate include and exclude chips for keywords
		const includeKeywordChips = activeKeywordChips.filter(c => c.mode === 'include');
		const excludeKeywordChips = activeKeywordChips.filter(c => c.mode === 'exclude');

		// Expand category chips to keyword chips
		for (const categoryChip of activeCategoryChips) {
			const categoryClass = categoryChip.value;
			// Find all keywords from category with matching id
			const categoryKeywords = HighlightSpaceRepeatPlugin.settings.categories
				.filter((cat: any) => cat.id === categoryClass)
				.flatMap((cat: any) => cat.keywords)
				.map((kw: any) => kw.keyword);

			// Add category keywords as individual chips
			for (const kw of categoryKeywords) {
				if (categoryChip.mode === 'include') {
					includeKeywordChips.push({ ...categoryChip, value: kw, type: 'keyword' });
				} else {
					excludeKeywordChips.push({ ...categoryChip, value: kw, type: 'keyword' });
				}
			}
		}

		const includeLanguages = activeLanguageChips.filter(c => c.mode === 'include').map(c => c.value);
		const excludeLanguages = activeLanguageChips.filter(c => c.mode === 'exclude').map(c => c.value);

		// Check exclude chips first (if any match, reject entry)
		for (const excludeChip of excludeKeywordChips) {
			const chipValue = excludeChip.value;

			// Multi-keyword chip: def.rep means entry must have BOTH def AND rep
			if (chipValue.includes('.')) {
				const requiredKeywords = chipValue.split('.');
				const hasAllKeywords = requiredKeywords.every(kw =>
					entry.keywords?.some(entryKw => entryKw.toLowerCase() === kw.toLowerCase())
				);
				if (hasAllKeywords) return false; // Has excluded multi-keyword combo
			} else {
				// Single keyword chip
				const hasKeyword = entry.keywords?.some(kw => kw.toLowerCase() === chipValue.toLowerCase());
				if (hasKeyword) return false;
			}
		}

		if (excludeLanguages.length > 0 && entry.type === 'codeblock') {
			const hasExcludedLanguage = entry.language && excludeLanguages.includes(entry.language);
			if (hasExcludedLanguage) return false;
		}

		// Check include chips (if any, entry must match at least one)
		// Use OR logic: match if it matches keywords OR languages
		const hasIncludeFilters = includeKeywordChips.length > 0 || includeLanguages.length > 0;

		if (!hasIncludeFilters) {
			return true; // No include filters, show entry
		}

		// Check if entry matches any include filter
		let matchesKeyword = false;
		let matchesLanguage = false;

		// Check keyword chips (including multi-keyword)
		for (const includeChip of includeKeywordChips) {
			const chipValue = includeChip.value;

			// Multi-keyword chip: def.rep means entry must have BOTH def AND rep
			if (chipValue.includes('.')) {
				const requiredKeywords = chipValue.split('.');
				const hasAllKeywords = requiredKeywords.every(kw =>
					entry.keywords?.some(entryKw => entryKw.toLowerCase() === kw.toLowerCase())
				);
				if (hasAllKeywords) {
					matchesKeyword = true;
					break;
				}
			} else {
				// Single keyword chip
				const hasKeyword = entry.keywords?.some(kw => kw.toLowerCase() === chipValue.toLowerCase());
				if (hasKeyword) {
					matchesKeyword = true;
					break;
				}
			}
		}

		if (includeLanguages.length > 0 && entry.type === 'codeblock') {
			matchesLanguage = entry.language ? includeLanguages.includes(entry.language) : false;
		}

		// Match if matches keywords OR languages (OR logic!)
		return matchesKeyword || matchesLanguage;
	}

	/**
	 * Discover all keywords from WHERE-matching entries and create temporary chips
	 * Called when \a flag is active
	 */
	private discoverAndCreateTemporaryChips(records: ParsedRecord[]): void {
		if (!this.filterExpression.includes('W:')) {
			return; // No WHERE clause to filter with
		}

		const parts = this.filterExpression.split(/W:/);
		const whereExpr = parts[1]?.trim() || '';

		if (!whereExpr) return;

		try {
			const whereCompiled = FilterParser.compile(whereExpr);
			const discoveredKeywords = new Set<string>();
			const discoveredLanguages = new Set<string>();

			// OPTIMIZATION: Check WHERE clause ONCE per file, then collect all keywords/languages from matching files
			for (const record of records) {
				// Create file-level context (no entry-specific data)
				const fileContext: FilterMatchContext = {
					filePath: record.filePath,
					fileName: record.fileName,
					tags: record.tags,
					keywords: [],
					code: '',
					languages: [],
					auxiliaryKeywords: [],
					keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
				};

				// Check WHERE clause ONCE for this file
				if (!FilterParser.evaluate(whereCompiled.ast, fileContext, whereCompiled.modifiers)) {
					continue; // File doesn't match WHERE, skip all entries
				}

				// File matches WHERE - collect ALL keywords and languages from ALL entries
				const contexts = this.parsedRecordToContexts(record);

				contexts.forEach(({ entry }) => {
					// Collect keywords
					if (entry.keywords && entry.keywords.length > 0) {
						entry.keywords.forEach(kw => discoveredKeywords.add(kw));
					}

					// Collect languages (from codeblocks)
					if (entry.type === 'codeblock' && entry.language) {
						discoveredLanguages.add(entry.language);
					}
				});
			}

			// Create temporary chips for discovered keywords (if not already present)
			discoveredKeywords.forEach(keyword => {
				const chipId = `keyword-include-${keyword}`;

				// Don't create if already exists (non-temporary)
				if (this.activeChips.has(chipId)) return;

				// Find keyword config
				let keywordConfig: any = null;
				for (const category of HighlightSpaceRepeatPlugin.settings.categories) {
					const found = category.keywords.find((kw: any) => kw.keyword === keyword);
					if (found) {
						keywordConfig = found;
						break;
					}
				}

				// Create temporary chip
				this.activeChips.set(chipId, {
					type: 'keyword',
					value: keyword,
					mode: 'include',
					label: keyword,
					icon: keywordConfig?.generateIcon || '🏷️',
					backgroundColor: keywordConfig?.backgroundColor,
					color: keywordConfig?.color,
					cssClass: keywordConfig?.ccssc,
					active: true,
					isTemporary: true
				});
			});

			// Create temporary chips for discovered languages (if not already present)
			discoveredLanguages.forEach(language => {
				const chipId = `language-include-${language}`;

				// Don't create if already exists (non-temporary)
				if (this.activeChips.has(chipId)) return;

				// Create temporary chip
				this.activeChips.set(chipId, {
					type: 'language',
					value: language,
					mode: 'include',
					label: language,
					icon: '💻',
					active: true,
					isTemporary: true
				});
			});

			// Re-render chips to show newly discovered ones
			this.renderChipsAndFlags();
		} catch (error) {
			console.error('[Dashboard] Error discovering keywords:', error);
		}
	}

	/**
	 * Render records mode - grouped by headers WITHOUT tabs
	 */
	private async renderRecords(records: ParsedRecord[]): Promise<void> {
		if (!this.resultsContainer) return;

		// STEP 1: Collect ALL matching entries into a flat array (filter FIRST)
		const allMatchingEntries: Array<{ entry: RecordEntry; record: ParsedRecord; header: string }> = [];

		// If \a flag is active, discover all keywords from WHERE-matching entries
		if (this.showAll && this.filterExpression) {
			this.discoverAndCreateTemporaryChips(records);
		}

		// If we have a filter expression, we need to filter entries, not just files
		if (this.filterExpression) {
			try {
				// Transform expression first (converts :boo, def, etc. to FilterParser syntax)
				const transformedExpr = this.transformFilterExpression(this.filterExpression);

				// Split on W: to separate SELECT and WHERE clauses
				const hasWhere = transformedExpr.includes('W:');
				let selectExpr = transformedExpr;
				let whereExpr = '';

				if (hasWhere) {
					const parts = transformedExpr.split(/W:/);
					selectExpr = parts[0].trim();
					whereExpr = parts[1]?.trim() || '';
				}

				// Compile expressions
				const selectCompiled = FilterParser.compile(selectExpr);
				const whereCompiled = whereExpr ? FilterParser.compile(whereExpr) : null;

				for (const record of records) {
					// Process all entries - WHERE and SELECT both filter at entry level
					const contexts = this.parsedRecordToContexts(record);

					contexts.forEach(({ entry, context }) => {
						// Check WHERE clause first (if present)
						if (whereCompiled) {
							if (!FilterParser.evaluate(whereCompiled.ast, context, whereCompiled.modifiers)) {
								return; // Entry doesn't match WHERE, skip it
							}
						}

						// If showAll is active, show all entries that passed WHERE check
						if (this.showAll) {
							// Apply chip filtering
							if (this.applyChipsFilter(entry, context)) {
								allMatchingEntries.push({ entry, record, header: this.getEntryHeader(entry, record) });
							}
							return;
						}

						// Apply SELECT clause to filter entries
						if (FilterParser.evaluate(selectCompiled.ast, context, selectCompiled.modifiers)) {
							// Apply chip filtering
							if (this.applyChipsFilter(entry, context)) {
								allMatchingEntries.push({ entry, record, header: this.getEntryHeader(entry, record) });
							}
						}
					});
				}
			} catch (error) {
				console.error('[Dashboard] Error filtering records for display:', error);
				// Fallback: show all entries from filtered records (with chip filtering)
				for (const record of records) {
					const contexts = this.parsedRecordToContexts(record);
					contexts.forEach(({ entry, context }) => {
						// Apply chip filtering even in fallback
						if (this.applyChipsFilter(entry, context)) {
							allMatchingEntries.push({ entry, record, header: this.getEntryHeader(entry, record) });
						}
					});
				}
			}
		} else {
			// No filter - show all entries from filtered records (with chip filtering)
			for (const record of records) {
				const contexts = this.parsedRecordToContexts(record);
				contexts.forEach(({ entry, context }) => {
					// Apply chip filtering even when no expression
					if (this.applyChipsFilter(entry, context)) {
						allMatchingEntries.push({ entry, record, header: this.getEntryHeader(entry, record) });
					}
				});
			}
		}

		// STEP 2: Set total items count
		this.totalItems = allMatchingEntries.length;

		if (this.totalItems === 0) {
			this.resultsContainer.createDiv({
				text: 'No records found',
				cls: 'kh-empty-message'
			});
			return;
		}

		// STEP 3: Paginate - slice to current page only
		const startIndex = (this.currentPage - 1) * this.itemsPerPage;
		const endIndex = Math.min(startIndex + this.itemsPerPage, this.totalItems);
		let pageEntries = allMatchingEntries.slice(startIndex, endIndex);

		// STEP 3.5: Apply topRecordOnly filter - remove records where match is only in sub-items
		if (this.topRecordOnly && this.filterExpression) {
			pageEntries = pageEntries.filter(({ entry }) => {
				// Keep codeblocks - they are always top-level entries
				if (entry.type === 'codeblock') {
					return true;
				}
				// For keyword entries, only keep if they have keywords (top-level match)
				// Filter out entries that only match through sub-items
				return entry.keywords && entry.keywords.length > 0;
			});
		}

		// STEP 3.6: Apply trim filter if enabled - filter sub-items to matching keywords only
		if (this.trimSubItems) {
			pageEntries = pageEntries.map(({ entry, record, header }) => {
				if (entry.subItems && entry.subItems.length > 0 && entry.keywords && entry.keywords.length > 0) {
					// Filter sub-items to only those matching entry's keywords
					const filteredSubItems = entry.subItems.filter(subItem => {
						return subItem.keywords && subItem.keywords.some(kw => entry.keywords!.includes(kw));
					});

					return {
						entry: { ...entry, subItems: filteredSubItems },
						record,
						header
					};
				}
				return { entry, record, header };
			});
		}

		// STEP 4: Group paginated entries by file, then by header for display
		const recordsByFile = new Map<string, Map<string, Array<{ entry: RecordEntry; record: ParsedRecord }>>>();

		for (const item of pageEntries) {
			if (!recordsByFile.has(item.record.filePath)) {
				recordsByFile.set(item.record.filePath, new Map());
			}
			const fileHeaders = recordsByFile.get(item.record.filePath)!;

			if (!fileHeaders.has(item.header)) {
				fileHeaders.set(item.header, []);
			}
			fileHeaders.get(item.header)!.push({ entry: item.entry, record: item.record });
		}

		// STEP 5: Render ONLY the current page items, grouped by file and header
		for (const [filePath, headerGroups] of recordsByFile) {
			const fileGroup = this.resultsContainer!.createDiv({ cls: 'kh-record-file-group' });

			// Get first record for file metadata
			const firstHeader = Array.from(headerGroups.values())[0];
			const firstRecord = firstHeader[0].record;

			const fileHeader = fileGroup.createDiv({ cls: 'kh-record-file-header' });
			fileHeader.createEl('span', {
				text: firstRecord.fileName,
				cls: 'kh-record-file-name'
			});

			// Count total entries in this file
			const totalFileEntries = Array.from(headerGroups.values())
				.reduce((sum, entries) => sum + entries.length, 0);

			fileHeader.createEl('span', {
				text: ` (${totalFileEntries})`,
				cls: 'kh-record-file-count'
			});

			// Make file header clickable to open file
			fileHeader.addEventListener('click', () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (file) {
					this.plugin.app.workspace.getLeaf().openFile(file as any);
				}
			});

			// Render each header group
			for (const [headerName, entries] of headerGroups) {
				// Skip rendering header section if header is empty/no_header
				const shouldRenderHeader = headerName && headerName !== '__no_header__';

				if (shouldRenderHeader) {
					const headerGroup = fileGroup.createDiv({ cls: 'kh-header-group' });

					const headerTitle = headerGroup.createDiv({ cls: 'kh-header-title' });
					const headerTextSpan = headerTitle.createEl('span', {
						cls: 'kh-header-text'
					});
					// Render header text with markdown support for keywords and formatting
					MarkdownRenderer.renderMarkdown(
						headerName,
						headerTextSpan,
						'',
						this.plugin
					);

					const entriesContainer = headerGroup.createDiv({ cls: 'kh-header-entries' });

					// Render entries under this header
					await Promise.all(entries.map(({ entry, record }) => {
						return this.renderSingleEntry(entriesContainer, entry, record);
					}));
				} else {
					// No header - render entries directly under file
					const entriesContainer = fileGroup.createDiv({ cls: 'kh-record-entries' });

					await Promise.all(entries.map(({ entry, record }) => {
						return this.renderSingleEntry(entriesContainer, entry, record);
					}));
				}
			}
		}

		// STEP 6: Render pagination controls
		this.renderPaginationControls();
	}

	/**
	 * Get the header text for an entry
	 */
	private getEntryHeader(entry: RecordEntry, record: ParsedRecord): string {
		// Try to find the header from the record's headers structure
		const findHeaderForEntry = (headers: RecordHeader[]): string | null => {
			for (const header of headers) {
				// Check if entry is in this header's entries
				if (header.entries && header.entries.some(e => e === entry)) {
					return header.text || '__no_header__';
				}
				// Recursively check children
				if (header.children) {
					const childResult = findHeaderForEntry(header.children);
					if (childResult) return childResult;
				}
			}
			return null;
		};

		return findHeaderForEntry(record.headers) || '__no_header__';
	}

	/**
	 * Render a single entry (helper method to avoid code duplication)
	 */
	private async renderSingleEntry(
		container: HTMLElement,
		entry: RecordEntry,
		record: ParsedRecord
	): Promise<void> {
		if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
			const primaryKeyword = entry.keywords[0];
			const entryItem = container.createDiv({
				cls: `kh-record-entry ${primaryKeyword}`
			});

			entryItem.addEventListener('click', () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					this.plugin.app.workspace.getLeaf().openFile(file as any);
				}
			});

			// KHEntry.renderKeywordEntry handles icon rendering in full mode
			return KHEntry.renderKeywordEntry(
				entryItem,
				entry,
				record,
				this.plugin,
				false // full mode for dashboard
			);
		} else if (entry.type === 'codeblock') {
			const entryItem = container.createDiv({ cls: 'kh-record-entry kh-codeblock-entry' });

			// Render code block with syntax highlighting (non-blocking)
			const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
			MarkdownRenderer.renderMarkdown(
				codeMarkdown,
				entryItem,
				record.filePath,
				this
			);

			entryItem.addEventListener('click', () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					this.plugin.app.workspace.getLeaf().openFile(file as any);
				}
			});

			return Promise.resolve();
		}
	}

	/**
	 * Render pagination controls at the bottom of results
	 */
	private renderPaginationControls(): void {
		if (!this.resultsContainer) return;

		const totalPages = Math.ceil(this.totalItems / this.itemsPerPage);

		// Don't show pagination if there's only one page
		if (totalPages <= 1) return;

		const paginationContainer = this.resultsContainer.createDiv({ cls: 'pagination-controls' });

		// Previous button
		const prevBtn = paginationContainer.createEl('button', {
			text: '← Previous',
			cls: 'pagination-btn'
		});
		prevBtn.disabled = this.currentPage === 1;
		prevBtn.addEventListener('click', () => {
			if (this.currentPage > 1) {
				this.currentPage--;
				this.triggerSearch();
			}
		});

		// Page info
		const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
		const endItem = Math.min(this.currentPage * this.itemsPerPage, this.totalItems);
		paginationContainer.createEl('span', {
			text: `${startItem}-${endItem} of ${this.totalItems} items`,
			cls: 'pagination-info'
		});

		// Next button
		const nextBtn = paginationContainer.createEl('button', {
			text: 'Next →',
			cls: 'pagination-btn'
		});
		nextBtn.disabled = this.currentPage === totalPages;
		nextBtn.addEventListener('click', () => {
			if (this.currentPage < totalPages) {
				this.currentPage++;
				this.triggerSearch();
			}
		});
	}

	/**
	 * Load parsed records
	 */
	private async loadParsedRecords(): Promise<ParsedRecord[]> {
		const parsedRecordsPath = '.obsidian/plugins/highlight-space-repeat/app-data/parsed-records.json';
		const exists = await this.plugin.app.vault.adapter.exists(parsedRecordsPath);

		if (!exists) {
			console.warn('[Dashboard] No parsed records found');
			return [];
		}

		const jsonContent = await this.plugin.app.vault.adapter.read(parsedRecordsPath);
		return JSON.parse(jsonContent);
	}

	/**
	 * Toggle filter modifier in expression
	 */
	private toggleFilterModifier(modifier: string, enable: boolean): void {
		if (enable) {
			// Add modifier if not present
			if (!this.filterExpression.includes(modifier)) {
				this.filterExpression = this.filterExpression.trim() + ' ' + modifier;
				this.filterExpression = this.filterExpression.trim();
			}
		} else {
			// Remove modifier
			this.filterExpression = this.filterExpression.replace(new RegExp('\\s*' + modifier.replace(/\\/g, '\\\\') + '\\s*', 'g'), ' ');
			this.filterExpression = this.filterExpression.trim();
		}
	}

	/**
	 * Sync button states from filter expression
	 * Detects modifiers in expression and activates corresponding buttons
	 */
	private syncButtonsFromExpression(): void {
		const wasShowingAll = this.showAll;

		this.trimSubItems = this.filterExpression.includes('\\s');
		this.topRecordOnly = this.filterExpression.includes('\\t');
		this.showAll = this.filterExpression.includes('\\a');

		// Remove temporary chips if \a was toggled off via text input
		if (wasShowingAll && !this.showAll) {
			const chipIdsToRemove: string[] = [];
			this.activeChips.forEach((chip, chipId) => {
				if (chip.isTemporary) {
					chipIdsToRemove.push(chipId);
				}
			});
			chipIdsToRemove.forEach(chipId => this.activeChips.delete(chipId));
		}

		this.renderChipsAndFlags();
	}

	/**
	 * Parse filter expression to create chips
	 * Supports keywords, categories (:name), and languages (`name)
	 * Supports negation with ! or - prefix
	 */
	private parseFilterExpression(): void {
		// Header mode (H) uses raw FilterParser syntax - don't create chips
		if (this.viewMode === 'H') {
			this.activeChips.clear();
			return;
		}

		// Clear existing chips (except temporary ones if \a is active)
		if (!this.showAll) {
			this.activeChips.clear();
		} else {
			// Keep temporary chips, remove non-temporary
			const tempChips = new Map<string, ActiveChip>();
			this.activeChips.forEach((chip, id) => {
				if (chip.isTemporary) {
					tempChips.set(id, chip);
				}
			});
			this.activeChips = tempChips;
		}

		if (!this.filterExpression.trim()) {
			return;
		}

		// Extract SELECT clause (S:) if present
		let selectClause = this.filterExpression;
		if (this.filterExpression.includes('W:')) {
			const parts = this.filterExpression.split(/W:/);
			selectClause = parts[0].replace(/^S:/, '').trim();
		} else if (this.filterExpression.startsWith('S:')) {
			selectClause = this.filterExpression.substring(2).trim();
		}

		// Remove modifiers from selectClause
		selectClause = selectClause.replace(/\\[sat]/g, '').trim();

		if (!selectClause) {
			return;
		}

		// Split by comma OR space to get individual items
		const items = selectClause.split(/[,\s]+/).map(item => item.trim()).filter(item => item);

		for (const item of items) {
			// Check for negation prefix
			const isExclude = item.startsWith('!') || item.startsWith('-');
			const cleanItem = isExclude ? item.substring(1).trim() : item;
			const mode = isExclude ? 'exclude' : 'include';

			// Category syntax: :category-id
			if (cleanItem.startsWith(':')) {
				const categoryClass = cleanItem.substring(1);
				// Find category by id to get icon
				let categoryIcon = '📁';
				for (const category of HighlightSpaceRepeatPlugin.settings.categories) {
					if (category.id === categoryClass) {
						categoryIcon = category.icon || '📁';
						break;
					}
				}

				// Create category master chip ONLY (no individual keyword chips)
				const categoryChipId = `category-${mode}-${categoryClass}`;
				this.activeChips.set(categoryChipId, {
					type: 'category',
					value: categoryClass,
					mode: mode,
					label: categoryClass,
					icon: categoryIcon,
					active: true
				});
			}
			// Language syntax: `language
			else if (cleanItem.startsWith('`')) {
				const language = cleanItem.substring(1);
				const languageChipId = `language-${mode}-${language}`;

				// Simple language chip (icon can be added if needed)
				this.activeChips.set(languageChipId, {
					type: 'language',
					value: language,
					mode: mode,
					label: language,
					icon: '💻',
					active: true
				});
			}
			// Raw FilterParser syntax: .keyword (skip chip creation)
			else if (cleanItem.startsWith('.')) {
				// User is using raw FilterParser syntax, don't create chip
				continue;
			}
			// Keyword syntax: plain text (includes multi-keyword like def.rep)
			else if (cleanItem) {
				const keyword = cleanItem;

				// Find keyword config in categories
				let keywordConfig: any = null;
				let categoryForKeyword: any = null;

				for (const category of HighlightSpaceRepeatPlugin.settings.categories) {
					const found = category.keywords.find((kw: any) => kw.keyword === keyword);
					if (found) {
						keywordConfig = found;
						categoryForKeyword = category;
						break;
					}
				}

				const keywordChipId = `keyword-${mode}-${keyword}`;
				this.activeChips.set(keywordChipId, {
					type: 'keyword',
					value: keyword,
					mode: mode,
					label: keyword,
					icon: keywordConfig?.generateIcon || '🏷️',
					backgroundColor: keywordConfig?.backgroundColor,
					color: keywordConfig?.color,
					cssClass: keywordConfig?.ccssc,
					active: true
				});
			}
		}
	}

	/**
	 * Render chips and flag toggle buttons
	 */
	private renderChipsAndFlags(): void {
		const chipsContainer = this.containerEl.querySelector('#kh-chips-container');
		if (!chipsContainer) return;

		chipsContainer.empty();

		// Flag toggle buttons group
		const flagsGroup = chipsContainer.createDiv({ cls: 'kh-filter-toggle-group' });

		// 📄 Disable Tabs toggle
		const disableTabsToggle = flagsGroup.createEl('button', {
			cls: 'kh-filter-toggle' + (this.disableTabs ? ' kh-filter-toggle-active' : ''),
			text: '📄'
		});
		disableTabsToggle.title = 'Toggle Pages: Show all entries on one page (disable H1 grouping)';
		disableTabsToggle.onclick = () => {
			this.disableTabs = !this.disableTabs;
			this.render();
		};

		// 💇 Slim toggle
		const trimToggle = flagsGroup.createEl('button', {
			cls: 'kh-filter-toggle' + (this.trimSubItems ? ' kh-filter-toggle-active' : ''),
			text: '💇'
		});
		trimToggle.title = 'Toggle Slim Records: Filter sub-items to only show matching keywords (\\s)';
		trimToggle.onclick = () => {
			this.trimSubItems = !this.trimSubItems;
			this.toggleFilterModifier('\\s', this.trimSubItems);
			this.render();
		};

		// 👑 Top Only toggle
		const topToggle = flagsGroup.createEl('button', {
			cls: 'kh-filter-toggle' + (this.topRecordOnly ? ' kh-filter-toggle-active' : ''),
			text: '👑'
		});
		topToggle.title = 'Toggle Show Top Only: Only show records where keyword is top-level (\\t)';
		topToggle.onclick = () => {
			this.topRecordOnly = !this.topRecordOnly;
			this.toggleFilterModifier('\\t', this.topRecordOnly);
			this.render();
		};

		// 🅰️ Show All toggle
		const showAllToggle = flagsGroup.createEl('button', {
			cls: 'kh-filter-toggle' + (this.showAll ? ' kh-filter-toggle-active' : ''),
			text: '🅰️'
		});
		showAllToggle.title = 'Toggle Show All: Ignore SELECT clause, show all records matching WHERE (\\a)';
		showAllToggle.onclick = () => {
			this.showAll = !this.showAll;
			this.toggleFilterModifier('\\a', this.showAll);

			// Remove temporary chips when toggling off \a
			if (!this.showAll) {
				// Remove all temporary chips
				const chipIdsToRemove: string[] = [];
				this.activeChips.forEach((chip, chipId) => {
					if (chip.isTemporary) {
						chipIdsToRemove.push(chipId);
					}
				});
				chipIdsToRemove.forEach(chipId => this.activeChips.delete(chipId));
			}

			this.render();
		};

		// Favorite filters (from current subject)
		if (this.currentSubject && this.currentSubject.favoriteFilters && this.currentSubject.favoriteFilters.length > 0) {
			this.currentSubject.favoriteFilters.forEach(filter => {
				const filterBtn = flagsGroup.createEl('button', {
					cls: 'kh-filter-toggle kh-favorite-filter',
					text: filter.icon
				});
				filterBtn.title = filter.expression;
				filterBtn.onclick = () => {
					// Apply the favorite filter
					this.viewMode = 'R'; // Switch to Records mode
					this.filterExpression = filter.expression;
					this.parseFilterExpression(); // Parse to create chips
					this.renderChipsAndFlags(); // Re-render to show chips
					this.triggerSearch(); // Execute search
				};
			});
		}

		// Plus button to add new favorite filter
		const plusBtn = flagsGroup.createEl('button', {
			cls: 'kh-filter-toggle kh-add-favorite',
			text: '➕'
		});
		plusBtn.title = 'Add favorite filter';
		plusBtn.onclick = () => {
			this.openFavoriteFilterModal();
		};

		if (this.activeChips.size === 0) {
			return; // Keep toggles visible even with no chips
		}

		// Render active chips
		const sortedChips = Array.from(this.activeChips.entries()).sort(([idA, chipA], [idB, chipB]) => {
			// Category chips first
			if (chipA.type === 'category' && chipB.type !== 'category') return -1;
			if (chipA.type !== 'category' && chipB.type === 'category') return 1;
			return 0;
		});

		sortedChips.forEach(([chipId, chip]) => {
			const classList = [
				'grid-keyword-chip',
				chip.active ? 'active' : 'inactive',
				chip.mode === 'exclude' ? 'excluded' : '',
				chip.type === 'category' ? 'kh-category-master' : '',
				chip.cssClass || ''
			].filter(c => c).join(' ');

			const chipEl = chipsContainer.createEl('button', { cls: classList });

			if (chip.backgroundColor) {
				chipEl.style.backgroundColor = chip.backgroundColor;
			}
			if (chip.color) {
				chipEl.style.color = chip.color;
			}

			if (chip.icon) {
				chipEl.createEl('span', {
					cls: 'keyword-chip-icon',
					text: chip.icon
				});
			}

			// Badge (for category keywords)
			if (chip.badge) {
				chipEl.createEl('span', {
					cls: 'keyword-chip-badge',
					text: chip.badge
				});
			}

			chipEl.createEl('span', {
				cls: 'keyword-chip-label',
				text: chip.label
			});

			// Chip click handler with Alt+click support
			chipEl.onclick = (event: MouseEvent) => {
				if (event.altKey) {
					// Alt+click: Solo mode - activate only this chip
					this.activeChips.forEach((c) => {
						c.active = false;
					});
					chip.active = true;
					if (chip.mode === 'exclude') {
						chip.mode = 'include';
					}
				} else {
					// Normal click: toggle
					if (chip.mode === 'exclude') {
						// Switch from exclude to include mode
						chip.mode = 'include';
						chip.active = true;
					} else {
						// Toggle active state
						chip.active = !chip.active;
					}
				}

				this.renderChipsAndFlags();
				this.triggerSearch();
			};

			chipEl.title = `${chip.label} (${chip.mode})\nAlt+Click to solo`;
		});
	}

	/**
	 * Open modal to create/edit favorite filters
	 */
	private openFavoriteFilterModal(): void {
		if (!this.currentSubject) return;

		// Create favorite filter modal
		class FavoriteFilterModal extends Modal {
			private subject: Subject;
			private plugin: HighlightSpaceRepeatPlugin;
			private widget: DashboardView;
			private icon: string = '⭐';
			private expression: string = '';

			constructor(app: App, subject: Subject, plugin: HighlightSpaceRepeatPlugin, widget: DashboardView) {
				super(app);
				this.subject = subject;
				this.plugin = plugin;
				this.widget = widget;
			}

			onOpen() {
				const { contentEl } = this;
				contentEl.empty();

				contentEl.createEl('h2', { text: 'Add Favorite Filter' });

				// Icon input
				new Setting(contentEl)
					.setName('Icon')
					.setDesc('Emoji icon for the button')
					.addText((text: any) => text
						.setValue(this.icon)
						.onChange((value: string) => this.icon = value));

				// Expression input
				new Setting(contentEl)
					.setName('Filter Expression')
					.setDesc('Filter expression (e.g., ":boo `java W: #foo \\t")')
					.addTextArea((text: any) => {
						text.setValue(this.expression)
							.onChange((value: string) => this.expression = value);
						text.inputEl.rows = 3;
					});

				// Buttons
				new Setting(contentEl)
					.addButton((btn: any) => btn
						.setButtonText('Cancel')
						.onClick(() => this.close()))
					.addButton((btn: any) => btn
						.setButtonText('Save')
						.setCta()
						.onClick(async () => {
							if (!this.expression) {
								return;
							}

							// Add to subject's favorite filters
							if (!this.subject.favoriteFilters) {
								this.subject.favoriteFilters = [];
							}

							this.subject.favoriteFilters.push({
								id: Date.now().toString(),
								icon: this.icon,
								expression: this.expression
							});

							// Save to store
							const { subjectsStore } = await import('../stores/settings-store');
							subjectsStore.update((data: any) => {
								const index = data.subjects.findIndex((s: Subject) => s.id === this.subject.id);
								if (index >= 0) {
									data.subjects[index] = this.subject;
								}
								return data;
							});

							this.close();
							this.widget.render();
						}));
			}

			onClose() {
				const { contentEl } = this;
				contentEl.empty();
			}
		}

		new FavoriteFilterModal(this.plugin.app, this.currentSubject, this.plugin, this).open();
	}
}
