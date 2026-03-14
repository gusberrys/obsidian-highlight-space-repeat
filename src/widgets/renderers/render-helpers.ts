import type { MatrixCell } from '../cells/MatrixCell';
import type { ParsedFile } from '../../interfaces/ParsedFile';

/**
 * Render F/H/R/D count link badges for a cell
 * All data comes from the cell instance - no manual parameter passing needed
 */
export function renderFHRCountLinkBadges(
	container: HTMLElement,
	cell: MatrixCell,
	cellKey: string,
	parsedRecords: ParsedFile[],
	onCountClick: (type: 'F' | 'H' | 'R' | 'D', cellKey: string) => void
): void {
	const countsDiv = container.createDiv({ cls: 'kh-matrix-counts' });

	// File count badge
	if (cell.shouldShowFiles()) {
		const fileCount = cell.countFiles(parsedRecords);
		if (fileCount > 0) {
			const fileCountSpan = countsDiv.createEl('span', {
				text: `/${fileCount}`,
				cls: 'kh-count-file'
			});
			fileCountSpan.style.cursor = 'pointer';
			fileCountSpan.addEventListener('click', (e) => {
				e.stopPropagation();
				onCountClick('F', cellKey);
			});
		}
	}

	// Header count badge
	if (cell.shouldShowHeaders()) {
		const headerCount = cell.countHeaders(parsedRecords);
		if (headerCount > 0) {
			const headerCountSpan = countsDiv.createEl('span', {
				text: `+${headerCount}`,
				cls: 'kh-count-header'
			});
			headerCountSpan.style.cursor = 'pointer';
			headerCountSpan.addEventListener('click', (e) => {
				e.stopPropagation();
				onCountClick('H', cellKey);
			});
		}
	}

	// Record count badge (always shown - no visibility check needed)
	const recordCount = cell.countRecords(parsedRecords);
	if (recordCount > 0) {
		const recordCountSpan = countsDiv.createEl('span', {
			text: `-${recordCount}`,
			cls: 'kh-count-record'
		});
		recordCountSpan.style.cursor = 'pointer';
		recordCountSpan.addEventListener('click', (e) => {
			e.stopPropagation();
			onCountClick('R', cellKey);
		});
	}

	// Dashboard count badge (light blue) - only for primary topics with dashOnlyFilterExpSide
	if (cell.shouldShowDashRecords()) {
		const dashCount = cell.countDashRecords(parsedRecords);
		if (dashCount > 0) {
			const dashCountSpan = countsDiv.createEl('span', {
				text: `~${dashCount}`,
				cls: 'kh-count-dash'
			});
			dashCountSpan.style.cursor = 'pointer';
			dashCountSpan.addEventListener('click', (e) => {
				e.stopPropagation();
				onCountClick('D', cellKey);
			});
		}
	}
}
