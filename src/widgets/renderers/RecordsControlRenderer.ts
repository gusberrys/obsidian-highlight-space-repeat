import { setIcon } from 'obsidian';

/**
 * RecordsControlRenderer - Handles rendering of records section controls
 * Renders filter expression input, flag buttons, text search, and chips
 */
export class RecordsControlRenderer {
	private filterExpression: string;
	private filterText: string;
	private trimSubItems: boolean;
	private topRecordOnly: boolean;
	private showAll: boolean;

	// Callbacks
	private onExpressionSearch: (expression: string) => void;
	private onExpressionInput: (expression: string) => void;
	private onFilterTextChange: (text: string) => void;
	private onTrimToggle: () => void;
	private onTopToggle: () => void;
	private onShowAllToggle: () => void;

	constructor(
		filterState: {
			filterExpression: string;
			filterText: string;
		},
		flags: {
			trimSubItems: boolean;
			topRecordOnly: boolean;
			showAll: boolean;
		},
		callbacks: {
			onExpressionSearch: (expression: string) => void;
			onExpressionInput: (expression: string) => void;
			onFilterTextChange: (text: string) => void;
			onTrimToggle: () => void;
			onTopToggle: () => void;
			onShowAllToggle: () => void;
		}
	) {
		this.filterExpression = filterState.filterExpression;
		this.filterText = filterState.filterText;
		this.trimSubItems = flags.trimSubItems;
		this.topRecordOnly = flags.topRecordOnly;
		this.showAll = flags.showAll;

		this.onExpressionSearch = callbacks.onExpressionSearch;
		this.onExpressionInput = callbacks.onExpressionInput;
		this.onFilterTextChange = callbacks.onFilterTextChange;
		this.onTrimToggle = callbacks.onTrimToggle;
		this.onTopToggle = callbacks.onTopToggle;
		this.onShowAllToggle = callbacks.onShowAllToggle;
	}

	/**
	 * Render all controls (expression filter, flags, text search)
	 */
	render(container: HTMLElement): void {
		// Records generating filter expression input
		this.renderExpressionFilter(container);

		// Text filter for filtering results
		this.renderTextFilter(container);
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

		const expressionLabel = expressionContainer.createEl('label', {
			text: 'Records filter:',
			attr: {
				style: 'font-weight: 600; color: var(--text-muted); font-size: 0.9em; white-space: nowrap;'
			}
		});

		const expressionInput = expressionContainer.createEl('input', {
			type: 'text',
			cls: 'kh-widget-filter-expression',
			value: this.filterExpression || '',
			placeholder: 'Filter expression...',
			attr: {
				style: 'flex: 1;'
			}
		});

		const expressionSearchBtn = expressionContainer.createEl('button', {
			text: '🔍',
			cls: 'kh-widget-filter-search-btn',
			title: `Filter Syntax Guide:

MATCHING:
  .keyword - keyword match (e.g., .goa .def)
  #tag - tag match (e.g., #kafka #strimzi)
  \`language - code language (e.g., \`java \`python)
  :category - category keywords (e.g., :boo)

KEYWORD COMBINATION (within entry):
  .kw1.kw2 - entry must have ALL (kw1 AND kw2)
    Example: .goa.wor = entry with BOTH goa AND wor

  [FUTURE] .goa|f1|f2 - goa with (f1 OR f2)
    Current: .goa AND (.f1 OR .f2)

  [FUTURE] .goa!f1!f2 - goa WITHOUT f1 or f2
    Current: .goa AND !.f1 AND !.f2

BOOLEAN OPERATORS (combine conditions):
  AND - both true (e.g., .goa AND #kafka)
  OR - either true (e.g., .goa OR .def)
  ! - negate (e.g., !.wor)
  ( ) - grouping (e.g., (.goa OR .def) AND #kafka)

FLAGS (modifiers):
  \\s - Slim: show only matching sub-items
  \\t - Top: show only top-level matches
  \\a - All: ignore SELECT, show all WHERE matches

CLAUSES:
  S: .keyword - SELECT what to show (default)
  W: #tag - WHERE to search (filter files)

Examples:
  .goa.wor - entries with goa AND wor
  .goa AND (.f1 OR .f2) - goa with f1 or f2
  .goa AND !.f1 AND !.f2 - goa without f1 or f2
  .goa \\t W: #kafka - top-level goa in #kafka files`
		});

		const performExpressionSearch = () => {
			this.onExpressionSearch(expressionInput.value);
		};

		expressionInput.addEventListener('input', () => {
			this.onExpressionInput(expressionInput.value);
		});

		expressionInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				performExpressionSearch();
			}
		});

		expressionSearchBtn.addEventListener('click', performExpressionSearch);

		// Flag toggle buttons (on same line as expression input)
		const trimToggle = expressionContainer.createEl('button', {
			cls: 'kh-filter-toggle' + (this.trimSubItems ? ' active' : ''),
			text: '💇',
			title: 'Slim: Show only matching sub-items (\\s flag)',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;'
			}
		});
		trimToggle.addEventListener('click', () => this.onTrimToggle());

		const topToggle = expressionContainer.createEl('button', {
			cls: 'kh-filter-toggle' + (this.topRecordOnly ? ' active' : ''),
			text: '👑',
			title: 'Top: Show only top-level matches (\\t flag)',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;'
			}
		});
		topToggle.addEventListener('click', () => this.onTopToggle());

		const showAllToggle = expressionContainer.createEl('button', {
			cls: 'kh-filter-toggle' + (this.showAll ? ' active' : ''),
			text: '🅰️',
			title: 'All: Ignore SELECT, show all WHERE matches (\\a flag)',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer;'
			}
		});
		showAllToggle.addEventListener('click', () => this.onShowAllToggle());
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
