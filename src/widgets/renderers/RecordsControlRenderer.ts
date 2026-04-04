import { setIcon } from 'obsidian';

/**
 * RecordsControlRenderer - Handles rendering of records section controls
 * Renders filter expression input, flag buttons, text search, and chips
 */
export class RecordsControlRenderer {
	private filterExpression: string;
	private filterText: string;
	private filterType: 'F' | 'H' | 'R' | 'D' | null;
	private trimSubItems: boolean;
	private topRecordOnly: boolean;

	// Callbacks
	private onExpressionSearch: (expression: string) => void;
	private onExpressionInput: (expression: string) => void;
	private onFilterTextChange: (text: string) => void;
	private onFilterTypeChange: (type: 'F' | 'H' | 'R' | 'D') => void;
	private onTrimToggle: () => void;
	private onTopToggle: () => void;
	private onToggleAllFiles: () => void;
	private onSRSReview: () => Promise<void>;
	private onFileSearchChange: (searchText: string) => void;

	constructor(
		filterState: {
			filterExpression: string;
			filterText: string;
			filterType: 'F' | 'H' | 'R' | 'D' | null;
		},
		flags: {
			trimSubItems: boolean;
			topRecordOnly: boolean;
		},
		callbacks: {
			onExpressionSearch: (expression: string) => void;
			onExpressionInput: (expression: string) => void;
			onFilterTextChange: (text: string) => void;
			onFilterTypeChange: (type: 'F' | 'H' | 'R' | 'D') => void;
			onTrimToggle: () => void;
			onTopToggle: () => void;
			onToggleAllFiles: () => void;
			onSRSReview: () => Promise<void>;
			onFileSearchChange: (searchText: string) => void;
		}
	) {
		this.filterExpression = filterState.filterExpression;
		this.filterText = filterState.filterText;
		this.filterType = filterState.filterType;
		this.trimSubItems = flags.trimSubItems;
		this.topRecordOnly = flags.topRecordOnly;

		this.onExpressionSearch = callbacks.onExpressionSearch;
		this.onExpressionInput = callbacks.onExpressionInput;
		this.onFilterTextChange = callbacks.onFilterTextChange;
		this.onFilterTypeChange = callbacks.onFilterTypeChange;
		this.onTrimToggle = callbacks.onTrimToggle;
		this.onTopToggle = callbacks.onTopToggle;
		this.onToggleAllFiles = callbacks.onToggleAllFiles;
		this.onSRSReview = callbacks.onSRSReview;
		this.onFileSearchChange = callbacks.onFileSearchChange;
	}

	/**
	 * Render all controls (expression filter, flags, text search)
	 */
	render(container: HTMLElement): void {
		// Records generating filter expression input (includes file search at end)
		this.renderExpressionFilter(container);

		// Text filter now inline in expression filter
		// this.renderTextFilter(container);
	}

	/**
	 * Render expression filter input with search button and flag buttons
	 */
	private renderExpressionFilter(container: HTMLElement): void {
		const expressionContainer = container.createDiv({
			cls: 'kh-widget-filter-input',
			attr: {
				style: 'display: flex; gap: 4px; align-items: center; margin-bottom: 12px;'
			}
		});

		// Filter type selector (F/H/R/D)
		const filterTypeSelect = expressionContainer.createEl('select', {
			cls: 'kh-filter-type-select',
			attr: {
				style: 'font-weight: 600; color: var(--text-muted); font-size: 0.9em; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background-color: var(--background-primary);'
			}
		});

		const typeOptions = [
			{ value: 'F', label: 'F' },
			{ value: 'H', label: 'H' },
			{ value: 'R', label: 'R' }
		];

		typeOptions.forEach(opt => {
			const option = filterTypeSelect.createEl('option', {
				value: opt.value,
				text: opt.label
			});
			if (opt.value === this.filterType) {
				option.selected = true;
			}
		});

		filterTypeSelect.addEventListener('change', () => {
			const newType = filterTypeSelect.value as 'F' | 'H' | 'R' | 'D';
			this.onFilterTypeChange(newType);
		});

		// Expression input and search button enabled for F/H/R (not D)
		const expressionEnabled = this.filterType === 'F' || this.filterType === 'H' || this.filterType === 'R';

		const expressionInput = expressionContainer.createEl('input', {
			type: 'text',
			cls: 'kh-widget-filter-expression',
			value: this.filterExpression || '',
			placeholder: 'Filter expression...',
			attr: {
				style: 'flex: 1;' + (expressionEnabled ? '' : ' opacity: 0.3; cursor: not-allowed;')
			}
		});
		expressionInput.disabled = !expressionEnabled;

		const getSearchBtnTooltip = () => {
			if (!expressionEnabled) return '[Only available for Files/Headers/Records]';

			return `Filter Syntax Guide:

MATCHING:
  .keyword - entry keyword (e.g., .goa .def)
  ..keyword - header keyword (e.g., ..goa)
  #tag - file OR header tag (e.g., #kafka)
  ##tag - header tag only (e.g., ##docker)
  \`language - code language (e.g., \`java)
  :category - category keywords (e.g., :boo)

KEYWORD COMBINATION:
  .kw1.kw2 - entry has ALL (kw1 AND kw2)

BOOLEAN OPERATORS:
  AND - both true (e.g., .goa AND #kafka)
  OR - either true (e.g., .goa OR .def)
  ! - negate (e.g., !.wor)
  ( ) - grouping (e.g., (.goa OR .def) AND #kafka)

FLAGS (R mode only):
  \\s - Slim: show only matching sub-items
  \\t - Top: show only top-level matches

CLAUSES (R mode only):
  W: #tag - WHERE to search (filter files)

Examples:
  F: #kubernetes - files with kubernetes tag
  H: ##docker - headers with docker tag
  R: .goa W: #kafka - goa entries in kafka files`;
		};

		const expressionSearchBtn = expressionContainer.createEl('button', {
			text: '🔍',
			cls: 'kh-widget-filter-search-btn',
			title: getSearchBtnTooltip(),
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;' + (expressionEnabled ? '' : ' opacity: 0.3; cursor: not-allowed;')
			}
		});
		expressionSearchBtn.disabled = !expressionEnabled;

		const performExpressionSearch = () => {
			if (expressionEnabled) {
				this.onExpressionSearch(expressionInput.value);
			}
		};

		expressionInput.addEventListener('input', () => {
			if (expressionEnabled) {
				this.onExpressionInput(expressionInput.value);
			}
		});

		expressionInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && expressionEnabled) {
				performExpressionSearch();
			}
		});

		expressionSearchBtn.addEventListener('click', performExpressionSearch);

		// Flag toggle buttons (on same line as expression input) - only enabled for Records (R)
		const flagsEnabled = this.filterType === 'R';

		const trimToggle = expressionContainer.createEl('button', {
			cls: 'kh-filter-toggle' + (this.trimSubItems ? ' kh-filter-toggle-active' : ''),
			text: '💇',
			title: 'Slim: Show only matching sub-items (\\s flag)' + (flagsEnabled ? '' : ' [Only available for Records]'),
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;' + (flagsEnabled ? '' : ' opacity: 0.3; cursor: not-allowed;')
			}
		});
		trimToggle.disabled = !flagsEnabled;
		trimToggle.addEventListener('click', () => {
			if (flagsEnabled) this.onTrimToggle();
		});

		const topToggle = expressionContainer.createEl('button', {
			cls: 'kh-filter-toggle' + (this.topRecordOnly ? ' kh-filter-toggle-active' : ''),
			text: '👑',
			title: 'Top: Show only top-level matches (\\t flag)' + (flagsEnabled ? '' : ' [Only available for Records]'),
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;' + (flagsEnabled ? '' : ' opacity: 0.3; cursor: not-allowed;')
			}
		});
		topToggle.disabled = !flagsEnabled;
		topToggle.addEventListener('click', () => {
			if (flagsEnabled) this.onTopToggle();
		});

		// Toggle all files button
		const toggleAllFilesBtn = expressionContainer.createEl('button', {
			cls: 'kh-filter-toggle',
			text: '⇅',
			title: 'Toggle Fold/Unfold All Files',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;'
			}
		});
		toggleAllFilesBtn.addEventListener('click', () => {
			this.onToggleAllFiles();
		});

		// SRS review button
		const srsReviewBtn = expressionContainer.createEl('button', {
			cls: 'kh-filter-toggle kh-srs-review-btn',
			title: 'Start SRS review for filtered entries',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;'
			}
		});
		setIcon(srsReviewBtn, 'brain');
		srsReviewBtn.addEventListener('click', async () => {
			console.log('[RecordsControlRenderer] SRS review button clicked');
			await this.onSRSReview();
		});

		// File search input at the end (small width, filter DOM directly)
		const searchInput = expressionContainer.createEl('input', {
			cls: 'kh-dashboard-file-search-input',
			type: 'text',
			placeholder: 'File search...',
			value: this.filterText,
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); width: 100px; background-color: var(--background-primary);'
			}
		});

		// Filter DOM directly on input (no re-render)
		searchInput.addEventListener('input', () => {
			const searchText = searchInput.value.trim().toLowerCase();

			// Notify callback so RecordsRenderer can update currentlyDisplayedRecords
			this.onFileSearchChange(searchText);

			const resultsContainer = document.querySelector('.kh-widget-filter-results');

			if (!resultsContainer) return;

			// Filter file items (check data-searchable attribute)
			const fileItems = resultsContainer.querySelectorAll('.kh-widget-filter-item');
			fileItems.forEach((item: HTMLElement) => {
				const searchable = item.getAttribute('data-searchable') || '';
				item.style.display = searchable.includes(searchText) ? '' : 'none';
			});

			// Filter header groups (show if header or any entry matches)
			const headerGroups = resultsContainer.querySelectorAll('.kh-widget-filter-file-group');
			headerGroups.forEach((group: HTMLElement) => {
				const groupSearchable = group.getAttribute('data-searchable') || '';
				const entries = group.querySelectorAll('.kh-widget-filter-entry');

				let hasMatch = groupSearchable.includes(searchText);

				entries.forEach((entry: HTMLElement) => {
					const entrySearchable = entry.getAttribute('data-searchable') || '';
					const entryMatches = entrySearchable.includes(searchText);
					entry.style.display = entryMatches ? '' : 'none';
					if (entryMatches) hasMatch = true;
				});

				group.style.display = hasMatch ? '' : 'none';
			});
		});
	}

	/**
	 * Render text filter input for filtering displayed results
	 */
	private renderTextFilter(container: HTMLElement): void {
		const searchContainer = container.createDiv({
			cls: 'kh-dashboard-file-search-container',
			attr: {
				style: 'display: flex; gap: 4px; align-items: center; margin-bottom: 8px;'
			}
		});

		const textFilterLabel = searchContainer.createEl('label', {
			text: 'Text filter:',
			attr: {
				style: 'font-weight: 600; color: var(--text-muted); font-size: 0.9em; white-space: nowrap;'
			}
		});

		const searchInput = searchContainer.createEl('input', {
			cls: 'kh-dashboard-file-search-input',
			type: 'text',
			placeholder: 'Filter by filename, keywords, content...',
			value: this.filterText,
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); min-width: 150px; flex: 1; background-color: var(--background-primary);'
			}
		});

		// Search on Enter key
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.onFilterTextChange(searchInput.value.trim());
			}
		});

		const searchButton = searchContainer.createEl('button', {
			cls: 'kh-dashboard-file-search-button',
			title: 'Filter',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer; background-color: var(--interactive-accent); color: white;'
			}
		});
		setIcon(searchButton, 'search');

		searchButton.addEventListener('click', () => {
			this.onFilterTextChange(searchInput.value.trim());
		});

		const clearButton = searchContainer.createEl('button', {
			cls: 'kh-dashboard-file-search-clear',
			title: 'Clear filter',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer; background-color: var(--background-primary);'
			}
		});
		setIcon(clearButton, 'x');

		clearButton.addEventListener('click', () => {
			searchInput.value = '';
			this.onFilterTextChange('');
		});
	}
}
