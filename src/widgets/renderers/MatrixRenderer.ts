import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import type { ParsedFile } from '../../interfaces/ParsedFile';
import type { MatrixCell } from '../cells';

/**
 * MatrixRenderer - Handles rendering of the matrix table
 * Takes cell instances (data) and renders them into DOM
 */
export class MatrixRenderer {
	private subject: Subject;
	private cellInstances: Map<string, MatrixCell>;
	private parsedRecords: ParsedFile[];

	// Callbacks for widget functionality
	private onCellClick: (cellKey: string, cellType: 'subject' | 'primary' | 'secondary' | 'intersection', event: MouseEvent) => void;
	private onCountClick: (type: 'F' | 'H' | 'R', cellKey: string) => void;
	private computeCellExpressions: (subject: Subject, secondaryTopic: Topic | null, primaryTopic: Topic | null, includesSubjectTag: boolean) => any;
	private addCountDisplay: (
		cell: HTMLElement,
		fileCount: number,
		headerCount: number,
		recordCount: number,
		subject: Subject,
		secondaryTopic: Topic | null,
		primaryTopic: Topic | null,
		includesSubjectTag: boolean,
		tooltip?: string,
		cellInstance?: MatrixCell
	) => void;

	constructor(
		subject: Subject,
		cellInstances: Map<string, MatrixCell>,
		parsedRecords: ParsedFile[],
		callbacks: {
			onCellClick: (cellKey: string, cellType: 'subject' | 'primary' | 'secondary' | 'intersection', event: MouseEvent) => void;
			onCountClick: (type: 'F' | 'H' | 'R', cellKey: string) => void;
			computeCellExpressions: (subject: Subject, secondaryTopic: Topic | null, primaryTopic: Topic | null, includesSubjectTag: boolean) => any;
			addCountDisplay: (
				cell: HTMLElement,
				fileCount: number,
				headerCount: number,
				recordCount: number,
				subject: Subject,
				secondaryTopic: Topic | null,
				primaryTopic: Topic | null,
				includesSubjectTag: boolean,
				tooltip?: string,
				cellInstance?: MatrixCell
			) => void;
		}
	) {
		this.subject = subject;
		this.cellInstances = cellInstances;
		this.parsedRecords = parsedRecords;
		this.onCellClick = callbacks.onCellClick;
		this.onCountClick = callbacks.onCountClick;
		this.computeCellExpressions = callbacks.computeCellExpressions;
		this.addCountDisplay = callbacks.addCountDisplay;
	}

	/**
	 * Render the complete matrix table
	 */
	render(container: HTMLElement): void {
		const primaryTopics = this.subject.primaryTopics || [];
		const secondaryTopics = this.subject.secondaryTopics || [];

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

		// Render header row
		this.renderHeaderRow(table, commonSecondaries, maxSpecificCount);

		// Render data rows
		this.renderDataRows(table, primaryTopics, secondaryTopics, commonSecondaries, specificSecondaries, maxSpecificCount);
	}

	/**
	 * Render header row (subject + secondary topics)
	 */
	private renderHeaderRow(
		table: HTMLTableElement,
		commonSecondaries: Topic[],
		maxSpecificCount: number
	): void {
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');

		// Cell 1x1: Subject
		this.renderSubjectHeaderCell(headerRow);

		// Cells 1x2, 1x3, ...: Common secondary topics
		commonSecondaries.forEach((topic, index) => {
			const col = index + 2;
			this.renderSecondaryHeaderCell(headerRow, topic, col);
		});

		// Add dynamic slots for specific secondaries (empty in header row)
		for (let i = 0; i < maxSpecificCount; i++) {
			const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell kh-matrix-specific-slot' });
			cell.textContent = '';
			cell.style.cursor = 'default';
			cell.setAttribute('title', 'Specific secondary topics column');
		}
	}

	/**
	 * Render subject header cell (1x1)
	 */
	private renderSubjectHeaderCell(headerRow: HTMLTableRowElement): void {
		const cellKey = '1x1';
		const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });
		const cellData = this.subject.matrix?.cells[cellKey];

		cell.textContent = this.subject.icon || '📁';
		const tooltipText = `Click: Open subject column\n\nSubject: ${this.subject.name}`;
		cell.setAttribute('title', tooltipText);

		// Add counts if available
		if (cellData?.fileCount !== undefined) {
			const cellInstance = this.cellInstances.get(cellKey);
			this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
				cellData.recordCount || 0, this.subject, null, null, false, tooltipText, cellInstance);
		}

		// Set background color
		const bgColor = this.getCellBackgroundColor(null, null);
		if (bgColor) {
			cell.style.backgroundColor = bgColor;
		}

		// Click handler - show subject columns
		cell.style.cursor = 'pointer';
		cell.addEventListener('click', (e) => {
			this.onCellClick(cellKey, 'subject', e);
		});
	}

	/**
	 * Render secondary topic header cell (1x2, 1x3, ...)
	 */
	private renderSecondaryHeaderCell(headerRow: HTMLTableRowElement, topic: Topic, col: number): void {
		const cellKey = `1x${col}`;
		const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });
		const cellData = this.subject.matrix?.cells[cellKey];
		const andMode = topic.andMode || false;

		// Apply AND mode styling
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
		cell.textContent = topic.icon || '🔗';

		// Set tooltip with expressions
		const expressions = this.computeCellExpressions(this.subject, topic, null, andMode);
		const expressionLines: string[] = [];
		if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
		if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
		if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
		const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
		const tooltipText = `${topic.name}${expressionsText}`;
		cell.setAttribute('title', tooltipText);

		// Add counts
		if (cellData?.fileCount !== undefined) {
			const cellInstance = this.cellInstances.get(cellKey);
			this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
				cellData.recordCount || 0, this.subject, topic, null, andMode, tooltipText, cellInstance);
		}

		// Set background color
		const bgColor = this.getCellBackgroundColor(topic, null);
		if (bgColor) {
			cell.style.backgroundColor = bgColor;
		}
	}

	/**
	 * Render data rows (primary topics and intersections)
	 */
	private renderDataRows(
		table: HTMLTableElement,
		primaryTopics: Topic[],
		secondaryTopics: Topic[],
		commonSecondaries: Topic[],
		specificSecondaries: Topic[],
		maxSpecificCount: number
	): void {
		const tbody = table.createEl('tbody');

		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const row = tbody.createEl('tr');
			const rowNum = rowIndex + 2;

			// Render row header (2x1, 3x1, ...)
			this.renderPrimaryRowHeader(row, primaryTopic, rowNum);

			// Render common intersection cells (2x2, 2x3, ...)
			commonSecondaries.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
				this.renderIntersectionCell(row, primaryTopic, secondaryTopic, rowNum, col);
			});

			// Render specific secondary intersections
			this.renderSpecificSecondaries(row, primaryTopic, secondaryTopics, specificSecondaries, rowNum, maxSpecificCount);
		});
	}

	/**
	 * Render primary topic row header (2x1, 3x1, ...)
	 */
	private renderPrimaryRowHeader(row: HTMLTableRowElement, primaryTopic: Topic, rowNum: number): void {
		const cellKey = `${rowNum}x1`;
		const rowHeaderCell = row.createEl('th', { cls: 'kh-matrix-cell kh-matrix-row-header-cell' });
		const cellData = this.subject.matrix?.cells[cellKey];
		const andMode = primaryTopic.andMode || false;

		// Apply AND mode styling
		if (andMode) {
			rowHeaderCell.classList.add('kh-matrix-and-mode-row');
			rowHeaderCell.classList.add('kh-matrix-and-mode');
		}

		// Check for limited collection
		if (this.hasLimitedCollection(null, primaryTopic)) {
			rowHeaderCell.classList.add('kh-matrix-limited-collection');
		}

		rowHeaderCell.textContent = primaryTopic.icon || '📌';

		// Set tooltip
		const expressions = this.computeCellExpressions(this.subject, null, primaryTopic, andMode);
		const expressionLines: string[] = [];
		if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
		if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
		if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
		const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
		const tooltipText = `${primaryTopic.name}${expressionsText}`;
		rowHeaderCell.setAttribute('title', tooltipText);

		// Add counts
		if (cellData?.fileCount !== undefined) {
			const cellInstance = this.cellInstances.get(cellKey);
			this.addCountDisplay(rowHeaderCell, cellData.fileCount, cellData.headerCount || 0,
				cellData.recordCount || 0, this.subject, null, primaryTopic, andMode, tooltipText, cellInstance);
		}

		// Set background color
		const bgColor = this.getCellBackgroundColor(null, primaryTopic);
		if (bgColor) {
			rowHeaderCell.style.backgroundColor = bgColor;
		}

		// Click handler
		rowHeaderCell.style.cursor = 'pointer';
		rowHeaderCell.title = `Click: Open column | Cmd+Click: Open dashboard\n\n${rowHeaderCell.title}`;
		rowHeaderCell.addEventListener('click', async (e) => {
			this.onCellClick(primaryTopic.id, 'primary', e);
		});
	}

	/**
	 * Render intersection cell (2x2, 2x3, ...)
	 */
	private renderIntersectionCell(
		row: HTMLTableRowElement,
		primaryTopic: Topic,
		secondaryTopic: Topic,
		rowNum: number,
		col: number
	): void {
		const intersectionKey = `${rowNum}x${col}`;
		const cell = row.createEl('td', { cls: 'kh-matrix-cell kh-matrix-data-cell' });
		const andMode = primaryTopic.andMode || false;
		const cellData = this.subject.matrix?.cells[intersectionKey];

		// Apply AND mode styling
		if (andMode) {
			cell.classList.add('kh-matrix-and-mode-row');
		}

		// Check for limited collection
		if (this.hasLimitedCollection(secondaryTopic, primaryTopic)) {
			cell.classList.add('kh-matrix-limited-collection');
		}

		// Apply F/H disabled styling
		if (secondaryTopic.fhDisabled) {
			cell.classList.add('kb-matrix-fh-disabled');
		}

		cell.textContent = cellData?.icon || '·';

		// Set tooltip
		const includesSubjectTag = andMode;
		const expressions = this.computeCellExpressions(this.subject, secondaryTopic, primaryTopic, includesSubjectTag);
		const expressionLines: string[] = [];
		if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
		if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
		if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
		const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
		const tooltipText = `${primaryTopic.name} × ${secondaryTopic.name}${expressionsText}`;
		cell.setAttribute('title', tooltipText);
		cell.style.cursor = 'pointer';

		// Add counts
		if (cellData?.fileCount !== undefined) {
			const cellInstance = this.cellInstances.get(intersectionKey);
			this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
				cellData.recordCount || 0, this.subject, secondaryTopic, primaryTopic, includesSubjectTag, tooltipText, cellInstance);
		}

		// Set background color
		const bgColor = this.getCellBackgroundColor(secondaryTopic, primaryTopic);
		if (bgColor) {
			cell.style.backgroundColor = bgColor;
		}
	}

	/**
	 * Render specific secondary intersections
	 */
	private renderSpecificSecondaries(
		row: HTMLTableRowElement,
		primaryTopic: Topic,
		secondaryTopics: Topic[],
		specificSecondaries: Topic[],
		rowNum: number,
		maxSpecificCount: number
	): void {
		const andMode = primaryTopic.andMode || false;
		const primarySpecificSecondaries = specificSecondaries.filter(sec =>
			sec.primaryTopicIds?.includes(primaryTopic.id)
		);

		for (let slotIndex = 0; slotIndex < maxSpecificCount; slotIndex++) {
			const cell = row.createEl('td', { cls: 'kh-matrix-cell kh-matrix-data-cell kh-matrix-specific-secondary' });

			if (slotIndex < primarySpecificSecondaries.length) {
				const secondaryTopic = primarySpecificSecondaries[slotIndex];
				const originalIndex = secondaryTopics.indexOf(secondaryTopic);
				const col = originalIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;

				if (andMode) {
					cell.classList.add('kh-matrix-and-mode-row');
				}

				const cellData = this.subject.matrix?.cells[intersectionKey];
				const includesSubjectTag = andMode;

				if (this.hasLimitedCollection(secondaryTopic, primaryTopic)) {
					cell.classList.add('kh-matrix-limited-collection');
				}

				if (secondaryTopic.fhDisabled) {
					cell.classList.add('kb-matrix-fh-disabled');
				}

				const displayIcon = cellData?.icon || secondaryTopic.icon || '·';
				const iconSpan = cell.createEl('span', { cls: 'kh-matrix-specific-icon' });
				iconSpan.textContent = displayIcon;

				// Set tooltip
				const expressions = this.computeCellExpressions(this.subject, secondaryTopic, primaryTopic, includesSubjectTag);
				const expressionLines: string[] = [];
				if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
				if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
				if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
				const expressionsText = expressionLines.length > 0 ? '\n\n' + expressionLines.join('\n') : '';
				const tooltipText = `${primaryTopic.name} × ${secondaryTopic.name}${expressionsText}`;
				cell.setAttribute('title', tooltipText);
				cell.style.cursor = 'pointer';

				// Add counts
				if (cellData?.fileCount !== undefined) {
					const cellInstance = this.cellInstances.get(intersectionKey);
					this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
						cellData.recordCount || 0, this.subject, secondaryTopic, primaryTopic, includesSubjectTag, tooltipText, cellInstance);
				}

				// Set background color
				const specificBgColor = this.getCellBackgroundColor(secondaryTopic, primaryTopic);
				if (specificBgColor) {
					cell.style.backgroundColor = specificBgColor;
				}
			} else {
				// Empty slot
				cell.textContent = '';
				cell.style.cursor = 'default';
			}
		}
	}

	/**
	 * Get cell background color based on topic flags
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

		// DISABLED: No background color overrides - let CSS classes handle styling
		return null;
	}

	/**
	 * Check if a topic (or combination) has limited collection
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
