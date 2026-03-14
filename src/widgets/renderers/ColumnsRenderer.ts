import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import type { ParsedFile } from '../../interfaces/ParsedFile';
import type { MatrixCell } from '../cells';
import { renderFHRCountLinkBadges } from './render-helpers';
import { SubjectCell, PrimarySideCell, SecondaryHeaderCell, PrimarySecondaryCell, PrimaryPrimaryCell } from '../cells';
import { getFileNameFromPath } from '../../utils/file-helpers';
import { TFile } from 'obsidian';

/**
 * ColumnsRenderer - Handles rendering of matrix columns
 * Takes cell instances (data) and renders them into column DOM
 */
export class ColumnsRenderer {
	private subject: Subject;
	private cellInstances: Map<string, MatrixCell>;
	private parsedRecords: ParsedFile[];
	private selectedRowId: string | null;

	// Callbacks for widget functionality
	private onFileClick: (filePath: string) => Promise<void>;
	private onCountClick: (type: 'F' | 'H' | 'R', cellKey: string) => void;
	private getFileLevelTags: (record: ParsedFile) => string[];
	private getRecordTags: (record: ParsedFile) => string[];

	constructor(
		subject: Subject,
		cellInstances: Map<string, MatrixCell>,
		parsedRecords: ParsedFile[],
		selectedRowId: string | null,
		callbacks: {
			onFileClick: (filePath: string) => Promise<void>;
			onCountClick: (type: 'F' | 'H' | 'R', cellKey: string) => void;
			getFileLevelTags: (record: ParsedFile) => string[];
			getRecordTags: (record: ParsedFile) => string[];
		}
	) {
		this.subject = subject;
		this.cellInstances = cellInstances;
		this.parsedRecords = parsedRecords;
		this.selectedRowId = selectedRowId;
		this.onFileClick = callbacks.onFileClick;
		this.onCountClick = callbacks.onCountClick;
		this.getFileLevelTags = callbacks.getFileLevelTags;
		this.getRecordTags = callbacks.getRecordTags;
	}

	/**
	 * Render all columns for the selected row
	 */
	render(container: HTMLElement): void {
		if (!this.selectedRowId) return;

		const columnsContainer = container.createDiv({ cls: 'kh-dashboard-columns kh-matrix-columns' });

		// Track files already shown in previous columns (for styling duplicates)
		const shownFiles = new Set<string>();

		const primaryTopics = this.subject.primaryTopics || [];
		const secondaryTopics = this.subject.secondaryTopics || [];

		// Render totals column based on selected row
		if (this.selectedRowId === 'orphans') {
			// Subject row selected - render subject totals column
			this.renderSubjectColumn(columnsContainer, shownFiles);
		} else {
			// Primary topic row selected - render primary totals column
			this.renderPrimaryColumn(columnsContainer, this.selectedRowId, shownFiles);
		}

		// Render secondary topic columns
		// Filter records based on selected row
		let filteredRecords: ParsedFile[] = [];
		if (this.selectedRowId === 'orphans') {
			// Subject row: files with subject tag but no primary/secondary tags
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
			filteredRecords = this.parsedRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				const hasSubjectTag = this.subject.mainTag ? tags.includes(this.subject.mainTag) : false;
				const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag!));
				const hasSecondaryTag = secondaryTopicTags.some(tag => tags.includes(tag!));
				return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
			});
		} else {
			// Primary topic row: files with primary topic tag
			const primaryTopic = primaryTopics.find(t => t.id === this.selectedRowId);
			if (primaryTopic?.topicTag) {
				if (primaryTopic.andMode && this.subject.mainTag) {
					filteredRecords = this.parsedRecords.filter(record => {
						const tags = this.getFileLevelTags(record);
						return tags.includes(primaryTopic.topicTag!) && tags.includes(this.subject.mainTag!);
					});
				} else {
					filteredRecords = this.parsedRecords.filter(record => {
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

			this.renderSecondaryColumn(columnsContainer, topic, filteredRecords, shownFiles);
		});

		// Render other primary topic columns (primary×primary intersections)
		if (this.selectedRowId !== 'orphans' && selectedPrimaryTopic) {
			primaryTopics.forEach((otherPrimaryTopic) => {
				// Skip the selected primary topic itself
				if (otherPrimaryTopic.id === this.selectedRowId) return;

				// Skip if no tag
				if (!otherPrimaryTopic.topicTag) return;

				// Render intersection column
				this.renderPrimaryIntersectionColumn(columnsContainer, selectedPrimaryTopic, otherPrimaryTopic, shownFiles);
			});
		}
	}

	/**
	 * Render subject column (1x1 cell)
	 */
	private renderSubjectColumn(columnsContainer: HTMLElement, shownFiles: Set<string>): void {
		// Get cached SubjectCell (created in recalculateMatrixCounts)
		const cellKey = '1x1';
		let cell = this.cellInstances.get(cellKey) as SubjectCell | undefined;
		if (!cell) {
			// Fallback: create cell if not cached (shouldn't happen if recalculate was called)
			cell = new SubjectCell(
				this.subject,
				this.getFileLevelTags,
				this.getRecordTags
			);
			this.cellInstances.set(cellKey, cell);
		}

		// Use cell for all counting
		const fileCount = cell.countFiles(this.parsedRecords);
		const headerCount = cell.countHeaders(this.parsedRecords);
		const recordCount = cell.countRecords(this.parsedRecords);

		// Get filter expression from cell
		const matrixExpr = cell.getFilterExpression();

		// Create column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column kh-dashboard-totals-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${this.subject.icon || '📁'} ${this.subject.name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		// Counts
		renderFHRCountLinkBadges(header, cell, cellKey, this.parsedRecords, this.onCountClick);

		// Content area - show files using MatrixCell collected data
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const files = cell.collectFiles(this.parsedRecords);
		this.renderFileList(content, files, shownFiles);
	}

	/**
	 * Render primary topic column
	 */
	private renderPrimaryColumn(columnsContainer: HTMLElement, primaryTopicId: string, shownFiles: Set<string>): void {
		const primaryTopics = this.subject.primaryTopics || [];
		const primaryTopic = primaryTopics.find(t => t.id === primaryTopicId);
		if (!primaryTopic) return;

		// Get cached PrimarySideCell
		const rowNum = primaryTopics.indexOf(primaryTopic) + 2;
		const cellKey = `${rowNum}x1`;
		let cell = this.cellInstances.get(cellKey) as PrimarySideCell | undefined;
		if (!cell) {
			// Fallback: create cell if not cached
			cell = new PrimarySideCell(
				this.subject,
				primaryTopic,
				this.getFileLevelTags,
				this.getRecordTags
			);
			this.cellInstances.set(cellKey, cell);
		}

		// Use cell for all counting
		const fileCount = cell.countFiles(this.parsedRecords);
		const headerCount = cell.countHeaders(this.parsedRecords);
		const recordCount = cell.countRecords(this.parsedRecords);

		// Get filter expression from cell
		const matrixExpr = cell.getFilterExpression();

		// Create column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column kh-dashboard-totals-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${primaryTopic.icon || '📌'} ${primaryTopic.name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		// Counts
		renderFHRCountLinkBadges(header, cell, cellKey, this.parsedRecords, this.onCountClick);

		// Content area - show files
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const files = cell.collectFiles(this.parsedRecords);
		this.renderFileList(content, files, shownFiles);
	}

	/**
	 * Render secondary topic column (intersection with selected primary)
	 */
	private renderSecondaryColumn(
		columnsContainer: HTMLElement,
		topic: Topic,
		filteredRecords: ParsedFile[],
		shownFiles: Set<string>
	): void {
		const primaryTopics = this.subject.primaryTopics || [];
		const secondaryTopics = this.subject.secondaryTopics || [];

		// Determine which cell type to use based on selected row
		let cell: MatrixCell | undefined;
		let cellKey: string;
		let primaryTopic: Topic | null = null;
		let andMode = false;

		if (this.selectedRowId === 'orphans') {
			// Subject row: use SecondaryHeaderCell (1x2, 1x3, ...)
			const secondaryIndex = secondaryTopics.findIndex(t => t.id === topic.id);
			const col = secondaryIndex + 2;
			cellKey = `1x${col}`;
			cell = this.cellInstances.get(cellKey) as SecondaryHeaderCell | undefined;
			if (!cell) {
				cell = new SecondaryHeaderCell(
					this.subject,
					topic,
					this.getFileLevelTags,
					this.getRecordTags
				);
				this.cellInstances.set(cellKey, cell);
			}
		} else {
			// Primary row: use PrimarySecondaryCell (2x2, 2x3, ...)
			primaryTopic = primaryTopics.find(t => t.id === this.selectedRowId) || null;
			if (!primaryTopic) return;

			andMode = primaryTopic.andMode || false;
			const rowNum = primaryTopics.indexOf(primaryTopic) + 2;
			const secondaryIndex = secondaryTopics.findIndex(t => t.id === topic.id);
			const col = secondaryIndex + 2;
			cellKey = `${rowNum}x${col}`;

			cell = this.cellInstances.get(cellKey) as PrimarySecondaryCell | undefined;
			if (!cell) {
				cell = new PrimarySecondaryCell(
					this.subject,
					primaryTopic,
					topic,
					this.getFileLevelTags,
					this.getRecordTags
				);
				this.cellInstances.set(cellKey, cell);
			}
		}

		// Use cell for all counting
		const fileCount = cell.countFiles(this.parsedRecords);
		const headerCount = cell.countHeaders(this.parsedRecords);
		const recordCount = cell.countRecords(this.parsedRecords);

		// Only render if there are counts
		if (fileCount === 0 && headerCount === 0 && recordCount === 0) return;

		// Get filter expression from cell
		const matrixExpr = cell.getFilterExpression();

		// Create column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${topic.icon || '🔗'} ${topic.name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		// Counts
		renderFHRCountLinkBadges(header, cell, cellKey, this.parsedRecords, this.onCountClick);

		// Content area - show files
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const files = cell.collectFiles(this.parsedRecords);
		this.renderFileList(content, files, shownFiles);
	}

	/**
	 * Render primary×primary intersection column
	 */
	private renderPrimaryIntersectionColumn(
		columnsContainer: HTMLElement,
		clickedPrimary: Topic,
		otherPrimary: Topic,
		shownFiles: Set<string>
	): void {
		// Create synthetic cellKey for PRIMARY×PRIMARY intersection
		const cellKey = `PRIMARY:${clickedPrimary.id}:${otherPrimary.id}`;

		// Create or get cached PrimaryPrimaryCell
		let cell = this.cellInstances.get(cellKey) as PrimaryPrimaryCell | undefined;
		if (!cell) {
			cell = new PrimaryPrimaryCell(
				this.subject,
				clickedPrimary,
				otherPrimary,
				this.getFileLevelTags,
				this.getRecordTags
			);
			this.cellInstances.set(cellKey, cell);
		}

		// Use cell for all counting
		const fileCount = cell.countFiles(this.parsedRecords);
		const headerCount = cell.countHeaders(this.parsedRecords);
		const recordCount = cell.countRecords(this.parsedRecords);

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

		// Counts
		renderFHRCountLinkBadges(header, cell, cellKey, this.parsedRecords, this.onCountClick);

		// Content area - show files using MatrixCell collected data
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const topicFiles = cell.collectFiles(this.parsedRecords);
		this.renderFileList(content, topicFiles, shownFiles);
	}

	/**
	 * Helper: Render file list with duplicate tracking
	 */
	private renderFileList(content: HTMLElement, files: ParsedFile[], shownFiles: Set<string>): void {
		const sortedRecords = files.slice().sort((a, b) => {
			const nameA = getFileNameFromPath(a.filePath).toLowerCase();
			const nameB = getFileNameFromPath(b.filePath).toLowerCase();
			return nameA.localeCompare(nameB);
		});

		sortedRecords.forEach(record => {
			const fileItem = content.createDiv({ cls: 'kh-dashboard-file-item' });

			// Check if this file was already shown in a previous column
			const isDuplicate = shownFiles.has(record.filePath);

			// Style duplicates differently (green background, gray text)
			if (isDuplicate) {
				fileItem.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
			}

			const fileNameSpan = fileItem.createEl('span', {
				text: getFileNameFromPath(record.filePath).replace('.md', ''),
				cls: 'kh-dashboard-file-name'
			});

			// Gray out duplicate file names
			if (isDuplicate) {
				fileNameSpan.style.color = 'var(--text-muted)';
			}

			fileItem.style.cursor = 'pointer';
			fileItem.addEventListener('click', async () => {
				await this.onFileClick(record.filePath);
			});

			// Add to shown files set
			shownFiles.add(record.filePath);
		});
	}
}
