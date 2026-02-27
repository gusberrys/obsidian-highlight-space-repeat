import { App, ItemView, WorkspaceLeaf, Menu, MarkdownRenderer, Modal, Setting, MarkdownView, Notice, TFile } from 'obsidian';
import { subjectsStore, saveSubjects, settingsDataStore } from '../stores/settings-store';
import { get } from 'svelte/store';
import { Subject } from '../interfaces/Subject';
import { Topic } from '../interfaces/Topic';
import type { SubjectsData } from '../shared';
import { SubjectModal } from '../settings/SubjectModal';
import type { ParsedRecord, RecordHeader, RecordEntry } from '../interfaces/ParsedRecord';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { FilterParser } from '../services/FilterParser';
import type { FilterMatchContext } from '../interfaces/FilterInterfaces';
import { KHEntry } from '../components/KHEntry';
import type { ActiveChip } from '../interfaces/ActiveChip';
import { KeywordType, getKeywordType } from '../shared/keyword-style';
import { MainCombinePriority } from '../shared/combine-priority';
import type { KeywordStyle } from '../shared/keyword-style';
import { SubjectDashboardView, SUBJECT_DASHBOARD_VIEW_TYPE } from './SubjectDashboardView';
import { resolveIconKeywordNames } from '../shared/priority-resolver';

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
			this.topics = data.topics || [];

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
			} else {
				container.createEl('p', {
					text: 'No subjects available',
					cls: 'kh-empty-message'
				});
			}

			// Show filter results if filter is active
			if (this.widgetFilterType && this.widgetFilterExpression && this.widgetFilterContext) {
				await this.renderWidgetFilter(container);
			}
		} finally {
			this.isRendering = false;
		}
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'kh-matrix-widget-header' });

		// Filter input (always visible at top)
		const filterDiv = header.createDiv({ cls: 'kh-widget-filter-input' });

		const modeSelect = filterDiv.createEl('select', {
			cls: 'kh-widget-filter-mode-select'
		});

		['F', 'H', 'R'].forEach(mode => {
			const option = modeSelect.createEl('option', {
				value: mode,
				text: mode + ':'
			});
			if (this.widgetFilterType === mode) {
				option.selected = true;
			}
		});

		modeSelect.addEventListener('change', (e) => {
			this.widgetFilterType = (e.target as HTMLSelectElement).value as 'F' | 'H' | 'R';
			this.render();
		});

		const input = filterDiv.createEl('input', {
			type: 'text',
			cls: 'kh-widget-filter-expression',
			value: this.widgetFilterExpression || ''
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

		// Controls container
		const controlsDiv = header.createDiv({ cls: 'kh-matrix-controls' });

		// Subject selector (without label)
		if (this.subjects.length > 0) {
			const selectorDiv = controlsDiv.createDiv({ cls: 'kh-subject-selector' });

			// Button with current subject icon
			const subjectBtn = selectorDiv.createEl('button', {
				text: this.currentSubject ? (this.currentSubject.icon || '📁') : '📁',
				cls: 'kh-subject-icon-btn',
				title: this.currentSubject ? `Open ${this.currentSubject.name} dashboard` : 'Select a subject'
			});
			subjectBtn.addEventListener('click', async () => {
				await this.openSubjectDashboard();
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

		// Buttons container
		const buttonsDiv = controlsDiv.createDiv({ cls: 'kh-matrix-buttons' });

		// Edit button
		const editBtn = buttonsDiv.createEl('button', {
			text: '✏️',
			cls: 'kh-matrix-icon-btn',
			title: 'Edit subject'
		});
		editBtn.addEventListener('click', () => {
			this.openSubjectEditor();
		});

		// Scan button
		const scanBtn = buttonsDiv.createEl('button', {
			text: '🔎',
			cls: 'kh-matrix-icon-btn',
			title: 'Scan file counts'
		});
		scanBtn.addEventListener('click', async () => {
			await this.scanMatrix();
		});

		// SRS Review button with due card count tooltip
		const srsBtn = buttonsDiv.createEl('button', {
			text: '🧠',
			cls: 'kh-matrix-icon-btn kh-srs-btn',
			title: 'Loading...'
		});

		// Update tooltip with due card count
		this.updateSRSButtonTooltip(srsBtn);

		srsBtn.addEventListener('click', async () => {
			await this.startSRSReview();
		});

	}

	private async renderMatrix(container: HTMLElement): Promise<void> {
		if (!this.currentSubject) return;

		const primaryTopics = this.topics.filter(t => t.subjectId === this.currentSubject!.id && t.type === 'primary');
		const secondaryTopics = this.topics.filter(t => t.subjectId === this.currentSubject!.id && t.type === 'secondary');

		if (primaryTopics.length === 0 && secondaryTopics.length === 0) {
			container.createEl('p', {
				text: 'No topics available for this subject',
				cls: 'kh-empty-message'
			});
			return;
		}

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

		// Add orphan files count in white text (files with ONLY subject tag, no topic tags)
		const orphanCount = await this.countOrphanFiles();
		if (orphanCount > 0) {
			const countsDiv = cell1x1.querySelector('.kh-matrix-counts') || cell1x1.createDiv({ cls: 'kh-matrix-counts' });
			const orphanSpan = countsDiv.createEl('span', {
				cls: 'kh-count-orphan',
				text: `(${orphanCount})`
			});
			orphanSpan.style.color = 'white';
			orphanSpan.style.cursor = 'pointer';
			orphanSpan.title = `${orphanCount} orphan files (only #${this.currentSubject.mainTag}, no topic tags). Click to view.`;

			// Click handler to show orphan files
			orphanSpan.addEventListener('click', async (e) => {
				e.stopPropagation();
				const orphanFiles = await this.getOrphanFiles();
				await this.renderOrphanFiles(orphanFiles);
			});
		}

		// Cells 1x2, 1x3, ...: Secondary topics
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });

			const cellData = this.currentSubject!.matrix?.cells[cellKey];
			const andMode = cellData?.andMode || false;

			if (andMode) {
				cell.classList.add('kh-matrix-and-mode');
			}

			// Check for limited collection (blue)
			if (this.hasLimitedCollection(topic, null)) {
				cell.classList.add('kh-matrix-limited-collection');
			}

			let displayText = topic.icon || '🔗';
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
		});

		// Data rows
		const tbody = table.createEl('tbody');

		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const row = tbody.createEl('tr');
			const rowNum = rowIndex + 2;

			// Cell 2x1, 3x1, ...: Primary topics
			const cellKey = `${rowNum}x1`;
			const rowHeaderCell = row.createEl('th', { cls: 'kh-matrix-cell kh-matrix-row-header-cell' });

			const cellData = this.currentSubject!.matrix?.cells[cellKey];
			const andMode = cellData?.andMode || false;

			if (andMode) {
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

			// Intersection cells: 2x2, 2x3, 3x2, 3x3, ...
			secondaryTopics.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;
				const cell = row.createEl('td', { cls: 'kh-matrix-cell kh-matrix-data-cell' });

				const cellData = this.currentSubject!.matrix?.cells[intersectionKey];

				// Use the cell's OWN andMode property for per-cell control
				const includesSubjectTag = cellData?.andMode || false;

				if (includesSubjectTag) {
					cell.classList.add('kh-matrix-and-mode');
				}

				// Check for limited collection (blue)
				if (this.hasLimitedCollection(secondaryTopic, primaryTopic)) {
					cell.classList.add('kh-matrix-limited-collection');
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
				const tooltipText = `${primaryTopic.name} × ${secondaryTopic.name}\nOption+Click to toggle AND mode${expressionsText}`;
				cell.setAttribute('title', tooltipText);
				cell.style.cursor = 'pointer';

				// Click handler: Option+Click toggles AND mode for this specific cell
				cell.addEventListener('click', (e) => {
					if (e.altKey) {
						// Option key pressed - toggle AND mode
						e.stopPropagation();
						this.toggleCellAndMode(intersectionKey);
					}
					// Regular click does nothing (counts handle their own clicks)
				});

				// Add counts if available
				if (cellData?.fileCount !== undefined) {
					this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
						cellData.recordCount || 0, this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag, tooltipText);
				}
			});
		});
	}

	/**
	 * Render widget filter component - just shows results, no duplicate controls
	 */
	private async renderWidgetFilter(container: HTMLElement): Promise<void> {
		if (!this.widgetFilterType || !this.widgetFilterExpression) {
			return; // Don't show filter if not active
		}

		const filterSection = container.createDiv({ cls: 'kh-widget-filter' });

		// Just show results directly - no duplicate header or input
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

		if (!this.widgetFilterContext || !this.widgetFilterExpression) {
			return;
		}

		const parsedRecords = await this.loadParsedRecords();

		if (this.widgetFilterType === 'F') {
			// File filter - show files matching tags
			await this.renderFileFilterResults(resultsContainer, parsedRecords);
		} else if (this.widgetFilterType === 'H') {
			// Header filter - show headers matching keyword/tag
			await this.renderHeaderFilterResults(resultsContainer, parsedRecords);
		} else if (this.widgetFilterType === 'R') {
			// Record filter - show records matching expression
			await this.renderRecordFilterResults(resultsContainer, parsedRecords);
		}
	}

	/**
	 * Render file filter results
	 */
	private async renderFileFilterResults(container: HTMLElement, parsedRecords: ParsedRecord[]): Promise<void> {
		if (!this.widgetFilterContext) return;

		const { subject, secondaryTopic, primaryTopic, includesSubjectTag } = this.widgetFilterContext;
		const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
		const matchingRecords = parsedRecords.filter(record => {
			const fileTags = this.getRecordTags(record);
			return tags.every(tag => fileTags.includes(tag));
		});

		if (matchingRecords.length === 0) {
			container.createEl('div', {
				text: 'No files found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		matchingRecords.forEach(record => {
			const fileItem = container.createDiv({ cls: 'kh-widget-filter-item' });
			fileItem.createEl('span', {
				text: record.fileName,
				cls: 'kh-widget-filter-item-name'
			});
			fileItem.addEventListener('click', () => {
				const file = this.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					this.app.workspace.getLeaf().openFile(file as any);
				}
			});
		});
	}

	/**
	 * Render header filter results with expandable entries
	 * Uses EXACT same matching logic as counting functions
	 * FIXED: For single topics, check ALL files - headers have independent tags/keywords
	 */
	private async renderHeaderFilterResults(container: HTMLElement, parsedRecords: ParsedRecord[]): Promise<void> {
		if (!this.widgetFilterContext) return;

		const { subject, secondaryTopic, primaryTopic, includesSubjectTag } = this.widgetFilterContext;
		const headers: { record: ParsedRecord; header: RecordHeader }[] = [];

		// Collect matching headers using EXACT same logic as counting
		if (secondaryTopic && primaryTopic) {
			// Intersection logic: secondary in header, primary in file
			// Only for intersections do we filter by file tags first
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
			const matchingRecords = parsedRecords.filter(record => {
				const fileTags = this.getRecordTags(record);
				return tags.every(tag => fileTags.includes(tag));
			});

			for (const record of matchingRecords) {
				const fileTags = this.getRecordTags(record);

				// Primary topic must be in FILE
				const primaryInFile = primaryTopic.topicTag && fileTags.includes(primaryTopic.topicTag);
				if (!primaryInFile) continue;

				const checkHeaders = (headerList: RecordHeader[]) => {
					for (const header of headerList) {
						if (header.text) {
							// Secondary topic must be in HEADER (keyword OR tag)
							let secondaryKeywordMatch = false;
							if (secondaryTopic.topicKeyword && header.keywords) {
								secondaryKeywordMatch = header.keywords.some(kw =>
									kw.toLowerCase() === secondaryTopic.topicKeyword!.toLowerCase()
								);
							}

							const secondaryTagMatch = secondaryTopic.topicTag && header.tags.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === secondaryTopic.topicTag;
							});

							const secondaryInHeader = secondaryKeywordMatch || secondaryTagMatch;

							if (secondaryInHeader) {
								headers.push({ record, header });
							}
						}

						if (header.children) {
							checkHeaders(header.children);
						}
					}
				};

				checkHeaders(record.headers);
			}
		} else {
			// Single topic logic: keyword OR tag in header
			// FIXED: Check ALL files - headers have independent tags/keywords
			const topic = secondaryTopic || primaryTopic;
			if (topic) {
				for (const record of parsedRecords) {
					const checkHeaders = (headerList: RecordHeader[]) => {
						for (const header of headerList) {
							if (header.text) {
								// Check if topic keyword is in header.keywords array
								let keywordMatch = false;
								if (topic.topicKeyword && header.keywords) {
									keywordMatch = header.keywords.some(kw =>
										kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
									);
								}

								// Check if header tags include the topic tag
								const tagMatch = topic.topicTag && header.tags.some(tag => {
									const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
									return normalizedTag === topic.topicTag;
								});

								if (keywordMatch || tagMatch) {
									headers.push({ record, header });
								}
							}

							if (header.children) {
								checkHeaders(header.children);
							}
						}
					};

					checkHeaders(record.headers);
				}
			}
		}

		if (headers.length === 0) {
			container.createEl('div', {
				text: 'No headers found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		for (const { record, header } of headers) {
			// Create unique ID for this header
			const headerId = `${record.filePath}:${header.level}:${header.text}`;
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

			// Filename (truncated)
			headerContent.createEl('span', {
				text: truncateFileName(record.fileName),
				cls: 'kh-header-filename'
			}).style.fontWeight = 'bold';

			// Separator
			if (header.keywords && header.keywords.length > 0) {
				headerContent.createEl('span', { text: '::' }).style.opacity = '0.5';

				// Render keyword icons
				header.keywords.forEach((kw, idx) => {
					const mark = headerContent.createEl('mark', { cls: `kh-icon ${kw}` });
					mark.innerHTML = '&nbsp;';
					if (header.keywords && idx < header.keywords.length - 1) {
						headerContent.createEl('span', { text: ' ' });
					}
				});

				headerContent.createEl('span', { text: '::' }).style.opacity = '0.5';
			}

			// Header text
			headerContent.createEl('span', {
				text: header.text || '',
				cls: 'kh-header-text'
			});

			// Tags
			if (header.tags && header.tags.length > 0) {
				header.tags.forEach(tag => {
					const tagEl = headerContent.createEl('span', {
						text: tag.startsWith('#') ? tag : '#' + tag,
						cls: 'kh-header-tag'
					});
					tagEl.style.color = 'var(--text-accent)';
					tagEl.style.marginLeft = '4px';
					tagEl.style.fontSize = '0.9em';
				});
			}

			headerContent.addEventListener('click', () => {
				const file = this.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					// Try to find line number from cache
					const cache = this.app.metadataCache.getFileCache(file as any);
					let lineNumber: number | undefined;
					if (cache && cache.headings) {
						const cacheHeading = cache.headings.find(h => {
							return h.level === header.level && h.heading.toLowerCase().includes(header.text!.toLowerCase());
						});
						if (cacheHeading) {
							lineNumber = cacheHeading.position.start.line;
						}
					}

					if (lineNumber !== undefined) {
						this.app.workspace.openLinkText('', record.filePath, false, {
							eState: { line: lineNumber }
						});
					} else {
						this.app.workspace.getLeaf().openFile(file as any);
					}
				}
			});

			// Show entries if expanded
			if (isExpanded && header.entries && header.entries.length > 0) {
				const entriesContainer = headerGroup.createDiv({ cls: 'kh-widget-filter-entries' });

				for (const entry of header.entries) {
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
							record,
							this.plugin,
							true // compact mode for matrix
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const file = this.app.vault.getAbstractFileByPath(record.filePath);
							if (file && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(file as any, {
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
							record.filePath,
							this
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const file = this.app.vault.getAbstractFileByPath(record.filePath);
							if (file && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(file as any, {
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
	private async renderRecordFilterResults(container: HTMLElement, parsedRecords: ParsedRecord[]): Promise<void> {
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

			const matchingRecords: { entry: RecordEntry; record: ParsedRecord }[] = [];

			for (const parsedRecord of parsedRecords) {
				const results = this.parsedRecordToContexts(parsedRecord);
				for (const { context, entry, record } of results) {
					// First apply WHERE clause (if present)
					if (whereCompiled) {
						const whereMatches = FilterParser.evaluate(whereCompiled.ast, context, whereCompiled.modifiers);
						if (!whereMatches) {
							continue; // Doesn't match WHERE clause, skip
						}
					}

					// If showAll is active, ignore SELECT clause and show all matching WHERE
					if (this.showAll && whereCompiled) {
						matchingRecords.push({ entry, record });
						continue;
					}

					// Then apply SELECT clause
					if (FilterParser.evaluate(selectCompiled.ast, context, selectCompiled.modifiers)) {
						matchingRecords.push({ entry, record });
					}
				}
			}

			if (matchingRecords.length === 0) {
				container.createEl('div', {
					text: 'No records found',
					cls: 'kh-widget-filter-empty'
				});
				return;
			}

			// No limit on results - show all matching entries
			let limitedRecords = matchingRecords;

			// Apply topRecordOnly filter if enabled - remove records where match is only in sub-items
			if (this.topRecordOnly && this.widgetFilterExpression) {
				limitedRecords = limitedRecords.filter(({ entry, record }) => {
					// Keep codeblocks - they are always top-level entries
					if (entry.type === 'codeblock') {
						return true;
					}
					// For keyword entries, check if SELECT matches using ONLY top-level keywords
					// Build a context with only entry-level keywords (no subitems)
					const topLevelContext: FilterMatchContext = {
						filePath: record.filePath,
						fileName: record.fileName,
						tags: record.tags.map(tag => tag.startsWith('#') ? tag : '#' + tag),
						keywords: entry.keywords || [],
						code: entry.text || '',
						languages: [],
						auxiliaryKeywords: [],
						keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
					};
					// Re-evaluate SELECT clause with top-level keywords only
					return FilterParser.evaluate(selectCompiled.ast, topLevelContext, selectCompiled.modifiers);
				});
			}

			// Apply trim filter if enabled - filter sub-items to only those matching SELECT clause
			if (this.trimSubItems) {
				limitedRecords = limitedRecords.map(({ entry, record }) => {
					if (entry.subItems && entry.subItems.length > 0) {
						// Filter sub-items to only those matching the SELECT clause
						const filteredSubItems = entry.subItems.filter(subItem => {
							if (!subItem.keywords || subItem.keywords.length === 0) {
								return false;
							}
							// Build context for this subitem
							const subItemContext: FilterMatchContext = {
								filePath: record.filePath,
								fileName: record.fileName,
								tags: record.tags.map(tag => tag.startsWith('#') ? tag : '#' + tag),
								keywords: subItem.keywords,
								code: subItem.content || '',
								languages: [],
								auxiliaryKeywords: [],
								keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
							};
							// Check if this subitem matches the SELECT clause
							return FilterParser.evaluate(selectCompiled.ast, subItemContext, selectCompiled.modifiers);
						});

						return {
							entry: { ...entry, subItems: filteredSubItems },
							record
						};
					}
					return { entry, record };
				});
			}

			// Group records by file
			const recordsByFile = new Map<string, Array<{ entry: RecordEntry; record: ParsedRecord }>>();
			limitedRecords.forEach(({ entry, record }) => {
				const filePath = record.filePath;
				if (!recordsByFile.has(filePath)) {
					recordsByFile.set(filePath, []);
				}
				recordsByFile.get(filePath)!.push({ entry, record });
			});

			// Render grouped by file
			for (const [filePath, entries] of recordsByFile) {
				// File header
				const fileGroup = container.createDiv({ cls: 'kh-widget-filter-file-group' });
				const fileHeader = fileGroup.createDiv({ cls: 'kh-widget-filter-file-header' });
				fileHeader.createEl('span', {
					text: entries[0].record.fileName,
					cls: 'kh-widget-filter-file-name'
				});
				fileHeader.createEl('span', {
					text: ` (${entries.length})`,
					cls: 'kh-widget-filter-file-count'
				});

				// Entries under this file - render in PARALLEL for performance
				const entriesContainer = fileGroup.createDiv({ cls: 'kh-widget-filter-entries' });

				// Render all entries in PARALLEL - NO async in map, return promises directly
				await Promise.all(entries.map(({ entry, record }) => {
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
							const file = this.app.vault.getAbstractFileByPath(record.filePath);
							if (file && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(file as any, {
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
							record,
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
							record.filePath,
							this
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const file = this.app.vault.getAbstractFileByPath(record.filePath);
							if (file && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(file as any, {
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
	private async renderOrphanFiles(orphanFiles: ParsedRecord[]): Promise<void> {
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
		orphanFiles.forEach(record => {
			const fileItem = resultsContainer.createDiv({ cls: 'kh-widget-filter-item' });
			fileItem.createEl('span', {
				text: record.fileName,
				cls: 'kh-widget-filter-item-name'
			});

			// Show file tags
			if (record.tags && record.tags.length > 0) {
				const tagsSpan = fileItem.createEl('span', {
					text: ` [${record.tags.join(', ')}]`,
					cls: 'kh-widget-filter-item-tags'
				});
				tagsSpan.style.fontSize = '0.85em';
				tagsSpan.style.color = '#888';
				tagsSpan.style.marginLeft = '8px';
			}

			fileItem.addEventListener('click', () => {
				const file = this.app.vault.getAbstractFileByPath(record.filePath);
				if (file) {
					this.app.workspace.getLeaf().openFile(file as any);
				}
			});
		});
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
				return (secondaryTopic.showFileRecords ?? true) && (primaryTopic.showFileRecords ?? true);
			} else if (secondaryTopic) {
				return secondaryTopic.showFileRecords ?? true;
			} else if (primaryTopic) {
				return primaryTopic.showFileRecords ?? true;
			}
			return true; // Subject cell (1x1) always shows
		})();

		const showHeaderRecords = (() => {
			if (secondaryTopic && primaryTopic) {
				return (secondaryTopic.showHeaderRecords ?? true) && (primaryTopic.showHeaderRecords ?? true);
			} else if (secondaryTopic) {
				return secondaryTopic.showHeaderRecords ?? true;
			} else if (primaryTopic) {
				return primaryTopic.showHeaderRecords ?? true;
			}
			return true; // Subject cell (1x1) always shows
		})();

		const showRecordRecords = (() => {
			if (secondaryTopic && primaryTopic) {
				return (secondaryTopic.showRecordRecords ?? true) && (primaryTopic.showRecordRecords ?? true);
			} else if (secondaryTopic) {
				return secondaryTopic.showRecordRecords ?? true;
			} else if (primaryTopic) {
				return primaryTopic.showRecordRecords ?? true;
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
					// Single topic cell
					const topic = secondaryTopic || primaryTopic;
					if (topic) {
						const parts = [];
						if (topic.topicKeyword) parts.push(`.${topic.topicKeyword}`);
						if (topic.topicTag) parts.push(topic.topicTag);
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

				if (secondaryTopic && primaryTopic) {
					// Intersection: use secondary's expression with primary's context
					topic = secondaryTopic;
					expansionContext = primaryTopic;
				} else if (secondaryTopic) {
					// Secondary topic only: use subject for expansion
					topic = secondaryTopic;
					expansionContext = null;
				} else if (primaryTopic) {
					// Primary topic only
					topic = primaryTopic;
					expansionContext = primaryTopic;
				}

				if (topic && topic.filterExpression) {
					this.widgetFilterType = 'R';
					let expr = topic.filterExpression;

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
		const parsedRecords = await this.loadParsedRecords();
		const matchingRecords = parsedRecords.filter(record => {
			const fileTags = this.getRecordTags(record);
			return tags.every(tag => fileTags.includes(tag));
		});

		// Show menu with file list
		const menu = new Menu();

		if (matchingRecords.length === 0) {
			menu.addItem((item) => {
				item.setTitle('No files found');
				item.setDisabled(true);
			});
		} else {
			matchingRecords.forEach(record => {
				menu.addItem((item) => {
					item.setTitle(record.fileName);
					item.setIcon('file');
					item.onClick(() => {
						const file = this.app.vault.getAbstractFileByPath(record.filePath);
						if (file) {
							this.app.workspace.getLeaf().openFile(file as any);
						}
					});
				});
			});
		}

		menu.showAtMouseEvent(event);
	}

	/**
	 * Show list of headers matching the criteria
	 * Uses EXACT same matching logic as counting - checks ParsedRecord headers
	 * FIXED: For single topics, check ALL files - headers have independent tags/keywords
	 */
	private async showHeaderList(
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean,
		event: MouseEvent
	): Promise<void> {
		const parsedRecords = await this.loadParsedRecords();
		const menu = new Menu();
		let hasHeaders = false;

		// For single topic - check ALL files
		if ((secondaryTopic && !primaryTopic) || (primaryTopic && !secondaryTopic)) {
			const topic = secondaryTopic || primaryTopic!;

			for (const record of parsedRecords) {
				// Get cache for LIVE line numbers
				const abstractFile = this.app.vault.getAbstractFileByPath(record.filePath);
				if (!abstractFile) continue;
				const file = abstractFile as any;
				const cache = this.app.metadataCache.getFileCache(file);

				// Use ParsedRecord headers with EXACT same logic as counting
				const checkHeaders = (headers: RecordHeader[]) => {
					headers.forEach(header => {
						if (header.text) {
							// Check if topic keyword is in header.keywords array (EXACT same as counting)
							let keywordMatch = false;
							if (topic.topicKeyword && header.keywords) {
								keywordMatch = header.keywords.some(kw =>
									kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
								);
							}

							// Check if header.tags array includes the topic tag (EXACT same as counting)
							const tagMatch = topic.topicTag && header.tags.some(tag => {
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
										if (h.level !== header.level) return false;

										// Match if cache heading contains our cleaned text
										// e.g., "kro :: salala #kroxy" contains "salala"
										return h.heading.toLowerCase().includes(header.text!.toLowerCase());
									});

									if (cacheHeading) {
										lineNumber = cacheHeading.position.start.line;
									}
								}

								menu.addItem((item) => {
									item.setTitle(`${record.fileName}: ${header.text}`);
									item.setIcon('heading');
									item.onClick(() => {
										if (lineNumber !== undefined) {
											// Use LIVE line number from cache
											this.app.workspace.openLinkText('', record.filePath, false, {
												eState: { line: lineNumber }
											});
										} else {
											// Fallback: just open the file
											this.app.workspace.openLinkText('', record.filePath, false);
										}
									});
								});
							}
						}

						// Recurse into children
						if (header.children) {
							checkHeaders(header.children);
						}
					});
				};

				checkHeaders(record.headers);
			}
		}
		// For intersection: NEW LOGIC - secondary in header, primary in file
		// For intersections, we DO need to filter by file tags first
		else if (secondaryTopic && primaryTopic) {
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
			const matchingRecords = parsedRecords.filter(record => {
				const fileTags = this.getRecordTags(record);
				return tags.every(tag => fileTags.includes(tag));
			});

			for (const record of matchingRecords) {
				const fileTags = this.getRecordTags(record);

				// Primary topic must be in FILE
				const primaryInFile = primaryTopic.topicTag && fileTags.includes(primaryTopic.topicTag);
				if (!primaryInFile) continue;

				// Get cache for line numbers
				const abstractFile = this.app.vault.getAbstractFileByPath(record.filePath);
				if (!abstractFile) continue;
				const file = abstractFile as any;
				const cache = this.app.metadataCache.getFileCache(file);

				// Use ParsedRecord headers with EXACT same logic as counting
				const checkHeaders = (headers: RecordHeader[]) => {
					headers.forEach(header => {
						if (header.text) {
							// Secondary topic must be in HEADER (keyword OR tag)
							let secondaryKeywordMatch = false;
							if (secondaryTopic.topicKeyword && header.keywords) {
								secondaryKeywordMatch = header.keywords.some(kw =>
									kw.toLowerCase() === secondaryTopic.topicKeyword!.toLowerCase()
								);
							}

							const secondaryTagMatch = secondaryTopic.topicTag && header.tags.some(tag => {
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
										if (h.level !== header.level) return false;

										// Match if cache heading contains our cleaned text
										// e.g., "kro :: salala #kroxy" contains "salala"
										return h.heading.toLowerCase().includes(header.text!.toLowerCase());
									});

									if (cacheHeading) {
										lineNumber = cacheHeading.position.start.line;
									}
								}

								menu.addItem((item) => {
									item.setTitle(`${record.fileName}: ${header.text}`);
									item.setIcon('heading');
									item.onClick(() => {
										if (lineNumber !== undefined) {
											// Use LIVE line number from cache
											this.app.workspace.openLinkText('', record.filePath, false, {
												eState: { line: lineNumber }
											});
										} else {
											// Fallback: just open the file
											this.app.workspace.openLinkText('', record.filePath, false);
										}
									});
								});
							}
						}

						// Recurse into children
						if (header.children) {
							checkHeaders(header.children);
						}
					});
				};

				checkHeaders(record.headers);
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
		// Determine which topic's filter expression to use
		let topic: Topic | null = null;
		let expansionContext: Topic | null = null;

		if (secondaryTopic && primaryTopic) {
			// Intersection: use secondary's expression with primary's context
			topic = secondaryTopic;
			expansionContext = primaryTopic;
		} else if (secondaryTopic) {
			// Secondary topic only: use subject for placeholder expansion
			topic = secondaryTopic;
			expansionContext = null;
		} else if (primaryTopic) {
			// Primary topic only: use its own expression and context
			topic = primaryTopic;
			expansionContext = primaryTopic;
		}

		if (!topic || !topic.filterExpression) {
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle('No filter expression defined');
				item.setDisabled(true);
			});
			menu.showAtMouseEvent(event);
			return;
		}

		// Load parsed records
		const parsedRecords = await this.loadParsedRecords();

		// Use countRecordsWithExpression helper to get matching records
		const expandedExpr = this.expandPlaceholders(topic.filterExpression, expansionContext, subject);

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
		const matchingRecords: { entry: RecordEntry; record: ParsedRecord }[] = [];
		for (const parsedRecord of parsedRecords) {
			const results = this.parsedRecordToContexts(parsedRecord);
			for (const { context, entry, record } of results) {
				if (FilterParser.evaluate(compiled.ast, context, compiled.modifiers)) {
					matchingRecords.push({ entry, record });
				}
			}
		}

		// Show menu with record list
		const menu = new Menu();

		if (matchingRecords.length === 0) {
			menu.addItem((item) => {
				item.setTitle('No records found');
				item.setDisabled(true);
			});
		} else {
			matchingRecords.forEach(({ entry, record }) => {
				menu.addItem((item) => {
					const displayText = entry.type === 'keyword'
						? (entry.keywords?.join(' :: ') + ' :: ' + entry.text)
						: (entry.language ? `\`${entry.language}\`` : 'code');
					item.setTitle(`${record.fileName}: ${displayText}`);
					item.setIcon('file-text');
					item.onClick(() => {
						const file = this.app.vault.getAbstractFileByPath(record.filePath);
						if (file) {
							this.app.workspace.getLeaf().openFile(file as any);
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
				return (secondaryTopic.showFileRecords ?? true) && (primaryTopic.showFileRecords ?? true);
			} else if (secondaryTopic) {
				return secondaryTopic.showFileRecords ?? true;
			} else if (primaryTopic) {
				return primaryTopic.showFileRecords ?? true;
			}
			return true; // Subject cell always shows
		})();

		const showH = (() => {
			if (secondaryTopic && primaryTopic) {
				return (secondaryTopic.showHeaderRecords ?? true) && (primaryTopic.showHeaderRecords ?? true);
			} else if (secondaryTopic) {
				return secondaryTopic.showHeaderRecords ?? true;
			} else if (primaryTopic) {
				return primaryTopic.showHeaderRecords ?? true;
			}
			return true; // Subject cell always shows
		})();

		const showR = (() => {
			if (secondaryTopic && primaryTopic) {
				return (secondaryTopic.showRecordRecords ?? true) && (primaryTopic.showRecordRecords ?? true);
			} else if (secondaryTopic) {
				return secondaryTopic.showRecordRecords ?? true;
			} else if (primaryTopic) {
				return primaryTopic.showRecordRecords ?? true;
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

		// R: Record filter (filterExpression with placeholders)
		let R: string | null = null;
		if (showR) {
			let topic: Topic | null = null;
			let expansionContext: Topic | null = null;

			if (secondaryTopic && primaryTopic) {
				// Intersection: use secondary's expression with primary's context
				topic = secondaryTopic;
				expansionContext = primaryTopic;
			} else if (secondaryTopic) {
				// Single secondary topic: use subject for placeholder expansion
				topic = secondaryTopic;
				expansionContext = null; // Will use subject instead
			} else if (primaryTopic) {
				topic = primaryTopic;
				expansionContext = primaryTopic;
			}

			if (topic && topic.filterExpression) {
				let expr = topic.filterExpression;

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
	 * Load parsed records from JSON file
	 */
	private async loadParsedRecords(): Promise<ParsedRecord[]> {
		const parsedRecordsPath = '.obsidian/plugins/highlight-space-repeat/app-data/parsed-records.json';
		const exists = await this.app.vault.adapter.exists(parsedRecordsPath);

		if (!exists) {
			console.warn('[KHMatrixWidget] No parsed records found. Please run scan in settings.');
			return [];
		}

		const jsonContent = await this.app.vault.adapter.read(parsedRecordsPath);
		return JSON.parse(jsonContent);
	}

	/**
	 * Get orphan files: files with ONLY subject tag and NO topic tags
	 * Excludes the subject file itself (e.g., "work.md" for subject "work")
	 */
	private async getOrphanFiles(): Promise<ParsedRecord[]> {
		if (!this.currentSubject || !this.currentSubject.mainTag) return [];

		const parsedRecords = await this.loadParsedRecords();
		const primaryTopics = this.topics.filter(t => t.subjectId === this.currentSubject!.id && t.type === 'primary');
		const secondaryTopics = this.topics.filter(t => t.subjectId === this.currentSubject!.id && t.type === 'secondary');

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
		return parsedRecords.filter(record => {
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
			const fileName = record.fileName.toLowerCase();
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

		const primaryTopics = this.topics.filter(t => t.subjectId === this.currentSubject!.id && t.type === 'primary');
		const secondaryTopics = this.topics.filter(t => t.subjectId === this.currentSubject!.id && t.type === 'secondary');

		// Trigger existing scan functionality from settings
		await this.plugin.triggerScan();

		// Load freshly parsed records
		const parsedRecords = await this.loadParsedRecords();

		// Initialize matrix if it doesn't exist
		if (!this.currentSubject.matrix) {
			this.currentSubject.matrix = { cells: {} };
		}

		// Scan subject cell (1x1)
		if (this.currentSubject.mainTag) {
			const cellKey1x1 = '1x1';
			const tags = [this.currentSubject.mainTag].filter(t => t);
			const fileCount = this.countFilesWithTags(parsedRecords, tags);

			if (!this.currentSubject.matrix.cells[cellKey1x1]) {
				this.currentSubject.matrix.cells[cellKey1x1] = {};
			}
			this.currentSubject.matrix.cells[cellKey1x1].fileCount = fileCount;
			this.currentSubject.matrix.cells[cellKey1x1].headerCount = 0;
		}

		// Scan secondary topic cells (1x2, 1x3, etc.)
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const andMode = this.currentSubject!.matrix?.cells[cellKey]?.andMode || false;
			const tags = this.getTagsForTopicCell(topic, andMode);

			const fileCount = this.countFilesWithTags(parsedRecords, tags);
			const headerCount = this.countHeadersForSingleTopic(parsedRecords, tags, topic);

			// For secondary topic cells, expand placeholders with subject's values
			let recordCount = 0;
			if (topic.filterExpression) {
				// Don't remove placeholders - pass subject to expand them
				recordCount = this.countRecordsWithExpression(parsedRecords, topic.filterExpression, null, this.currentSubject ?? undefined, andMode);
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
			const andMode = this.currentSubject!.matrix?.cells[cellKey]?.andMode || false;
			const tags = this.getTagsForTopicCell(topic, andMode);

			const fileCount = this.countFilesWithTags(parsedRecords, tags);
			const headerCount = this.countHeadersForSingleTopic(parsedRecords, tags, topic);

			// For single topic, remove ALL placeholders (#?, .?, `?) before counting
			let recordCount = 0;
			if (topic.filterExpression) {
				let expr = topic.filterExpression;
				// Remove #? and surrounding AND/OR operators
				expr = expr.replace(/\s*(AND|OR)\s*#\?/gi, '');
				expr = expr.replace(/#\?\s*(AND|OR)\s*/gi, '');
				expr = expr.replace(/#\?/g, '');
				// Remove .? and surrounding AND/OR operators
				expr = expr.replace(/\s*(AND|OR)\s*\.\?/gi, '');
				expr = expr.replace(/\.\?\s*(AND|OR)\s*/gi, '');
				expr = expr.replace(/\.\?/g, '');
				// Remove `? and surrounding AND/OR operators
				expr = expr.replace(/\s*(AND|OR)\s*`\?/gi, '');
				expr = expr.replace(/`\?\s*(AND|OR)\s*/gi, '');
				expr = expr.replace(/`\?/g, '');
				recordCount = this.countRecordsWithExpression(parsedRecords, expr, topic, this.currentSubject ?? undefined, andMode);
			}

			if (!this.currentSubject!.matrix!.cells[cellKey]) {
				this.currentSubject!.matrix!.cells[cellKey] = {};
			}
			this.currentSubject!.matrix!.cells[cellKey].fileCount = fileCount;
			this.currentSubject!.matrix!.cells[cellKey].headerCount = headerCount;
			this.currentSubject!.matrix!.cells[cellKey].recordCount = recordCount;
		});

		// Scan intersection cells (2x2, 2x3, 3x2, 3x3, etc.)
		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const rowNum = rowIndex + 2;

			secondaryTopics.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;

				// Use the cell's OWN andMode property for per-cell control
				const includesSubjectTag = this.currentSubject!.matrix!.cells[intersectionKey]?.andMode || false;

				// Get tags for this intersection
				const tags = this.getTags(this.currentSubject!, secondaryTopic, primaryTopic, includesSubjectTag);
				const fileCount = this.countFilesWithTags(parsedRecords, tags);
				const headerCount = this.countHeadersForIntersection(parsedRecords, tags, primaryTopic, secondaryTopic);
				// For intersections: use PRIMARY topic's values to expand SECONDARY topic's expression
				const recordCount = secondaryTopic.filterExpression
					? this.countRecordsWithExpression(parsedRecords, secondaryTopic.filterExpression, primaryTopic, this.currentSubject ?? undefined, includesSubjectTag)
					: 0;

				if (!this.currentSubject!.matrix!.cells[intersectionKey]) {
					this.currentSubject!.matrix!.cells[intersectionKey] = {};
				}
				this.currentSubject!.matrix!.cells[intersectionKey].fileCount = fileCount;
				this.currentSubject!.matrix!.cells[intersectionKey].headerCount = headerCount;
				this.currentSubject!.matrix!.cells[intersectionKey].recordCount = recordCount;
			});
		});

		// Update the store
		subjectsStore.update((data: SubjectsData) => {
			const index = data.subjects.findIndex(s => s.id === this.currentSubject!.id);
			if (index >= 0) {
				data.subjects[index] = this.currentSubject!;
			}
			return data;
		});

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
			const parsedRecords = await this.loadParsedRecords();
			const allCards = Object.values(this.plugin.srsManager.getDatabase().cards);
			let filteredCards = [];

			if (!filterExpr) {
				// Use subject filter if available
				if (this.currentSubject && this.currentSubject.mainTag) {
					const subjectTag = this.currentSubject.mainTag.replace(/^#/, '');
					for (const card of allCards) {
						const record = parsedRecords.find((r: any) => r.filePath === card.filePath);
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
				const matchingEntries = await this.getFilteredEntries(parsedRecords, filterExpr);

				// Get SRS cards for these specific entries
				for (const { entry, record } of matchingEntries) {
					if (entry.keywords && entry.keywords.length > 0) {
						for (const keyword of entry.keywords) {
							const cardId = `${record.filePath}::${entry.lineNumber}::${keyword}::${entry.type}`;
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
		const parsedRecords = await this.loadParsedRecords();

		// Get all SRS cards
		const allCards = Object.values(this.plugin.srsManager.getDatabase().cards);

		let filteredCards = [];

		if (!filterExpr) {
			// No filter active - use subject filter if available
			if (this.currentSubject && this.currentSubject.mainTag) {
				const subjectTag = this.currentSubject.mainTag.replace(/^#/, '');
				// Get all cards from files with this subject tag
				for (const card of allCards) {
					const record = parsedRecords.find((r: any) => r.filePath === card.filePath);
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
			const matchingEntries = await this.getFilteredEntries(parsedRecords, filterExpr);

			if (matchingEntries.length === 0) {
				new Notice('No matching entries found.');
				return;
			}

			// Now get SRS cards for these specific entries
			for (const { entry, record } of matchingEntries) {
				if (entry.keywords && entry.keywords.length > 0) {
					// For each keyword in the entry, check if there's an SRS card
					for (const keyword of entry.keywords) {
						const cardId = `${record.filePath}::${entry.lineNumber}::${keyword}::${entry.type}`;
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
		parsedRecords: ParsedRecord[],
		filterExpression: string
	): Promise<Array<{ entry: RecordEntry; record: ParsedRecord }>> {
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

			const matchingRecords: { entry: RecordEntry; record: ParsedRecord }[] = [];

			// Filter records (same logic as renderRecordFilterResults)
			for (const parsedRecord of parsedRecords) {
				const results = this.parsedRecordToContexts(parsedRecord);
				for (const { context, entry, record } of results) {
					// First apply WHERE clause (if present)
					if (whereCompiled) {
						const whereMatches = FilterParser.evaluate(whereCompiled.ast, context, whereCompiled.modifiers);
						if (!whereMatches) {
							continue;
						}
					}

					// If showAll is active, ignore SELECT clause and show all matching WHERE
					if (showAll && whereCompiled) {
						matchingRecords.push({ entry, record });
						continue;
					}

					// Then apply SELECT clause
					if (FilterParser.evaluate(selectCompiled.ast, context, selectCompiled.modifiers)) {
						matchingRecords.push({ entry, record });
					}
				}
			}

			let limitedRecords = matchingRecords;

			// Apply topRecordOnly filter if enabled (from flag OR button)
			if (topRecordOnly && filterExpression) {
				limitedRecords = limitedRecords.filter(({ entry, record }) => {
					if (entry.type === 'codeblock') {
						return true;
					}
					const topLevelContext: FilterMatchContext = {
						filePath: record.filePath,
						fileName: record.fileName,
						tags: record.tags.map(tag => tag.startsWith('#') ? tag : '#' + tag),
						keywords: entry.keywords || [],
						code: entry.text || '',
						languages: [],
						auxiliaryKeywords: [],
						keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
					};
					return FilterParser.evaluate(selectCompiled.ast, topLevelContext, selectCompiled.modifiers);
				});
			}

			// Apply trim filter if enabled (from flag OR button) - filter sub-items
			if (trimSubItems) {
				limitedRecords = limitedRecords.map(({ entry, record }) => {
					if (entry.subItems && entry.subItems.length > 0) {
						// Filter sub-items to only those matching the SELECT clause
						const filteredSubItems = entry.subItems.filter(subItem => {
							if (!subItem.keywords || subItem.keywords.length === 0) {
								return false;
							}
							// Build context for this subitem
							const subItemContext: FilterMatchContext = {
								filePath: record.filePath,
								fileName: record.fileName,
								tags: record.tags.map(tag => tag.startsWith('#') ? tag : '#' + tag),
								keywords: subItem.keywords,
								code: subItem.content || '',
								languages: [],
								auxiliaryKeywords: [],
								keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
							};
							// Check if this subitem matches the SELECT clause
							return FilterParser.evaluate(selectCompiled.ast, subItemContext, selectCompiled.modifiers);
						});

						return {
							entry: { ...entry, subItems: filteredSubItems },
							record
						};
					}
					return { entry, record };
				});
			}

			return limitedRecords;
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
	 * Get all tags from a parsed record (file-level tags + all header tags)
	 */
	private getRecordTags(record: ParsedRecord): string[] {
		const tags = new Set<string>();

		// Add file-level tags (ensure they have #)
		record.tags.forEach(tag => {
			tags.add(tag.startsWith('#') ? tag : '#' + tag);
		});

		// Recursively collect header tags
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
	 * Count parsed records that have ALL specified tags
	 */
	private countFilesWithTags(parsedRecords: ParsedRecord[], tags: string[]): number {
		if (tags.length === 0) return 0;

		return parsedRecords.filter(record => {
			const fileTags = this.getRecordTags(record);
			return tags.every(tag => fileTags.includes(tag));
		}).length;
	}

	/**
	 * Count headers for a single topic
	 * Header matches if: header contains keyword OR header has actual tag (with #)
	 * FIXED: Headers are checked across ALL files - we don't filter by file tags first
	 * because headers have their own tags/keywords independent of file-level tags
	 */
	private countHeadersForSingleTopic(parsedRecords: ParsedRecord[], requiredTags: string[], topic: Topic): number {
		// FIXED: Don't filter by file tags - headers have their own tags!
		// We check ALL files and only filter at the header level
		let count = 0;

		// Recursively count matching headers
		const countInHeaders = (headers: RecordHeader[], filePath?: string) => {
			for (const header of headers) {
				if (header.text) {
					// Check if topic keyword is in header.keywords array
					let keywordMatch = false;
					if (topic.topicKeyword && header.keywords) {
						keywordMatch = header.keywords.some(kw =>
							kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
						);
					}

					// Check if header tags include the topic tag
					const tagMatch = topic.topicTag && header.tags.some(tag => {
						const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
						return normalizedTag === topic.topicTag;
					});

					if (keywordMatch || tagMatch) {
						count++;
					}
				}

				// Recurse into children
				if (header.children) {
					countInHeaders(header.children, filePath);
				}
			}
		};

		// Check ALL files - don't pre-filter by file tags
		for (const record of parsedRecords) {
			countInHeaders(record.headers, record.filePath);
		}

		return count;
	}

	/**
	 * Count headers for intersection
	 * NEW LOGIC: Secondary topic at header level (keyword OR tag), primary topic at file level
	 * topic1 = primaryTopic (row), topic2 = secondaryTopic (column)
	 */
	private countHeadersForIntersection(parsedRecords: ParsedRecord[], requiredTags: string[], topic1: Topic, topic2: Topic): number {
		const matchingRecords = parsedRecords.filter(record => {
			const fileTags = this.getRecordTags(record);
			return requiredTags.every(tag => fileTags.includes(tag));
		});

		let count = 0;

		for (const record of matchingRecords) {
			const fileTags = this.getRecordTags(record);

			// Primary topic (topic1) must be in FILE
			const primaryInFile = topic1.topicTag && fileTags.includes(topic1.topicTag);
			if (!primaryInFile) continue;

			// Recursively count matching headers where secondary topic is in header
			const countInHeaders = (headers: RecordHeader[]) => {
				for (const header of headers) {
					if (header.text) {
						// Secondary topic (topic2) must be in HEADER (keyword OR tag)
						let secondaryKeywordMatch = false;
						if (topic2.topicKeyword && header.keywords) {
							secondaryKeywordMatch = header.keywords.some(kw =>
								kw.toLowerCase() === topic2.topicKeyword!.toLowerCase()
							);
						}

						const secondaryTagMatch = topic2.topicTag && header.tags.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === topic2.topicTag;
						});

						const secondaryInHeader = secondaryKeywordMatch || secondaryTagMatch;

						if (secondaryInHeader) {
							count++;
						}
					}

					// Recurse into children
					if (header.children) {
						countInHeaders(header.children);
					}
				}
			};

			countInHeaders(record.headers);
		}

		return count;
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
	 * Count records matching a filter expression
	 * Supports W: syntax for WHERE clause (file filtering)
	 */
	private countRecordsWithExpression(
		parsedRecords: ParsedRecord[],
		filterExpression: string,
		primaryTopic: Topic | null,
		subject?: Subject,
		includesSubjectTag: boolean = false
	): number {
		if (!filterExpression || !filterExpression.trim()) {
			return 0;
		}

		// Expand placeholders in expression
		const expandedExpr = this.expandPlaceholders(filterExpression, primaryTopic, subject);

		// Transform expression to add OR operators between keywords
		const transformedExpr = this.transformFilterExpression(expandedExpr);

		// Split on W: to separate SELECT and WHERE clauses
		const hasWhere = transformedExpr.includes('W:');
		let selectExpr = transformedExpr;
		let whereExpr = '';

		if (hasWhere) {
			const parts = transformedExpr.split(/W:/);
			selectExpr = parts[0].trim();
			whereExpr = parts[1]?.trim() || '';
		}

		// Add subject tag to WHERE clause if this is a green cell (AND mode enabled)
		if (includesSubjectTag && subject?.mainTag) {
			// Normalize: strip leading # if present, then add it back
			const subjectTag = subject.mainTag.replace(/^#/, '');
			if (whereExpr) {
				// Add to existing WHERE clause (wrap in parentheses for correct precedence)
				whereExpr = `#${subjectTag} AND (${whereExpr})`;
			} else {
				// Create new WHERE clause with just the subject tag
				whereExpr = `#${subjectTag}`;
			}
		}

		// Compile expressions
		let selectCompiled;
		let whereCompiled;

		try {
			selectCompiled = FilterParser.compile(selectExpr);
			if (whereExpr) {
				whereCompiled = FilterParser.compile(whereExpr);
			}
		} catch (error) {
			console.error(`[KHMatrixWidget] Failed to compile expression: ${transformedExpr}`, error);
			return 0;
		}

		// Convert ParsedRecords to FilterMatchContext and count matches
		let matchCount = 0;
		for (const parsedRecord of parsedRecords) {
			// Create contexts from this record (one context per entry/code block)
			const results = this.parsedRecordToContexts(parsedRecord);

			// Filter contexts
			for (const { context } of results) {
				// First apply WHERE clause (if present)
				if (whereCompiled) {
					if (!FilterParser.evaluate(whereCompiled.ast, context, whereCompiled.modifiers)) {
						continue; // Doesn't match WHERE clause, skip
					}
				}

				// Then apply SELECT clause
				if (FilterParser.evaluate(selectCompiled.ast, context, selectCompiled.modifiers)) {
					matchCount++;
				}
			}
		}

		return matchCount;
	}

	/**
	 * Expand placeholders in filter expression
	 * For secondary topics: use topic's own values (or subject's if no topic)
	 * For intersections: use primary topic's values
	 */
	private expandPlaceholders(expression: string, primaryTopic: Topic | null, subject?: Subject): string {
		if (!primaryTopic && !subject) {
			return expression;
		}

		let result = expression;

		// Expand #? with topicTag (or subject mainTag)
		const tagSource = primaryTopic?.topicTag || subject?.mainTag;
		if (tagSource) {
			// NORMALIZE: Strip leading # from tag if present (works regardless of storage format)
			const tagValue = tagSource.replace(/^#/, '');
			result = result.replace(/#\?/g, `#${tagValue}`);
		}

		// Expand .? with topicKeyword (or subject keyword)
		const keywordSource = primaryTopic?.topicKeyword || subject?.keyword;
		if (keywordSource) {
			result = result.replace(/\.\?/g, `.${keywordSource}`);
		}

		// Expand `? with topicText (only from topic, not subject)
		if (primaryTopic?.topicText) {
			result = result.replace(/`\?/g, `"${primaryTopic.topicText}"`);
		}

		return result;
	}

	/**
	 * Convert ParsedRecord to FilterMatchContext array
	 * Creates one context per keyword entry/code block
	 * Also returns the original entry for display purposes
	 */
	private parsedRecordToContexts(record: ParsedRecord): Array<{ context: FilterMatchContext; entry: RecordEntry; record: ParsedRecord }> {
		const results: Array<{ context: FilterMatchContext; entry: RecordEntry; record: ParsedRecord }> = [];

		// CRITICAL FIX: Collect ALL tags from the entire file (file-level + all headers)
		// Tags anywhere in the file should match the WHERE clause
		const allFileTags = new Set<string>();

		// Add file-level tags with # normalization
		record.tags.forEach(tag => {
			const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
			allFileTags.add(normalizedTag);
		});

		const collectAllTags = (headers: RecordHeader[]) => {
			for (const header of headers) {
				header.tags.forEach(tag => {
					const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
					allFileTags.add(normalizedTag);
				});
				if (header.children && header.children.length > 0) {
					collectAllTags(header.children);
				}
			}
		};
		collectAllTags(record.headers);

		const allFileTagsArray = Array.from(allFileTags);

		// Process entries within headers
		const processHeaders = (headers: RecordHeader[]) => {
			for (const header of headers) {
				// Process entries in this header
				if (header.entries && header.entries.length > 0) {
					for (const entry of header.entries) {
						// Collect keywords from entry and all subitems
						const allKeywords = [...(entry.keywords || [])];
						if (entry.subItems && entry.subItems.length > 0) {
							for (const subItem of entry.subItems) {
								if (subItem.keywords && subItem.keywords.length > 0) {
									allKeywords.push(...subItem.keywords);
								}
							}
						}

						const context: FilterMatchContext = {
							filePath: record.filePath,
							fileName: record.fileName,
							tags: allFileTagsArray,  // Use ALL tags from entire file
							keywords: allKeywords,  // Include keywords from entry and all subitems
							code: entry.text || '',
							languages: entry.type === 'codeblock' && entry.language ? [entry.language] : [],
							auxiliaryKeywords: [],
							keywordData: { categories: HighlightSpaceRepeatPlugin.settings.categories }
						};

						results.push({ context, entry, record });
					}
				}

				// Process children recursively
				if (header.children && header.children.length > 0) {
					processHeaders(header.children);
				}
			}
		};

		processHeaders(record.headers);

		return results;
	}

	/**
	 * Check if any records for a given cell context match the filter
	 */
	private cellMatchesFilter(
		parsedRecords: ParsedRecord[],
		compiledFilter: ReturnType<typeof FilterParser.compile>,
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean
	): boolean {
		// Get tags for this cell context
		const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);

		// Filter records to those matching the cell's tags
		const matchingRecords = parsedRecords.filter(record => {
			const fileTags = this.getRecordTags(record);
			return tags.every(tag => fileTags.includes(tag));
		});

		// Check if any record matches the filter expression
		for (const record of matchingRecords) {
			const contexts = this.parsedRecordToContexts(record);
			for (const { context } of contexts) {
				if (FilterParser.evaluate(compiledFilter.ast, context, compiledFilter.modifiers)) {
					return true; // Found at least one match
				}
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
	 * Toggle AND mode for a matrix cell and re-render
	 */
	private async toggleCellAndMode(cellKey: string): Promise<void> {
		if (!this.currentSubject || !this.currentSubject.matrix) return;

		if (!this.currentSubject.matrix.cells[cellKey]) {
			this.currentSubject.matrix.cells[cellKey] = {};
		}

		const cellData = this.currentSubject.matrix.cells[cellKey];
		cellData.andMode = !cellData.andMode;

		// Update the store
		subjectsStore.update((data: SubjectsData) => {
			const index = data.subjects.findIndex(s => s.id === this.currentSubject!.id);
			if (index >= 0) {
				data.subjects[index] = this.currentSubject!;
			}
			return data;
		});

		// Persist changes to disk
		await saveSubjects();

		// Re-render to show updated state
		this.render();
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
					this.widgetFilterType = 'R';
					this.widgetFilterExpression = filter.expression;
					this.widgetFilterContext = {
						subject: this.currentSubject!,
						secondaryTopic: null,
						primaryTopic: null,
						includesSubjectTag: false
					};
					this.render();
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
			const secondaryLimited = (secondaryTopic.showFileRecords === false) ||
			                        (secondaryTopic.showHeaderRecords === false) ||
			                        (secondaryTopic.showRecordRecords === false);
			const primaryLimited = (primaryTopic.showFileRecords === false) ||
			                      (primaryTopic.showHeaderRecords === false) ||
			                      (primaryTopic.showRecordRecords === false);
			return secondaryLimited || primaryLimited;
		}
		// For single topic: check that topic's flags
		const topic = secondaryTopic || primaryTopic;
		if (topic) {
			return (topic.showFileRecords === false) ||
			       (topic.showHeaderRecords === false) ||
			       (topic.showRecordRecords === false);
		}
		return false; // Subject cell has no limited collection
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
			private widget: KHMatrixWidget;
			private icon: string = '⭐';
			private expression: string = '';

			constructor(app: App, subject: Subject, plugin: HighlightSpaceRepeatPlugin, widget: KHMatrixWidget) {
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

		new FavoriteFilterModal(this.app, this.currentSubject, this.plugin, this).open();
	}
}
