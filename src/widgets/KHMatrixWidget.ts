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
	private widgetFilterType: 'F' | 'H' | 'R' | null = null;
	private widgetFilterCell: MatrixCell | null = null; // Cell-based filter (from clicking F/H/R counts)
	private widgetFilterExpression: string = ''; // Manual text filter expression (from typing in text box)
	private widgetFilterText: string = ''; // Text filter for entries (file name, aliases, keywords, content)
	private collapsedFiles: Set<string> = new Set(); // Track collapsed file groups in widget filter

	// Track expanded headers (using unique header identifier)
	private expandedHeaders: Set<string> = new Set();

	// Prevent concurrent renders
	private isRendering: boolean = false;

	// Chips and flags
	private activeChips: Map<string, ActiveChip> = new Map();
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

			this.render();
		});

		// Render initial state
		this.render();
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

			// ========================================
			// PART 1: MATRIX HEADER
			// ========================================
			this.renderMatrixHeader(container);

			// ========================================
			// PART 2: MATRIX TABLE
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
			// PART 3: COLUMNS (when row selected)
			// ========================================
			if (this.currentSubject && this.selectedRowId) {
				await this.renderMatrixColumns(container);
			}

			// ========================================
			// PART 4: RECORDS (when filter active)
			// ========================================
			if (this.widgetFilterType && (this.widgetFilterCell || this.widgetFilterExpression)) {
				await this.renderWidgetFilter(container);
			}
		} finally {
			this.isRendering = false;
		}
	}

	/**
	 * PART 1: Render matrix header (subject selector + chips/flags)
	 */
	private renderMatrixHeader(container: HTMLElement): void {
		const renderer = new HeaderRenderer(
			this.subjects,
			this.currentSubject,
			this.widgetFilterExpression,
			{
				activeChips: this.activeChips,
				trimSubItems: this.trimSubItems,
				topRecordOnly: this.topRecordOnly,
				showAll: this.showAll,
				showLegend: this.showLegend
			},
			{
				onSubjectIconClick: () => {
					this.toggleSubjectColumn();
				},
				onSubjectChange: async (subjectId: string) => {
					this.currentSubject = this.subjects.find(s => s.id === subjectId) || null;
					if (this.currentSubject) {
						await this.recalculateMatrixCounts();
					} else {
						this.render();
					}
				},
				onFilterSearch: (expression: string) => {
					this.widgetFilterExpression = expression;
					this.widgetFilterType = 'R'; // Default to Record filter
					this.widgetFilterCell = null; // Manual expression, not cell-based
					this.render();
				},
				onFilterInput: (expression: string) => {
					this.widgetFilterExpression = expression;
					this.syncButtonsFromExpression();
				},
				onEditClick: () => {
					this.openSubjectEditor();
				},
				onSRSClick: async () => {
					await this.startSRSReview();
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
				onShowAllToggle: () => {
					this.showAll = !this.showAll;
					this.toggleFilterModifier('\\a', this.showAll);
					this.render();
				},
				onLegendToggle: () => {
					this.showLegend = !this.showLegend;
					this.render();
				},
				onChipClick: (chipId: string) => {
					// Chip click functionality handled via active chips
				},
				updateSRSButtonTooltip: (button: HTMLElement) => {
					this.updateSRSButtonTooltip(button);
				}
		}
	);

		renderer.render(container);
	}


	/**
	 * PART 4: Render widget filter (individual records display with search)
	 */
	private async renderWidgetFilter(container: HTMLElement): Promise<void> {
		if (!this.widgetFilterType || (!this.widgetFilterCell && !this.widgetFilterExpression)) {
			return; // Don't show filter if not active
		}

		const parsedRecords = await this.loadParsedRecords();

		const renderer = new RecordsRenderer(
			this.app,
			this.plugin,
			parsedRecords,
			this.currentSubject,
			{
				filterType: this.widgetFilterType,
				filterCell: this.widgetFilterCell,
				filterExpression: this.widgetFilterExpression,
				filterText: this.widgetFilterText
			},
			{
				activeChips: this.activeChips,
					trimSubItems: this.trimSubItems,
				topRecordOnly: this.topRecordOnly,
				showAll: this.showAll
			},
			{
				collapsedFiles: this.collapsedFiles,
				expandedHeaders: this.expandedHeaders
			},
			{
				onFilterTextChange: (text: string) => {
					this.widgetFilterText = text;
					this.renderRecordsOnly();
				}
			}
		);

		await renderer.render(container);
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
		// Only re-render columns and records sections, not the matrix
		this.renderColumnsAndRecords();
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
		// Only re-render columns and records sections, not the matrix
		this.renderColumnsAndRecords();
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

		// Re-render records if filter is active
		if (this.widgetFilterType && (this.widgetFilterCell || this.widgetFilterExpression)) {
			await this.renderWidgetFilter(container);
		}
	}

	/**
	 * Re-render only the records section (not matrix or columns)
	 */
	private async renderRecordsOnly(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;

		// Remove existing records section
		const existingRecords = container.querySelector('.kh-widget-filter');
		if (existingRecords) existingRecords.remove();

		// Re-render records if filter is active
		if (this.widgetFilterType && (this.widgetFilterCell || this.widgetFilterExpression)) {
			await this.renderWidgetFilter(container);
		}
	}

	/**
	 * PART 2: Render matrix table
	 */
	private async renderMatrixTable(container: HTMLElement): Promise<void> {
		if (!this.currentSubject) return;

		// Load parsed records for count calculations
		const parsedRecords = await this.loadParsedRecords();

		const renderer = new MatrixRenderer(
			this.currentSubject,
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
				onCountClick: (type: 'F' | 'H' | 'R', cellKey: string) => {
					const cellInstance = this.cellInstances.get(cellKey);
					if (!cellInstance) return;

					this.widgetFilterType = type;
					this.widgetFilterCell = cellInstance;
					this.renderRecordsOnly();
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
		const parsedRecords = await this.loadParsedRecords();

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
				onCountClick: (type: 'F' | 'H' | 'R', cellKey: string) => {
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
	 * Open Subject Dashboard View with current subject selected
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
			commonSecondaries.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
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
		this.showAll = this.widgetFilterExpression.includes('\\a');
	}

}
