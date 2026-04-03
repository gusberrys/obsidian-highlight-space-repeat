import { ItemView, WorkspaceLeaf, Menu, Notice, TFile } from 'obsidian';
import { DATA_PATHS } from '../shared/data-paths';
import { subjectsStore } from '../stores/settings-store';
import { Subject } from '../interfaces/Subject';
import { Topic } from '../interfaces/Topic';
import type { SubjectsData } from '../shared';
import { SubjectModal } from '../settings/SubjectModal';
import type { ParsedFile, ParsedEntry, FlatEntry } from '../interfaces/ParsedFile';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { FilterParser } from '../services/FilterParser';
import { FilterExpressionService } from '../services/FilterExpressionService';
import type { ActiveChip } from '../interfaces/ActiveChip';
import { MatrixCell, SubjectCell, PrimarySideCell, SecondaryHeaderCell, PrimarySecondaryCell, PrimaryPrimaryCell } from './cells';
import { MatrixRenderer } from './renderers/MatrixRenderer';
import { ColumnsRenderer } from './renderers/ColumnsRenderer';
import { RecordsRenderer } from './renderers/RecordsRenderer';
import { HeaderRenderer } from './renderers/HeaderRenderer';

export const KH_MATRIX_VIEW_TYPE = 'kh-matrix-view';

export class KHMatrixWidget extends ItemView {
	private currentSubject: Subject | null = null;
	private subjects: Subject[] = [];
	private plugin: HighlightSpaceRepeatPlugin;

	// Cell instances cache - reused across matrix counting, column rendering, and widget filter
	private cellInstances: Map<string, MatrixCell> = new Map();

	// Widget filter state
	private widgetFilterType: 'F' | 'H' | 'R' | 'D' | null = 'R'; // Default to Records
	private widgetFilterCell: MatrixCell | null = null; // Cell-based filter (from clicking F/H/R/D counts)
	private widgetFilterExpression: string = ''; // Manual text filter expression (from typing in text box)
	private widgetFilterText: string = ''; // Text filter for entries (file name, aliases, keywords, content)
	private widgetFileSearchText: string = ''; // File search input text (filters DOM and data)
	private collapsedFiles: Set<string> = new Set(); // Track collapsed file groups in widget filter
	private recordsRenderer: import('./renderers/RecordsRenderer').RecordsRenderer | null = null; // Reference to current records renderer

	// Track expanded headers (using unique header identifier)
	private expandedHeaders: Set<string> = new Set();

	// Prevent concurrent renders
	private isRendering: boolean = false;
	private pendingRender: boolean = false;

	// Chips and flags
	private activeChips: Map<string, ActiveChip> = new Map();
	private availableChips: { keywords: string[]; categories: string[]; codeblocks: string[] } = {
		keywords: [],
		categories: [],
		codeblocks: []
	};
	private activeChipIds: Set<string> = new Set(); // Track which chips are active
	private trimSubItems: boolean = false; // Filter sub-items to matching keywords only
	private topRecordOnly: boolean = false; // Only show records where keyword is top-level
	private showExpressions: boolean = true; // Show F/H/R filter expressions on cells
	private showLegend: boolean = false; // Show/hide legend explaining color meanings

	// Columns state (for displaying records in column view)
	// Stores which row is currently open: 'orphans' for subject, or primaryTopicId for primary topic
	private selectedRowId: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
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
			// Sync global subject
			HighlightSpaceRepeatPlugin.currentSubject = this.currentSubject;
			// Just recalculate matrix for new subject (don't trigger full rescan)
			await this.recalculateMatrixCounts();
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

			// Sync global subject
			HighlightSpaceRepeatPlugin.currentSubject = this.currentSubject;

			// Load dashboard filter on subject change
			this.loadDashboardFilterIntoExpression();

			this.render();
		});

		// Load dashboard filter on initial render
		if (this.subjects.length > 0 && !this.currentSubject) {
			this.currentSubject = this.subjects[0];
		}
		this.loadDashboardFilterIntoExpression();

		// Render initial state
		this.render();
	}

	async onClose(): Promise<void> {
		// Clean up
	}

	private async render(): Promise<void> {
		// Prevent concurrent renders
		if (this.isRendering) {
			console.log('[render] BLOCKED - already rendering, setting pendingRender flag');
			this.pendingRender = true;
			return;
		}
		console.log('[render] Starting render');
		this.isRendering = true;

		try {
			const container = this.containerEl.children[1] as HTMLElement;
			container.empty();
			container.addClass('kh-matrix-widget');

			// Update chips from dashboard filter
			this.updateChipsFromDashboardFilter();

			// Render header (chips/flags) - synchronous, fast
			this.renderMatrixHeader(container);

			// Create placeholder containers for matrix and records
			const matrixContainer = container.createDiv('kh-matrix-section');
			const recordsContainer = container.createDiv('kh-records-section');

			// Render matrix and records in parallel (independently)
			await Promise.all([
				this.renderMatrixSection(matrixContainer),
				this.renderRecordsSection(recordsContainer)
			]);
		} finally {
			console.log('[render] Completed render');
			this.isRendering = false;

			// If a render was requested while we were rendering, execute it now
			if (this.pendingRender) {
				console.log('[render] Executing pending render');
				this.pendingRender = false;
				this.render();
			}
		}
	}

	/**
	 * Render matrix section (table + columns)
	 */
	private async renderMatrixSection(container: HTMLElement): Promise<void> {
		console.log('[renderMatrixSection] Starting matrix render');

		// ========================================
		// MATRIX TABLE
		// ========================================
		if (this.currentSubject) {
			await this.renderMatrixTable(container);
		} else {
			container.createEl('p', {
				text: 'No subjects available',
				cls: 'kh-empty-message'
			});
		}

		// ========================================
		// COLUMNS (when row selected)
		// ========================================
		if (this.currentSubject && this.selectedRowId) {
			await this.renderMatrixColumns(container);
		}

		console.log('[renderMatrixSection] Completed matrix render');
	}

	/**
	 * Render records section (widget filter)
	 */
	private async renderRecordsSection(container: HTMLElement): Promise<void> {
		console.log('[renderRecordsSection] Starting records render');
		await this.renderWidgetFilter(container);
		console.log('[renderRecordsSection] Completed records render');
	}

	/**
	 * PART 1: Render matrix header (chips/flags only)
	 */
	private renderMatrixHeader(container: HTMLElement): void {
		const renderer = new HeaderRenderer(
			{
				activeChips: this.activeChips,
				trimSubItems: this.trimSubItems,
				topRecordOnly: this.topRecordOnly,
				showLegend: this.showLegend
			},
			{
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
				onLegendToggle: () => {
					this.showLegend = !this.showLegend;
					this.render();
				},
				onChipClick: (chipId: string) => {
					this.handleChipClick(chipId);
				}
			}
		);

		renderer.render(container);
	}


	/**
	 * PART 4: Render widget filter (individual records display with search)
	 */
	private async renderWidgetFilter(container: HTMLElement): Promise<void> {
		// Filter is always visible (static)

		const parsedRecords = this.getParsedRecords();

		this.recordsRenderer = new RecordsRenderer(
			this.app,
			this.plugin,
			parsedRecords,
			this.currentSubject,
			{
				filterType: this.widgetFilterType,
				filterCell: this.widgetFilterCell,
				filterExpression: this.widgetFilterExpression,
				filterText: this.widgetFilterText,
				fileSearchText: this.widgetFileSearchText
			},
			{
				activeChips: this.activeChips,
				trimSubItems: this.trimSubItems,
				topRecordOnly: this.topRecordOnly
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
					this.widgetFilterType = 'R'; // Default to Record filter
					this.widgetFilterCell = null; // Manual expression, not cell-based

					// Safety check
					if (!this.plugin?.settings) {
						this.render();
						return;
					}

					// Extract and create chips from expression
					const extracted = this.extractChipsFromFilterExpression(expression);
					this.activeChips.clear();

					// Add keyword chips
					extracted.keywords.forEach(kw => {
						const keywordStyle = this.plugin.settings.categories
							.flatMap(cat => cat.keywords)
							.find(k => k.keyword === kw.value);

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
						const category = this.plugin.settings.categories.find(c => c.id === cat.value);
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
					console.log(`[KHMatrixWidget] Filter type changed to: ${type}`);
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
				onToggleAllFiles: () => {
					if (this.widgetFilterType === 'H') {
						// Headers mode: expandedHeaders set (default collapsed)
						// If some are expanded, collapse all. Otherwise, expand all.
						if (this.expandedHeaders.size > 0) {
							// Collapse all - clear expanded headers
							this.expandedHeaders.clear();
						} else {
							// Expand all - collect all header IDs and add to expanded set
							if (this.widgetFilterCell) {
								const parsedRecords = this.getParsedRecords();
								const headerGroups = this.widgetFilterCell.collectHeaders(parsedRecords);

								for (const { file, headerText, headerLevel } of headerGroups.values()) {
									const headerId = `${file.filePath}:${headerLevel}:${headerText}`;
									this.expandedHeaders.add(headerId);
								}
							}
						}
					} else {
						// Files mode: collapsedFiles set (default expanded)
						// If all files are collapsed, unfold all. Otherwise, fold all.
						const parsedRecords = this.getParsedRecords();
						const allFilePaths = parsedRecords.map(f => f.filePath);
						const allCollapsed = allFilePaths.length > 0 && allFilePaths.every(path => this.collapsedFiles.has(path));

						if (allCollapsed) {
							// Unfold all - clear collapsed files
							this.collapsedFiles.clear();
						} else {
							// Fold all - add all files to collapsed
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
				onFileSearchChange: (searchText: string) => {
					console.log('[KHMatrixWidget] File search changed:', searchText);
					this.widgetFileSearchText = searchText;
					if (this.recordsRenderer) {
						this.recordsRenderer.applyFileSearchFilter(searchText);
					}
				}
			}
		);

		await this.recordsRenderer.render(container);
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

		const showR = true; // Record filter always available

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
					R = FilterExpressionService.expandPlaceholders(expr, expansionContext, subject);
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
					R = FilterExpressionService.expandPlaceholders(expr, expansionContext, subject);
				} else {
					// Intersection: expand with primary topic
					R = FilterExpressionService.expandPlaceholders(expr, expansionContext, subject);
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
	public openSubjectEditor(): void {
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
		// Load dashboard filter into expression input
		this.loadDashboardFilterIntoExpression();
		// Clear filter cell so expression-based filtering is used
		this.widgetFilterCell = null;
		// Full render to update everything including filtered records
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
		// Load dashboard filter into expression input
		this.loadDashboardFilterIntoExpression();
		// Clear filter cell so expression-based filtering is used
		this.widgetFilterCell = null;
		// Full render to update everything including filtered records
		this.render();
	}

	/**
	 * Re-render only columns and records sections (not the matrix table)
	 */
	private async renderColumnsAndRecords(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;

		// Remove existing columns and records sections
		const existingColumns = container.querySelector('.kh-matrix-columns');
		if (existingColumns) existingColumns.remove();

		const existingRecords = container.querySelector('.kh-widget-filter');
		if (existingRecords) existingRecords.remove();

		// Re-render columns if a row is selected
		if (this.currentSubject && this.selectedRowId) {
			await this.renderMatrixColumns(container);
		}

		// Re-render records (always visible, now includes chips)
		await this.renderWidgetFilter(container);
	}

	/**
	 * Re-render only the records section (not matrix or columns)
	 */
	private async renderRecordsOnly(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;

		// Find the records section container
		const recordsContainer = container.querySelector('.kh-records-section') as HTMLElement;
		if (!recordsContainer) {
			console.warn('[renderRecordsOnly] Records container not found');
			return;
		}

		// Clear and re-render records section
		recordsContainer.empty();
		await this.renderRecordsSection(recordsContainer);
	}

	/**
	 * PART 2: Render matrix table
	 */
	private async renderMatrixTable(container: HTMLElement): Promise<void> {
		if (!this.currentSubject) return;

		// Load parsed records for count calculations
		const parsedRecords = this.getParsedRecords();

		const renderer = new MatrixRenderer(
			this.currentSubject,
			this.subjects,
			this.cellInstances,
			parsedRecords,
			{
				onCellClick: (cellKey: string, cellType: 'subject' | 'primary' | 'secondary' | 'intersection', event: MouseEvent) => {
					if (cellType === 'subject') {
						this.toggleSubjectColumn();
					} else if (cellType === 'primary') {
						this.togglePrimaryColumn(cellKey);
					}
					// Secondary and intersection cells don't toggle columns (icon clicks only)
				},
				onCountClick: (type: 'F' | 'H' | 'R' | 'D', cellKey: string) => {
					const cellInstance = this.cellInstances.get(cellKey);
					if (!cellInstance) return;

					this.widgetFilterType = type;
					this.widgetFilterCell = cellInstance;
					this.renderRecordsOnly();
				},
				onSubjectChange: async (subjectId: string) => {
					console.log('[onSubjectChange] Switching to subject:', subjectId);
					this.currentSubject = this.subjects.find(s => s.id === subjectId) || null;
					console.log('[onSubjectChange] Current subject:', this.currentSubject?.name);
					// Sync global subject
					HighlightSpaceRepeatPlugin.currentSubject = this.currentSubject;
					// Load dashboard filter into expression
					this.loadDashboardFilterIntoExpression();
					console.log('[onSubjectChange] Filter expression:', this.widgetFilterExpression);
					console.log('[onSubjectChange] Active chips:', Array.from(this.activeChips.keys()));
					// Clear filter cell so expression-based filtering is used
					this.widgetFilterCell = null;
					if (this.currentSubject) {
						console.log('[onSubjectChange] Calling recalculateMatrixCounts');
						await this.recalculateMatrixCounts();
						console.log('[onSubjectChange] recalculateMatrixCounts done');
					} else {
						this.render();
					}
				},
				computeCellExpressions: this.computeCellExpressions.bind(this),
			}
		);

		renderer.render(container);
	}

	/**
	 * PART 3: Render matrix columns (dashboard columns for selected row)
	 */
	private async renderMatrixColumns(container: HTMLElement): Promise<void> {
		if (!this.selectedRowId || !this.currentSubject) return;

		// Load parsed records
		const parsedRecords = this.getParsedRecords();

		const renderer = new ColumnsRenderer(
			this.currentSubject,
			this.cellInstances,
			parsedRecords,
			this.selectedRowId,
			{
				onFileClick: async (filePath: string) => {
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) {
						await this.app.workspace.getLeaf(false).openFile(file);
					}
				},
				onCountClick: (type: 'F' | 'H' | 'R' | 'D', cellKey: string) => {
					const cellInstance = this.cellInstances.get(cellKey);
					if (!cellInstance) return;

					this.widgetFilterType = type;
					this.widgetFilterCell = cellInstance;
					this.renderRecordsOnly();
				}
			}
		);

		renderer.render(container);
	}

	/**
	 * Get parsed records from plugin RAM cache
	 */
	private getParsedRecords(): ParsedFile[] {
		return this.plugin.parsedRecords;
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
		const parsedFiles = this.getParsedRecords();

		// Clear and recreate cell instances
		this.cellInstances.clear();

		// Create and use SubjectCell for 1x1
		if (this.currentSubject.mainTag) {
			const cellKey = '1x1';
			const cell = new SubjectCell(
				this.currentSubject,
				this.getFileLevelTags.bind(this),
				this.getRecordTags.bind(this)
			);
			this.cellInstances.set(cellKey, cell);

			// Counts are cached in cell instance, no need to store in JSON
		}

		// Create and use SecondaryHeaderCell for 1x2, 1x3, etc.
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const cell = new SecondaryHeaderCell(
				this.currentSubject!,
				topic,
				this.getFileLevelTags.bind(this),
				this.getRecordTags.bind(this)
			);
			this.cellInstances.set(cellKey, cell);

			// Counts are cached in cell instance, no need to store in JSON
		});

		// Create and use PrimarySideCell for 2x1, 3x1, etc.
		primaryTopics.forEach((topic, index) => {
			const rowNum = index + 2;
			const cellKey = `${rowNum}x1`;
			const cell = new PrimarySideCell(
				this.currentSubject!,
				topic,
				this.getFileLevelTags.bind(this),
				this.getRecordTags.bind(this)
			);
			this.cellInstances.set(cellKey, cell);

			// Counts are cached in cell instance, no need to store in JSON
		});

		// Separate common vs specific secondary topics (SAME as rendering)
		const commonSecondaries = secondaryTopics.filter(t =>
			!t.primaryTopicIds || t.primaryTopicIds.length === 0
		);
		const specificSecondaries = secondaryTopics.filter(t =>
			t.primaryTopicIds && t.primaryTopicIds.length > 0
		);

		// Create and use PrimarySecondaryCell for intersection cells (2x2, 2x3, 3x2, 3x3, etc.)
		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const rowNum = rowIndex + 2;

			// Common secondaries (main table columns)
			commonSecondaries.forEach((secondaryTopic) => {
				// Use ORIGINAL index from full secondaryTopics array (same as rendering)
				const originalIndex = secondaryTopics.indexOf(secondaryTopic);
				const col = originalIndex + 2;
				const cellKey = `${rowNum}x${col}`;
				const cell = new PrimarySecondaryCell(
					this.currentSubject!,
					primaryTopic,
					secondaryTopic,
					this.getFileLevelTags.bind(this),
					this.getRecordTags.bind(this)
				);
				this.cellInstances.set(cellKey, cell);

				// Counts are cached in cell instance, no need to store in JSON
			});

			// Specific secondaries for this primary (dynamic columns)
			const primarySpecificSecondaries = specificSecondaries.filter(sec =>
				sec.primaryTopicIds?.includes(primaryTopic.id)
			);
			primarySpecificSecondaries.forEach((secondaryTopic) => {
				// Find the ORIGINAL index in the full secondaryTopics array for correct cell key
				const originalIndex = secondaryTopics.indexOf(secondaryTopic);
				const col = originalIndex + 2;
				const cellKey = `${rowNum}x${col}`;
				const cell = new PrimarySecondaryCell(
					this.currentSubject!,
					primaryTopic,
					secondaryTopic,
					this.getFileLevelTags.bind(this),
					this.getRecordTags.bind(this)
				);
				this.cellInstances.set(cellKey, cell);

				// Counts are cached in cell instance, no need to store in JSON
			});
		});

		// Create PRIMARY×PRIMARY intersection cells (for column view when a primary row is clicked)
		primaryTopics.forEach((clickedPrimary) => {
			primaryTopics.forEach((otherPrimary) => {
				// Skip self-intersection
				if (clickedPrimary.id === otherPrimary.id) return;

				// Skip if other primary has no tag (can't filter)
				if (!otherPrimary.topicTag) return;

				const cellKey = `PRIMARY:${clickedPrimary.id}:${otherPrimary.id}`;
				console.log(`[recalculateMatrixCounts] Creating PRIMARY×PRIMARY cell: ${clickedPrimary.name} × ${otherPrimary.name} (key: ${cellKey}, tags: ${clickedPrimary.topicTag} × ${otherPrimary.topicTag})`);
				const cell = new PrimaryPrimaryCell(
					this.currentSubject!,
					clickedPrimary,
					otherPrimary,
					this.getFileLevelTags.bind(this),
					this.getRecordTags.bind(this)
				);
				this.cellInstances.set(cellKey, cell);
			});
		});

		// Re-render to show counts
		this.render();
	}

	/**
	 * Update SRS button tooltip with due entry count
	 * IMPORTANT: Respects filter flags (\s trim, \t top-only, \a show-all)
	 */
	private async updateSRSButtonTooltip(button: HTMLElement): Promise<void> {
		try {
			const filterExpr = this.getCurrentFilterExpression();
			const parsedFiles = this.getParsedRecords();
			const allEntries = this.plugin.srsManager.getAllSRSEntries(parsedFiles);
			const dueEntries = this.plugin.srsManager.getDueEntries(parsedFiles);

			let filteredAllEntries = allEntries;
			let filteredDueEntries = dueEntries;

			if (!filterExpr) {
				// Use subject filter if available
				if (this.currentSubject && this.currentSubject.mainTag) {
					const subjectTag = this.currentSubject.mainTag.replace(/^#/, '');
					filteredAllEntries = allEntries.filter(({ file }) => {
						const fileTags = this.getRecordTags(file);
						return fileTags.includes(`#${subjectTag}`);
					});
					filteredDueEntries = dueEntries.filter(({ file }) => {
						const fileTags = this.getRecordTags(file);
						return fileTags.includes(`#${subjectTag}`);
					});
				}
			} else {
				// Use same filtering logic as startSRSReview
				const matchingEntries = await this.getFilteredEntries(parsedFiles, filterExpr);

				// Intersect with SRS entries
				filteredAllEntries = allEntries.filter(({ entry: srsEntry, file: srsFile }) =>
					matchingEntries.some(({ entry: matchEntry, file: matchFile }) =>
						matchEntry.lineNumber === srsEntry.lineNumber &&
						matchFile.filePath === srsFile.filePath
					)
				);

				filteredDueEntries = dueEntries.filter(({ entry: dueEntry, file: dueFile }) =>
					matchingEntries.some(({ entry: matchEntry, file: matchFile }) =>
						matchEntry.lineNumber === dueEntry.lineNumber &&
						matchFile.filePath === dueFile.filePath
					)
				);
			}

			if (filteredAllEntries.length === 0) {
				button.title = 'SRS Review: No entries with SRS data found';
				return;
			}

			if (filteredDueEntries.length === 0) {
				button.title = `SRS Review: No entries due today (${filteredAllEntries.length} total)`;
			} else {
				button.title = `SRS Review: ${filteredDueEntries.length} entries due for review (${filteredAllEntries.length} total)`;
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
	public async startSRSReview(): Promise<void> {
		console.log('[KHMatrixWidget] startSRSReview called');

		// Get currently displayed records from the RecordsRenderer
		if (!this.recordsRenderer) {
			new Notice('No records renderer available');
			return;
		}

		const displayedRecords = this.recordsRenderer.getCurrentlyDisplayedRecords();
		console.log('[SRS] Currently displayed records:', displayedRecords.length);

		// Get all due entries
		const parsedFiles = this.getParsedRecords();
		const dueEntries = this.plugin.srsManager.getDueEntries(parsedFiles);
		console.log('[SRS] Total due entries:', dueEntries.length);

		// Intersect: only due entries that are also currently displayed
		const displayedDueEntries = dueEntries.filter(({ entry: dueEntry, file: dueFile }) =>
			displayedRecords.some(
				({ entry: displayedEntry, file: displayedFile }) =>
					displayedEntry.lineNumber === dueEntry.lineNumber &&
					displayedFile.filePath === dueFile.filePath
			)
		);

		console.log('[SRS] Displayed due entries:', displayedDueEntries.length);

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

		new Notice(`Starting SRS review: ${displayedDueEntries.length} entries due`);
		await this.plugin.activateSRSReviewView(displayedDueEntries);
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

			// Use flags from expression OR from instance variables (buttons)
			const trimSubItems = hasTrimFlag || this.trimSubItems;
			const topRecordOnly = hasTopFlag || this.topRecordOnly;

			// Transform expression (same as renderRecordFilterResults)
			const hasExplicitOperators = /\b(AND|OR)\b/.test(filterExpression);
			const expr = hasExplicitOperators
				? filterExpression
				: FilterExpressionService.transformFilterExpression(filterExpression);

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
			// Check if filter cell is a PrimarySideCell or PrimarySecondaryCell with andMode
			let includesSubjectTag = false;
			if (this.widgetFilterCell) {
				// Check if it's a primary topic cell with andMode (green cell)
				const cellType = this.widgetFilterCell.constructor.name;
				if (cellType === 'PrimarySideCell' || cellType === 'PrimarySecondaryCell') {
					// Access the primaryTopic from the cell to check andMode
					const primaryTopic = (this.widgetFilterCell as any).primaryTopic;
					includesSubjectTag = primaryTopic?.andMode || false;
				}
			}

			if (includesSubjectTag && this.currentSubject?.mainTag) {
				const subjectTag = this.currentSubject.mainTag.replace(/^#/, '');
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
	}

	/**
	 * Extract keywords/categories/languages from SELECT clause of filter expression
	 * Returns objects with {value, mode} where mode is 'include' or 'exclude'
	 */
	private extractChipsFromFilterExpression(expression: string): { keywords: Array<{value: string, mode: 'include' | 'exclude'}>, categoryIds: Array<{value: string, mode: 'include' | 'exclude'}>, languages: Array<{value: string, mode: 'include' | 'exclude'}> } {
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

		// Remove modifiers from selectClause
		selectClause = selectClause.replace(/\\[sat]/g, '').trim();

		if (!selectClause) {
			return { keywords: [], categoryIds: [], languages: [] };
		}

		const keywords: Array<{value: string, mode: 'include' | 'exclude'}> = [];
		const categoryIds: Array<{value: string, mode: 'include' | 'exclude'}> = [];
		const languages: Array<{value: string, mode: 'include' | 'exclude'}> = [];

		// Split by space and OR to get individual tokens
		const tokens = selectClause.split(/\s+/).filter(t => t.length > 0 && t !== 'OR' && t !== 'AND');

		for (const token of tokens) {
			// Detect exclude mode (starts with _)
			const isExclude = token.startsWith('_');
			const cleanToken = isExclude ? token.substring(1) : token;
			const mode: 'include' | 'exclude' = isExclude ? 'exclude' : 'include';

			// Category syntax: :category-id or _:category-id
			if (cleanToken.startsWith(':')) {
				const categoryId = cleanToken.substring(1);
				if (!categoryIds.find(c => c.value === categoryId)) {
					categoryIds.push({ value: categoryId, mode });
				}
			}
			// Language syntax: `language or _`language
			else if (cleanToken.startsWith('`')) {
				const language = cleanToken.substring(1);
				if (!languages.find(l => l.value === language)) {
					languages.push({ value: language, mode });
				}
			}
			// Keyword syntax: .keyword or _.keyword
			else if (cleanToken.startsWith('.')) {
				const keyword = cleanToken.substring(1);
				if (!keywords.find(k => k.value === keyword)) {
					keywords.push({ value: keyword, mode });
				}
			}
		}

		return { keywords, categoryIds, languages };
	}

	/**
	 * Handle chip click - 2-state toggle: activated (.pos) ↔ deactivated (_.pos)
	 */
	private handleChipClick(chipId: string): void {
		const chip = this.activeChips.get(chipId);
		if (!chip) return;

		// Get chip syntax (without prefix)
		let chipBase = '';
		if (chip.type === 'category') {
			chipBase = chipId.replace('category:', '');
		} else if (chip.type === 'keyword') {
			chipBase = chip.label;
		} else if (chip.type === 'codeblock') {
			chipBase = chip.label;
		}

		// Get prefix for chip type
		let prefix = '';
		if (chip.type === 'category') {
			prefix = ':';
		} else if (chip.type === 'keyword') {
			prefix = '.';
		} else if (chip.type === 'codeblock') {
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

		console.log('[handleChipClick] Updated widgetFilterExpression:', this.widgetFilterExpression);

		this.syncButtonsFromExpression();

		// Clear filter cell so expression-based filtering is used
		this.widgetFilterCell = null;

		// Re-render records section to show updated chip states and filtered results
		this.renderRecordsOnly();
	}

	/**
	 * Save subject data to store
	 */
	private async saveSubjectData(): Promise<void> {
		if (!this.currentSubject) return;

		// Update the subject in the subjects array
		const index = this.subjects.findIndex(s => s.id === this.currentSubject!.id);
		if (index !== -1) {
			this.subjects[index] = this.currentSubject;
		}

		// Save to store
		await subjectsStore.update({ subjects: this.subjects });
	}

	/**
	 * Get SELECT clause from filter expression
	 */
	private getSelectClause(expression: string): string {
		if (!expression) return '';

		let selectClause = expression;
		if (expression.includes('W:')) {
			const parts = expression.split(/\s+W:\s+/);
			selectClause = parts[0];
		}

		// Remove S: prefix if present
		if (selectClause.startsWith('S:')) {
			selectClause = selectClause.substring(2).trim();
		}

		return selectClause;
	}

	/**
	 * Add a chip to the filter expression
	 * Uses implicit OR (space-separated): .def .foo not .def OR .foo
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
	 * Remove a chip from the filter expression
	 * Handles both implicit (space-separated) and explicit (OR/AND) formats
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
		const cleaned: string[] = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token === 'OR' || token === 'AND') {
				// Only keep if there's a term before and after
				if (i > 0 && i < tokens.length - 1 &&
					tokens[i - 1] !== 'OR' && tokens[i - 1] !== 'AND' &&
					tokens[i + 1] !== 'OR' && tokens[i + 1] !== 'AND') {
					cleaned.push(token);
				}
			} else {
				cleaned.push(token);
			}
		}

		const newSelect = cleaned.join(' ');

		// Reconstruct expression
		if (whereClause) {
			return newSelect ? `${newSelect} W: ${whereClause}` : `W: ${whereClause}`;
		}
		return newSelect;
	}

	/**
	 * Update chips from dashboard filter or current widget expression
	 * Called when selectedRowId changes or on initial render
	 */
	private updateChipsFromDashboardFilter(): void {
		// Use current widget expression if available (manual search), otherwise dashboard filter
		let filterExpression: string | undefined = this.widgetFilterExpression;

		// If no manual expression, get dashboard filter based on selected row
		if (!filterExpression || filterExpression.trim() === '') {
			if (this.selectedRowId === 'orphans' && this.currentSubject) {
				// Subject row selected - use subject's dashboard filter
				filterExpression = this.currentSubject.dashOnlyFilterExp;
			} else if (this.selectedRowId && this.currentSubject) {
				// Primary topic row selected - use that topic's dashboard filter
				const primaryTopic = this.currentSubject.primaryTopics?.find(t => t.id === this.selectedRowId);
				if (primaryTopic) {
					filterExpression = primaryTopic.dashOnlyFilterExpSide;
				}
			} else if (this.currentSubject) {
				// No row selected - use subject's dashboard filter
				filterExpression = this.currentSubject.dashOnlyFilterExp;
			}
		}

		if (!filterExpression) {
			this.activeChips.clear();
			this.activeChipIds.clear();
			return;
		}

		// Extract chips from filter expression
		const chips = this.extractChipsFromFilterExpression(filterExpression);

		// Clear previous chips
		this.activeChips.clear();
		this.activeChipIds.clear();

		// Build chips directly from current expression (not from accumulated palette)
		chips.categoryIds.forEach(({value, mode}) => {
			const category = HighlightSpaceRepeatPlugin.settings.categories?.find((c: any) => c.id === value);
			if (category) {
				const chipId = `category:${value}`;
				this.activeChipIds.add(chipId);
				this.activeChips.set(chipId, {
					id: chipId,
					type: 'category',
					label: (category as any).name || value,
					icon: (category as any).icon || '📁',
					active: true,
					mode: mode,
					backgroundColor: (category as any).bgColor,
					color: (category as any).color
				});
			}
		});

		chips.keywords.forEach(({value, mode}) => {
			// Find keyword definition in categories
			let keywordDef: any = null;
			for (const category of HighlightSpaceRepeatPlugin.settings.categories || []) {
				keywordDef = category.keywords?.find((k: any) => k.keyword === value);
				if (keywordDef) break;
			}

			if (keywordDef) {
				const chipId = `keyword:${value}`;
				this.activeChipIds.add(chipId);
				this.activeChips.set(chipId, {
					id: chipId,
					type: 'keyword',
					label: value,
					icon: keywordDef.icon,
					active: true,
					mode: mode,
					backgroundColor: keywordDef.bgColor,
					color: keywordDef.color
				});
			}
		});

		chips.languages.forEach(({value, mode}) => {
			const chipId = `codeblock:${value}`;
			this.activeChipIds.add(chipId);
			this.activeChips.set(chipId, {
				id: chipId,
				type: 'codeblock',
				label: value,
				icon: '```',
				active: true,
				mode: mode
			});
		});
	}

	/**
	 * Load dashboard filter expression into widget filter expression
	 * Called when subject or row selection changes
	 */
	private loadDashboardFilterIntoExpression(): void {
		// Get dashboard filter based on selected row
		let dashFilterExpression: string | undefined;

		if (this.selectedRowId === 'orphans' && this.currentSubject) {
			// Subject row selected - use subject's dashboard filter
			dashFilterExpression = this.currentSubject.dashOnlyFilterExp;
		} else if (this.selectedRowId && this.currentSubject) {
			// Primary topic row selected - use that topic's dashboard filter
			const primaryTopic = this.currentSubject.primaryTopics?.find(t => t.id === this.selectedRowId);
			if (primaryTopic) {
				dashFilterExpression = primaryTopic.dashOnlyFilterExpSide;
			}
		} else if (this.currentSubject) {
			// No row selected - use subject's dashboard filter
			dashFilterExpression = this.currentSubject.dashOnlyFilterExp;
		}

		// Load into widget filter expression
		if (dashFilterExpression) {
			this.widgetFilterExpression = dashFilterExpression;
			this.syncButtonsFromExpression();

			// Only rebuild chips if plugin is initialized
			if (!this.plugin?.settings) return;

			// Clear old chips and create new ones from expression
			const extracted = this.extractChipsFromFilterExpression(dashFilterExpression);
			this.activeChips.clear();

			// Add keyword chips
			extracted.keywords.forEach(kw => {
				const keywordStyle = this.plugin.settings.categories
					.flatMap(cat => cat.keywords)
					.find(k => k.keyword === kw.value);

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
				const category = this.plugin.settings.categories.find(c => c.id === cat.value);
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
		} else {
			// No dashboard filter, clear everything
			this.widgetFilterExpression = '';
			this.activeChips.clear();
		}
	}

}
