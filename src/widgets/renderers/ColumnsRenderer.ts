import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import type { ParsedFile } from '../../interfaces/ParsedFile';
import type { MatrixCell } from '../cells';
import { renderFHRCountLinkBadges } from './render-helpers';
import { getFileNameFromPath } from '../../utils/file-helpers';

/**
 * ColumnsRenderer - Handles rendering of matrix columns (all of them)
 * Takes cell instances (data) and renders them into column DOM
 */
export class ColumnsRenderer {
	private subject: Subject;
	private cellInstances: Map<string, MatrixCell>;
	private parsedRecords: ParsedFile[];
	private selectedRowId: string | null;

	// Callbacks for widget functionality
	private onFileClick: (filePath: string) => Promise<void>;
	private onCountClick: (type: 'F' | 'H' | 'R' | 'D', cellKey: string) => void;

	constructor(
		subject: Subject,
		cellInstances: Map<string, MatrixCell>,
		parsedRecords: ParsedFile[],
		selectedRowId: string | null,
		callbacks: {
			onFileClick: (filePath: string) => Promise<void>;
			onCountClick: (type: 'F' | 'H' | 'R' | 'D', cellKey: string) => void;
		}
	) {
		this.subject = subject;
		this.cellInstances = cellInstances;
		this.parsedRecords = parsedRecords;
		this.selectedRowId = selectedRowId;
		this.onFileClick = callbacks.onFileClick;
		this.onCountClick = callbacks.onCountClick;
	}

	/**
	 * Render all columns for the selected row
	 */
	render(container: HTMLElement): void {
		if (!this.selectedRowId) return;

		const columnsContainer = container.createDiv({ cls: 'kh-dashboard-columns kh-matrix-columns' });
		const shownFiles = new Set<string>();

		const primaryTopics = this.subject.primaryTopics || [];
		const secondaryTopics = this.subject.secondaryTopics || [];

		// Render totals column + calculate row context
		let rowNum: number;
		let selectedPrimaryTopic: Topic | null = null;

		if (this.selectedRowId === 'orphans') {
			// Subject row
			this.renderColumn(columnsContainer, '1x1', this.subject.icon || '📁', this.subject.name, true, shownFiles);
			rowNum = 1;
		} else {
			// Primary row
			selectedPrimaryTopic = primaryTopics.find(t => t.id === this.selectedRowId) || null;
			if (!selectedPrimaryTopic) return;

			rowNum = primaryTopics.indexOf(selectedPrimaryTopic) + 2;
			this.renderColumn(columnsContainer, `${rowNum}x1`, selectedPrimaryTopic.icon || '📌', selectedPrimaryTopic.name, true, shownFiles);
		}

		// Render secondary columns
		secondaryTopics.forEach((topic, index) => {
			if (topic.fhDisabled) return;

      // common secondary topics belongs to everyone and can proceed
			const isCommon = !topic.primaryTopicIds || topic.primaryTopicIds.length === 0;
      // specific topic for my primary topic
			const isSpecificForCurrentPrimary = selectedPrimaryTopic && topic.primaryTopicIds?.includes(selectedPrimaryTopic.id);

			if (!isCommon && !isSpecificForCurrentPrimary) return;

			const col = index + 2;
			const cellKey = `${rowNum}x${col}`;
			this.renderColumn(columnsContainer, cellKey, topic.icon || '🔗', topic.name, false, shownFiles);
		});

		// Render primary×primary intersection columns
		if (selectedPrimaryTopic) {
			primaryTopics.forEach((otherPrimary) => {
				if (otherPrimary.id === this.selectedRowId) return;
				if (!otherPrimary.topicTag) return;

				const cellKey = `PRIMARY:${selectedPrimaryTopic!.id}:${otherPrimary.id}`;
				this.renderColumn(columnsContainer, cellKey, otherPrimary.icon || '📌', otherPrimary.name, false, shownFiles);
			});
		}
	}

	/**
	 * Render a single column
	 */
	private renderColumn(
		columnsContainer: HTMLElement,
		cellKey: string,
		icon: string,
		name: string,
		isTotalsColumn: boolean,
		shownFiles: Set<string>
	): void {
		const cell = this.cellInstances.get(cellKey);
		if (!cell) {
			throw new Error(`Cell ${cellKey} not found - recalculateMatrixCounts() must be called first`);
		}

		const files = cell.collectFiles(this.parsedRecords);
		if (files.length === 0) return;

		const column = columnsContainer.createDiv({
			cls: isTotalsColumn ? 'kh-dashboard-column kh-dashboard-totals-column' : 'kh-dashboard-column'
		});

		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.createEl('span', {
			text: `${icon} ${name.slice(0, 3)}`,
			cls: 'kh-dashboard-column-title'
		});

		renderFHRCountLinkBadges(header, cell, cellKey, this.parsedRecords, this.onCountClick);

		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		this.renderFileList(content, files, shownFiles);
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
