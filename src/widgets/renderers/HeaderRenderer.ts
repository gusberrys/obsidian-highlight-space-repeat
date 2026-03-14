import { setIcon } from 'obsidian';
import type { Subject } from '../../interfaces/Subject';
import type { ActiveChip } from '../../interfaces/ActiveChip';

/**
 * HeaderRenderer - Handles rendering of matrix widget header
 * Renders subject selector, filter input, buttons, chips, and flags
 */
export class HeaderRenderer {
	private subjects: Subject[];
	private currentSubject: Subject | null;
	private widgetFilterExpression: string;
	private activeChips: Map<string, ActiveChip>;
	private trimSubItems: boolean;
	private topRecordOnly: boolean;
	private showAll: boolean;
	private showLegend: boolean;

	// Callbacks
	private onSubjectIconClick: () => void;
	private onSubjectChange: (subjectId: string) => void;
	private onFilterSearch: (expression: string) => void;
	private onFilterInput: (expression: string) => void;
	private onEditClick: () => void;
	private onSRSClick: () => Promise<void>;
	private onTrimToggle: () => void;
	private onTopToggle: () => void;
	private onShowAllToggle: () => void;
	private onLegendToggle: () => void;
	private onChipClick: (chipId: string) => void;
	private updateSRSButtonTooltip: (button: HTMLElement) => void;

	constructor(
		subjects: Subject[],
		currentSubject: Subject | null,
		widgetFilterExpression: string,
		flags: {
			activeChips: Map<string, ActiveChip>;
			trimSubItems: boolean;
			topRecordOnly: boolean;
			showAll: boolean;
			showLegend: boolean;
		},
		callbacks: {
			onSubjectIconClick: () => void;
			onSubjectChange: (subjectId: string) => void;
			onFilterSearch: (expression: string) => void;
			onFilterInput: (expression: string) => void;
			onEditClick: () => void;
			onSRSClick: () => Promise<void>;
			onTrimToggle: () => void;
			onTopToggle: () => void;
			onShowAllToggle: () => void;
			onLegendToggle: () => void;
			onChipClick: (chipId: string) => void;
			updateSRSButtonTooltip: (button: HTMLElement) => void;
		}
	) {
		this.subjects = subjects;
		this.currentSubject = currentSubject;
		this.widgetFilterExpression = widgetFilterExpression;
		this.activeChips = flags.activeChips;
		this.trimSubItems = flags.trimSubItems;
		this.topRecordOnly = flags.topRecordOnly;
		this.showAll = flags.showAll;
		this.showLegend = flags.showLegend;

		this.onSubjectIconClick = callbacks.onSubjectIconClick;
		this.onSubjectChange = callbacks.onSubjectChange;
		this.onFilterSearch = callbacks.onFilterSearch;
		this.onFilterInput = callbacks.onFilterInput;
		this.onEditClick = callbacks.onEditClick;
		this.onSRSClick = callbacks.onSRSClick;
		this.onTrimToggle = callbacks.onTrimToggle;
		this.onTopToggle = callbacks.onTopToggle;
		this.onShowAllToggle = callbacks.onShowAllToggle;
		this.onLegendToggle = callbacks.onLegendToggle;
		this.onChipClick = callbacks.onChipClick;
		this.updateSRSButtonTooltip = callbacks.updateSRSButtonTooltip;
	}

	/**
	 * Render complete header (subject selector + chips/flags)
	 * IMPORTANT: Preserves exact DOM structure:
	 * - Creates 'kh-matrix-widget-header' div
	 * - Creates 'kh-chips-section' div with id='kh-chips-container'
	 */
	render(container: HTMLElement): void {
		// Part 1: Header with subject selector, filter, buttons
		this.renderHeader(container);

		// Part 2: Chips and flags section
		this.renderChipsSection(container);
	}

	/**
	 * Render main header with subject selector, filter input, and buttons
	 */
	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'kh-matrix-widget-header' });

		// Controls container
		const controlsDiv = header.createDiv({ cls: 'kh-matrix-controls' });

		// Subject selector (without label)
		if (this.subjects.length > 0) {
			const selectorDiv = controlsDiv.createDiv({ cls: 'kh-subject-selector' });

			// Button with current subject icon
			const subjectBtn = selectorDiv.createEl('button', {
				text: this.currentSubject ? (this.currentSubject.icon || '📁') : '📁',
				cls: 'kh-subject-icon-btn',
				title: this.currentSubject ? 'Toggle subject column' : 'Select a subject'
			});
			subjectBtn.addEventListener('click', () => {
				this.onSubjectIconClick();
			});

			// Select dropdown (hidden text, only arrows visible)
			const select = selectorDiv.createEl('select', { cls: 'kh-subject-dropdown' });

			this.subjects.forEach(subject => {
				const option = select.createEl('option', {
					text: `${subject.icon || '📁'} ${subject.name}`,
					value: subject.id
				});
				if (this.currentSubject && subject.id === this.currentSubject.id) {
					option.selected = true;
				}
			});

			select.addEventListener('change', (e) => {
				const selectedId = (e.target as HTMLSelectElement).value;
				this.onSubjectChange(selectedId);
			});
		}

		// Filter input (always visible at top)
		const filterDiv = header.createDiv({ cls: 'kh-widget-filter-input' });

		const input = filterDiv.createEl('input', {
			type: 'text',
			cls: 'kh-widget-filter-expression',
			value: this.widgetFilterExpression || '',
			placeholder: 'Filter expression...'
		});

		const searchBtn = filterDiv.createEl('button', {
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

		const performSearch = () => {
			this.onFilterSearch(input.value);
		};

		// Sync button states as user types
		input.addEventListener('input', () => {
			this.onFilterInput(input.value);
		});

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				performSearch();
			}
		});

		searchBtn.addEventListener('click', performSearch);

		// Buttons container
		const buttonsDiv = controlsDiv.createDiv({ cls: 'kh-matrix-buttons' });

		// Edit button
		const editBtn = buttonsDiv.createEl('button', {
			cls: 'kh-matrix-icon-btn',
			title: 'Edit subject'
		});
		const editIcon = editBtn.createSpan();
		setIcon(editIcon, 'settings');
		editBtn.addEventListener('click', () => {
			this.onEditClick();
		});

		// SRS Review button with due card count tooltip
		const srsBtn = buttonsDiv.createEl('button', {
			cls: 'kh-matrix-icon-btn kh-srs-btn',
			title: 'Loading...'
		});
		const srsIcon = srsBtn.createSpan();
		setIcon(srsIcon, 'brain');

		// Update tooltip with due card count
		this.updateSRSButtonTooltip(srsBtn);

		srsBtn.addEventListener('click', async () => {
			await this.onSRSClick();
		});
	}

	/**
	 * Render chips and flags section
	 * IMPORTANT: Creates div with id='kh-chips-container' for external access
	 */
	private renderChipsSection(container: HTMLElement): void {
		const chipsSection = container.createDiv({ cls: 'kh-chips-section' });
		chipsSection.id = 'kh-chips-container';

		this.renderChipsAndFlags(chipsSection);
	}

	/**
	 * Render chips content (flags moved to RecordsRenderer)
	 */
	private renderChipsAndFlags(chipsContainer: HTMLElement): void {
		chipsContainer.empty();

		if (this.activeChips.size === 0) {
			return;
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

			chipEl.createEl('span', {
				cls: 'keyword-chip-label',
				text: chip.label
			});

			// Chip click handler
			chipEl.onclick = () => {
				this.onChipClick(chipId);
			};
		});
	}
}
