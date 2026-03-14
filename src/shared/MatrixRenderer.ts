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

		cell1x1.textContent = subject.icon || '📁';
		const tooltipText1x1 = `Subject: ${subject.name}`;
		cell1x1.setAttribute('title', tooltipText1x1);

		// Counts no longer stored in JSON - removed count display

		// Cells 1x2, 1x3, ...: Secondary topics
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const cell = headerRow.createEl('th', { cls: 'kh-matrix-cell kh-matrix-header-cell' });

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

			// Counts no longer stored in JSON - removed count display

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

			// Counts no longer stored in JSON - removed count display

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

				cell.textContent = '·';

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

				// Counts no longer stored in JSON - removed count display

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
}
