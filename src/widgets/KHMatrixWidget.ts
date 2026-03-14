import { App, ItemView, WorkspaceLeaf, Menu, MarkdownRenderer, Modal, Setting, MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import { DATA_PATHS } from '../shared/data-paths';
import { subjectsStore, saveSubjects, settingsDataStore } from '../stores/settings-store';
import { get } from 'svelte/store';
import { Subject } from '../interfaces/Subject';
import { Topic } from '../interfaces/Topic';
import type { SubjectsData } from '../shared';
import { SubjectModal } from '../settings/SubjectModal';
import type { ParsedFile, ParsedHeader, ParsedEntry, FlatEntry } from '../interfaces/ParsedFile';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { FilterParser } from '../services/FilterParser';
import { KHEntry } from '../components/KHEntry';
import type { ActiveChip } from '../interfaces/ActiveChip';
import { MainCombinePriority } from '../shared/combine-priority';
import type { KeywordStyle } from '../shared/keyword-style';
import { SubjectDashboardView, SUBJECT_DASHBOARD_VIEW_TYPE } from './SubjectDashboardView';
import { resolveIconKeywordNames } from '../shared/priority-resolver';
import { fileHasMatch } from '../utils/filter-helpers';
import { getFileNameFromPath } from '../utils/file-helpers';
import { getAllKeywords } from '../utils/parse-helpers';
import { MatrixCell, MatrixCellType } from './MatrixCell';

export const KH_MATRIX_VIEW_TYPE = 'kh-matrix-view';

export class KHMatrixWidget extends ItemView {
	private currentSubject: Subject | null = null;
	private subjects: Subject[] = [];
	private topics: Topic[] = [];
	private plugin: HighlightSpaceRepeatPlugin;

	// Widget filter state
	private widgetFilterType: 'F' | 'H' | 'R' | null = null;
	private widgetFilterExpression: string = '';
	private widgetFilterContext: {
		subject: Subject;
		secondaryTopic: Topic | null;
		primaryTopic: Topic | null;
		includesSubjectTag: boolean;
	} | null = null;
	private widgetFilterText: string = ''; // Text filter for entries (file name, aliases, keywords, content)
	private collapsedFiles: Set<string> = new Set(); // Track collapsed file groups in widget filter

	// Track expanded headers (using unique header identifier)
	private expandedHeaders: Set<string> = new Set();

	// Prevent concurrent renders
	private isRendering: boolean = false;

	// Chips and flags
	private activeChips: Map<string, ActiveChip> = new Map();
	private disableTabs: boolean = false; // Disable H1 tab grouping
	private trimSubItems: boolean = false; // Filter sub-items to matching keywords only
	private topRecordOnly: boolean = false; // Only show records where keyword is top-level
	private showAll: boolean = false; // Show all records (ignore SELECT clause, apply only WHERE)
	private showExpressions: boolean = true; // Show F/H/R filter expressions on cells
	private showLegend: boolean = false; // Show/hide legend explaining color meanings

	// Columns state (for displaying records in column view)
	// Stores which row is currently open: 'orphans' for subject, or primaryTopicId for primary topic
	private selectedRowId: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	/**
	 * Resolve which keywords should provide icons (uses centralized logic)
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

		// Use centralized icon resolution logic
		return resolveIconKeywordNames(keywordStyles);
	}

	/**
	 * Get the CSS class to use for a keyword entry
	 * Uses keyword's configured CSS class (ccssc field) if available,
	 * otherwise falls back to the keyword name
	 */
	private getKeywordClass(keywordName: string): string {
		const keywordStyle = this.plugin.api.getKeywordStyle(keywordName);

		// Use configured CSS class if it exists and is not empty
		if (keywordStyle?.ccssc && keywordStyle.ccssc.trim()) {
			return keywordStyle.ccssc.trim();
		}

		// Fallback to keyword name
		return keywordName;
	}

	getViewType(): string {
		return KH_MATRIX_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'KH Matrix';
	}

	getIcon(): string {
		return 'layout-grid';
	}

	/**
	 * Toggle filter expressions display (called from command)
	 */
	toggleExpressions(): void {
		this.showExpressions = !this.showExpressions;
		this.render();
	}

	/**
	 * Select a subject by ID and refresh the matrix (called from command)
	 */
	async selectSubject(subjectId: string): Promise<void> {
		const subject = this.subjects.find(s => s.id === subjectId);
		if (subject) {
			this.currentSubject = subject;
			await this.scanMatrix();
		} else {
			console.warn(`[KHMatrixWidget] Subject not found: ${subjectId}`);
		}
	}

	async onOpen(): Promise<void> {
		// Subscribe to subjects store
		subjectsStore.subscribe((data: SubjectsData) => {
			this.subjects = data.subjects || [];

			// Preserve currently selected subject or default to first
			if (this.currentSubject) {
				// Update currentSubject reference to the new data
				this.currentSubject = this.subjects.find(s => s.id === this.currentSubject!.id) || this.currentSubject;
			} else if (this.subjects.length > 0) {
				// No subject selected, default to first
				this.currentSubject = this.subjects[0];
			}

			this.render();
		});

		// Auto-scan on first open to ensure fresh data
		if (this.currentSubject) {
			await this.scanMatrix();
		} else {
			this.render();
		}
	}

	async onClose(): Promise<void> {
		// Clean up
	}

	private async render(): Promise<void> {
		// Prevent concurrent renders
		if (this.isRendering) {
			return;
		}
		this.isRendering = true;

		try {
			const container = this.containerEl.children[1] as HTMLElement;
			container.empty();
			container.addClass('kh-matrix-widget');

			// Add BLUE border to indicate Matrix View (uses expression/MatrixRecordFilter)
			container.style.border = '3px solid rgba(0, 0, 255, 0.3)';
			container.style.borderRadius = '4px';

			// Header with subject selector
			this.renderHeader(container);

			// Chips and flag buttons container
			const chipsSection = container.createDiv({ cls: 'kh-chips-section' });
			chipsSection.id = 'kh-chips-container';
			this.renderChipsAndFlags();

			// Matrix table
			if (this.currentSubject) {
				await this.renderMatrix(container);

				// Columns container (for subject/primary topic columns)
				if (this.selectedRowId) {
					await this.renderMatrixColumns(container);
				}
			} else {
				container.createEl('p', {
					text: 'No subjects available',
					cls: 'kh-empty-message'
				});
			}

			// Show filter results if filter is active
			if (this.widgetFilterType && this.widgetFilterContext) {
				await this.renderWidgetFilter(container);
			}
		} finally {
			this.isRendering = false;
		}
	}

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
				title: this.currentSubject ? `Click: Open column | Cmd+Click: Open dashboard` : 'Select a subject'
			});
			subjectBtn.addEventListener('click', async (e) => {
				if (e.metaKey || e.ctrlKey) {
					// Cmd/Ctrl + Click: Open dashboard
					await this.openSubjectDashboard();
				} else {
					// Regular click: Toggle subject column
					this.toggleSubjectColumn();
				}
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

			select.addEventListener('change', async (e) => {
				const selectedId = (e.target as HTMLSelectElement).value;
				this.currentSubject = this.subjects.find(s => s.id === selectedId) || null;

				// Update button icon
				if (this.currentSubject) {
					subjectBtn.textContent = this.currentSubject.icon || '📁';
					subjectBtn.title = `Open ${this.currentSubject.name} dashboard`;
				}

				// Auto-scan on subject change
				if (this.currentSubject) {
					await this.scanMatrix();
				} else {
					this.render();
				}
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
      this.widgetFilterExpression = input.value;
      this.widgetFilterType = 'R'; // Default to Record filter
      // Set filter context
      this.widgetFilterContext = {
        subject: this.currentSubject!,
        secondaryTopic: null,
        primaryTopic: null,
        includesSubjectTag: false
      };
      // Re-render entire view to apply filter to matrix
      this.render();
    };

    // Sync button states as user types
    input.addEventListener('input', () => {
      this.widgetFilterExpression = input.value;
      this.syncButtonsFromExpression();
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
			this.openSubjectEditor();
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
			await this.startSRSReview();
		});

	}

	private async renderMatrix(container: HTMLElement): Promise<void> {
		if (!this.currentSubject) return;

		const primaryTopics = this.currentSubject!.primaryTopics || [];
		const secondaryTopics = this.currentSubject!.secondaryTopics || [];

		if (primaryTopics.length === 0 && secondaryTopics.length === 0) {
			container.createEl('p', {
				text: 'No topics available for this subject',
				cls: 'kh-empty-message'
			});
			return;
		}

		// Separate common vs specific secondary topics
		const commonSecondaries = secondaryTopics.filter(t =>
			!t.primaryTopicIds || t.primaryTopicIds.length === 0
		);
		const specificSecondaries = secondaryTopics.filter(t =>
			t.primaryTopicIds && t.primaryTopicIds.length > 0
		);

		// Calculate max number of specific secondaries for any primary
		const maxSpecificCount = Math.max(
			0,
			...primaryTopics.map(primary =>
				specificSecondaries.filter(sec =>
					sec.primaryTopicIds?.includes(primary.id)
				).length
			)
		);

		const matrixSection = container.createDiv({ cls: 'kh-matrix-section' });

		// Create table
		const table = matrixSection.createEl('table', { cls: 'kh-matrix-table' });

		// Header row
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');

		// Cell 1x1: Subject
		const cell1x1 = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });
		const cellKey1x1 = '1x1';
		const cellData1x1 = this.currentSubject.matrix?.cells[cellKey1x1];

		let displayText1x1 = this.currentSubject.icon || '📁';
		cell1x1.textContent = displayText1x1;
		const tooltipText1x1 = `Subject: ${this.currentSubject.name}`;
		cell1x1.setAttribute('title', tooltipText1x1);

		// Add counts if available
		if (cellData1x1?.fileCount !== undefined) {
			this.addCountDisplay(cell1x1, cellData1x1.fileCount, cellData1x1.headerCount || 0,
				cellData1x1.recordCount || 0, this.currentSubject, null, null, false, tooltipText1x1);
		}

		// Set background color based on exclusions
		const bgColor1x1 = this.getCellBackgroundColor(null, null);
		if (bgColor1x1) {
			cell1x1.style.backgroundColor = bgColor1x1;
		}

		// Cells 1x2, 1x3, ...: Common secondary topics (left columns)
		commonSecondaries.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });

			const cellData = this.currentSubject!.matrix?.cells[cellKey];
			const andMode = topic.andMode || false;

			// Apply white border to column header if AND mode is enabled
			if (andMode) {
				cell.classList.add('kh-matrix-and-mode-col');
				cell.classList.add('kh-matrix-and-mode');
			}

			// Check for limited collection (blue)
			if (this.hasLimitedCollection(topic, null)) {
				cell.classList.add('kh-matrix-limited-collection');
			}

			// Apply F/H disabled styling (red background)
			if (topic.fhDisabled) {
				cell.classList.add('kb-matrix-fh-disabled');
			}


			// Display topic icon
			const displayText = topic.icon || '🔗';
			cell.textContent = displayText;

			// Set tooltip with F/H/R expressions (only show enabled expressions)
			const expressions = this.computeCellExpressions(this.currentSubject!, topic, null, andMode);
			const expressionLines: string[] = [];
			if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
			if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
			if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
			const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
			const tooltipText = `${topic.name}${expressionsText}`;
			cell.setAttribute('title', tooltipText);

			// Add counts if available
			if (cellData?.fileCount !== undefined) {
				this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
					cellData.recordCount || 0, this.currentSubject!, topic, null, andMode, tooltipText);
			}

			// Set background color based on exclusions
			const bgColor = this.getCellBackgroundColor(topic, null);
			if (bgColor) {
				cell.style.backgroundColor = bgColor;
			}
		});

		// Add dynamic slots for specific secondaries (right columns)
		// These are empty in the header row - specific secondaries only show in intersection cells
		for (let i = 0; i < maxSpecificCount; i++) {
			const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell kh-matrix-specific-slot' });
			cell.textContent = '';
			cell.style.cursor = 'default';
			cell.setAttribute('title', 'Specific secondary topics column');
		}

		// Data rows
		const tbody = table.createEl('tbody');

		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const row = tbody.createEl('tr');
			const rowNum = rowIndex + 2;

			// Cell 2x1, 3x1, ...: Primary topics
			const cellKey = `${rowNum}x1`;
			const rowHeaderCell = row.createEl('th', { cls: 'kh-matrix-cell kh-matrix-row-header-cell' });

			const cellData = this.currentSubject!.matrix?.cells[cellKey];
			const andMode = primaryTopic.andMode || false;

			// Apply white border to all cells in row if AND mode is enabled
			if (andMode) {
				rowHeaderCell.classList.add('kh-matrix-and-mode-row');
				rowHeaderCell.classList.add('kh-matrix-and-mode');
			}

			// Check for limited collection (blue)
			if (this.hasLimitedCollection(null, primaryTopic)) {
				rowHeaderCell.classList.add('kh-matrix-limited-collection');
			}

			let displayText = primaryTopic.icon || '📌';
			rowHeaderCell.textContent = displayText;

			// Set tooltip with F/H/R expressions (only show enabled expressions)
			const expressions = this.computeCellExpressions(this.currentSubject!, null, primaryTopic, andMode);
			const expressionLines: string[] = [];
			if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
			if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
			if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
			const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
			const tooltipText = `${primaryTopic.name}${expressionsText}`;
			rowHeaderCell.setAttribute('title', tooltipText);

			// Add counts if available
			if (cellData?.fileCount !== undefined) {
				this.addCountDisplay(rowHeaderCell, cellData.fileCount, cellData.headerCount || 0,
					cellData.recordCount || 0, this.currentSubject!, null, primaryTopic, andMode, tooltipText);
			}

			// Set background color based on exclusions
			const bgColor = this.getCellBackgroundColor(null, primaryTopic);
			if (bgColor) {
				rowHeaderCell.style.backgroundColor = bgColor;
			}

			// Click handler: Regular click opens column, Cmd/Ctrl+click opens dashboard
			rowHeaderCell.style.cursor = 'pointer';
			rowHeaderCell.title = `Click: Open column | Cmd+Click: Open dashboard\n\n${rowHeaderCell.title}`;
			rowHeaderCell.addEventListener('click', async (e) => {
				if (e.metaKey || e.ctrlKey) {
					// Cmd/Ctrl + Click: Open dashboard
					await this.openSubjectDashboardWithPrimary(primaryTopic.id);
				} else {
					// Regular click: Toggle primary topic column
					this.togglePrimaryColumn(primaryTopic.id);
				}
			});

			// Intersection cells with common secondaries: 2x2, 2x3, 3x2, 3x3, ...
			commonSecondaries.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;
				const cell = row.createEl('td', { cls: 'kh-matrix-cell kh-matrix-data-cell' });

				// Apply white border to all cells in row if primary topic has AND mode
				if (andMode) {
					cell.classList.add('kh-matrix-and-mode-row');
				}

				const cellData = this.currentSubject!.matrix?.cells[intersectionKey];

				// For intersections: ONLY use primary topic's AND mode (inherited from row)
				// Secondary topic's AND mode does NOT apply to intersections
				const includesSubjectTag = andMode;

				// Check for limited collection (blue)
				if (this.hasLimitedCollection(secondaryTopic, primaryTopic)) {
					cell.classList.add('kh-matrix-limited-collection');
				}

				// Apply F/H disabled styling (red background) if secondary topic has F/H disabled
				if (secondaryTopic.fhDisabled) {
					cell.classList.add('kb-matrix-fh-disabled');
				}

				const displayIcon = cellData?.icon || '·';
				cell.textContent = displayIcon;

				// Set tooltip with F/H/R expressions (only show enabled expressions)
				const expressions = this.computeCellExpressions(this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag);
				const expressionLines: string[] = [];
				if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
				if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
				if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
				const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
				const tooltipText = `${primaryTopic.name} × ${secondaryTopic.name}${expressionsText}`;
				cell.setAttribute('title', tooltipText);
				cell.style.cursor = 'pointer';

				// Add counts if available
				if (cellData?.fileCount !== undefined) {
					this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
						cellData.recordCount || 0, this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag, tooltipText);
				}

				// Set background color based on exclusions
				const bgColor = this.getCellBackgroundColor(secondaryTopic, primaryTopic);
				if (bgColor) {
					cell.style.backgroundColor = bgColor;
				}
			});

			// Add specific secondaries for this primary in dynamic slots (right columns)
			const primarySpecificSecondaries = specificSecondaries.filter(sec =>
				sec.primaryTopicIds?.includes(primaryTopic.id)
			);

			for (let slotIndex = 0; slotIndex < maxSpecificCount; slotIndex++) {
				const cell = row.createEl('td', { cls: 'kh-matrix-cell kh-matrix-data-cell kh-matrix-specific-secondary' });

				if (slotIndex < primarySpecificSecondaries.length) {
					// This primary has a specific secondary for this slot
					const secondaryTopic = primarySpecificSecondaries[slotIndex];
					// Find the ORIGINAL index in the full secondaryTopics array for correct cell key
					const originalIndex = secondaryTopics.indexOf(secondaryTopic);
					const col = originalIndex + 2;
					const intersectionKey = `${rowNum}x${col}`;

					// Apply white border to all cells in row if primary topic has AND mode
					if (andMode) {
						cell.classList.add('kh-matrix-and-mode-row');
					}

					const cellData = this.currentSubject!.matrix?.cells[intersectionKey];

					// For intersections: ONLY use primary topic's AND mode (inherited from row)
					const includesSubjectTag = andMode;

					// Check for limited collection (blue)
					if (this.hasLimitedCollection(secondaryTopic, primaryTopic)) {
						cell.classList.add('kh-matrix-limited-collection');
					}

					// Apply F/H disabled styling (red background) if secondary topic has F/H disabled
					if (secondaryTopic.fhDisabled) {
						cell.classList.add('kb-matrix-fh-disabled');
					}

					// Display smaller icon for specific secondaries
					const displayIcon = cellData?.icon || secondaryTopic.icon || '·';
					const iconSpan = cell.createEl('span', { cls: 'kh-matrix-specific-icon' });
					iconSpan.textContent = displayIcon;

					// Set tooltip with F/H/R expressions
					const expressions = this.computeCellExpressions(this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag);
					const expressionLines: string[] = [];
					if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
					if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
					if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
					const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
					const tooltipText = `${primaryTopic.name} × ${secondaryTopic.name}${expressionsText}`;
					cell.setAttribute('title', tooltipText);
					cell.style.cursor = 'pointer';

					// Add counts if available
					if (cellData?.fileCount !== undefined) {
						this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
							cellData.recordCount || 0, this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag, tooltipText);
					}

					// Set background color based on exclusions
					const specificBgColor = this.getCellBackgroundColor(secondaryTopic, primaryTopic);
					if (specificBgColor) {
						cell.style.backgroundColor = specificBgColor;
					}
				} else {
					// Empty slot - this primary has fewer specific secondaries than the max
					cell.textContent = '';
					cell.style.cursor = 'default';
				}
			}
		});
	}

	/**
	 * Render widget filter component - with text search input
	 */
	private async renderWidgetFilter(container: HTMLElement): Promise<void> {
		if (!this.widgetFilterType) {
			return; // Don't show filter if not active
		}

		const filterSection = container.createDiv({ cls: 'kh-widget-filter' });

		// Add search input for text filtering
		const searchContainer = filterSection.createDiv({
			cls: 'kh-dashboard-file-search-container',
			attr: {
				style: 'display: flex; gap: 4px; align-items: center; margin-bottom: 8px;'
			}
		});

		const searchInput = searchContainer.createEl('input', {
			cls: 'kh-dashboard-file-search-input',
			type: 'text',
			placeholder: 'Filter results...',
			value: this.widgetFilterText,
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); min-width: 150px; flex: 1; background-color: var(--background-primary);'
			}
		});

		// Search on Enter key
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.widgetFilterText = searchInput.value.trim();
				this.render();
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
			this.widgetFilterText = searchInput.value.trim();
			this.render();
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
			this.widgetFilterText = '';
			this.render();
		});

		// Render results with text filter applied
		await this.renderFilterResults(filterSection);
	}

	/**
	 * Render filter results based on current filter
	 */
	private async renderFilterResults(filterSection: HTMLElement): Promise<void> {
		// Remove existing results
		const existingResults = filterSection.querySelector('.kh-widget-filter-results');
		if (existingResults) {
			existingResults.remove();
		}

		const resultsContainer = filterSection.createDiv({ cls: 'kh-widget-filter-results' });

		if (!this.widgetFilterContext) {
			return;
		}

		const parsedFiles = await this.loadParsedRecords();

		console.log(`[WIDGET FILTER] Type: ${this.widgetFilterType}, Expression: ${this.widgetFilterExpression}`);
		console.log(`[WIDGET FILTER] Context:`, this.widgetFilterContext);

		if (this.widgetFilterType === 'F') {
			// File filter - show files matching tags
			console.log(`[WIDGET FILTER] Calling renderFileFilterResults`);
			await this.renderFileFilterResults(resultsContainer, parsedFiles);
		} else if (this.widgetFilterType === 'H') {
			// Header filter - show headers matching keyword/tag
			console.log(`[WIDGET FILTER] Calling renderHeaderFilterResults`);
			await this.renderHeaderFilterResults(resultsContainer, parsedFiles);
		} else if (this.widgetFilterType === 'R') {
			// Record filter - show records matching expression
			console.log(`[WIDGET FILTER] Calling renderRecordFilterResults`);
			await this.renderRecordFilterResults(resultsContainer, parsedFiles);
		}
	}

	/**
	 * Check if a file matches the text filter (name, aliases, keywords, content)
	 */
	private fileMatchesTextFilter(file: ParsedFile, filterText: string): boolean {
		if (!filterText) return true; // No filter, match everything

		const lowerFilter = filterText.toLowerCase();

		// Check file name
		const fileName = getFileNameFromPath(file.filePath).toLowerCase();
		if (fileName.includes(lowerFilter)) return true;

		// Check aliases
		if (file.aliases && file.aliases.some(alias => alias.toLowerCase().includes(lowerFilter))) {
			return true;
		}

		// Check entries
		for (const entry of file.entries) {
			// Check keywords
			if (entry.keywords && entry.keywords.some(kw => kw.toLowerCase().includes(lowerFilter))) {
				return true;
			}
			// Check text content
			if (entry.text && entry.text.toLowerCase().includes(lowerFilter)) {
				return true;
			}
			// Check codeblocks
			if (entry.type === 'codeblock' && entry.text && entry.text.toLowerCase().includes(lowerFilter)) {
				return true;
			}
			// Check subItems
			if (entry.subItems && entry.subItems.length > 0) {
				for (const subItem of entry.subItems) {
					if (subItem.text && subItem.text.toLowerCase().includes(lowerFilter)) {
						return true;
					}
					if (subItem.keywords && subItem.keywords.some(kw => kw.toLowerCase().includes(lowerFilter))) {
						return true;
					}
				}
			}
		}

		return false;
	}

	/**
	 * Check if an entry matches the text filter (keywords, content)
	 */
	private entryMatchesTextFilter(entry: FlatEntry, file: ParsedFile, filterText: string): boolean {
		if (!filterText) return true; // No filter, match everything

		const lowerFilter = filterText.toLowerCase();

		// Check keywords
		if (entry.keywords && entry.keywords.some(kw => kw.toLowerCase().includes(lowerFilter))) {
			return true;
		}

		// Check text content
		if (entry.text && entry.text.toLowerCase().includes(lowerFilter)) {
			return true;
		}

		// Check subItems
		if (entry.subItems && entry.subItems.length > 0) {
			for (const subItem of entry.subItems) {
				if (subItem.text && subItem.text.toLowerCase().includes(lowerFilter)) {
					return true;
				}
				if (subItem.keywords && subItem.keywords.some(kw => kw.toLowerCase().includes(lowerFilter))) {
					return true;
				}
			}
		}

		// Check file name
		const fileName = getFileNameFromPath(file.filePath).toLowerCase();
		if (fileName.includes(lowerFilter)) return true;

		// Check file aliases
		if (file.aliases && file.aliases.some(alias => alias.toLowerCase().includes(lowerFilter))) {
			return true;
		}

		return false;
	}

	/**
	 * Render file filter results
	 */
	private async renderFileFilterResults(container: HTMLElement, parsedFiles: ParsedFile[]): Promise<void> {
		if (!this.widgetFilterContext) return;

		const { subject, secondaryTopic, primaryTopic, includesSubjectTag } = this.widgetFilterContext;

		// Special handling for subject cell (1x1) and secondary topic cells (1x2, 1x3, etc.)
		let matchingFiles: ParsedFile[];
		if (!secondaryTopic && !primaryTopic) {
			// Subject cell (1x1): has subject tag BUT NOT any primary or secondary topic tags
			const primaryTopics = this.currentSubject?.primaryTopics || [];
			const secondaryTopics = this.currentSubject?.secondaryTopics || [];
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);

			matchingFiles = parsedFiles.filter(file => {
				const fileTags = this.getFileLevelTags(file);  // Use file-level tags ONLY
				// Must have subject tag
				const hasSubjectTag = subject.mainTag ? fileTags.includes(subject.mainTag) : false;
				// Must NOT have any primary topic tags
				const hasPrimaryTag = primaryTopicTags.some(tag => fileTags.includes(tag));
				// Must NOT have any secondary topic tags
				const hasSecondaryTag = secondaryTopicTags.some(tag => fileTags.includes(tag));
				return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
			});
		} else if (secondaryTopic && !primaryTopic) {
			// Secondary topic cell (1x2, 1x3, etc.): has secondary tag BUT NOT any primary topic tags
			const primaryTopics = this.currentSubject?.primaryTopics || [];
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);

			matchingFiles = parsedFiles.filter(file => {
				const fileTags = this.getFileLevelTags(file);  // Use file-level tags ONLY
				// Must have the secondary topic's tag
				const hasSecondaryTag = tags.every(tag => fileTags.includes(tag));
				// Must NOT have any primary topic tags
				const hasPrimaryTag = primaryTopicTags.some(tag => fileTags.includes(tag));
				return hasSecondaryTag && !hasPrimaryTag;
			});
		} else if (primaryTopic && !secondaryTopic) {
			// Primary topic cell (2x1, 3x1, etc.): has primary tag BUT NOT any secondary topic tags
			const secondaryTopics = this.currentSubject?.secondaryTopics || [];
			const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);

			matchingFiles = parsedFiles.filter(file => {
				const fileTags = this.getFileLevelTags(file);  // Use file-level tags ONLY
				// Must have the primary topic's tag
				const hasPrimaryTag = tags.every(tag => fileTags.includes(tag));
				// Must NOT have any secondary topic tags
				const hasSecondaryTag = secondaryTopicTags.some(tag => fileTags.includes(tag));
				return hasPrimaryTag && !hasSecondaryTag;
			});
		} else {
			// Intersection cells (2x2, 2x3, etc.): use getTags() for AND filtering
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
			matchingFiles = parsedFiles.filter(file => {
				const fileTags = this.getFileLevelTags(file);  // Use file-level tags ONLY
				return tags.every(tag => fileTags.includes(tag));
			});
		}

		// Apply text filter
		if (this.widgetFilterText) {
			matchingFiles = matchingFiles.filter(file => this.fileMatchesTextFilter(file, this.widgetFilterText));
		}

		if (matchingFiles.length === 0) {
			container.createEl('div', {
				text: 'No files found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		matchingFiles.forEach(file => {
			const fileItem = container.createDiv({ cls: 'kh-widget-filter-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(file.filePath),
				cls: 'kh-widget-filter-item-name'
			});
			fileItem.addEventListener('click', () => {
				const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
				if (obsidianFile) {
					this.app.workspace.getLeaf().openFile(obsidianFile as any);
				}
			});
		});
	}

	/**
	 * Render header filter results with expandable entries
	 * Uses EXACT same matching logic as counting functions
	 * FIXED: For single topics, check ALL files - headers have independent tags/keywords
	 */
	private async renderHeaderFilterResults(container: HTMLElement, parsedFiles: ParsedFile[]): Promise<void> {
		if (!this.widgetFilterContext) return;

		const { subject, secondaryTopic, primaryTopic, includesSubjectTag } = this.widgetFilterContext;

		// Group entries by header: Map<"filePath::headerText", { file, headerText, headerLevel, entries }>
		const headerGroups = new Map<string, { file: ParsedFile; headerText: string; headerLevel: number; entries: FlatEntry[] }>();

		// Collect matching headers using EXACT same logic as counting
		if (secondaryTopic && primaryTopic) {
			// Intersection logic: (topic1 in header + topic2 in file) OR (topic2 in header + topic1 in file)
			// Don't pre-filter files by tags - intersection logic checks headers individually
			// A file only needs to have at least ONE of the topic tags (or none if both are keyword-based)

			// Check if this is primary×primary intersection (both are primary topics)
			const isPrimaryPrimaryIntersection = this.currentSubject?.primaryTopics?.some(t => t.id === secondaryTopic.id);

			console.log(`[HEADER FILTER] Rendering headers for intersection:`);
			console.log(`  Primary: ${primaryTopic.name} (tag: ${primaryTopic.topicTag}, keyword: ${primaryTopic.topicKeyword})`);
			console.log(`  Secondary: ${secondaryTopic.name} (tag: ${secondaryTopic.topicTag}, keyword: ${secondaryTopic.topicKeyword})`);
			console.log(`  Is Primary×Primary: ${isPrimaryPrimaryIntersection}`);

			for (const file of parsedFiles) {
				// For primary×primary, use file-level tags only. For secondary×primary, use all tags
				const fileTags = isPrimaryPrimaryIntersection ? this.getFileLevelTags(file) : this.getRecordTags(file);

				// Check both topics on file level
				const topic1InFile = !!(primaryTopic.topicTag && fileTags.includes(primaryTopic.topicTag));
				const topic2InFile = !!(secondaryTopic.topicTag && fileTags.includes(secondaryTopic.topicTag));

				// Check each entry's headers (h1/h2/h3)
				for (const entry of file.entries) {
					const headerLevels = [
						entry.h1 ? { level: 1, info: entry.h1 } : null,
						entry.h2 ? { level: 2, info: entry.h2 } : null,
						entry.h3 ? { level: 3, info: entry.h3 } : null
					].filter(h => h !== null);

					for (const headerLevel of headerLevels) {
						const header = headerLevel!.info;
						if (header.text || header.keywords || header.inlineKeywords) {
							// Check topic1 (primary) in header
							let topic1KeywordMatch = false;
							if (primaryTopic.topicKeyword) {
								const headerKeywords = getAllKeywords(header);
								topic1KeywordMatch = headerKeywords.some(kw =>
									kw.toLowerCase() === primaryTopic.topicKeyword!.toLowerCase()
								);
							}
							const topic1TagMatch = !!(primaryTopic.topicTag && header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === primaryTopic.topicTag;
							}));
							const topic1InHeader = topic1KeywordMatch || topic1TagMatch;

							// Check topic2 (secondary) in header
							let topic2KeywordMatch = false;
							if (secondaryTopic.topicKeyword) {
								const headerKeywords = getAllKeywords(header);
								topic2KeywordMatch = headerKeywords.some(kw =>
									kw.toLowerCase() === secondaryTopic.topicKeyword!.toLowerCase()
								);
							}
							const topic2TagMatch = !!(secondaryTopic.topicTag && header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === secondaryTopic.topicTag;
							}));
							const topic2InHeader = topic2KeywordMatch || topic2TagMatch;

							// Check intersection: (topic1 in header + topic2 on file) OR (topic2 in header + topic1 on file)
							const validCase1 = topic1InHeader && topic2InFile;
							const validCase2 = topic2InHeader && topic1InFile;

							if (validCase1 || validCase2) {
								console.log(`  ✓ MATCH FOUND: ${file.filePath} :: ${header.text}`);
								console.log(`    validCase1 (topic1 in header + topic2 on file): ${validCase1}`);
								console.log(`    validCase2 (topic2 in header + topic1 on file): ${validCase2}`);
								console.log(`    topic1InFile: ${topic1InFile}, topic2InFile: ${topic2InFile}`);
								console.log(`    topic1InHeader: ${topic1InHeader}, topic2InHeader: ${topic2InHeader}`);
								console.log(`    File tags: ${fileTags.join(', ')}`);

								const groupKey = `${file.filePath}::${header.text}`;
								if (!headerGroups.has(groupKey)) {
									headerGroups.set(groupKey, {
										file,
										headerText: header.text,
										headerLevel: headerLevel!.level,
										entries: []
									});
								}
								headerGroups.get(groupKey)!.entries.push(entry);
							}
						}
					}
				}
			}
		} else {
			// Single topic logic: keyword OR tag in header
			const topic = secondaryTopic || primaryTopic;
			if (topic) {
				for (const file of parsedFiles) {
					for (const entry of file.entries) {
						const headerLevels = [
							entry.h1 ? { level: 1, info: entry.h1 } : null,
							entry.h2 ? { level: 2, info: entry.h2 } : null,
							entry.h3 ? { level: 3, info: entry.h3 } : null
						].filter(h => h !== null);

						for (const headerLevel of headerLevels) {
							const header = headerLevel!.info;
							if (header.text || header.keywords || header.inlineKeywords) {
								// Check if topic keyword is in header.keywords array
								let keywordMatch = false;
								if (topic.topicKeyword && header.keywords) {
									keywordMatch = header.keywords?.some(kw =>
										kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
									);
								}

								// Check if header tags include the topic tag
								const tagMatch = topic.topicTag && header.tags?.some(tag => {
									const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
									return normalizedTag === topic.topicTag;
								});

								if (keywordMatch || tagMatch) {
									const groupKey = `${file.filePath}::${header.text}`;
									if (!headerGroups.has(groupKey)) {
										headerGroups.set(groupKey, {
											file,
											headerText: header.text,
											headerLevel: headerLevel!.level,
											entries: []
										});
									}
									headerGroups.get(groupKey)!.entries.push(entry);
								}
							}
						}
					}
				}
			} else {
				// Subject cell: use subject's keyword OR tag
				if (subject.keyword || subject.mainTag) {
					for (const file of parsedFiles) {
						for (const entry of file.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text || header.keywords || header.inlineKeywords) {
									// Check if subject keyword is in header.keywords array
									let keywordMatch = false;
									if (subject.keyword && header.keywords) {
										keywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === subject.keyword!.toLowerCase()
										);
									}

									// Check if header tags include the subject tag
									const tagMatch = subject.mainTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === subject.mainTag;
									});

									if (keywordMatch || tagMatch) {
										const groupKey = `${file.filePath}::${header.text}`;
										if (!headerGroups.has(groupKey)) {
											headerGroups.set(groupKey, {
												file,
												headerText: header.text,
												headerLevel: headerLevel!.level,
												entries: []
											});
										}
										headerGroups.get(groupKey)!.entries.push(entry);
									}
								}
							}
						}
					}
				}
			}
		}

		// Apply text filter to header groups
		if (this.widgetFilterText) {
			const filteredGroups = new Map<string, { file: ParsedFile; headerText: string; headerLevel: number; entries: FlatEntry[] }>();
			for (const [key, group] of headerGroups.entries()) {
				// Filter entries that match the text filter
				const filteredEntries = group.entries.filter(entry =>
					this.entryMatchesTextFilter(entry, group.file, this.widgetFilterText)
				);
				if (filteredEntries.length > 0) {
					filteredGroups.set(key, { ...group, entries: filteredEntries });
				}
			}
			headerGroups.clear();
			filteredGroups.forEach((value, key) => headerGroups.set(key, value));
		}

		console.log(`[HEADER FILTER] Total header groups found: ${headerGroups.size}`);
		if (headerGroups.size > 0) {
			console.log(`  Headers:`);
			for (const [key, group] of headerGroups.entries()) {
				console.log(`    - ${key} (${group.entries.length} entries)`);
			}
		}

		if (headerGroups.size === 0) {
			console.log(`[HEADER FILTER] ❌ NO HEADERS FOUND - Showing empty message`);
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

			// Header group container
			const headerGroup = container.createDiv({ cls: 'kh-widget-filter-file-group' });

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

			// Filename (truncated, without .md extension)
			const fileName = getFileNameFromPath(file.filePath).replace(/\.md$/, '');
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
					this
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
						// Resolve which keyword provides the icon based on combinePriority
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

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

						// Render code block with syntax highlighting (non-blocking)
						const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							entryItem,
							file.filePath,
							this
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
	 * Render record filter results
	 * Supports W: syntax for WHERE clause (file filtering)
	 */
	private async renderRecordFilterResults(container: HTMLElement, parsedFiles: ParsedFile[]): Promise<void> {
		try {

			// Matrix expressions are already in FilterParser syntax (placeholders expanded)
			// Only transform if expression doesn't look like FilterParser syntax (no dots for keywords, no # for tags)
			// Check if expression already uses FilterParser syntax (has .keyword or #tag patterns)
			const hasExplicitOperators = /\b(AND|OR)\b/.test(this.widgetFilterExpression);
			const expr = hasExplicitOperators
				? this.widgetFilterExpression  // Already has operators - use as-is
				: this.transformFilterExpression(this.widgetFilterExpression); // No operators - transform it


			// Split on W: to separate SELECT and WHERE clauses
			const hasWhere = expr.includes('W:');
			let selectExpr = expr;
			let whereExpr = '';

			if (hasWhere) {
				const parts = expr.split(/W:/);
				selectExpr = parts[0].trim();
				whereExpr = parts[1]?.trim() || '';
			}


			// Add subject tag to WHERE clause if this is a green cell (AND mode enabled)
			if (this.widgetFilterContext?.includesSubjectTag && this.widgetFilterContext.subject.mainTag) {
				// Normalize: strip leading # if present, then add it back
				const subjectTag = this.widgetFilterContext.subject.mainTag.replace(/^#/, '');
				if (whereExpr) {
					// Add to existing WHERE clause (wrap in parentheses for correct precedence)
					whereExpr = `#${subjectTag} AND (${whereExpr})`;
				} else {
					// Create new WHERE clause with just the subject tag
					whereExpr = `#${subjectTag}`;
				}
			}


			// Compile expressions
			const selectCompiled = FilterParser.compile(selectExpr);
			const whereCompiled = whereExpr ? FilterParser.compile(whereExpr) : null;

			const matchingFiles: { entry: FlatEntry; file: ParsedFile }[] = [];

			let totalEntriesChecked = 0;
			let rejectedByWhere = 0;
			let matchedBySelect = 0;

for (const file of parsedFiles) {
			for (const entry of file.entries) {
				totalEntriesChecked++;

				// Debug specific entry that should match
				const isKroxyFile = file.filePath.includes('Kroxy ST.md');
				const entryKeywords = getAllKeywords(entry);
				const hasDefRep = entryKeywords.includes('def') && entryKeywords.includes('rep');

				if (isKroxyFile && hasDefRep) {
				}

				// First apply WHERE clause (if present)
				if (whereCompiled) {
					const whereMatches = FilterParser.evaluateFlatEntry(whereCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, whereCompiled.modifiers);

					if (!whereMatches) {
						rejectedByWhere++;
						continue; // Doesn't match WHERE clause, skip
					}
				}

				// If showAll is active, ignore SELECT clause and show all matching WHERE
				if (this.showAll && whereCompiled) {
					matchingFiles.push({ entry, file });
					continue;
				}

				// Then apply SELECT clause
				const selectMatches = FilterParser.evaluateFlatEntry(selectCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);


				if (selectMatches) {
					matchingFiles.push({ entry, file });
					matchedBySelect++;
				}
			}
		}


			if (matchingFiles.length === 0) {
				container.createEl('div', {
					text: 'No records found',
					cls: 'kh-widget-filter-empty'
				});
				return;
			}

			// No limit on results - show all matching entries
			let limitedFiles = matchingFiles;

			// Apply topRecordOnly filter if enabled - remove records where match is only in sub-items
			if (this.topRecordOnly && this.widgetFilterExpression) {
				limitedFiles = limitedFiles.filter(({ entry, file }) => {
					// Keep codeblocks - they are always top-level entries
					if (entry.type === 'codeblock') {
						return true;
					}
					// For keyword entries, check if SELECT matches using ONLY top-level keywords
					// Create a copy of entry with only top-level keywords (no subitems)
					const topLevelEntry: FlatEntry = {
						...entry,
						keywords: entry.keywords || []
						// subItems are ignored for top-level matching
					};
					// Re-evaluate SELECT clause with top-level keywords only
					return FilterParser.evaluateFlatEntry(selectCompiled.ast, topLevelEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);
				});
			}

			// Apply trim filter if enabled - filter sub-items to only those matching SELECT clause
			if (this.trimSubItems) {
				limitedFiles = limitedFiles.map(({ entry, file }) => {
					if (entry.subItems && entry.subItems.length > 0) {
						// Filter sub-items to only those matching the SELECT clause
						const filteredSubItems = entry.subItems.filter(subItem => {
							if (!subItem.keywords || subItem.keywords.length === 0) {
								return false;
							}
							// Create a FlatEntry for this subitem with its own keywords
							const subItemEntry: FlatEntry = {
								...entry,
								keywords: subItem.keywords,
								text: subItem.content || ''
							};
							// Check if this subitem matches the SELECT clause
							return FilterParser.evaluateFlatEntry(selectCompiled.ast, subItemEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);
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
			if (this.widgetFilterText) {
				limitedFiles = limitedFiles.filter(({ entry, file }) =>
					this.entryMatchesTextFilter(entry, file, this.widgetFilterText)
				);
			}

			// Group records by file
			const recordsByFile = new Map<string, Array<{ entry: ParsedEntry; file: ParsedFile }>>();
			limitedFiles.forEach(({ entry, file }) => {
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
					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						// Resolve which keyword provides the icon based on combinePriority
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

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

						// Render code block with syntax highlighting (non-blocking)
						const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							entryItem,
							file.filePath,
							this
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
				}));
				}
			}
		} catch (error) {
			container.createEl('div', {
				text: 'Invalid filter expression',
				cls: 'kh-widget-filter-error'
			});
		}
	}

	/**
	 * Render orphan files list (files with ONLY subject tag, no topic tags)
	 */
	private async renderOrphanFiles(orphanFiles: ParsedFile[]): Promise<void> {
		// Find or create filter section
		let filterSection = this.containerEl.querySelector('.kh-widget-filter') as HTMLElement;
		if (!filterSection) {
			// Create filter section if it doesn't exist
			const matrixSection = this.containerEl.querySelector('.kh-matrix-section');
			if (matrixSection) {
				filterSection = matrixSection.parentElement!.createDiv({ cls: 'kh-widget-filter' });
			} else {
				return; // Can't create section
			}
		}

		// Find or create results container
		let resultsContainer = filterSection.querySelector('.kh-widget-filter-results') as HTMLElement;
		if (!resultsContainer) {
			resultsContainer = filterSection.createDiv({ cls: 'kh-widget-filter-results' });
		}

		resultsContainer.empty();

		if (orphanFiles.length === 0) {
			resultsContainer.createEl('div', {
				text: 'No orphan files found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		// Header
		resultsContainer.createEl('div', {
			text: `Orphan Files (${orphanFiles.length}) - Files with only #${this.currentSubject?.mainTag}, no topic tags`,
			cls: 'kh-widget-filter-info'
		}).style.fontWeight = 'bold';

		// Render each orphan file as a clickable item (reuse existing file rendering)
		orphanFiles.forEach(file => {
			const fileItem = resultsContainer.createDiv({ cls: 'kh-widget-filter-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(file.filePath),
				cls: 'kh-widget-filter-item-name'
			});

			// Show file tags
			if (file.tags && file.tags.length > 0) {
				const tagsSpan = fileItem.createEl('span', {
					text: ` [${file.tags.join(', ')}]`,
					cls: 'kh-widget-filter-item-tags'
				});
				tagsSpan.style.fontSize = '0.85em';
				tagsSpan.style.color = '#888';
				tagsSpan.style.marginLeft = '8px';
			}

			fileItem.addEventListener('click', () => {
				const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
				if (file) {
					this.app.workspace.getLeaf().openFile(obsidianFile as any);
				}
			});
		});
	}

	/**
	 * Get background color for cell based on exclusions
	 * Purple = files NOT counted
	 * Red = headers NOT counted
	 * Both = darker purple/magenta
	 */
	private getCellBackgroundColor(
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null
	): string | null {
		// Determine which topic's visibility flags to check
		const showFileRecords = (() => {
			if (secondaryTopic && primaryTopic) {
				return !secondaryTopic.fhDisabled && !primaryTopic.fhDisabled;
			} else if (secondaryTopic) {
				return !secondaryTopic.fhDisabled;
			} else if (primaryTopic) {
				return !primaryTopic.fhDisabled;
			}
			return true; // Subject cell (1x1) always shows
		})();

		const showHeaderRecords = (() => {
			if (secondaryTopic && primaryTopic) {
				return !secondaryTopic.fhDisabled && !primaryTopic.fhDisabled;
			} else if (secondaryTopic) {
				return !secondaryTopic.fhDisabled;
			} else if (primaryTopic) {
				return !primaryTopic.fhDisabled;
			}
			return true; // Subject cell (1x1) always shows
		})();

		const filesNotCounted = !showFileRecords;
		const headersNotCounted = !showHeaderRecords;

		// DISABLED: No background color overrides - let CSS classes handle styling
		return null;
	}

	/**
	 * Add clickable count display to a cell
	 */
	private addCountDisplay(
		cell: HTMLElement,
		fileCount: number,
		headerCount: number,
		recordCount: number,
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean,
		tooltip?: string
	): void {
		const countsDiv = cell.createDiv({ cls: 'kh-matrix-counts' });

		// Set tooltip on counts div so it shows regardless of hover location
		if (tooltip) {
			countsDiv.setAttribute('title', tooltip);
		}

		// Determine which topic's visibility flags to check
		// For intersection cells: BOTH topics must allow showing
		// For single topic cells: check that topic's flags
		const showFileRecords = (() => {
			if (secondaryTopic && primaryTopic) {
				return !secondaryTopic.fhDisabled && !primaryTopic.fhDisabled;
			} else if (secondaryTopic) {
				return !secondaryTopic.fhDisabled;
			} else if (primaryTopic) {
				return !primaryTopic.fhDisabled;
			}
			return true; // Subject cell (1x1) always shows
		})();

		const showHeaderRecords = (() => {
			if (secondaryTopic && primaryTopic) {
				return !secondaryTopic.fhDisabled && !primaryTopic.fhDisabled;
			} else if (secondaryTopic) {
				return !secondaryTopic.fhDisabled;
			} else if (primaryTopic) {
				return !primaryTopic.fhDisabled;
			}
			return true; // Subject cell (1x1) always shows
		})();

		const showRecordRecords = (() => {
			if (secondaryTopic && primaryTopic) {
				return true && true;
			} else if (secondaryTopic) {
				return true;
			} else if (primaryTopic) {
				return true;
			}
			return true; // Subject cell (1x1) always shows
		})();

		// File count (clickable) - only show if enabled
		if (fileCount > 0 && showFileRecords) {
			const fileCountSpan = countsDiv.createEl('span', {
				text: `/${fileCount}`,
				cls: 'kh-count-file'
			});
			fileCountSpan.addEventListener('click', (e) => {
				e.stopPropagation();
				// Set widget filter to show file filter
				const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
				this.widgetFilterType = 'F';
				this.widgetFilterExpression = tags.join(' AND ');
				this.widgetFilterContext = { subject, secondaryTopic, primaryTopic, includesSubjectTag };
				this.render();
			});
		}

		// Header count (clickable) - only show if enabled
		if (headerCount > 0 && showHeaderRecords) {
			const headerCountSpan = countsDiv.createEl('span', {
				text: `+${headerCount}`,
				cls: 'kh-count-header'
			});
			headerCountSpan.addEventListener('click', (e) => {
				e.stopPropagation();

				// For intersection cells, build filter with BOTH topics
				if (secondaryTopic && primaryTopic) {
					const parts1 = [];
					if (primaryTopic.topicKeyword) parts1.push(`.${primaryTopic.topicKeyword}`);
					if (primaryTopic.topicTag) parts1.push(primaryTopic.topicTag);

					const parts2 = [];
					if (secondaryTopic.topicKeyword) parts2.push(`.${secondaryTopic.topicKeyword}`);
					if (secondaryTopic.topicTag) parts2.push(secondaryTopic.topicTag);

					const expr1 = parts1.length > 1 ? `(${parts1.join(' OR ')})` : parts1[0];
					const expr2 = parts2.length > 1 ? `(${parts2.join(' OR ')})` : parts2[0];

					this.widgetFilterExpression = expr1 && expr2 ? `${expr1} AND ${expr2}` : (expr1 || expr2);
				} else {
					// Single topic cell OR subject cell
					const topic = secondaryTopic || primaryTopic;
					if (topic) {
						const parts = [];
						if (topic.topicKeyword) parts.push(`.${topic.topicKeyword}`);
						if (topic.topicTag) parts.push(topic.topicTag);
						this.widgetFilterExpression = parts.join(' OR ');
					} else {
						// Subject cell: use subject's keyword OR tag
						const parts = [];
						if (subject.keyword) parts.push(`.${subject.keyword}`);
						if (subject.mainTag) parts.push(subject.mainTag);
						this.widgetFilterExpression = parts.join(' OR ');
					}
				}

				this.widgetFilterType = 'H';
				this.widgetFilterContext = { subject, secondaryTopic, primaryTopic, includesSubjectTag };
				this.render();
			});
		}

		// Record count (clickable) - only show if enabled
		if (recordCount > 0 && showRecordRecords) {
			const recordCountSpan = countsDiv.createEl('span', {
				text: `-${recordCount}`,
				cls: 'kh-count-record'
			});
			recordCountSpan.addEventListener('click', (e) => {
				e.stopPropagation();


				// Set widget filter to show record filter
				let topic: Topic | null = null;
				let expansionContext: Topic | null = null;

				// Get the appropriate filter expression based on cell type
				let expr: string | undefined;

				if (secondaryTopic && primaryTopic) {
					// Intersection: use secondary's intersection expression (BLUE)
					expr = secondaryTopic.appliedFilterExpIntersection;
					topic = secondaryTopic;
					expansionContext = primaryTopic;
				} else if (secondaryTopic) {
					// Secondary own cell: use header expression (GREEN)
					expr = secondaryTopic.FilterExpHeader;
					topic = secondaryTopic;
					expansionContext = null;
				} else if (primaryTopic) {
					// Primary own cell: use side expression (RED)
					expr = primaryTopic.matrixOnlyFilterExpSide;
					topic = primaryTopic;
					expansionContext = primaryTopic;
				} else {
					// Subject cell (1x1): use matrixOnlyFilterExp (primary), keyword (fallback), or expression (legacy)
					expr = subject.matrixOnlyFilterExp || subject.expression;
					if (!expr && subject.keyword) {
						// Fallback to keyword if no filter expression
						expr = `.${subject.keyword}`;
					}
					topic = null;
					expansionContext = null;
				}

				if (expr) {
					this.widgetFilterType = 'R';

					// For single secondary: expand with subject
					// For single primary: remove placeholders (they reference non-existent secondary)
					if (secondaryTopic && !primaryTopic) {
						// Single secondary: expand with subject
						this.widgetFilterExpression = this.expandPlaceholders(expr, expansionContext, subject);
					} else if (primaryTopic && !secondaryTopic) {
						// Single primary: remove placeholders
						expr = expr.replace(/\s*(AND|OR)\s*#\?/gi, '');
						expr = expr.replace(/#\?\s*(AND|OR)\s*/gi, '');
						expr = expr.replace(/#\?/g, '');
						expr = expr.replace(/\s*(AND|OR)\s*\.\?/gi, '');
						expr = expr.replace(/\.\?\s*(AND|OR)\s*/gi, '');
						expr = expr.replace(/\.\?/g, '');
						expr = expr.replace(/\s*(AND|OR)\s*`\?/gi, '');
						expr = expr.replace(/`\?\s*(AND|OR)\s*/gi, '');
						expr = expr.replace(/`\?/g, '');
						this.widgetFilterExpression = this.expandPlaceholders(expr, expansionContext, subject);
					} else {
						// Intersection: expand with primary topic
						this.widgetFilterExpression = this.expandPlaceholders(expr, expansionContext, subject);
					}

					this.widgetFilterContext = { subject, secondaryTopic, primaryTopic, includesSubjectTag };
					this.render();
				}
			});
		}
	}

	/**
	 * Show list of files matching the criteria
	 */
	private async showFileList(
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean,
		event: MouseEvent
	): Promise<void> {
		const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
		const parsedFiles = await this.loadParsedRecords();
		const matchingFiles = parsedFiles.filter(file => {
			const fileTags = this.getRecordTags(file);
			return tags.every(tag => fileTags.includes(tag));
		});

		// Show menu with file list
		const menu = new Menu();

		if (matchingFiles.length === 0) {
			menu.addItem((item) => {
				item.setTitle('No files found');
				item.setDisabled(true);
			});
		} else {
			matchingFiles.forEach(file => {
				menu.addItem((item) => {
					item.setTitle(getFileNameFromPath(file.filePath));
					item.setIcon('file');
					item.onClick(() => {
						const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
						if (file) {
							this.app.workspace.getLeaf().openFile(obsidianFile as any);
						}
					});
				});
			});
		}

		menu.showAtMouseEvent(event);
	}

	/**
	 * Show list of headers matching the criteria
	 * Uses EXACT same matching logic as counting - checks ParsedFile headers
	 * FIXED: For single topics, check ALL files - headers have independent tags/keywords
	 */
	private async showHeaderList(
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean,
		event: MouseEvent
	): Promise<void> {
		const parsedFiles = await this.loadParsedRecords();
		const menu = new Menu();
		let hasHeaders = false;

		// For single topic - check ALL files
		if ((secondaryTopic && !primaryTopic) || (primaryTopic && !secondaryTopic)) {
			const topic = secondaryTopic || primaryTopic!;

			for (const file of parsedFiles) {
				// Get cache for LIVE line numbers
				const abstractFile = this.app.vault.getAbstractFileByPath(file.filePath);
				if (!abstractFile) continue;
				const obsidianFile = abstractFile as any;
				const cache = this.app.metadataCache.getFileCache(obsidianFile);

				// Check each entry's headers (h1/h2/h3)
				for (const entry of file.entries) {
					const headerLevels = [
						entry.h1 ? { level: 1, info: entry.h1 } : null,
						entry.h2 ? { level: 2, info: entry.h2 } : null,
						entry.h3 ? { level: 3, info: entry.h3 } : null
					].filter(h => h !== null);

					for (const headerLevel of headerLevels) {
						const header = headerLevel!.info;
						if (header.text || header.keywords || header.inlineKeywords) {
							// Check if topic keyword is in header.keywords array
							let keywordMatch = false;
							if (topic.topicKeyword && header.keywords) {
								keywordMatch = header.keywords?.some(kw =>
									kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
								);
							}

							// Check if header.tags array includes the topic tag
							const tagMatch = topic.topicTag && header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === topic.topicTag;
							});

							if (keywordMatch || tagMatch) {
								hasHeaders = true;

								// Find matching cache heading by level and text content
								let lineNumber: number | undefined;
								if (cache && cache.headings) {
									const cacheHeading = cache.headings.find(h => {
										// Match by level (H1=1, H2=2, H3=3)
										if (h.level !== headerLevel!.level) return false;

										// Match if cache heading contains our cleaned text
										return h.heading.toLowerCase().includes(header.text!.toLowerCase());
									});

									if (cacheHeading) {
										lineNumber = cacheHeading.position.start.line;
									}
								}

								menu.addItem((item) => {
									item.setTitle(`${getFileNameFromPath(file.filePath)}: ${header.text}`);
									item.setIcon('heading');
									item.onClick(() => {
										if (lineNumber !== undefined) {
											// Use LIVE line number from cache
											this.app.workspace.openLinkText('', file.filePath, false, {
												eState: { line: lineNumber }
											});
										} else {
											// Fallback: just open the file
											this.app.workspace.openLinkText('', file.filePath, false);
										}
									});
								});
							}
						}
					}
				}
			}
		}
		// For intersection: NEW LOGIC - secondary in header, primary in file
		// For intersections, we DO need to filter by file tags first
		else if (secondaryTopic && primaryTopic) {
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
			const matchingFiles = parsedFiles.filter(file => {
				const fileTags = this.getRecordTags(file);
				return tags.every(tag => fileTags.includes(tag));
			});

			for (const file of matchingFiles) {
				const fileTags = this.getRecordTags(file);

				// Primary topic must be in FILE
				const primaryInFile = primaryTopic.topicTag && fileTags.includes(primaryTopic.topicTag);
				if (!primaryInFile) continue;

				// Get cache for line numbers
				const abstractFile = this.app.vault.getAbstractFileByPath(file.filePath);
				if (!abstractFile) continue;
				const obsidianFile = abstractFile as any;
				const cache = this.app.metadataCache.getFileCache(obsidianFile);

				// Use ParsedFile entries with EXACT same logic as counting
				for (const entry of file.entries) {
					const headerLevels = [
						entry.h1 ? { level: 1, info: entry.h1 } : null,
						entry.h2 ? { level: 2, info: entry.h2 } : null,
						entry.h3 ? { level: 3, info: entry.h3 } : null
					].filter(h => h !== null);

					for (const headerLevel of headerLevels) {
						const header = headerLevel!.info;
						if (header.text || header.keywords || header.inlineKeywords) {
							// Secondary topic must be in HEADER (keyword OR tag)
							let secondaryKeywordMatch = false;
							if (secondaryTopic.topicKeyword) {
								const headerKeywords = getAllKeywords(header);
								secondaryKeywordMatch = headerKeywords.some(kw =>
									kw.toLowerCase() === secondaryTopic.topicKeyword!.toLowerCase()
								);
							}

							const secondaryTagMatch = secondaryTopic.topicTag && header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === secondaryTopic.topicTag;
							});

							const secondaryInHeader = secondaryKeywordMatch || secondaryTagMatch;

							if (secondaryInHeader) {
								hasHeaders = true;

								// Find matching cache heading by level and text content
								let lineNumber: number | undefined;
								if (cache && cache.headings) {
									const cacheHeading = cache.headings.find(h => {
										// Match by level (H1=1, H2=2, H3=3)
										if (h.level !== headerLevel!.level) return false;

										// Match if cache heading contains our cleaned text
										// e.g., "kro :: salala #kroxy" contains "salala"
										return h.heading.toLowerCase().includes(header.text!.toLowerCase());
									});

									if (cacheHeading) {
										lineNumber = cacheHeading.position.start.line;
									}
								}

								menu.addItem((item) => {
									item.setTitle(`${getFileNameFromPath(file.filePath)}: ${header.text}`);
									item.setIcon('heading');
									item.onClick(() => {
										if (lineNumber !== undefined) {
											// Use LIVE line number from cache
											this.app.workspace.openLinkText('', file.filePath, false, {
												eState: { line: lineNumber }
											});
										} else {
											// Fallback: just open the file
											this.app.workspace.openLinkText('', file.filePath, false);
										}
									});
								});
							}
						}
					}
				}
			}
		}

		if (!hasHeaders) {
			menu.addItem((item) => {
				item.setTitle('No headers found');
				item.setDisabled(true);
			});
		}

		menu.showAtMouseEvent(event);
	}

	/**
	 * Show list of records matching the filter expression
	 */
	private async showRecordList(
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		event: MouseEvent
	): Promise<void> {
		// Get the appropriate filter expression based on cell type
		let expr: string | undefined;
		let expansionContext: Topic | null = null;

		if (secondaryTopic && primaryTopic) {
			// Intersection: use secondary's intersection expression (BLUE)
			expr = secondaryTopic.appliedFilterExpIntersection;
			expansionContext = primaryTopic;
		} else if (secondaryTopic) {
			// Secondary own cell: use header expression (GREEN)
			expr = secondaryTopic.FilterExpHeader;
			expansionContext = null;
		} else if (primaryTopic) {
			// Primary own cell: use side expression (RED)
			expr = primaryTopic.matrixOnlyFilterExpSide;
			expansionContext = primaryTopic;
		}

		if (!expr) {
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle('No filter expression defined');
				item.setDisabled(true);
			});
			menu.showAtMouseEvent(event);
			return;
		}

		// Load parsed records
		const parsedFiles = await this.loadParsedRecords();

		// Use countRecordsWithExpression helper to get matching records
		const expandedExpr = this.expandPlaceholders(expr, expansionContext, subject);

		let compiled;
		try {
			compiled = FilterParser.compile(expandedExpr);
		} catch (error) {
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle('Invalid filter expression');
				item.setDisabled(true);
			});
			menu.showAtMouseEvent(event);
			return;
		}

		// Collect matching records
		const matchingFiles: { entry: FlatEntry; file: ParsedFile }[] = [];

		for (const file of parsedFiles) {
			for (const entry of file.entries) {
				if (FilterParser.evaluateFlatEntry(compiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, compiled.modifiers)) {
					matchingFiles.push({ entry, file });
				}
			}
		}

		// Show menu with record list
		const menu = new Menu();

		if (matchingFiles.length === 0) {
			menu.addItem((item) => {
				item.setTitle('No records found');
				item.setDisabled(true);
			});
		} else {
			matchingFiles.forEach(({ entry, file }) => {
				menu.addItem((item) => {
					const displayText = entry.type === 'keyword'
						? (entry.keywords?.join(' :: ') + ' :: ' + entry.text)
						: (entry.language ? `\`${entry.language}\`` : 'code');
					item.setTitle(`${getFileNameFromPath(file.filePath)}: ${displayText}`);
					item.setIcon('file-text');
					item.onClick(() => {
						const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
						if (file) {
							this.app.workspace.getLeaf().openFile(obsidianFile as any);
						}
					});
				});
			});
		}

		menu.showAtMouseEvent(event);
	}

	/**
	 * Normalize a tag by ensuring it has exactly one # prefix
	 */
	private normalizeTag(tag: string): string {
		if (!tag) return '';
		// Remove existing # prefix if present
		const withoutHash = tag.startsWith('#') ? tag.substring(1) : tag;
		// Return with single # prefix
		return `#${withoutHash}`;
	}

	/**
	 * Compute F/H/R filter expressions for a cell
	 * Returns only expressions that are enabled based on topic collection flags
	 */
	private computeCellExpressions(
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean
	): { F: string | null; H: string | null; R: string | null } {
		// Determine which expressions to show based on topic flags
		// For intersection: both topics must allow showing
		// For single topic: check that topic's flags
		const showF = (() => {
			if (secondaryTopic && primaryTopic) {
				return !secondaryTopic.fhDisabled && !primaryTopic.fhDisabled;
			} else if (secondaryTopic) {
				return !secondaryTopic.fhDisabled;
			} else if (primaryTopic) {
				return !primaryTopic.fhDisabled;
			}
			return true; // Subject cell always shows
		})();

		const showH = (() => {
			if (secondaryTopic && primaryTopic) {
				return !secondaryTopic.fhDisabled && !primaryTopic.fhDisabled;
			} else if (secondaryTopic) {
				return !secondaryTopic.fhDisabled;
			} else if (primaryTopic) {
				return !primaryTopic.fhDisabled;
			}
			return true; // Subject cell always shows
		})();

		const showR = (() => {
			if (secondaryTopic && primaryTopic) {
				return true && true;
			} else if (secondaryTopic) {
				return true;
			} else if (primaryTopic) {
				return true;
			}
			return true; // Subject cell always shows
		})();

		// F: File filter (tags)
		const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
		const F = showF ? (tags.map(t => this.normalizeTag(t)).join(' AND ') || '(no tags)') : null;

		// H: Header filter (keyword OR tag in header)
		let H: string | null = null;
		if (showH) {
			if (secondaryTopic && primaryTopic) {
				// Intersection: (kw1 OR tag1) AND (kw2 OR tag2)
				const parts1 = [];
				if (primaryTopic.topicKeyword) parts1.push(`.${primaryTopic.topicKeyword}`);
				if (primaryTopic.topicTag) parts1.push(this.normalizeTag(primaryTopic.topicTag));

				const parts2 = [];
				if (secondaryTopic.topicKeyword) parts2.push(`.${secondaryTopic.topicKeyword}`);
				if (secondaryTopic.topicTag) parts2.push(this.normalizeTag(secondaryTopic.topicTag));

				const expr1 = parts1.length > 1 ? `(${parts1.join(' OR ')})` : parts1[0];
				const expr2 = parts2.length > 1 ? `(${parts2.join(' OR ')})` : parts2[0];

				let baseExpr = expr1 && expr2 ? `${expr1} AND ${expr2}` : (expr1 || expr2 || '(no keyword/tag)');

				// Add subject tag if AND mode enabled
				if (includesSubjectTag && subject.mainTag) {
					H = `${this.normalizeTag(subject.mainTag)} AND ${baseExpr}`;
				} else {
					H = baseExpr;
				}
			} else {
				// Single topic
				const topic = secondaryTopic || primaryTopic;
				if (topic) {
					const parts = [];
					if (topic.topicKeyword) parts.push(`.${topic.topicKeyword}`);
					if (topic.topicTag) parts.push(this.normalizeTag(topic.topicTag));
					let baseExpr = parts.join(' OR ') || '(no keyword/tag)';

					// Add subject tag if AND mode enabled
					if (includesSubjectTag && subject.mainTag) {
						H = `${this.normalizeTag(subject.mainTag)} AND ${baseExpr}`;
					} else {
						H = baseExpr;
					}
				} else {
					// Subject only
					H = subject.mainTag ? this.normalizeTag(subject.mainTag) : '(no tag)';
				}
			}
		}

		// R: Record filter (filter expressions)
		let R: string | null = null;
		if (showR) {
			let expr: string | undefined;
			let expansionContext: Topic | null = null;

			if (secondaryTopic && primaryTopic) {
				// Intersection: use secondary's intersection expression (BLUE) with primary's context
				expr = secondaryTopic.appliedFilterExpIntersection;
				expansionContext = primaryTopic;
			} else if (secondaryTopic) {
				// Single secondary topic: use header expression (GREEN)
				expr = secondaryTopic.FilterExpHeader;
				expansionContext = null; // Will use subject instead
			} else if (primaryTopic) {
				// Single primary topic: use side expression (RED)
				expr = primaryTopic.matrixOnlyFilterExpSide;
				expansionContext = primaryTopic;
			}

			if (expr) {

				// For intersections: expand with primary topic
				// For single secondary: expand with subject
				// For single primary: expand with itself (remove placeholders since they reference non-existent secondary)
				if (secondaryTopic && !primaryTopic) {
					// Single secondary topic: expand placeholders with subject's values
					R = this.expandPlaceholders(expr, expansionContext, subject);
				} else if (primaryTopic && !secondaryTopic) {
					// Single primary topic: remove placeholders (they reference non-existent secondary)
					expr = expr.replace(/\s*(AND|OR)\s*#\?/gi, '');
					expr = expr.replace(/#\?\s*(AND|OR)\s*/gi, '');
					expr = expr.replace(/#\?/g, '');
					expr = expr.replace(/\s*(AND|OR)\s*\.\?/gi, '');
					expr = expr.replace(/\.\?\s*(AND|OR)\s*/gi, '');
					expr = expr.replace(/\.\?/g, '');
					expr = expr.replace(/\s*(AND|OR)\s*`\?/gi, '');
					expr = expr.replace(/`\?\s*(AND|OR)\s*/gi, '');
					expr = expr.replace(/`\?/g, '');
					R = this.expandPlaceholders(expr, expansionContext, subject);
				} else {
					// Intersection: expand with primary topic
					R = this.expandPlaceholders(expr, expansionContext, subject);
				}

				// Add subject tag as WHERE clause if AND mode enabled
				if (includesSubjectTag && subject.mainTag) {
					// Normalize: strip leading # if present, then add it back
					const subjectTag = subject.mainTag.replace(/^#/, '');
					// Check if expression already has W: clause
					if (R && R.includes('W:')) {
						// Add subject tag to existing WHERE clause (wrap in parentheses for correct precedence)
						R = R.replace(/W:\s*(.+)/, `W: #${subjectTag} AND ($1)`);
					} else {
						// Add new WHERE clause
						R = `${R} W: #${subjectTag}`;
					}
				}
			}
		}

		return { F, H, R };
	}

	/**
	 * Get tags for filtering
	 */
	private getTags(
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean
	): string[] {
		let tags: string[] = [];

		if (secondaryTopic && primaryTopic) {
			// Intersection
			const primaryTag = primaryTopic.topicTag || '';
			const secondaryTag = secondaryTopic.topicTag || '';

			if (includesSubjectTag && subject.mainTag) {
				tags = [subject.mainTag, primaryTag, secondaryTag].filter(t => t);
			} else {
				tags = [primaryTag, secondaryTag].filter(t => t);
			}
		} else if (secondaryTopic) {
			// Secondary topic only
			if (includesSubjectTag && subject.mainTag) {
				tags = [subject.mainTag, secondaryTopic.topicTag || ''].filter(t => t);
			} else {
				tags = [secondaryTopic.topicTag || ''].filter(t => t);
			}
		} else if (primaryTopic) {
			// Primary topic only
			if (includesSubjectTag && subject.mainTag) {
				tags = [subject.mainTag, primaryTopic.topicTag || ''].filter(t => t);
			} else {
				tags = [primaryTopic.topicTag || ''].filter(t => t);
			}
		} else {
			// Subject only
			tags = [subject.mainTag || ''].filter(t => t);
		}

		return tags;
	}


	/**
	 * Open subject editor modal
	 */
	private openSubjectEditor(): void {
		if (!this.currentSubject) return;

		const modal = new SubjectModal(
			this.app,
			this.plugin,
			this.currentSubject,
			(updatedSubject: Subject) => {
				// Update current subject reference
				this.currentSubject = updatedSubject;
				// Re-render the widget
				this.render();
			}
		);
		modal.open();
	}

	/**
	 * Toggle subject column
	 */
	private toggleSubjectColumn(): void {
		if (this.selectedRowId === 'orphans') {
			// Already showing subject columns, close them
			this.selectedRowId = null;
		} else {
			// Open subject columns
			this.selectedRowId = 'orphans';
		}
		this.render();
	}

	/**
	 * Toggle primary topic column
	 */
	private togglePrimaryColumn(topicId: string): void {
		if (this.selectedRowId === topicId) {
			// Already showing this primary's columns, close them
			this.selectedRowId = null;
		} else {
			// Open this primary's columns
			this.selectedRowId = topicId;
		}
		this.render();
	}

	/**
	 * Render matrix columns (similar to dashboard columns)
	 */
	private async renderMatrixColumns(container: HTMLElement): Promise<void> {
		if (!this.selectedRowId || !this.currentSubject) return;

		const columnsContainer = container.createDiv({ cls: 'kh-dashboard-columns kh-matrix-columns' });

		// Load parsed records
		const parsedRecords = await this.loadParsedRecords();

		const primaryTopics = this.currentSubject.primaryTopics || [];
		const secondaryTopics = this.currentSubject.secondaryTopics || [];

		// Render totals column based on selected row
		if (this.selectedRowId === 'orphans') {
			// Subject row selected - render subject totals column
			await this.renderSubjectColumn(columnsContainer, parsedRecords);
		} else {
			// Primary topic row selected - render primary totals column
			await this.renderPrimaryColumn(columnsContainer, parsedRecords, this.selectedRowId);
		}

		// Render secondary topic columns
		// Filter records based on selected row
		let filteredRecords: ParsedFile[] = [];
		if (this.selectedRowId === 'orphans') {
			// Subject row: files with subject tag but no primary/secondary tags
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
			filteredRecords = parsedRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				const hasSubjectTag = this.currentSubject?.mainTag ? tags.includes(this.currentSubject.mainTag) : false;
				const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag!));
				const hasSecondaryTag = secondaryTopicTags.some(tag => tags.includes(tag!));
				return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
			});
		} else {
			// Primary topic row: files with primary topic tag
			const primaryTopic = primaryTopics.find(t => t.id === this.selectedRowId);
			if (primaryTopic?.topicTag) {
				if (primaryTopic.andMode && this.currentSubject.mainTag) {
					filteredRecords = parsedRecords.filter(record => {
						const tags = this.getFileLevelTags(record);
						return tags.includes(primaryTopic.topicTag!) && tags.includes(this.currentSubject.mainTag!);
					});
				} else {
					filteredRecords = parsedRecords.filter(record => {
						const tags = this.getFileLevelTags(record);
						return tags.includes(primaryTopic.topicTag!);
					});
				}
			}
		}

		// Render each secondary topic as a column (skip fhDisabled topics)
		const selectedPrimaryTopic = primaryTopics.find(t => t.id === this.selectedRowId);

		secondaryTopics.forEach((topic) => {
			// Skip topics with fhDisabled flag
			if (topic.fhDisabled) return;

			// Check if this is a common or specific secondary
			const isCommon = !topic.primaryTopicIds || topic.primaryTopicIds.length === 0;
			const isSpecificForCurrentPrimary = topic.primaryTopicIds && selectedPrimaryTopic && topic.primaryTopicIds.includes(selectedPrimaryTopic.id);

			// Only show common secondaries OR specific secondaries for the current primary
			if (!isCommon && !isSpecificForCurrentPrimary) return;

			this.renderSecondaryColumn(columnsContainer, topic, filteredRecords, parsedRecords);
		});

		// Render other primary topic columns (primary×primary intersections)
		if (this.selectedRowId !== 'orphans' && selectedPrimaryTopic) {
			primaryTopics.forEach((otherPrimaryTopic) => {
				// Skip the selected primary topic itself
				if (otherPrimaryTopic.id === this.selectedRowId) return;

				// Skip if no tag
				if (!otherPrimaryTopic.topicTag) return;

				// Render intersection column
				this.renderPrimaryIntersectionColumn(columnsContainer, selectedPrimaryTopic, otherPrimaryTopic, parsedRecords);
			});
		}
	}

	/**
	 * Render subject column (1x1 cell) in matrix columns
	 */
	private async renderSubjectColumn(columnsContainer: HTMLElement, allRecords: ParsedFile[]): Promise<void> {
		if (!this.currentSubject) return;

		// Filter files: Has subject tag BUT NOT any primary or secondary topic tags
		const primaryTopics = this.currentSubject.primaryTopics || [];
		const secondaryTopics = this.currentSubject.secondaryTopics || [];
		const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
		const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);

		const filteredRecords = allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			const hasSubjectTag = this.currentSubject?.mainTag ? tags.includes(this.currentSubject.mainTag) : false;
			const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag!));
			const hasSecondaryTag = secondaryTopicTags.some(tag => tags.includes(tag!));
			return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
		});

		const fileCount = filteredRecords.length;

		// Count headers matching subject keyword OR tag (check ALL files, deduplicate)
		let headerCount = 0;
		if (this.currentSubject.keyword || this.currentSubject.mainTag) {
			const subjectTopic: Topic = {
				id: 'subject',
				name: this.currentSubject.name,
				topicKeyword: this.currentSubject.keyword,
				topicTag: this.currentSubject.mainTag
			};
			headerCount = this.countHeadersForSingleTopic(allRecords, [], subjectTopic);
		}

		// Count entries matching subject's matrixOnlyFilterExp or keyword
		let recordCount = 0;
		const matrixExpr = this.currentSubject.matrixOnlyFilterExp || this.currentSubject.expression;
		if (matrixExpr) {
			const { FilterExpressionService } = await import('../services/FilterExpressionService');
			recordCount = FilterExpressionService.countRecordsWithExpression(
				allRecords,
				matrixExpr,
				null,
				this.currentSubject,
				false
			);
		} else if (this.currentSubject.keyword) {
			for (const record of allRecords) {
				for (const entry of record.entries) {
					if (getAllKeywords(entry).includes(this.currentSubject.keyword!)) {
						recordCount++;
					}
					if (entry.subItems && entry.subItems.length > 0) {
						for (const subItem of entry.subItems) {
							if (getAllKeywords(subItem).includes(this.currentSubject.keyword!)) {
								recordCount++;
							}
						}
					}
				}
			}
		}

		// Create column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column kh-dashboard-totals-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${this.currentSubject.icon || '📁'} ${this.currentSubject.name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		// Counts container
		const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

		// Files count
		const filesCount = countsContainer.createEl('span', {
			text: `/${fileCount}`,
			cls: 'kh-count-files'
		});
		filesCount.style.cursor = 'pointer';
		filesCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			const tags = this.getTags(this.currentSubject!, null, null, true);
			this.widgetFilterType = 'F';
			this.widgetFilterExpression = tags.join(' AND ');
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: null,
				includesSubjectTag: true
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Headers count
		const headersCount = countsContainer.createEl('span', {
			text: `+${headerCount}`,
			cls: 'kh-count-headers'
		});
		headersCount.style.cursor = 'pointer';
		headersCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			// Subject cell: use subject's keyword OR tag
			const parts = [];
			if (this.currentSubject!.keyword) parts.push(`.${this.currentSubject!.keyword}`);
			if (this.currentSubject!.mainTag) parts.push(this.currentSubject!.mainTag);
			this.widgetFilterExpression = parts.join(' OR ');
			this.widgetFilterType = 'H';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: null,
				includesSubjectTag: true
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Records count
		const recordsCount = countsContainer.createEl('span', {
			text: `-${recordCount}`,
			cls: 'kh-count-entries'
		});
		recordsCount.style.cursor = 'pointer';
		recordsCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			this.widgetFilterType = 'R';
			this.widgetFilterExpression = matrixExpr || '';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: null,
				includesSubjectTag: true
			};
			await this.render();
		});

		// Content area - show files
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const sortedRecords = filteredRecords.slice().sort((a, b) => {
			const nameA = getFileNameFromPath(a.filePath).toLowerCase();
			const nameB = getFileNameFromPath(b.filePath).toLowerCase();
			return nameA.localeCompare(nameB);
		});

		sortedRecords.forEach(record => {
			const fileItem = content.createDiv({ cls: 'kh-dashboard-file-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(record.filePath).replace('.md', ''),
				cls: 'kh-dashboard-file-name'
			});
			fileItem.style.cursor = 'pointer';
			fileItem.addEventListener('click', async () => {
				const file = this.app.vault.getAbstractFileByPath(record.filePath);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(file);
				}
			});
		});
	}

	/**
	 * Render primary topic column in matrix columns
	 */
	private async renderPrimaryColumn(columnsContainer: HTMLElement, allRecords: ParsedFile[], primaryTopicId: string): Promise<void> {
		if (!this.currentSubject) return;

		const primaryTopic = this.currentSubject.primaryTopics?.find(t => t.id === primaryTopicId);
		if (!primaryTopic || !primaryTopic.topicTag) return;

		// Filter files with primary topic tag
		let filteredRecords: ParsedFile[] = [];
		if (primaryTopic.andMode && this.currentSubject.mainTag) {
			filteredRecords = allRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				return tags.includes(primaryTopic.topicTag!) && tags.includes(this.currentSubject.mainTag!);
			});
		} else {
			filteredRecords = allRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				return tags.includes(primaryTopic.topicTag!);
			});
		}

		// Filter out files that have any secondary topic tags
		const secondaryTopics = this.currentSubject.secondaryTopics || [];
		const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
		const filteredRecordsWithoutSecondary = filteredRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return !secondaryTopicTags.some(tag => tags.includes(tag!));
		});

		const fileCount = filteredRecordsWithoutSecondary.length;

		// Count headers matching topic keyword/tag (check ALL files, deduplicate)
		const headerCount = this.countHeadersForSingleTopic(allRecords, [], primaryTopic);

		// Count entries matching topic keyword
		let recordCount = 0;
		if (primaryTopic.topicKeyword) {
			for (const record of allRecords) {
				for (const entry of record.entries) {
					if (getAllKeywords(entry).includes(primaryTopic.topicKeyword!)) {
						recordCount++;
					}
					if (entry.subItems && entry.subItems.length > 0) {
						for (const subItem of entry.subItems) {
							if (getAllKeywords(subItem).includes(primaryTopic.topicKeyword!)) {
								recordCount++;
							}
						}
					}
				}
			}
		}

		// Create column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column kh-dashboard-totals-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${primaryTopic.icon || '📌'} ${primaryTopic.name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		// Counts container
		const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

		// Files count
		const filesCount = countsContainer.createEl('span', {
			text: `/${fileCount}`,
			cls: 'kh-count-files'
		});
		filesCount.style.cursor = 'pointer';
		filesCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			const tags = this.getTags(this.currentSubject!, null, primaryTopic, false);
			this.widgetFilterType = 'F';
			this.widgetFilterExpression = tags.join(' AND ');
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: primaryTopic,
				includesSubjectTag: false
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Headers count
		const headersCount = countsContainer.createEl('span', {
			text: `+${headerCount}`,
			cls: 'kh-count-headers'
		});
		headersCount.style.cursor = 'pointer';
		headersCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			// Primary topic cell: use primary's keyword OR tag
			const parts = [];
			if (primaryTopic.topicKeyword) parts.push(`.${primaryTopic.topicKeyword}`);
			if (primaryTopic.topicTag) parts.push(primaryTopic.topicTag);
			this.widgetFilterExpression = parts.join(' OR ');
			this.widgetFilterType = 'H';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: primaryTopic,
				includesSubjectTag: false
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Records count
		const recordsCount = countsContainer.createEl('span', {
			text: `-${recordCount}`,
			cls: 'kh-count-entries'
		});
		recordsCount.style.cursor = 'pointer';
		recordsCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			// Primary own cell: use side expression (RED)
			const expr = primaryTopic.matrixOnlyFilterExpSide;
			this.widgetFilterType = 'R';
			this.widgetFilterExpression = expr || '';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: primaryTopic,
				includesSubjectTag: false
			};
			await this.render();
		});

		// Content area - show files
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const sortedRecords = filteredRecordsWithoutSecondary.slice().sort((a, b) => {
			const nameA = getFileNameFromPath(a.filePath).toLowerCase();
			const nameB = getFileNameFromPath(b.filePath).toLowerCase();
			return nameA.localeCompare(nameB);
		});

		sortedRecords.forEach(record => {
			const fileItem = content.createDiv({ cls: 'kh-dashboard-file-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(record.filePath).replace('.md', ''),
				cls: 'kh-dashboard-file-name'
			});
			fileItem.style.cursor = 'pointer';
			fileItem.addEventListener('click', async () => {
				const file = this.app.vault.getAbstractFileByPath(record.filePath);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(file);
				}
			});
		});
	}

	/**
	 * Render secondary topic column in matrix columns
	 */
	private renderSecondaryColumn(columnsContainer: HTMLElement, topic: Topic, filteredRecords: ParsedFile[], allRecords: ParsedFile[]): void {
		if (!this.currentSubject) return;

		// Count files with topic tag
		let topicFiles: ParsedFile[] = [];
		if (topic.topicTag) {
			if (this.selectedRowId === 'orphans') {
				// Subject row: secondary topics should exclude primary tags
				const primaryTopics = this.currentSubject.primaryTopics || [];
				const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);

				topicFiles = allRecords.filter(record => {
					const tags = this.getRecordTags(record);
					const hasSecondaryTag = tags.includes(topic.topicTag!);
					const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag!));
					return hasSecondaryTag && !hasPrimaryTag;
				});
			} else {
				// Primary topic row: use intersection (from filteredRecords)
				topicFiles = filteredRecords.filter(record => {
					const tags = this.getRecordTags(record);
					return tags.includes(topic.topicTag!);
				});
			}
		}
		let fileCount = topicFiles.length;

		// Count headers matching topic keyword/tag (check ALL files, deduplicate)
		let headerCount = this.countHeadersForSingleTopic(allRecords, [], topic);

		// Count entries matching topic keyword
		let recordCount = 0;
		if (topic.topicKeyword) {
			for (const record of allRecords) {
				for (const entry of record.entries) {
					if (getAllKeywords(entry).includes(topic.topicKeyword!)) {
						recordCount++;
					}
					if (entry.subItems && entry.subItems.length > 0) {
						for (const subItem of entry.subItems) {
							if (getAllKeywords(subItem).includes(topic.topicKeyword!)) {
								recordCount++;
							}
						}
					}
				}
			}
		}

		// Override counts with pre-calculated matrix data
		if (this.currentSubject?.matrix?.cells) {
			const allSecondaryTopics = this.currentSubject.secondaryTopics || [];
			const commonSecondaries = allSecondaryTopics.filter(t =>
				!t.primaryTopicIds || t.primaryTopicIds.length === 0
			);

			// Find column position
			let col: number;
			const commonIndex = commonSecondaries.findIndex(t => t.id === topic.id);
			if (commonIndex >= 0) {
				col = commonIndex + 2;
			} else {
				const specificSecondaries = allSecondaryTopics.filter(t =>
					t.primaryTopicIds && t.primaryTopicIds.length > 0
				);
				const specificIndex = specificSecondaries.findIndex(t => t.id === topic.id);
				col = commonSecondaries.length + 2 + specificIndex;
			}

			let cellKey: string;
			if (this.selectedRowId === 'orphans') {
				cellKey = `1x${col}`;
			} else {
				const primaryTopics = this.currentSubject.primaryTopics || [];
				const primaryTopicIndex = primaryTopics.findIndex(t => t.id === this.selectedRowId);
				if (primaryTopicIndex >= 0) {
					const rowNum = primaryTopicIndex + 2;
					cellKey = `${rowNum}x${col}`;
				}
			}

			if (cellKey) {
				const cell = this.currentSubject.matrix.cells[cellKey];
				if (cell) {
					fileCount = cell.fileCount || 0;
					headerCount = cell.headerCount || 0;
					recordCount = cell.recordCount || 0;
				}
			}
		}

		// Only render if there are counts
		if (fileCount === 0 && headerCount === 0 && recordCount === 0) return;

		// Create column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${topic.icon || '📌'} ${topic.name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		// Counts container
		const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

		// Files count
		const filesCount = countsContainer.createEl('span', {
			text: `/${fileCount}`,
			cls: 'kh-count-files'
		});
		filesCount.style.cursor = 'pointer';
		filesCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			const primaryTopic = this.currentSubject?.primaryTopics?.find(t => t.id === this.selectedRowId);
			const tags = this.getTags(this.currentSubject!, topic, primaryTopic || null, this.selectedRowId === 'orphans');
			this.widgetFilterType = 'F';
			this.widgetFilterExpression = tags.join(' AND ');
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: topic,
				primaryTopic: primaryTopic || null,
				includesSubjectTag: this.selectedRowId === 'orphans'
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Headers count
		const headersCount = countsContainer.createEl('span', {
			text: `+${headerCount}`,
			cls: 'kh-count-headers'
		});
		headersCount.style.cursor = 'pointer';
		headersCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			const primaryTopic = this.currentSubject?.primaryTopics?.find(t => t.id === this.selectedRowId);

			// Build filter expression based on intersection or single topic
			if (topic && primaryTopic) {
				// Intersection: BOTH topics
				const parts1 = [];
				if (primaryTopic.topicKeyword) parts1.push(`.${primaryTopic.topicKeyword}`);
				if (primaryTopic.topicTag) parts1.push(primaryTopic.topicTag);

				const parts2 = [];
				if (topic.topicKeyword) parts2.push(`.${topic.topicKeyword}`);
				if (topic.topicTag) parts2.push(topic.topicTag);

				const expr1 = parts1.length > 1 ? `(${parts1.join(' OR ')})` : parts1[0];
				const expr2 = parts2.length > 1 ? `(${parts2.join(' OR ')})` : parts2[0];

				this.widgetFilterExpression = expr1 && expr2 ? `${expr1} AND ${expr2}` : (expr1 || expr2);
			} else {
				// Single topic cell (secondary only)
				const parts = [];
				if (topic.topicKeyword) parts.push(`.${topic.topicKeyword}`);
				if (topic.topicTag) parts.push(topic.topicTag);
				this.widgetFilterExpression = parts.join(' OR ');
			}

			this.widgetFilterType = 'H';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: topic,
				primaryTopic: primaryTopic || null,
				includesSubjectTag: this.selectedRowId === 'orphans'
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Records count
		const recordsCount = countsContainer.createEl('span', {
			text: `-${recordCount}`,
			cls: 'kh-count-entries'
		});
		recordsCount.style.cursor = 'pointer';
		recordsCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			const primaryTopic = this.currentSubject?.primaryTopics?.find(t => t.id === this.selectedRowId);
			this.widgetFilterType = 'R';
			this.widgetFilterExpression = topic.appliedFilterExpIntersection || '';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: topic,
				primaryTopic: primaryTopic || null,
				includesSubjectTag: this.selectedRowId === 'orphans'
			};
			await this.render();
		});

		// Content area - show files
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const sortedRecords = topicFiles.slice().sort((a, b) => {
			const nameA = getFileNameFromPath(a.filePath).toLowerCase();
			const nameB = getFileNameFromPath(b.filePath).toLowerCase();
			return nameA.localeCompare(nameB);
		});

		sortedRecords.forEach(record => {
			const fileItem = content.createDiv({ cls: 'kh-dashboard-file-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(record.filePath).replace('.md', ''),
				cls: 'kh-dashboard-file-name'
			});
			fileItem.style.cursor = 'pointer';
			fileItem.addEventListener('click', async () => {
				const file = this.app.vault.getAbstractFileByPath(record.filePath);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(file);
				}
			});
		});
	}

	/**
	 * Render primary×primary intersection column in matrix columns
	 */
	private renderPrimaryIntersectionColumn(
		columnsContainer: HTMLElement,
		clickedPrimary: Topic,
		otherPrimary: Topic,
		allRecords: ParsedFile[]
	): void {
		if (!this.currentSubject) return;

		// Create MatrixCell - SINGLE source of truth for primary×primary intersection
		const cell = new MatrixCell(
			MatrixCellType.PRIMARY_PRIMARY,
			this.currentSubject,
			this.getFileLevelTags.bind(this),
			this.getRecordTags.bind(this),
			clickedPrimary,
			otherPrimary
		);

		// Use MatrixCell for all counting (ensures consistency with rendering)
		const fileCount = cell.countFiles(allRecords);
		const headerCount = cell.countHeaders(allRecords);
		const recordCount = cell.countRecords(allRecords);

		// Only render if there are counts
		if (fileCount === 0 && headerCount === 0 && recordCount === 0) return;

		// Create column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${otherPrimary.icon || '📌'} ${otherPrimary.name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		// Counts container
		const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

		// Files count
		const filesCount = countsContainer.createEl('span', {
			text: `/${fileCount}`,
			cls: 'kh-count-files'
		});
		filesCount.style.cursor = 'pointer';
		filesCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			const tags = [];
			if (clickedPrimary.topicTag) tags.push(clickedPrimary.topicTag);
			if (otherPrimary.topicTag) tags.push(otherPrimary.topicTag);
			this.widgetFilterType = 'F';
			this.widgetFilterExpression = tags.join(' AND ');
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: clickedPrimary,
				includesSubjectTag: false
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Headers count
		const headersCount = countsContainer.createEl('span', {
			text: `+${headerCount}`,
			cls: 'kh-count-headers'
		});
		headersCount.style.cursor = 'pointer';
		headersCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			console.log(`[PRIMARY×PRIMARY HEADER CLICK] Count: +${headerCount}`);
			console.log(`  Clicked Primary: ${clickedPrimary.name} (tag: ${clickedPrimary.topicTag}, keyword: ${clickedPrimary.topicKeyword})`);
			console.log(`  Other Primary: ${otherPrimary.name} (tag: ${otherPrimary.topicTag}, keyword: ${otherPrimary.topicKeyword})`);

			// Use intersection logic: set both topics in context
			this.widgetFilterExpression = '';
			this.widgetFilterType = 'H';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: otherPrimary, // Pass as secondaryTopic for intersection logic
				primaryTopic: clickedPrimary,
				includesSubjectTag: false
			};
			await this.render();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Records count
		const recordsCount = countsContainer.createEl('span', {
			text: `-${recordCount}`,
			cls: 'kh-count-entries'
		});
		recordsCount.style.cursor = 'pointer';
		recordsCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			// Use MatrixCell to get the filter expression (same as used for counting)
			const expr = cell.getFilterExpression();

			this.widgetFilterExpression = expr;
			this.widgetFilterType = 'R';
			this.widgetFilterContext = {
				subject: this.currentSubject!,
				secondaryTopic: null,
				primaryTopic: clickedPrimary,
				includesSubjectTag: false
			};
			await this.render();
		});

		// Content area - show files using MatrixCell collected data
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const topicFiles = cell.collectFiles(allRecords);

		const sortedRecords = topicFiles.slice().sort((a, b) => {
			const nameA = getFileNameFromPath(a.filePath).toLowerCase();
			const nameB = getFileNameFromPath(b.filePath).toLowerCase();
			return nameA.localeCompare(nameB);
		});

		sortedRecords.forEach(record => {
			const fileItem = content.createDiv({ cls: 'kh-dashboard-file-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(record.filePath).replace('.md', ''),
				cls: 'kh-dashboard-file-name'
			});
			fileItem.style.cursor = 'pointer';
			fileItem.addEventListener('click', async () => {
				const file = this.app.vault.getAbstractFileByPath(record.filePath);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(file);
				}
			});
		});
	}

	/**
	 * Open Subject Dashboard View with current subject selected
	 */
	private async openSubjectDashboard(): Promise<void> {
		if (!this.currentSubject) {
			new Notice('No subject selected');
			return;
		}

		// Get or create Subject Dashboard View
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(SUBJECT_DASHBOARD_VIEW_TYPE);

		if (leaves.length > 0) {
			// View already exists, reveal it
			leaf = leaves[0];
		} else {
			// Create new view in main workspace area
			leaf = workspace.getLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: SUBJECT_DASHBOARD_VIEW_TYPE,
					active: true,
				});
			}
		}

		// Reveal the leaf and set the subject
		if (leaf) {
			workspace.revealLeaf(leaf);

			// Set the subject in the dashboard view
			const dashboardView = leaf.view as SubjectDashboardView;
			if (dashboardView && 'setSubject' in dashboardView) {
				dashboardView.setSubject(this.currentSubject);
			}
		}
	}

	/**
	 * Open Subject Dashboard View with specific primary topic selected
	 */
	private async openSubjectDashboardWithPrimary(primaryTopicId: string): Promise<void> {
		if (!this.currentSubject) {
			new Notice('No subject selected');
			return;
		}

		// Get or create Subject Dashboard View
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(SUBJECT_DASHBOARD_VIEW_TYPE);

		if (leaves.length > 0) {
			// View already exists, reveal it
			leaf = leaves[0];
		} else {
			// Create new view in main workspace area
			leaf = workspace.getLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: SUBJECT_DASHBOARD_VIEW_TYPE,
					active: true,
				});
			}
		}

		// Reveal the leaf and set the subject with primary topic
		if (leaf) {
			workspace.revealLeaf(leaf);

			// Set the subject in the dashboard view
			const dashboardView = leaf.view as SubjectDashboardView;
			if (dashboardView && 'setSubject' in dashboardView) {
				dashboardView.setSubject(this.currentSubject, primaryTopicId);
			}
		}
	}

	/**
	 * Load parsed records from JSON file
	 */
	private async loadParsedRecords(): Promise<ParsedFile[]> {
		const parsedRecordsPath = DATA_PATHS.PARSED_FILES;
		const exists = await this.app.vault.adapter.exists(parsedRecordsPath);

		if (!exists) {
			console.warn('[KHMatrixWidget] No parsed records found. Please run scan in settings.');
			return [];
		}

		const jsonContent = await this.app.vault.adapter.read(parsedRecordsPath);
		const parsedFiles: ParsedFile[] = JSON.parse(jsonContent);

		// Add file context references and defaults to each entry (not stored on disk, only in RAM)
		for (const file of parsedFiles) {
			// Default empty arrays for optional fields
			if (!file.aliases) file.aliases = [];

			for (const entry of file.entries) {
				entry.filePath = file.filePath;
				entry.fileTags = file.tags;

				// Default empty arrays for header keywords/tags
				if (entry.h1) {
					if (!entry.h1.keywords) entry.h1.keywords = [];
					if (!entry.h1.tags) entry.h1.tags = [];
				}
				if (entry.h2) {
					if (!entry.h2.keywords) entry.h2.keywords = [];
					if (!entry.h2.tags) entry.h2.tags = [];
				}
				if (entry.h3) {
					if (!entry.h3.keywords) entry.h3.keywords = [];
					if (!entry.h3.tags) entry.h3.tags = [];
				}
			}
		}

		return parsedFiles;
	}

	/**
	 * Get orphan files: files with ONLY subject tag and NO topic tags
	 * Excludes the subject file itself (e.g., "work.md" for subject "work")
	 */
	private async getOrphanFiles(): Promise<ParsedFile[]> {
		if (!this.currentSubject || !this.currentSubject.mainTag) return [];

		const parsedFiles = await this.loadParsedRecords();
		const primaryTopics = this.currentSubject!.primaryTopics || [];
		const secondaryTopics = this.currentSubject!.secondaryTopics || [];

		// Collect all topic tags
		const topicTags = new Set<string>();
		for (const topic of [...primaryTopics, ...secondaryTopics]) {
			if (topic.topicTag) {
				topicTags.add(topic.topicTag);
			}
		}

		const subjectTag = this.currentSubject.mainTag;
		const subjectName = this.currentSubject.name.toLowerCase();

		// Filter orphan files
		return parsedFiles.filter(record => {
			const fileTags = this.getRecordTags(record);

			// Must have subject tag
			if (!fileTags.includes(subjectTag)) {
				return false;
			}

			// Must NOT have any topic tags
			for (const topicTag of topicTags) {
				if (fileTags.includes(topicTag)) {
					return false;
				}
			}

			// Exclude file named same as subject (e.g., "work.md" for subject "work")
			const fileName = getFileNameFromPath(record.filePath).toLowerCase();
			if (fileName === `${subjectName}.md` || fileName === subjectName) {
				return false;
			}

			return true;
		});
	}

	/**
	 * Count orphan files
	 */
	private async countOrphanFiles(): Promise<number> {
		const orphans = await this.getOrphanFiles();
		return orphans.length;
	}

	/**
	 * Scan matrix for file and header counts
	 * Performs complete file parsing before counting
	 */
	private async scanMatrix(): Promise<void> {
		if (!this.currentSubject) return;

		// Trigger existing scan functionality from settings
		await this.plugin.triggerScan();

		// Recalculate counts from parsed data
		await this.recalculateMatrixCounts();
	}

	/**
	 * Recalculate matrix counts from already-parsed data
	 * Does NOT trigger a new scan - just loads existing parsed records and recalculates
	 */
	private async recalculateMatrixCounts(): Promise<void> {
		if (!this.currentSubject) return;

		const primaryTopics = this.currentSubject!.primaryTopics || [];
		const secondaryTopics = this.currentSubject!.secondaryTopics || [];

		// Load freshly parsed records
		const parsedFiles = await this.loadParsedRecords();

		// Initialize matrix if it doesn't exist
		if (!this.currentSubject.matrix) {
			this.currentSubject.matrix = { cells: {} };
		}

		// Scan subject cell (1x1) - store counts in memory only
		if (this.currentSubject.mainTag) {
			const cellKey1x1 = '1x1';

			// Files: Has subject tag BUT NOT any primary or secondary topic tags
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
			const fileCount = parsedFiles.filter(record => {
				const fileTags = this.getFileLevelTags(record);  // Use file-level tags ONLY
				// Must have subject tag
				const hasSubjectTag = fileTags.includes(this.currentSubject.mainTag!);
				// Must NOT have any primary topic tags
				const hasPrimaryTag = primaryTopicTags.some(tag => fileTags.includes(tag));
				// Must NOT have any secondary topic tags
				const hasSecondaryTag = secondaryTopicTags.some(tag => fileTags.includes(tag));
				return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
			}).length;

			// Headers: Count headers with subject keyword OR tag
			let headerCount = 0;
			if (this.currentSubject.keyword) {
				// Create a temporary topic object for subject
				const subjectTopic: Topic = {
					id: 'subject',
					name: this.currentSubject.name,
					topicKeyword: this.currentSubject.keyword,
					topicTag: this.currentSubject.mainTag
				};
				headerCount = this.countHeadersForSingleTopic(parsedFiles, [], subjectTopic);
			}

			// Records: Use matrixOnlyFilterExp (primary), keyword (fallback), or expression (legacy)
			let recordCount = 0;
			const matrixExpr = this.currentSubject.matrixOnlyFilterExp || this.currentSubject.expression;
			if (matrixExpr) {
				// Use matrixOnlyFilterExp or legacy expression
				recordCount = this.countRecordsWithExpression(parsedFiles, matrixExpr, null, this.currentSubject, false);
			} else if (this.currentSubject.keyword) {
				// Fallback to keyword if no filter expression
				for (const record of parsedFiles) {
					for (const entry of record.entries) {
						// Check main entry keywords (includes inline keywords)
						if (getAllKeywords(entry).includes(this.currentSubject.keyword)) {
							recordCount++;
						} else if (entry.subItems) {
							// Check subitem keywords (includes inline keywords)
							for (const subItem of entry.subItems) {
								if (getAllKeywords(subItem).includes(this.currentSubject.keyword)) {
									recordCount++;
									break; // Count entry only once even if multiple subitems match
								}
							}
						}
					}
				}
			}

			// Store counts in cell (in-memory only, not persisted)
			if (!this.currentSubject.matrix.cells[cellKey1x1]) {
				this.currentSubject.matrix.cells[cellKey1x1] = {};
			}
			this.currentSubject.matrix.cells[cellKey1x1].fileCount = fileCount;
			this.currentSubject.matrix.cells[cellKey1x1].headerCount = headerCount;
			this.currentSubject.matrix.cells[cellKey1x1].recordCount = recordCount;
		}

		// Scan secondary topic cells (1x2, 1x3, etc.)
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const andMode = topic.andMode || false;
			const tags = this.getTagsForTopicCell(topic, andMode);

			// Files: Count files that have secondary topic's tag BUT NONE of the primary topic tags
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			const fileCount = parsedFiles.filter(record => {
				const fileTags = this.getFileLevelTags(record);  // Use file-level tags ONLY
				// Must have the secondary topic's tag
				const hasSecondaryTag = tags.every(tag => fileTags.includes(tag));
				// Must NOT have any primary topic tags
				const hasPrimaryTag = primaryTopicTags.some(tag => fileTags.includes(tag));
				return hasSecondaryTag && !hasPrimaryTag;
			}).length;

			// Headers: Count headers if header has tag OR keyword (checked across ALL files)
			const headerCount = this.countHeadersForSingleTopic(parsedFiles, tags, topic);

		// For secondary topic's OWN cell (HEADER cells 1x2, 1x3):
		// - Uses FilterExpHeader (GREEN) - standalone expression, no variables
		// - If no FilterExpHeader, no record count
		let recordCount = 0;
		if (topic.FilterExpHeader) {
			recordCount = this.countRecordsWithExpression(parsedFiles, topic.FilterExpHeader, null, this.currentSubject ?? undefined, andMode);
		}

			if (!this.currentSubject!.matrix!.cells[cellKey]) {
				this.currentSubject!.matrix!.cells[cellKey] = {};
			}
			this.currentSubject!.matrix!.cells[cellKey].fileCount = fileCount;
			this.currentSubject!.matrix!.cells[cellKey].headerCount = headerCount;
			this.currentSubject!.matrix!.cells[cellKey].recordCount = recordCount;
		});

		// Scan primary topic cells (2x1, 3x1, etc.)
		primaryTopics.forEach((topic, index) => {
			const rowNum = index + 2;
			const cellKey = `${rowNum}x1`;
			const andMode = topic.andMode || false;
			const tags = this.getTagsForTopicCell(topic, andMode);

			// Primary topic cell: has primary tag BUT NOT any secondary topic tags
			const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
			const fileCount = parsedFiles.filter(file => {
				const fileTags = this.getFileLevelTags(file);  // Use file-level tags ONLY
				// Must have all required tags (primary topic)
				const hasRequiredTags = tags.every(tag => fileTags.includes(tag));
				// Must NOT have any secondary topic tags
				const hasSecondaryTag = secondaryTopicTags.some(tag => fileTags.includes(tag!));
				return hasRequiredTags && !hasSecondaryTag;
			}).length;
			const headerCount = this.countHeadersForSingleTopic(parsedFiles, tags, topic);

			// For primary topic's OWN cell (SIDE cells 2x1, 3x1):
			// - Uses matrixOnlyFilterExpSide (RED) - standalone expression, no placeholders
			let recordCount = 0;
			if (topic.matrixOnlyFilterExpSide) {
				recordCount = this.countRecordsWithExpression(parsedFiles, topic.matrixOnlyFilterExpSide, topic, this.currentSubject ?? undefined, andMode);
			}

			if (!this.currentSubject!.matrix!.cells[cellKey]) {
				this.currentSubject!.matrix!.cells[cellKey] = {};
			}
			this.currentSubject!.matrix!.cells[cellKey].fileCount = fileCount;
			this.currentSubject!.matrix!.cells[cellKey].headerCount = headerCount;
			this.currentSubject!.matrix!.cells[cellKey].recordCount = recordCount;
		});

		// Separate common vs specific secondary topics (SAME as rendering)
		const commonSecondaries = secondaryTopics.filter(t =>
			!t.primaryTopicIds || t.primaryTopicIds.length === 0
		);
		const specificSecondaries = secondaryTopics.filter(t =>
			t.primaryTopicIds && t.primaryTopicIds.length > 0
		);

		// Scan intersection cells (2x2, 2x3, 3x2, 3x3, etc.)
		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const rowNum = rowIndex + 2;

			// Scan common secondaries (main table columns)
			commonSecondaries.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;  // Use index from commonSecondaries, not full array
				const intersectionKey = `${rowNum}x${col}`;

				// For intersections: ONLY use primary topic's AND mode (inherited from row)
				// Secondary topic's AND mode does NOT apply to intersections
				const includesSubjectTag = primaryTopic.andMode || false;

				// Get tags for this intersection
				const tags = this.getTags(this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag);
				const fileCount = this.countFilesWithTags(parsedFiles, tags);
				const headerCount = this.countHeadersForIntersection(parsedFiles, tags, primaryTopic, secondaryTopic);
				// For INTERSECTION cells (2x2, 2x3, 3x2, 3x3):
				// - Uses appliedFilterExpIntersection (BLUE) - with variables/placeholders
				// - Variables get replaced by PRIMARY topic's values
				const recordCount = secondaryTopic.appliedFilterExpIntersection
					? this.countRecordsWithExpression(parsedFiles, secondaryTopic.appliedFilterExpIntersection, primaryTopic, this.currentSubject ?? undefined, includesSubjectTag)
					: 0;

				if (!this.currentSubject!.matrix!.cells[intersectionKey]) {
					this.currentSubject!.matrix!.cells[intersectionKey] = {};
				}
				this.currentSubject!.matrix!.cells[intersectionKey].fileCount = fileCount;
				this.currentSubject!.matrix!.cells[intersectionKey].headerCount = headerCount;
				this.currentSubject!.matrix!.cells[intersectionKey].recordCount = recordCount;

			});

			// Scan specific secondaries for this primary (dynamic columns)
			const primarySpecificSecondaries = specificSecondaries.filter(sec =>
				sec.primaryTopicIds?.includes(primaryTopic.id)
			);
			primarySpecificSecondaries.forEach((secondaryTopic, specIndex) => {
				// Find the ORIGINAL index in the full secondaryTopics array for correct cell key
				const originalIndex = secondaryTopics.indexOf(secondaryTopic);
				const col = originalIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;

				const includesSubjectTag = primaryTopic.andMode || false;
				const tags = this.getTags(this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag);
				const fileCount = this.countFilesWithTags(parsedFiles, tags);
				const headerCount = this.countHeadersForIntersection(parsedFiles, tags, primaryTopic, secondaryTopic);
				const recordCount = secondaryTopic.appliedFilterExpIntersection
					? this.countRecordsWithExpression(parsedFiles, secondaryTopic.appliedFilterExpIntersection, primaryTopic, this.currentSubject ?? undefined, includesSubjectTag)
					: 0;

				if (!this.currentSubject!.matrix!.cells[intersectionKey]) {
					this.currentSubject!.matrix!.cells[intersectionKey] = {};
				}
				this.currentSubject!.matrix!.cells[intersectionKey].fileCount = fileCount;
				this.currentSubject!.matrix!.cells[intersectionKey].headerCount = headerCount;
				this.currentSubject!.matrix!.cells[intersectionKey].recordCount = recordCount;
			});
		});

		// DON'T update the store - counts are in-memory only for display
		// The matrix with counts exists only in this.currentSubject (local state)
		// and will be cleared by migration on next load

		// Re-render to show counts
		this.render();
	}

	/**
	 * Update SRS button tooltip with due card count
	 * IMPORTANT: Respects filter flags (\s trim, \t top-only, \a show-all)
	 */
	private async updateSRSButtonTooltip(button: HTMLElement): Promise<void> {
		try {
			const filterExpr = this.getCurrentFilterExpression();
			const parsedFiles = await this.loadParsedRecords();
			const allCards = Object.values(this.plugin.srsManager.getDatabase().cards);
			let filteredCards = [];

			if (!filterExpr) {
				// Use subject filter if available
				if (this.currentSubject && this.currentSubject.mainTag) {
					const subjectTag = this.currentSubject.mainTag.replace(/^#/, '');
					for (const card of allCards) {
						const record = parsedFiles.find((r: any) => r.filePath === card.filePath);
						if (record) {
							const fileTags = this.getRecordTags(record);
							if (fileTags.includes(`#${subjectTag}`)) {
								filteredCards.push(card);
							}
						}
					}
				}
			} else {
				// Use same filtering logic as startSRSReview
				const matchingEntries = await this.getFilteredEntries(parsedFiles, filterExpr);

				// Get SRS cards for these specific entries
				for (const { entry, file } of matchingEntries) {
					if (entry.keywords && entry.keywords.length > 0) {
						for (const keyword of entry.keywords) {
							const cardId = `${file.filePath}::${entry.lineNumber}::${keyword}::${entry.type}`;
							const card = allCards.find(c => c.cardId === cardId);
							if (card) {
								filteredCards.push(card);
							}
						}
					}
				}
			}

			if (filteredCards.length === 0) {
				button.title = 'SRS Review: No cards found (mark keywords as SPACED)';
				return;
			}

			// Count due cards
			const today = new Date().toISOString().split('T')[0];
			const dueCards = filteredCards.filter(card => card.nextReviewDate <= today);

			if (dueCards.length === 0) {
				button.title = `SRS Review: No cards due today (${filteredCards.length} total cards)`;
			} else {
				button.title = `SRS Review: ${dueCards.length} cards due for review (${filteredCards.length} total)`;
			}
		} catch (error) {
			console.error('[KHMatrixWidget] Error updating SRS tooltip:', error);
			button.title = 'SRS Review';
		}
	}

	/**
	 * Start SRS review session for filtered records
	 * IMPORTANT: Respects filter flags (\s trim, \t top-only, \a show-all)
	 */
	private async startSRSReview(): Promise<void> {
		// Get current filter expression
		const filterExpr = this.getCurrentFilterExpression();

		// Load parsed records
		const parsedFiles = await this.loadParsedRecords();

		// Get all SRS cards
		const allCards = Object.values(this.plugin.srsManager.getDatabase().cards);

		let filteredCards = [];

		if (!filterExpr) {
			// No filter active - use subject filter if available
			if (this.currentSubject && this.currentSubject.mainTag) {
				const subjectTag = this.currentSubject.mainTag.replace(/^#/, '');
				// Get all cards from files with this subject tag
				for (const card of allCards) {
					const record = parsedFiles.find((r: any) => r.filePath === card.filePath);
					if (record) {
						const fileTags = this.getRecordTags(record);
						if (fileTags.includes(`#${subjectTag}`)) {
							filteredCards.push(card);
						}
					}
				}
			} else {
				new Notice('No filter active. Click on a count badge or select a subject.');
				return;
			}
		} else {
			// Get filtered entries using EXACT same logic as renderRecordFilterResults
			const matchingEntries = await this.getFilteredEntries(parsedFiles, filterExpr);

			if (matchingEntries.length === 0) {
				new Notice('No matching entries found.');
				return;
			}

			// Now get SRS cards for these specific entries
			for (const { entry, file } of matchingEntries) {
				if (entry.keywords && entry.keywords.length > 0) {
					// For each keyword in the entry, check if there's an SRS card
					for (const keyword of entry.keywords) {
						const cardId = `${file.filePath}::${entry.lineNumber}::${keyword}::${entry.type}`;
						const card = allCards.find(c => c.cardId === cardId);
						if (card) {
							filteredCards.push(card);
						}
					}
				}
			}
		}

		if (filteredCards.length === 0) {
			new Notice('No SRS cards found. Mark keywords as SPACED and rescan.');
			return;
		}

		// Filter to only DUE cards
		const today = new Date().toISOString().split('T')[0];
		const dueCards = filteredCards.filter(card => card.nextReviewDate <= today);

		if (dueCards.length === 0) {
			new Notice(`Found ${filteredCards.length} cards, but none are due for review today.`);
			return;
		}

		new Notice(`Starting SRS review: ${dueCards.length} cards due (${filteredCards.length} total)`);

		// Start review session with DUE cards only
		await this.plugin.activateSRSReviewView(dueCards);
	}

	/**
	 * Get filtered entries using EXACT same logic as renderRecordFilterResults
	 * Respects all filter flags: \s (trim), \t (top-only), \a (show-all)
	 */
	private async getFilteredEntries(
		parsedFiles: ParsedFile[],
		filterExpression: string
	): Promise<Array<{ entry: ParsedEntry; file: ParsedFile }>> {
		try {
			// EXTRACT FLAGS from expression before transformation
			const hasTrimFlag = /\\s/.test(filterExpression);
			const hasTopFlag = /\\t/.test(filterExpression);
			const hasShowAllFlag = /\\a/.test(filterExpression);

			// Use flags from expression OR from instance variables (buttons)
			const trimSubItems = hasTrimFlag || this.trimSubItems;
			const topRecordOnly = hasTopFlag || this.topRecordOnly;
			const showAll = hasShowAllFlag || this.showAll;

			// Transform expression (same as renderRecordFilterResults)
			const hasExplicitOperators = /\b(AND|OR)\b/.test(filterExpression);
			const expr = hasExplicitOperators
				? filterExpression
				: this.transformFilterExpression(filterExpression);

			// Split on W: to separate SELECT and WHERE clauses
			const hasWhere = expr.includes('W:');
			let selectExpr = expr;
			let whereExpr = '';

			if (hasWhere) {
				const parts = expr.split(/W:/);
				selectExpr = parts[0].trim();
				whereExpr = parts[1]?.trim() || '';
			}

			// Add subject tag to WHERE clause if this is a green cell (AND mode enabled)
			if (this.widgetFilterContext?.includesSubjectTag && this.widgetFilterContext.subject.mainTag) {
				const subjectTag = this.widgetFilterContext.subject.mainTag.replace(/^#/, '');
				if (whereExpr) {
					whereExpr = `#${subjectTag} AND (${whereExpr})`;
				} else {
					whereExpr = `#${subjectTag}`;
				}
			}

			// Compile expressions
			const selectCompiled = FilterParser.compile(selectExpr);
			const whereCompiled = whereExpr ? FilterParser.compile(whereExpr) : null;

			const matchingFiles: { entry: FlatEntry; file: ParsedFile }[] = [];

			// Filter records (same logic as renderRecordFilterResults)

			for (const file of parsedFiles) {
				for (const entry of file.entries) {
					// First apply WHERE clause (if present)
					if (whereCompiled) {
						const whereMatches = FilterParser.evaluateFlatEntry(whereCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, whereCompiled.modifiers);
						if (!whereMatches) {
							continue;
						}
					}

					// If showAll is active, ignore SELECT clause and show all matching WHERE
					if (showAll && whereCompiled) {
						matchingFiles.push({ entry, file });
						continue;
					}

					// Then apply SELECT clause
					if (FilterParser.evaluateFlatEntry(selectCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers)) {
						matchingFiles.push({ entry, file });
					}
				}
			}

			let limitedFiles = matchingFiles;

			// Apply topRecordOnly filter if enabled (from flag OR button)
			if (topRecordOnly && filterExpression) {
				limitedFiles = limitedFiles.filter(({ entry, file }) => {
					if (entry.type === 'codeblock') {
						return true;
					}
					// Create a copy of entry with only top-level keywords (no subitems)
					const topLevelEntry: FlatEntry = {
						...entry,
						keywords: entry.keywords || []
					};
					return FilterParser.evaluateFlatEntry(selectCompiled.ast, topLevelEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);
				});
			}

			// Apply trim filter if enabled (from flag OR button) - filter sub-items
			if (trimSubItems) {
				limitedFiles = limitedFiles.map(({ entry, file }) => {
					if (entry.subItems && entry.subItems.length > 0) {
						// Filter sub-items to only those matching the SELECT clause
						const filteredSubItems = entry.subItems.filter(subItem => {
							if (!subItem.keywords || subItem.keywords.length === 0) {
								return false;
							}
							// Create a FlatEntry for this subitem with its own keywords
							const subItemEntry: FlatEntry = {
								...entry,
								keywords: subItem.keywords,
								text: subItem.content || ''
							};
							// Check if this subitem matches the SELECT clause
							return FilterParser.evaluateFlatEntry(selectCompiled.ast, subItemEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);
						});

						return {
							entry: { ...entry, subItems: filteredSubItems },
							file
						};
					}
					return { entry, file };
				});
			}

			return limitedFiles;
		} catch (error) {
			console.error('[KHMatrixWidget] Error getting filtered entries:', error);
			return [];
		}
	}

	/**
	 * Get current filter expression from active chips/selections
	 */
	private getCurrentFilterExpression(): string | null {
		// Return current widget filter expression if active
		if (this.widgetFilterExpression && this.widgetFilterExpression.trim()) {
			return this.widgetFilterExpression;
		}
		return null;
	}

	/**
	 * Check if entry matches filter expression
	 */
	private doesEntryMatchFilter(record: any, card: any, filterExpr: string): boolean {
		// TODO: Implement filter matching logic
		// For now, just check if card keyword is in record
		return true;
	}

	/**
	 * Get tags for a single topic cell
	 */
	private getTagsForTopicCell(topic: Topic, andMode: boolean): string[] {
		if (andMode && this.currentSubject?.mainTag) {
			return [this.currentSubject.mainTag, topic.topicTag || ''].filter(t => t);
		} else {
			return [topic.topicTag || ''].filter(t => t);
		}
	}

	/**
	 * Get ONLY file-level tags (NOT header tags)
	 * Use this for file filtering/categorization in matrix
	 */
	private getFileLevelTags(record: ParsedFile): string[] {
		const tags: string[] = [];
		record.tags.forEach(tag => {
			tags.push(tag.startsWith('#') ? tag : '#' + tag);
		});
		return tags;
	}

	/**
	 * Get all tags from a parsed record (file-level tags + all header tags)
	 * Use this for header matching and comprehensive tag searches
	 */
	private getRecordTags(record: ParsedFile): string[] {
		const tags = new Set<string>();

		// Add file-level tags (ensure they have #)
		record.tags.forEach(tag => {
			tags.add(tag.startsWith('#') ? tag : '#' + tag);
		});

		// Collect tags from all entry headers (h1/h2/h3)
		for (const entry of record.entries) {
			if (entry.h1?.tags) {
				entry.h1.tags.forEach(tag => {
					tags.add(tag.startsWith('#') ? tag : '#' + tag);
				});
			}
			if (entry.h2?.tags) {
				entry.h2.tags.forEach(tag => {
					tags.add(tag.startsWith('#') ? tag : '#' + tag);
				});
			}
			if (entry.h3?.tags) {
				entry.h3.tags.forEach(tag => {
					tags.add(tag.startsWith('#') ? tag : '#' + tag);
				});
			}
		}

		return Array.from(tags);
	}

	/**
	 * Count parsed records that have ALL specified tags
	 */
	public countFilesWithTags(parsedFiles: ParsedFile[], tags: string[]): number {
		if (tags.length === 0) return 0;

		return parsedFiles.filter(record => {
			const fileTags = this.getFileLevelTags(record);  // Use file-level tags ONLY
			return tags.every(tag => fileTags.includes(tag));
		}).length;
	}

	/**
	 * Count headers for a single topic
	 * Header matches if: header contains keyword OR header has actual tag (with #)
	 * FIXED: Headers are checked across ALL files - we don't filter by file tags first
	 * because headers have their own tags/keywords independent of file-level tags
	 */
	private countHeadersForSingleTopic(parsedFiles: ParsedFile[], requiredTags: string[], topic: Topic): number {
		// FIXED: Don't filter by file tags - headers have their own tags!
		// We check ALL files and only filter at the header level
		// Track distinct headers (file path + header text + level) to count each header only once
		const countedHeaders = new Set<string>();

		// Check ALL files - don't pre-filter by file tags
		for (const file of parsedFiles) {
			for (const entry of file.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text || header.keywords || header.inlineKeywords) {
						// Check if topic keyword is in header.keywords array (includes inline keywords)
						let keywordMatch = false;
						if (topic.topicKeyword) {
							const headerKeywords = getAllKeywords(header);
							keywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
							);
						}

						// Check if header tags include the topic tag
						const tagMatch = topic.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === topic.topicTag;
						});

						if (keywordMatch || tagMatch) {
							// Only count this header once (use file path + level + text as unique key)
							const headerKey = `${file.filePath}::${headerLevel!.level}::${header.text}`;
							countedHeaders.add(headerKey);
						}
					}
				}
			}
		}

		return countedHeaders.size;
	}

	/**
	 * Count headers for intersection (e.g., java × oop)
	 * RULE: Count a header if and only if:
	 * 1. At least ONE topic is in the header (by keyword OR by tag)
	 * 2. AND the OTHER topic is on file level (by file tag)
	 *
	 * Valid: (topic1 in header AND topic2 on file) OR (topic2 in header AND topic1 on file)
	 * Invalid: Both only on file, or one in header without other on file
	 *
	 * topic1 = primaryTopic (row), topic2 = secondaryTopic (column)
	 */
	public countHeadersForIntersection(parsedFiles: ParsedFile[], requiredTags: string[], topic1: Topic, topic2: Topic, useFileLevelTagsOnly: boolean = false): number {
		// Don't filter files by required tags - intersection logic checks headers individually
		// A file only needs to have at least ONE of the topic tags (or none if both are keyword-based)

		console.log(`[COUNT HEADERS] Counting intersection headers:`);
		console.log(`  Topic1: ${topic1.name} (tag: ${topic1.topicTag}, keyword: ${topic1.topicKeyword})`);
		console.log(`  Topic2: ${topic2.name} (tag: ${topic2.topicTag}, keyword: ${topic2.topicKeyword})`);
		console.log(`  Use File-Level Tags Only: ${useFileLevelTagsOnly}`);

		// Track distinct headers (file path + header text + level) to count each header only once
		const countedHeaders = new Set<string>();

		for (const record of parsedFiles) {
			// For primary×primary, use file-level tags only. For primary×secondary, use all tags
			const fileTags = useFileLevelTagsOnly ? this.getFileLevelTags(record) : this.getRecordTags(record);

			// Check if topics are on file level
			const topic1InFile = topic1.topicTag && fileTags.includes(topic1.topicTag);
			const topic2InFile = topic2.topicTag && fileTags.includes(topic2.topicTag);

			// Count matching headers
			for (const entry of record.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text || header.keywords || header.inlineKeywords) {
						// Check if topic1 is in header (keyword OR tag, includes inline keywords)
						let topic1KeywordMatch = false;
						if (topic1.topicKeyword) {
							const headerKeywords = getAllKeywords(header);
							topic1KeywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === topic1.topicKeyword!.toLowerCase()
							);
						}
						const topic1TagMatch = topic1.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === topic1.topicTag;
						});
						const topic1InHeader = topic1KeywordMatch || topic1TagMatch;

						// Check if topic2 is in header (keyword OR tag, includes inline keywords)
						let topic2KeywordMatch = false;
						if (topic2.topicKeyword) {
							const headerKeywords = getAllKeywords(header);
							topic2KeywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === topic2.topicKeyword!.toLowerCase()
							);
						}
						const topic2TagMatch = topic2.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === topic2.topicTag;
						});
						const topic2InHeader = topic2KeywordMatch || topic2TagMatch;

						// Apply the intersection rule: one in header + other on file
						const validCase1 = topic1InHeader && topic2InFile;
						const validCase2 = topic2InHeader && topic1InFile;

						if (validCase1 || validCase2) {
							// Only count this header once (use file path + level + text as unique key)
							const headerKey = `${record.filePath}::${headerLevel!.level}::${header.text}`;
							console.log(`  ✓ COUNTED: ${headerKey}`);
							console.log(`    validCase1: ${validCase1}, validCase2: ${validCase2}`);
							console.log(`    File tags: ${fileTags.join(', ')}`);
							countedHeaders.add(headerKey);
						}
					}
				}
			}
		}

		console.log(`[COUNT HEADERS] TOTAL COUNT: ${countedHeaders.size}`);
		return countedHeaders.size;
	}

	/**
	 * Transform filter expression to add OR operators between keywords
	 * Example: ".def .inc :boo W: #tag" → ".def OR .inc OR :boo W: #tag"
	 */
	private transformFilterExpression(expression: string): string {
		// Remove modifiers from ENTIRE expression first (before splitting on W:)
		expression = expression.replace(/\\[hast]/g, '').trim();

		// Extract SELECT and WHERE clauses
		const hasWhere = expression.includes('W:');
		let selectExpr = expression;
		let whereExpr = '';

		if (hasWhere) {
			const parts = expression.split(/W:/);
			selectExpr = parts[0].trim();
			whereExpr = parts[1]?.trim() || '';
		}

		// Parse SELECT expression to find individual filter terms
		const transformedItems: string[] = [];
		let i = 0;

		while (i < selectExpr.length) {
			const char = selectExpr[i];

			// Skip whitespace
			if (/\s/.test(char)) {
				i++;
				continue;
			}

			// Check for existing AND/OR operators - keep them
			if (selectExpr.substring(i).match(/^(AND|OR)\b/)) {
				const opMatch = selectExpr.substring(i).match(/^(AND|OR)\b/);
				if (opMatch) {
					transformedItems.push(opMatch[0]);
					i += opMatch[0].length;
					continue;
				}
			}

			// Parentheses - preserve as-is
			if (char === '(' || char === ')') {
				transformedItems.push(char);
				i++;
				continue;
			}

			// Negation
			if (char === '!' || char === '-') {
				const negation = char;
				i++;
				// Skip whitespace after negation
				while (i < selectExpr.length && /\s/.test(selectExpr[i])) {
					i++;
				}
				// Get the next term
				const term = this.extractNextTerm(selectExpr, i);
				if (term) {
					transformedItems.push(negation + term.value);
					i = term.endPos;
				}
				continue;
			}

			// Extract next term (keyword, tag, category, language, etc.)
			const term = this.extractNextTerm(selectExpr, i);
			if (term) {
				transformedItems.push(term.value);
				i = term.endPos;
			} else {
				i++;
			}
		}

		// Join items with OR if they don't already have operators between them
		let transformedSelect = '';
		for (let j = 0; j < transformedItems.length; j++) {
			const item = transformedItems[j];
			const nextItem = transformedItems[j + 1];

			transformedSelect += item;

			// Add OR between items if:
			// - Not the last item
			// - Current item is not an operator
			// - Next item is not an operator
			// - Current item is not an opening paren
			// - Next item is not a closing paren
			if (nextItem !== undefined &&
				item !== 'AND' && item !== 'OR' &&
				nextItem !== 'AND' && nextItem !== 'OR' &&
				item !== '(' && nextItem !== ')') {
				transformedSelect += ' OR ';
			} else if (nextItem !== undefined) {
				transformedSelect += ' ';
			}
		}

		// Reconstruct expression
		return whereExpr ? `${transformedSelect} W: ${whereExpr}` : transformedSelect;
	}

	/**
	 * Extract next filter term from expression (keyword, tag, category, language, etc.)
	 */
	private extractNextTerm(expr: string, startPos: number): { value: string; endPos: number } | null {
		let i = startPos;
		if (i >= expr.length) return null;

		const char = expr[i];

		// Keyword (.foo or .foo.bar)
		if (char === '.') {
			let value = '.';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_.-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Tag (#foo)
		if (char === '#') {
			let value = '#';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Category (:foo)
		if (char === ':') {
			let value = ':';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Language (`java)
		if (char === '`') {
			let value = '`';
			i++;
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// Path (/foo/bar)
		if (char === '/') {
			let value = '';
			while (i < expr.length && /[a-zA-Z0-9_\-\/.]/.test(expr[i])) {
				value += expr[i];
				i++;
			}
			return { value, endPos: i };
		}

		// File name (f"filename")
		if (char === 'f' && i + 1 < expr.length && expr[i + 1] === '"') {
			let value = 'f"';
			i += 2;
			while (i < expr.length && expr[i] !== '"') {
				value += expr[i];
				i++;
			}
			value += '"';
			i++;
			return { value, endPos: i };
		}

		// Quoted text ("plaintext")
		if (char === '"') {
			let value = '"';
			i++;
			while (i < expr.length && expr[i] !== '"') {
				value += expr[i];
				i++;
			}
			value += '"';
			i++;
			return { value, endPos: i };
		}

		// Bare keyword (no prefix) - treat as .keyword
		if (/[a-zA-Z0-9_]/.test(char)) {
			let bareWord = '';
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
				bareWord += expr[i];
				i++;
			}
			// Don't prefix AND/OR
			if (bareWord === 'AND' || bareWord === 'OR') {
				return { value: bareWord, endPos: i };
			}
			// Add . prefix for keywords
			return { value: '.' + bareWord, endPos: i };
		}

		return null;
	}

	/**
	 * UNIFIED METHOD: Evaluate filter expression and return matching entries
	 * SINGLE SOURCE OF TRUTH - used by both counting and displaying
	 *
	 * @param showAll - If true, ignore SELECT and return all entries matching WHERE clause
	 */
	private evaluateFilterExpression(
		parsedFiles: ParsedFile[],
		filterExpression: string,
		primaryTopic: Topic | null,
		subject?: Subject,
		includesSubjectTag: boolean = false,
		showAll: boolean = false
	): Array<{ entry: FlatEntry; file: ParsedFile }> {
		if (!filterExpression || !filterExpression.trim()) {
			return [];
		}

		// 1. Expand placeholders in expression (only if primaryTopic provided, otherwise already expanded)
		const expandedExpr = this.expandPlaceholders(filterExpression, primaryTopic, subject);

		// 2. Transform expression ONLY if it doesn't have explicit operators
		const hasExplicitOperators = /\b(AND|OR)\b/.test(expandedExpr);
		const transformedExpr = hasExplicitOperators
			? expandedExpr  // Already has operators - use as-is
			: this.transformFilterExpression(expandedExpr); // No operators - transform it

		// 3. Split on W: to separate SELECT and WHERE clauses
		const hasWhere = transformedExpr.includes('W:');
		let selectExpr = transformedExpr;
		let whereExpr = '';

		if (hasWhere) {
			const parts = transformedExpr.split(/W:/);
			selectExpr = parts[0].trim();
			whereExpr = parts[1]?.trim() || '';
		}

		// 4. Add subject tag to WHERE clause if this is a green cell (AND mode enabled)
		// ONLY add if the WHERE clause doesn't already contain it
		if (includesSubjectTag && subject?.mainTag) {
			const subjectTag = subject.mainTag.replace(/^#/, '');
			const normalizedTag = `#${subjectTag}`;

			if (whereExpr) {
				// Only add if not already present in WHERE clause
				if (!whereExpr.includes(normalizedTag)) {
					whereExpr = `${normalizedTag} AND (${whereExpr})`;
				}
			} else {
				// Create new WHERE clause with just the subject tag
				whereExpr = normalizedTag;
			}
		}


		// 5. Compile expressions
		let selectCompiled: import('../interfaces/FilterInterfaces').CompiledFilter;
		let whereCompiled: import('../interfaces/FilterInterfaces').CompiledFilter | null = null;

		try {
			selectCompiled = FilterParser.compile(selectExpr);
			if (whereExpr) {
				whereCompiled = FilterParser.compile(whereExpr);
			}
		} catch (error) {
			console.error(`[KHMatrixWidget] Failed to compile expression: ${transformedExpr}`, error);
			return [];
		}

		// 6. Evaluate and collect matching entries
		const matchingEntries: Array<{ entry: FlatEntry; file: ParsedFile }> = [];

		for (const file of parsedFiles) {
			for (const entry of file.entries) {
				// First apply WHERE clause (if present)
				if (whereCompiled) {
					if (!FilterParser.evaluateFlatEntry(whereCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, whereCompiled.modifiers)) {
						continue; // Doesn't match WHERE clause, skip
					}
				}

				// If showAll mode: return all entries that passed WHERE clause
				if (showAll && whereCompiled) {
					matchingEntries.push({ entry, file });
					continue;
				}

				// Then apply SELECT clause
				if (FilterParser.evaluateFlatEntry(selectCompiled.ast, entry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers)) {
					matchingEntries.push({ entry, file });
				}
			}
		}

		return matchingEntries;
	}

	/**
	 * Count records matching a filter expression
	 * Uses unified evaluation method
	 */
	private countRecordsWithExpression(
		parsedFiles: ParsedFile[],
		filterExpression: string,
		primaryTopic: Topic | null,
		subject?: Subject,
		includesSubjectTag: boolean = false
	): number {
		const matches = this.evaluateFilterExpression(parsedFiles, filterExpression, primaryTopic, subject, includesSubjectTag);
		return matches.length;
	}

	/**
	 * Expand placeholders in filter expression
	 * For secondary topics: use topic's own values (or subject's if no topic)
	 * For intersections: use primary topic's values
	 *
	 * New placeholder syntax:
	 * - $TAG → topicTag (e.g., #java)
	 * - $KEY → topicKeyword (e.g., .jav)
	 * - $BLOCK or $CODE → code block language (e.g., `java)
	 * - $TEXT → topicText (e.g., "java")
	 */
	private expandPlaceholders(expression: string, primaryTopic: Topic | null, subject?: Subject): string {
		if (!primaryTopic && !subject) {
			return expression;
		}

		let result = expression;

		// Expand $TAG with topicTag (or subject mainTag)
		const tagSource = primaryTopic?.topicTag || subject?.mainTag;
		if (tagSource) {
			// NORMALIZE: Strip leading # from tag if present (works regardless of storage format)
			const tagValue = tagSource.replace(/^#/, '');
			result = result.replace(/\$TAG/g, `#${tagValue}`);
		}

		// Expand $KEY with topicKeyword (or subject keyword)
		const keywordSource = primaryTopic?.topicKeyword || subject?.keyword;
		if (keywordSource) {
			result = result.replace(/\$KEY/g, `.${keywordSource}`);
		}

		// Expand $BLOCK and $CODE with topicText (language/code block)
		if (primaryTopic?.topicText) {
			result = result.replace(/\$BLOCK/g, `\`${primaryTopic.topicText}`);
			result = result.replace(/\$CODE/g, `\`${primaryTopic.topicText}`);
		}

		// Expand $TEXT with topicText
		if (primaryTopic?.topicText) {
			result = result.replace(/\$TEXT/g, `"${primaryTopic.topicText}"`);
		}

		return result;
	}

	/**
	 * Check if any records for a given cell context match the filter
	 */
	private cellMatchesFilter(
		parsedFiles: ParsedFile[],
		compiledFilter: ReturnType<typeof FilterParser.compile>,
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean
	): boolean {
		// Get tags for this cell context
		const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);

		// Filter records to those matching the cell's tags
		const matchingFiles = parsedFiles.filter(file => {
			const fileTags = this.getRecordTags(file);
			return tags.every(tag => fileTags.includes(tag));
		});

		// Check if any record matches the filter expression
		for (const record of matchingFiles) {
			if (fileHasMatch(record, compiledFilter)) {
				return true; // Found at least one match
			}
		}

		return false; // No matches found
	}

	/**
	 * Toggle filter modifier in expression
	 */
	private toggleFilterModifier(modifier: string, enable: boolean): void {
		if (enable) {
			// Add modifier if not present
			if (!this.widgetFilterExpression.includes(modifier)) {
				this.widgetFilterExpression = this.widgetFilterExpression.trim() + ' ' + modifier;
				this.widgetFilterExpression = this.widgetFilterExpression.trim();
			}
		} else {
			// Remove modifier
			this.widgetFilterExpression = this.widgetFilterExpression.replace(new RegExp('\\s*' + modifier.replace(/\\/g, '\\\\') + '\\s*', 'g'), ' ');
			this.widgetFilterExpression = this.widgetFilterExpression.trim();
		}
	}

	/**
	 * Sync button states from filter expression
	 * Detects modifiers in expression and activates corresponding buttons
	 */
	private syncButtonsFromExpression(): void {
		this.trimSubItems = this.widgetFilterExpression.includes('\\s');
		this.topRecordOnly = this.widgetFilterExpression.includes('\\t');
		this.showAll = this.widgetFilterExpression.includes('\\a');
		this.renderChipsAndFlags();
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
			this.render();
		};

		// ℹ️ Legend toggle
		const legendToggle = flagsGroup.createEl('button', {
			cls: 'kh-filter-toggle' + (this.showLegend ? ' kh-filter-toggle-active' : ''),
			text: 'ℹ️'
		});
		legendToggle.title = 'Toggle Legend: Show explanation of border and background colors';
		legendToggle.onclick = () => {
			this.showLegend = !this.showLegend;
			this.renderChipsAndFlags();
		};

		// Legend container (shown/hidden based on toggle)
		if (this.showLegend) {
			const legendContainer = chipsContainer.createDiv({ cls: 'kh-legend-container' });

			legendContainer.createEl('h4', {
				text: 'Legend',
				cls: 'kh-legend-title'
			});

			// White border explanation
			const whiteBorderItem = legendContainer.createDiv({ cls: 'kh-legend-item' });
			const whiteBorderSample = whiteBorderItem.createDiv({ cls: 'kh-legend-sample kh-legend-white-border' });
			whiteBorderSample.textContent = '⬜';
			const whiteDesc = whiteBorderItem.createDiv({ cls: 'kh-legend-description' });
			whiteDesc.createEl('strong', { text: 'White border (AND mode):' });
			whiteDesc.createEl('br');
			whiteDesc.appendText('Topic requires subject tag on files for F/H entries');

			// Red background explanation
			const redBgItem = legendContainer.createDiv({ cls: 'kh-legend-item' });
			const redBgSample = redBgItem.createDiv({ cls: 'kh-legend-sample kh-legend-red-bg' });
			redBgSample.textContent = '🔴';
			const redDesc = redBgItem.createDiv({ cls: 'kh-legend-description' });
			redDesc.createEl('strong', { text: 'Red background (F/H disabled):' });
			redDesc.createEl('br');
			redDesc.appendText('Only Record entries shown, no File/Header records');

		}

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

			chipEl.createEl('span', {
				cls: 'keyword-chip-label',
				text: chip.label
			});

			// Chip click handler
			chipEl.onclick = () => {
				chip.active = !chip.active;
				this.renderChipsAndFlags();
				this.render();
			};
		});
	}

	/**
	 * Check if a topic (or combination) has limited collection
	 * Limited collection means not all three flags (F/H/R) are enabled
	 */
	private hasLimitedCollection(secondaryTopic: Topic | null, primaryTopic: Topic | null): boolean {
		// For intersection: check if EITHER topic has limited collection
		if (secondaryTopic && primaryTopic) {
			const secondaryLimited = (secondaryTopic.fhDisabled) ||
			                        (secondaryTopic.fhDisabled) ||
			                        (false);
			const primaryLimited = (primaryTopic.fhDisabled) ||
			                      (primaryTopic.fhDisabled) ||
			                      (false);
			return secondaryLimited || primaryLimited;
		}
		// For single topic: check that topic's flags
		const topic = secondaryTopic || primaryTopic;
		if (topic) {
			return (topic.fhDisabled) ||
			       (topic.fhDisabled) ||
			       (false);
		}
		return false; // Subject cell has no limited collection
	}

}
