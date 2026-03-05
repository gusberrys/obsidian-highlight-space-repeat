import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';

/**
 * Shared matrix table renderer used by both KHMatrixWidget and SubjectModal
 * This avoids code duplication and ensures consistent rendering
 */
export class MatrixRenderer {

	/**
	 * Render a matrix table for a subject
	 */
	static renderMatrixTable(
		container: HTMLElement,
		subject: Subject,
		topics: Topic[],
		options: {
			showScanButton?: boolean;
			onScanClick?: () => void;
			onCellClick?: (cellKey: string) => void;
			computeExpressions?: (subject: Subject, secondaryTopic: Topic | null, primaryTopic: Topic | null, includesSubjectTag: boolean) => { F: string | null, H: string | null, R: string | null };
			getCellBackgroundColor?: (secondaryTopic: Topic | null, primaryTopic: Topic | null) => string | null;
			hasLimitedCollection?: (secondaryTopic: Topic | null, primaryTopic: Topic | null) => boolean;
		} = {}
	): HTMLElement {
		// Cast to any[] since SubjectModal passes topics with temporary type field for editing
		const primaryTopics = (topics as any[]).filter((t: any) => t.type === 'primary');
		const secondaryTopics = (topics as any[]).filter((t: any) => t.type === 'secondary');

		// Only show matrix if we have at least one primary or secondary topic
		if (primaryTopics.length === 0 && secondaryTopics.length === 0) {
			container.createEl('p', {
				text: 'No topics available for this subject',
				cls: 'kh-empty-message'
			});
			return container;
		}

		const matrixSection = container.createDiv({ cls: 'kh-matrix-section' });

		// Scan button (optional)
		if (options.showScanButton && options.onScanClick) {
			const scanBtn = matrixSection.createEl('button', {
				text: '🔍 Scan File Counts',
				cls: 'kb-matrix-scan-btn'
			});
			scanBtn.addEventListener('click', options.onScanClick);
		}

		// Create table
		const table = matrixSection.createEl('table', { cls: 'kh-matrix-table' });

		// Header row
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');

		// Cell 1x1: Subject
		const cell1x1 = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });
		const cellData1x1 = subject.matrix?.cells['1x1'];

		cell1x1.textContent = subject.icon || '📁';
		const tooltipText1x1 = `Subject: ${subject.name}`;
		cell1x1.setAttribute('title', tooltipText1x1);

		// Add counts if available
		if (cellData1x1?.fileCount !== undefined) {
			this.addCountDisplay(cell1x1, cellData1x1.fileCount, cellData1x1.headerCount || 0,
				cellData1x1.recordCount || 0, tooltipText1x1, null, null);
		}

		// Cells 1x2, 1x3, ...: Secondary topics
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });

			const cellData = subject.matrix?.cells[cellKey];
			const andMode = topic.andMode || false;

			// Apply white border to column header if AND mode is enabled
			if (andMode) {
				cell.classList.add('kh-matrix-and-mode-col');
				cell.classList.add('kh-matrix-and-mode');
			}

			// Check for limited collection (blue)
			if (options.hasLimitedCollection && options.hasLimitedCollection(topic, null)) {
				cell.classList.add('kh-matrix-limited-collection');
			}

			// Apply F/H disabled styling (red background)
			if (topic.fhDisabled) {
				cell.classList.add('kb-matrix-fh-disabled');
			}

			// Apply My Own mode styling (red/blue or black/blue stripes, secondary cell only)
			if (topic.myOwn) {
				if (topic.fhDisabled) {
					// F/H disabled (checked): red/blue alternating stripes (most restrictive)
					cell.classList.add('kb-matrix-myown-enabled');
				} else {
					// F/H enabled (unchecked): black/blue alternating stripes
					cell.classList.add('kb-matrix-myown-fh-disabled');
				}
			}

			// Display topic icon
			const displayText = topic.icon || '🔗';
			cell.textContent = displayText;

			// Set tooltip with F/H/R expressions (only show enabled expressions)
			let tooltipText = `${topic.name}`;
			if (options.computeExpressions) {
				const expressions = options.computeExpressions(subject, topic, null, andMode);
				const expressionLines: string[] = [];
				if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
				if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
				if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
				if (expressionLines.length > 0) {
					tooltipText += '\n\n' + expressionLines.join('\n');
				}
			}
			cell.setAttribute('title', tooltipText);

			// Add counts if available
			if (cellData?.fileCount !== undefined) {
				this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
					cellData.recordCount || 0, tooltipText, topic, null);
			}

			// Set background color based on exclusions
			if (options.getCellBackgroundColor) {
				const bgColor = options.getCellBackgroundColor(topic, null);
				if (bgColor) {
					cell.style.backgroundColor = bgColor;
				}
			}

			// Make clickable if handler provided
			if (options.onCellClick) {
				cell.style.cursor = 'pointer';
				cell.addEventListener('click', () => options.onCellClick!(cellKey));
			}
		});

		// Data rows
		const tbody = table.createEl('tbody');

		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const row = tbody.createEl('tr');
			const rowNum = rowIndex + 2;
			const primaryCellKey = `${rowNum}x1`;
			const primaryCellData = subject.matrix?.cells[primaryCellKey];
			const andMode = primaryTopic.andMode || false;

			// Cell 2x1, 3x1, ...: Primary topics (row headers)
			const rowHeaderCell = row.createEl('th', { cls: 'kh-matrix-cell kh-matrix-row-header-cell' });

			// Apply white border to all cells in row if primary topic has AND mode
			if (andMode) {
				row.classList.add('kh-matrix-and-mode-row');
				rowHeaderCell.classList.add('kh-matrix-and-mode');
			}

			// Display topic icon
			const displayText = primaryTopic.icon || '📌';
			rowHeaderCell.textContent = displayText;

			// Set tooltip with F/H/R expressions
			let tooltipText = `${primaryTopic.name}`;
			if (options.computeExpressions) {
				const expressions = options.computeExpressions(subject, null, primaryTopic, andMode);
				const expressionLines: string[] = [];
				if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
				if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
				if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
				if (expressionLines.length > 0) {
					tooltipText += '\n\n' + expressionLines.join('\n');
				}
			}
			rowHeaderCell.setAttribute('title', tooltipText);

			// Add counts if available
			if (primaryCellData?.fileCount !== undefined) {
				this.addCountDisplay(rowHeaderCell, primaryCellData.fileCount, primaryCellData.headerCount || 0,
					primaryCellData.recordCount || 0, tooltipText, null, primaryTopic);
			}

			// Set background color
			if (options.getCellBackgroundColor) {
				const bgColor = options.getCellBackgroundColor(null, primaryTopic);
				if (bgColor) {
					rowHeaderCell.style.backgroundColor = bgColor;
				}
			}

			// Make clickable if handler provided
			if (options.onCellClick) {
				rowHeaderCell.style.cursor = 'pointer';
				rowHeaderCell.addEventListener('click', () => options.onCellClick!(primaryCellKey));
			}

			// Intersection cells: 2x2, 2x3, 3x2, 3x3, ...
			secondaryTopics.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;
				const cell = row.createEl('td', { cls: 'kh-matrix-cell kh-matrix-data-cell' });

				// Check if this secondary topic should intersect with this primary topic
				const shouldShowIntersection = !secondaryTopic.primaryTopicIds ||
					secondaryTopic.primaryTopicIds.length === 0 ||
					secondaryTopic.primaryTopicIds.includes(primaryTopic.id);

				if (!shouldShowIntersection) {
					// This secondary is assigned to specific primaries, but not this one
					cell.classList.add('kh-matrix-cell-disabled');
					cell.textContent = '';
					cell.style.cursor = 'default';
					cell.setAttribute('title', 'Not applicable - this secondary topic is not assigned to this primary topic');
					return;
				}

				// Apply white border to all cells in row if primary topic has AND mode
				if (andMode) {
					cell.classList.add('kh-matrix-and-mode-row');
				}

				const cellData = subject.matrix?.cells[intersectionKey];

				// For intersections: ONLY use primary topic's AND mode (inherited from row)
				// Secondary topic's AND mode does NOT apply to intersections
				const includesSubjectTag = andMode;

				// Check for limited collection (blue)
				if (options.hasLimitedCollection && options.hasLimitedCollection(secondaryTopic, primaryTopic)) {
					cell.classList.add('kh-matrix-limited-collection');
				}

				// Apply F/H disabled styling (red background) if secondary topic has F/H disabled
				if (secondaryTopic.fhDisabled) {
					cell.classList.add('kb-matrix-fh-disabled');
				}

				const displayIcon = cellData?.icon || '·';
				cell.textContent = displayIcon;

				// Set tooltip with F/H/R expressions
				let tooltipText = `${primaryTopic.name} × ${secondaryTopic.name}`;
				if (options.computeExpressions) {
					const expressions = options.computeExpressions(subject, secondaryTopic, primaryTopic, includesSubjectTag);
					const expressionLines: string[] = [];
					if (expressions.F !== null) expressionLines.push(`F: ${expressions.F}`);
					if (expressions.H !== null) expressionLines.push(`H: ${expressions.H}`);
					if (expressions.R !== null) expressionLines.push(`R: ${expressions.R}`);
					if (expressionLines.length > 0) {
						tooltipText += '\n\n' + expressionLines.join('\n');
					}
				}
				cell.setAttribute('title', tooltipText);

				// Add counts if available
				if (cellData?.fileCount !== undefined) {
					this.addCountDisplay(cell, cellData.fileCount, cellData.headerCount || 0,
						cellData.recordCount || 0, tooltipText, secondaryTopic, primaryTopic);
				}

				// Make clickable if handler provided
				if (options.onCellClick) {
					cell.style.cursor = 'pointer';
					cell.addEventListener('click', () => {
						options.onCellClick!(intersectionKey);
					});
				}
			});
		});

		return matrixSection;
	}

	/**
	 * Add count display to a cell (files, headers, records)
	 */
	private static addCountDisplay(
		cell: HTMLElement,
		fileCount: number,
		headerCount: number,
		recordCount: number,
		tooltipText: string,
		secondaryTopic: Topic | null = null,
		primaryTopic: Topic | null = null
	): void {
		const countsDiv = cell.createDiv({ cls: 'kh-matrix-counts' });
		countsDiv.setAttribute('title', tooltipText);

		// Determine which counts to show based on topic flags
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

		// Only show counts if enabled by topic flags
		if (fileCount > 0 && showFileRecords) {
			countsDiv.createEl('span', {
				cls: 'kh-count-file',
				text: `/${fileCount}`
			});
		}

		if (headerCount > 0 && showHeaderRecords) {
			countsDiv.createEl('span', {
				cls: 'kh-count-header',
				text: `+${headerCount}`
			});
		}

		if (recordCount > 0) {
			countsDiv.createEl('span', {
				cls: 'kh-count-record',
				text: `-${Math.abs(recordCount)}`
			});
		}
	}
}
