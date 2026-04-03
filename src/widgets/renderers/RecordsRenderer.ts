import type { App } from 'obsidian';
import { TFile, setIcon, MarkdownRenderer, MarkdownView } from 'obsidian';
import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { ActiveChip } from '../../interfaces/ActiveChip';
import type { KeywordStyle } from '../../shared/keyword-style';
import { HighlightSpaceRepeatPlugin } from '../../highlight-space-repeat-plugin';
import { FilterParser } from '../../services/FilterParser';
import { FilterExpressionService } from '../../services/FilterExpressionService';
import { KHEntry } from '../../components/KHEntry';
import { getFileNameFromPath } from '../../utils/file-helpers';
import { getAllKeywords } from '../../utils/parse-helpers';
import { RecordsControlRenderer } from './RecordsControlRenderer';

/**
 * RecordsRenderer - Handles rendering of widget filter (records section)
 * Renders file/header/record filter results based on filter type
 */
export class RecordsRenderer {
	private app: App;
	private plugin: HighlightSpaceRepeatPlugin;
	private parsedRecords: ParsedFile[];

	// Filter state
	private filterType: 'F' | 'H' | 'R' | 'D' | null;
	private filterExpression: string;
	private filterText: string;

	// UI flags
	private activeChips: Map<string, ActiveChip>;
	private trimSubItems: boolean;
	private topRecordOnly: boolean;

	// UI state
	private collapsedFiles: Set<string>;
	private expandedHeaders: Set<string>;

	// Currently displayed records (updated after each render)
	private currentlyDisplayedRecords: Array<{ entry: FlatEntry; file: ParsedFile }> = [];
	private fileSearchText: string = '';

	// Callbacks
	private onFilterTextChange: (text: string) => void;
	private onExpressionSearch: (expression: string) => void;
	private onExpressionInput: (expression: string) => void;
	private onFilterTypeChange: (type: 'F' | 'H' | 'R' | 'D') => void;
	private onTrimToggle: () => void;
	private onTopToggle: () => void;
	private onToggleAllFiles: () => void;
	private onLegendToggle: () => void;
	private onChipClick: (chipId: string) => void;
	private onSRSReview: () => Promise<void>;

	constructor(
		app: App,
		plugin: HighlightSpaceRepeatPlugin,
		parsedRecords: ParsedFile[],
		filterState: {
			filterType: 'F' | 'H' | 'R' | 'D' | null;
			filterExpression: string;
			filterText: string;
			fileSearchText: string;
		},
		uiFlags: {
			activeChips: Map<string, ActiveChip>;
			trimSubItems: boolean;
			topRecordOnly: boolean;
		},
		uiState: {
			collapsedFiles: Set<string>;
			expandedHeaders: Set<string>;
		},
		callbacks: {
			onFilterTextChange: (text: string) => void;
			onExpressionSearch: (expression: string) => void;
			onExpressionInput: (expression: string) => void;
			onFilterTypeChange: (type: 'F' | 'H' | 'R' | 'D') => void;
			onTrimToggle: () => void;
			onTopToggle: () => void;
			onToggleAllFiles: () => void;
			onLegendToggle: () => void;
			onChipClick: (chipId: string) => void;
			onSRSReview: () => Promise<void>;
		}
	) {
		this.app = app;
		this.plugin = plugin;
		this.parsedRecords = parsedRecords;

		this.filterType = filterState.filterType;
		this.filterExpression = filterState.filterExpression;
		this.filterText = filterState.filterText;
		this.fileSearchText = filterState.fileSearchText;

		this.activeChips = uiFlags.activeChips;
		this.trimSubItems = uiFlags.trimSubItems;
		this.topRecordOnly = uiFlags.topRecordOnly;

		this.collapsedFiles = uiState.collapsedFiles;
		this.expandedHeaders = uiState.expandedHeaders;

		this.onFilterTextChange = callbacks.onFilterTextChange;
		this.onExpressionSearch = callbacks.onExpressionSearch;
		this.onExpressionInput = callbacks.onExpressionInput;
		this.onFilterTypeChange = callbacks.onFilterTypeChange;
		this.onTrimToggle = callbacks.onTrimToggle;
		this.onTopToggle = callbacks.onTopToggle;
		this.onToggleAllFiles = callbacks.onToggleAllFiles;
		this.onLegendToggle = callbacks.onLegendToggle;
		this.onChipClick = callbacks.onChipClick;
		this.onSRSReview = callbacks.onSRSReview;
	}

	/**
	 * Render the widget filter (records section)
	 */
	async render(container: HTMLElement): Promise<void> {
		if (!this.filterType) {
			return; // Don't show filter if not active
		}

		const filterSection = container.createDiv({ cls: 'kh-widget-filter' });

		// Render controls (expression filter, flags, text search)
		const controlRenderer = new RecordsControlRenderer(
			{
				filterExpression: this.filterExpression,
				filterText: this.filterText,
				filterType: this.filterType
			},
			{
				trimSubItems: this.trimSubItems,
				topRecordOnly: this.topRecordOnly
			},
			{
				onExpressionSearch: this.onExpressionSearch,
				onExpressionInput: this.onExpressionInput,
				onFilterTextChange: this.onFilterTextChange,
				onFilterTypeChange: this.onFilterTypeChange,
				onTrimToggle: this.onTrimToggle,
				onTopToggle: this.onTopToggle,
				onToggleAllFiles: this.onToggleAllFiles,
				onSRSReview: this.onSRSReview,
				onFileSearchChange: (searchText: string) => this.applyFileSearchFilter(searchText)
			}
		);
		controlRenderer.render(filterSection);

		// Render chips right after controls
		this.renderChips(filterSection);

		// Render results with text filter applied
		await this.renderFilterResults(filterSection);
	}

	/**
	 * Render chips section (dashboard filter chips)
	 */
	private renderChips(container: HTMLElement): void {
		if (this.activeChips.size === 0) {
			return;
		}

		const chipsContainer = container.createDiv({
			cls: 'kh-dashboard-chips-container',
			attr: {
				style: 'display: flex; gap: 6px; flex-wrap: wrap;'
			}
		});

		// Render active chips sorted by type
		const sortedChips = Array.from(this.activeChips.entries()).sort(([idA, chipA], [idB, chipB]) => {
			// Category chips first
			if (chipA.type === 'category' && chipB.type !== 'category') return -1;
			if (chipA.type !== 'category' && chipB.type === 'category') return 1;
			return 0;
		});

		sortedChips.forEach(([chipId, chip]) => {
			// Build class list to match SubjectDashboard
			const isActivated = chip.mode === 'include';
			const classList = [
				'kh-dashboard-chip',
				'grid-keyword-chip',
				isActivated ? 'kh-chip-active' : '',
				chip.type === 'category' ? 'kh-category-master' : ''
			].filter(c => c).join(' ');

			const chipEl = chipsContainer.createEl('button', { cls: classList });

			// Title for tooltip
			if (chip.type === 'category') {
				chipEl.title = `Category: ${chip.label} (${chip.mode === 'include' ? 'activated' : 'deactivated'})`;
			} else {
				chipEl.title = `Keyword: ${chip.label} (${chip.mode === 'include' ? 'activated' : 'deactivated'})`;
			}

			// Inline styles to match SubjectDashboard
			chipEl.style.padding = '4px 10px';
			chipEl.style.borderRadius = '12px';
			chipEl.style.border = '2px solid transparent';
			chipEl.style.cursor = 'pointer';
			chipEl.style.opacity = isActivated ? '1' : '0.3';
			chipEl.style.filter = isActivated ? 'none' : 'grayscale(100%)';

			if (chip.backgroundColor) {
				chipEl.style.backgroundColor = chip.backgroundColor;
			}
			if (chip.color) {
				chipEl.style.color = chip.color;
			}

			// Render icon as <mark class="kh-icon {keyword}">&nbsp;</mark>
			if (chip.type === 'keyword') {
				const iconMark = chipEl.createEl('mark', {
					cls: `kh-icon ${chip.label}`,
					text: '\u00A0' // &nbsp;
				});
			} else if (chip.type === 'category') {
				// For category, show icon with "..." indicator
				const iconSpan = chipEl.createEl('span');
				iconSpan.textContent = chip.icon || '📁';
				const indicatorSpan = chipEl.createEl('span');
				indicatorSpan.textContent = '...';
				indicatorSpan.style.fontSize = '0.8em';
				indicatorSpan.style.opacity = '0.6';
				indicatorSpan.style.marginLeft = '2px';
			} else if (chip.type === 'language') {
				// For language/codeblock, show backtick + language name
				chipEl.createEl('span', {
					text: `\`${chip.label}`
				});
			}

			// Chip click handler
			chipEl.onclick = () => {
				this.onChipClick(chipId);
			};
		});
	}

	/**
	 * Render filter results based on current filter type
	 */
	private async renderFilterResults(filterSection: HTMLElement): Promise<void> {
		// Remove existing results
		const existingResults = filterSection.querySelector('.kh-widget-filter-results');
		if (existingResults) {
			existingResults.remove();
		}

		const resultsContainer = filterSection.createDiv({ cls: 'kh-widget-filter-results' });

		// Render based on filter type
		if (this.filterType === 'F') {
			await this.renderFileFilterResults(resultsContainer);
		} else if (this.filterType === 'H') {
			await this.renderHeaderFilterResults(resultsContainer);
			} else if (this.filterType === 'R') {
				await this.renderRecordFilterResults(resultsContainer);
			} else if (this.filterType === 'D') {
				await this.renderDashFilterResults(resultsContainer);
			} else if (this.filterExpression) {
				// Expression-based filtering
				await this.renderExpressionRecords(resultsContainer);
			}
		}

	/**
	 * Get currently displayed records (with file search filter applied)
	 */
	public getCurrentlyDisplayedRecords(): Array<{ entry: FlatEntry; file: ParsedFile }> {
		console.log('[RecordsRenderer] getCurrentlyDisplayedRecords called');
		console.log('[RecordsRenderer] Base records:', this.currentlyDisplayedRecords.length);
		console.log('[RecordsRenderer] File search text:', this.fileSearchText);

		// If no file search, return all
		if (!this.fileSearchText || this.fileSearchText.trim() === '') {
			console.log('[RecordsRenderer] No file search, returning all records');
			return this.currentlyDisplayedRecords;
		}

		// Apply file search filter
		const query = this.fileSearchText.trim().toLowerCase();
		const filtered = this.currentlyDisplayedRecords.filter(({ entry, file }) => {
			return this.entryMatchesTextFilter(entry, file, query);
		});

		console.log('[RecordsRenderer] After file search filter:', filtered.length);
		return filtered;
	}

	/**
	 * Update file search text (called when file search input changes)
	 */
	public applyFileSearchFilter(searchText: string): void {
		console.log('[RecordsRenderer] applyFileSearchFilter called with:', searchText);
		this.fileSearchText = searchText;
	}

	/**
	 * Check if file matches text filter
	 */
	private fileMatchesTextFilter(file: ParsedFile, filterText: string): boolean {
		if (!filterText) return true;

		const query = filterText.toLowerCase();

		// Check file name
		const fileName = getFileNameFromPath(file.filePath).replace('.md', '').toLowerCase();
		if (fileName.includes(query)) return true;

		// Check aliases
		if (file.aliases && file.aliases.length > 0) {
			for (const alias of file.aliases) {
				if (alias.toLowerCase().includes(query)) return true;
			}
		}

		// Check entry text content
		for (const entry of file.entries) {
			if (entry.text && entry.text.toLowerCase().includes(query)) return true;

			// Check keywords
			const keywords = getAllKeywords(entry);
			if (keywords.some(kw => kw.toLowerCase().includes(query))) return true;

			// Check subitem keywords
			if (entry.subItems) {
				for (const subItem of entry.subItems) {
					const subKeywords = subItem.keywords || [];
					if (subKeywords.some(kw => kw.toLowerCase().includes(query))) return true;
					if (subItem.content && subItem.content.toLowerCase().includes(query)) return true;
				}
			}
		}

		return false;
	}

	/**
	 * Check if entry matches text filter (must match EXACTLY how DOM filter works)
	 */
	private entryMatchesTextFilter(entry: FlatEntry, file: ParsedFile, filterText: string): boolean {
		if (!filterText) return true;

		const query = filterText.toLowerCase();

		// Build searchable string EXACTLY like the DOM does
		const fileName = getFileNameFromPath(file.filePath).replace(/\.md$/, '');
		const fileAliases = file.aliases?.join(' ') || '';
		const fileTags = file.tags?.join(' ') || '';
		const entryKeywords = entry.keywords?.join(' ') || '';
		const h1Tags = entry.h1?.tags?.join(' ') || '';
		const h2Tags = entry.h2?.tags?.join(' ') || '';
		const h3Tags = entry.h3?.tags?.join(' ') || '';
		const entryText = entry.text || '';

		// Join all parts with space and lowercase (same as DOM)
		const searchable = [fileName, fileAliases, fileTags, entryKeywords, h1Tags, h2Tags, h3Tags, entryText].join(' ').toLowerCase();

		// Check if searchable string contains query (same as DOM)
		const matches = searchable.includes(query);

		console.log('[RecordsRenderer] Entry match check:', {
			query,
			fileName,
			entryText: entryText.substring(0, 50),
			matches
		});

		return matches;
	}

	/**
	 * Render file filter results with entries (like H mode shows headers with entries)
	 */
	private async renderFileFilterResults(container: HTMLElement): Promise<void> {
		// Get matching records and extract unique files
		const compiledFilter = FilterParser.compile(this.filterExpression);
		const matchingRecords = FilterExpressionService.getMatchingRecords(this.parsedRecords, this.filterExpression);
		const filePathSet = new Set(matchingRecords.map(({ file }) => file.filePath));
		let matchingFiles = this.parsedRecords.filter(file => filePathSet.has(file.filePath));

		// Apply text filter
		if (this.filterText) {
			matchingFiles = matchingFiles.filter(file => this.fileMatchesTextFilter(file, this.filterText));
		}

		if (matchingFiles.length === 0) {
			container.createEl('div', {
				text: 'No files found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		// Collect all entries from matching files (respecting chips)
		const allEntries: Array<{ entry: FlatEntry; file: ParsedFile }> = [];
		for (const file of matchingFiles) {
			for (const entry of file.entries) {
				allEntries.push({ entry, file });
			}
		}

		// Store currently displayed records
		this.currentlyDisplayedRecords = allEntries;

		// Render files with their entries
		await this.renderRecordsByFile(container, allEntries);
	}

	/**
	 * Render header filter results with expandable entries
	 */
	private async renderHeaderFilterResults(container: HTMLElement): Promise<void> {
		// Get matching records and group by header
		const matchingRecords = FilterExpressionService.getMatchingRecords(this.parsedRecords, this.filterExpression);

		// Group records by their parent header
		let headerGroups = new Map<string, { file: ParsedFile; headerText: string; headerLevel: number; entries: FlatEntry[] }>();

		for (const { entry, file } of matchingRecords) {
			const h1Text = entry.h1?.text || '';
			const h2Text = entry.h2?.text || '';
			const h3Text = entry.h3?.text || '';
			const headerKey = `${file.filePath}::${h1Text}::${h2Text}::${h3Text}`;
			const headerText = h3Text || h2Text || h1Text || '';
			const headerLevel = entry.h3 ? 3 : entry.h2 ? 2 : entry.h1 ? 1 : 0;

			if (!headerGroups.has(headerKey)) {
				headerGroups.set(headerKey, { file, headerText, headerLevel, entries: [] });
			}
			headerGroups.get(headerKey)!.entries.push(entry);
		}

		// Apply text filter to header groups
		if (this.filterText) {
			const filteredGroups = new Map<string, { file: ParsedFile; headerText: string; headerLevel: number; entries: FlatEntry[] }>();
			for (const [key, group] of headerGroups.entries()) {
				// Filter entries that match the text filter
				const filteredEntries = group.entries.filter(entry =>
					this.entryMatchesTextFilter(entry, group.file, this.filterText)
				);
				if (filteredEntries.length > 0) {
					filteredGroups.set(key, { ...group, entries: filteredEntries });
				}
			}
			headerGroups.clear();
			filteredGroups.forEach((value, key) => headerGroups.set(key, value));
		}

		// Store currently displayed records
		const allEntries: Array<{ entry: FlatEntry; file: ParsedFile }> = [];
		for (const { file, entries } of headerGroups.values()) {
			for (const entry of entries) {
				allEntries.push({ entry, file });
			}
		}
		this.currentlyDisplayedRecords = allEntries;

		if (headerGroups.size === 0) {
			container.createEl('div', {
				text: 'No headers found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		for (const { file, headerText, headerLevel, entries } of headerGroups.values()) {
			// Get header info from first entry
			const firstEntry = entries[0];
			const headerInfo = headerLevel === 1 ? firstEntry.h1 : headerLevel === 2 ? firstEntry.h2 : firstEntry.h3;
			if (!headerInfo) continue;

			// Create unique ID for this header
			const headerId = `${file.filePath}:${headerLevel}:${headerText}`;
			const isExpanded = this.expandedHeaders.has(headerId);

			// Header group container with searchable data attributes
			const headerGroup = container.createDiv({ cls: 'kh-widget-filter-file-group' });

			// Add searchable metadata as data attributes
			const fileName = getFileNameFromPath(file.filePath).replace(/\.md$/, '');
			const fileAliases = file.aliases?.join(' ') || '';
			const fileTags = file.tags?.join(' ') || '';
			const headerTags = headerInfo.tags?.join(' ') || '';
			const allSearchable = [fileName, fileAliases, fileTags, headerTags, headerText].join(' ').toLowerCase();
			headerGroup.setAttribute('data-searchable', allSearchable);

			// Header with toggle
			const headerItem = headerGroup.createDiv({ cls: 'kh-widget-filter-file-header' });

			// Toggle icon
			const toggleIcon = headerItem.createEl('span', {
				text: isExpanded ? '▼' : '▶',
				cls: 'kh-header-toggle'
			});
			toggleIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.expandedHeaders.has(headerId)) {
					this.expandedHeaders.delete(headerId);
				} else {
					this.expandedHeaders.add(headerId);
				}
				// Re-render to show/hide entries
				this.renderFilterResults(container.parentElement as HTMLElement);
			});

			// Truncate filename if longer than 10 chars
			const truncateFileName = (name: string, maxLength: number = 10): string => {
				if (name.length <= maxLength) return name;
				return name.substring(0, maxLength) + '...';
			};

			// Header content (clickable to open file)
			const headerContent = headerItem.createEl('span', {
				cls: 'kh-widget-filter-file-name'
			});
			headerContent.style.cursor = 'pointer';
			headerContent.style.display = 'inline-flex';
			headerContent.style.alignItems = 'center';
			headerContent.style.gap = '4px';

			// Filename (truncated, without .md extension) - reuse fileName from line 457
			headerContent.createEl('span', {
				text: truncateFileName(fileName),
				cls: 'kh-header-filename'
			}).style.fontWeight = 'bold';

			// Separator and icons (only display keywords, NOT inline keywords)
			const headerKeywords = headerInfo.keywords || [];
			if (headerKeywords.length > 0) {
				headerContent.createEl('span', { text: '::' }).style.opacity = '0.5';

				// Render keyword icons
				headerKeywords.forEach((kw, idx) => {
					const mark = headerContent.createEl('mark', { cls: `kh-icon ${kw}` });
					mark.innerHTML = '&nbsp;';
					if (idx < headerKeywords.length - 1) {
						headerContent.createEl('span', { text: ' ' });
					}
				});

				headerContent.createEl('span', { text: '::' }).style.opacity = '0.5';
			}

			// Header text (render markdown)
			const headerTextSpan = headerContent.createEl('span', { cls: 'kh-header-text' });
			if (headerInfo.text) {
				MarkdownRenderer.render(
					this.app,
					headerInfo.text,
					headerTextSpan,
					file.filePath,
					this.plugin
				);
			}

			// Tags
			if (headerInfo.tags && headerInfo.tags.length > 0) {
				headerInfo.tags.forEach(tag => {
					const tagEl = headerContent.createEl('span', {
						text: tag.startsWith('#') ? tag : '#' + tag,
						cls: 'kh-header-tag'
					});
					tagEl.style.color = 'var(--text-accent)';
					tagEl.style.marginLeft = '4px';
					tagEl.style.fontSize = '0.9em';
				});
			}

			headerContent.addEventListener('click', async (e: MouseEvent) => {
				// Only open file on Command/Ctrl + click
				if (e.metaKey || e.ctrlKey) {
					const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
					if (obsidianFile instanceof TFile) {
						// Open the file
						const leaf = this.app.workspace.getLeaf(false);
						await leaf.openFile(obsidianFile);

						// Search for the header line in the file
						const view = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (view && view.editor) {
							const content = view.editor.getValue();
							const lines = content.split('\n');

							// Build header pattern based on level (e.g., "## Run on" for h2)
							const headerPrefix = '#'.repeat(headerLevel);
							const headerPattern = `${headerPrefix} ${headerText}`;

							// Find the line containing this exact header
							let headerLine = -1;
							for (let i = 0; i < lines.length; i++) {
								const line = lines[i].trim();
								// Match "## headerText" or "## headerText #tag" etc
								if (line.startsWith(headerPattern)) {
									headerLine = i;
									break;
								}
							}

							// Navigate to the header line
							if (headerLine >= 0) {
								view.editor.setCursor({ line: headerLine, ch: 0 });
								const scrollToLine = Math.max(0, headerLine - 3);
								view.editor.scrollIntoView({
									from: { line: scrollToLine, ch: 0 },
									to: { line: scrollToLine, ch: 0 }
								}, true);
							}
						}
					}
				}
			});

			// Show entries if expanded
			if (isExpanded && entries && entries.length > 0) {
				const entriesContainer = headerGroup.createDiv({ cls: 'kh-widget-filter-entries' });

				for (const entry of entries) {
					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						// Resolve which keyword provides the icon based on iconPriority
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

						// Add searchable metadata as data attributes (reuse fileName, fileAliases, fileTags from outer scope)
						const entryKeywords = entry.keywords?.join(' ') || '';
						const h1Tags = entry.h1?.tags?.join(' ') || '';
						const h2Tags = entry.h2?.tags?.join(' ') || '';
						const h3Tags = entry.h3?.tags?.join(' ') || '';
						const entrySearchable = [fileName, fileAliases, fileTags, entryKeywords, h1Tags, h2Tags, h3Tags, entry.text].join(' ').toLowerCase();
						entryItem.setAttribute('data-searchable', entrySearchable);

						// Render icons from all keywords with Icon/StyleAndIcon priority
						for (const iconKeyword of iconKeywords) {
							const mark = entryItem.createEl('mark', { cls: `kh-icon ${iconKeyword}` });
							mark.innerHTML = '&nbsp;';
						}
						entryItem.createEl('span', { text: ' ', cls: 'kh-separator' });

						// Render entry text with image/quote support (compact mode)
						await KHEntry.renderKeywordEntry(
							entryItem,
							entry,
					file,
							this.plugin,
							true // compact mode for matrix
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});
					} else if (entry.type === 'codeblock') {
						const entryItem = entriesContainer.createDiv({ cls: 'kh-widget-filter-entry kh-widget-filter-codeblock' });

						// Add searchable metadata as data attributes (reuse fileName, fileAliases, fileTags from outer scope)
						const codeLanguage = entry.language || '';
						const codeH1Tags = entry.h1?.tags?.join(' ') || '';
						const codeH2Tags = entry.h2?.tags?.join(' ') || '';
						const codeH3Tags = entry.h3?.tags?.join(' ') || '';
						const codeSearchable = [fileName, fileAliases, fileTags, codeLanguage, codeH1Tags, codeH2Tags, codeH3Tags, entry.text].join(' ').toLowerCase();
						entryItem.setAttribute('data-searchable', codeSearchable);

						// Render code block with syntax highlighting (non-blocking)
						const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							entryItem,
							file.filePath,
							this.plugin
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});
					}
				}
			}
		}
	}

	/**
	 * Render record filter results from cell
	 */
	private async renderRecordFilterResults(container: HTMLElement): Promise<void> {
		// Get matching records
		let matchingRecords = FilterExpressionService.getMatchingRecords(this.parsedRecords, this.filterExpression);

		// Apply text filter
		if (this.filterText) {
			matchingRecords = matchingRecords.filter(({ entry, file }) =>
				this.entryMatchesTextFilter(entry, file, this.filterText)
			);
		}

		// Store currently displayed records
		this.currentlyDisplayedRecords = matchingRecords;

		if (matchingRecords.length === 0) {
			container.createEl('div', {
				text: 'No records found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		// Use shared rendering logic
		await this.renderRecordsByFile(container, matchingRecords);
	}

	/**
	 * Render dashboard filter results (D) for primary topics
	 * Uses dashOnlyFilterExpSide expression
	 */
	private async renderDashFilterResults(container: HTMLElement): Promise<void> {
		// Get dashboard records
		let matchingRecords = FilterExpressionService.getMatchingRecords(this.parsedRecords, this.filterExpression);

		// Apply text filter
		if (this.filterText) {
			matchingRecords = matchingRecords.filter(({ entry, file }) =>
				this.entryMatchesTextFilter(entry, file, this.filterText)
			);
		}

		// Store currently displayed records
		this.currentlyDisplayedRecords = matchingRecords;

		if (matchingRecords.length === 0) {
			container.createEl('div', {
				text: 'No dashboard records found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		// Use shared rendering logic
		await this.renderRecordsByFile(container, matchingRecords);
	}

	/**
	 * Render record filter results
	 * Supports W: syntax for WHERE clause (file filtering)
	 */

	private async renderExpressionRecords(container: HTMLElement): Promise<void> {
		try {
			// Use FilterExpressionService.getMatchingRecords() - SINGLE SOURCE OF TRUTH
			const matchingFiles = FilterExpressionService.getMatchingRecords(
				this.parsedRecords,
				this.filterExpression
			);

			if (matchingFiles.length === 0) {
				container.createEl('div', {
					text: 'No records found',
					cls: 'kh-widget-filter-empty'
				});
				return;
			}

			// No limit on results - show all matching entries
			let limitedFiles = matchingFiles;

			// Compile SELECT expression for UI-level filtering (topRecordOnly, trimSubItems)
			// We need this because those features filter AFTER getting the base matching records
			let selectCompiled: import('../../interfaces/FilterInterfaces').CompiledFilter | undefined;
			if ((this.topRecordOnly || this.trimSubItems) && this.filterExpression) {
				try {
					// Transform and extract SELECT clause
					const hasExplicitOperators = /\b(AND|OR)\b/.test(this.filterExpression);
					const expr = hasExplicitOperators
						? this.filterExpression
						: FilterExpressionService.transformFilterExpression(this.filterExpression);

					// Skip compilation if expression is empty after transformation
					if (!expr || !expr.trim()) {
						selectCompiled = undefined;
					} else {
						const hasWhere = /\s+[Ww]:\s+/.test(expr);
						const selectExpr = hasWhere ? expr.split(/\s+[Ww]:\s+/)[0].trim() : expr;
						selectCompiled = FilterParser.compile(selectExpr);
					}
				} catch (error) {
					console.error('[renderExpressionRecords] Failed to compile SELECT for UI filtering:', error);
				}
			}

			// Apply topRecordOnly filter if enabled - remove records where match is only in sub-items
			if (this.topRecordOnly && this.filterExpression && selectCompiled) {
				const beforeTopFilter = limitedFiles.length;
				limitedFiles = limitedFiles.filter(({ entry, file }) => {
					// Keep codeblocks - they are always top-level entries
					if (entry.type === 'codeblock') {
						return true;
					}
					// For keyword entries, check if SELECT matches using ONLY top-level keywords
					// Top-level = entry.keywords + entry.inlineKeywords (from main text)
					// Exclude = sub-items (which have their own keywords and inlineKeywords)
					const topLevelEntry: FlatEntry = {
						...entry,
						subItems: [] // Clear sub-items so their keywords/inlineKeywords are not checked
					};
					// Re-evaluate SELECT clause with top-level data only (no sub-items)
					return FilterParser.evaluateFlatEntry(selectCompiled.ast, topLevelEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);
				});
			}

			// Apply trim filter if enabled - filter sub-items to only those matching SELECT clause
			if (this.trimSubItems && selectCompiled) {
				const beforeTrimFilter = limitedFiles.length;
				limitedFiles = limitedFiles.map(({ entry, file }) => {
					if (entry.subItems && entry.subItems.length > 0) {
						// Filter sub-items to only those matching the SELECT clause
						const filteredSubItems = entry.subItems.filter(subItem => {
							// Create a FlatEntry for this subitem with its own keywords and inline keywords
							const subItemEntry: FlatEntry = {
								...entry,
								keywords: subItem.keywords || [],
								inlineKeywords: subItem.inlineKeywords || [],
								inlineCodeLanguages: subItem.inlineCodeLanguages || [],
								text: subItem.content || '',
								subItems: [] // Sub-items don't have their own sub-items
							};
							// Check if this subitem matches the SELECT clause
							const matches = FilterParser.evaluateFlatEntry(selectCompiled.ast, subItemEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);
							return matches;
						});

						return {
							entry: { ...entry, subItems: filteredSubItems },
							file
						};
					}
					return { entry, file };
				});
			}

			// Apply text filter
			if (this.filterText) {
				const beforeTextFilter = limitedFiles.length;
				limitedFiles = limitedFiles.filter(({ entry, file }) =>
					this.entryMatchesTextFilter(entry, file, this.filterText)
				);
			}

			// Store currently displayed records
			this.currentlyDisplayedRecords = limitedFiles;

			// Use shared rendering logic
			await this.renderRecordsByFile(container, limitedFiles);
		} catch (error) {
			console.error('[renderExpressionRecords] ERROR:', error);
			container.createEl('div', {
				text: `Invalid filter expression: ${error.message || error}`,
				cls: 'kh-widget-filter-error'
			});
		}
	}


	/**
	 * Shared rendering: Group records by file and render with collapsible file headers
	 */
	private async renderRecordsByFile(
		container: HTMLElement,
		records: Array<{ entry: FlatEntry; file: ParsedFile }>
	): Promise<void> {
		// Group records by file
		const recordsByFile = new Map<string, Array<{ entry: FlatEntry; file: ParsedFile }>>();
		records.forEach(({ entry, file }) => {
			const filePath = file.filePath;
			if (!recordsByFile.has(filePath)) {
				recordsByFile.set(filePath, []);
			}
			recordsByFile.get(filePath)!.push({ entry, file });
		});

		// Render grouped by file
		for (const [filePath, entries] of recordsByFile) {
			// File header (clickable to open file)
			const fileGroup = container.createDiv({ cls: 'kh-widget-filter-file-group' });
			const fileHeader = fileGroup.createDiv({ cls: 'kh-widget-filter-file-header' });
			fileHeader.style.cursor = 'pointer';

			// Check if this file is collapsed
			const isCollapsed = this.collapsedFiles.has(filePath);

			// Add toggle icon
			const toggleIcon = fileHeader.createEl('span', {
				cls: 'kh-header-toggle',
				text: isCollapsed ? '▸' : '▾'
			});
			toggleIcon.style.marginRight = '4px';

			fileHeader.createEl('span', {
				text: getFileNameFromPath(filePath).replace(/\.md$/, ''),
				cls: 'kh-widget-filter-file-name'
			});
			fileHeader.createEl('span', {
				text: ` (${entries.length})`,
				cls: 'kh-widget-filter-file-count'
			});

			// Add click handler to toggle collapse/expand
			fileHeader.addEventListener('click', async (e: MouseEvent) => {
				// Command/Ctrl + click: open file
				if (e.metaKey || e.ctrlKey) {
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) {
						await this.app.workspace.getLeaf(false).openFile(file);
					}
				} else {
					// Regular click: toggle collapse/expand
					if (this.collapsedFiles.has(filePath)) {
						this.collapsedFiles.delete(filePath);
					} else {
						this.collapsedFiles.add(filePath);
					}
					// Re-render to show/hide entries
					await this.renderFilterResults(container.closest('.kh-widget-filter') as HTMLElement);
				}
			});

			// Entries under this file - only render if not collapsed
			if (!isCollapsed) {
				const entriesContainer = fileGroup.createDiv({ cls: 'kh-widget-filter-entries' });

				// Render all entries in PARALLEL - NO async in map, return promises directly
				await Promise.all(entries.map(({ entry, file }) => {
					// Define searchable data for this file
					const fileName = getFileNameFromPath(file.filePath).replace(/\.md$/, '');
					const fileAliases = file.aliases?.join(' ') || '';
					const fileTags = file.tags?.join(' ') || '';

					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						// Resolve which keyword provides the icon based on iconPriority
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

						// Add searchable metadata as data attributes (reuse fileName, fileAliases, fileTags from outer scope)
						const entryKeywords = entry.keywords?.join(' ') || '';
						const h1Tags = entry.h1?.tags?.join(' ') || '';
						const h2Tags = entry.h2?.tags?.join(' ') || '';
						const h3Tags = entry.h3?.tags?.join(' ') || '';
						const entrySearchable = [fileName, fileAliases, fileTags, entryKeywords, h1Tags, h2Tags, h3Tags, entry.text].join(' ').toLowerCase();
						entryItem.setAttribute('data-searchable', entrySearchable);

						// Render icons from all keywords with Icon/StyleAndIcon priority
						for (const iconKeyword of iconKeywords) {
							const mark = entryItem.createEl('mark', { cls: `kh-icon ${iconKeyword}` });
							mark.innerHTML = '&nbsp;';
						}
						entryItem.createEl('span', { text: ' ', cls: 'kh-separator' });

						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});

						// Return promise directly, don't await
						return KHEntry.renderKeywordEntry(
							entryItem,
							entry,
							file,
							this.plugin,
							true // compact mode for matrix
						);

					} else if (entry.type === 'codeblock') {
						const entryItem = entriesContainer.createDiv({ cls: 'kh-widget-filter-entry kh-widget-filter-codeblock' });

						// Add searchable metadata as data attributes (reuse fileName, fileAliases, fileTags from outer scope)
						const codeLanguage = entry.language || '';
						const codeH1Tags = entry.h1?.tags?.join(' ') || '';
						const codeH2Tags = entry.h2?.tags?.join(' ') || '';
						const codeH3Tags = entry.h3?.tags?.join(' ') || '';
						const codeSearchable = [fileName, fileAliases, fileTags, codeLanguage, codeH1Tags, codeH2Tags, codeH3Tags, entry.text].join(' ').toLowerCase();
						entryItem.setAttribute('data-searchable', codeSearchable);

						// Render code block with syntax highlighting (non-blocking)
						const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							entryItem,
							file.filePath,
							this.plugin
						);

						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});

						return Promise.resolve();
					}
					return Promise.resolve();
				}));
			}
		}
	}

	/**
	 * Resolve which keywords should provide icons based on iconPriority
	 * Returns array of keyword strings to display icons from
	 */
	private resolveIconKeywords(keywordStrings: string[]): string[] {
		if (!keywordStrings || keywordStrings.length === 0) {
			return keywordStrings || [];
		}

		// Convert keyword strings to KeywordStyle objects
		const keywordStyles: KeywordStyle[] = keywordStrings
			.map(kw => this.plugin.api.getKeywordStyle(kw))
			.filter((style): style is KeywordStyle => style !== undefined);

		if (keywordStyles.length === 0) {
			return [keywordStrings[0]];
		}

		// Find highest icon priority
		const maxIconPriority = Math.max(...keywordStyles.map(k => k.iconPriority || 1));

		// Get all keywords with highest priority that have icons
		const winnersWithIcons = keywordStyles
			.filter(k => (k.iconPriority || 1) === maxIconPriority && k.generateIcon)
			.map(k => k.keyword);

		// Return winner keywords, or first keyword if none have icons
		return winnersWithIcons.length > 0 ? winnersWithIcons : [keywordStrings[0]];
	}

	/**
	 * Get the CSS class to use for a keyword entry
	 */
	private getKeywordClass(keywordName: string): string {
		const keywordStyle = this.plugin.api.getKeywordStyle(keywordName);

		return keywordStyle?.keyword || keywordName;
	}
}
