import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { subjectsStore, saveSubjects } from '../stores/subject-store';
import { Subject } from '../interfaces/Subject';
import { Topic } from '../interfaces/Topic';
import type { SubjectsData } from '../shared/subjects-data';
import { SubjectModal } from '../settings/SubjectModal';
import type { ParsedFile } from '../interfaces/ParsedFile';
import { PlaceholderExpansion } from '../services/PlaceholderExpansion';
import { MatrixRenderer } from '../matrix/renderers/MatrixRenderer';
import { ColumnsRenderer } from '../matrix/renderers/ColumnsRenderer';
import { MatrixCell } from '../matrix/cells/MatrixCell';
import { SubjectCell } from '../matrix/cells/SubjectCell';
import { PrimarySideCell } from '../matrix/cells/PrimarySideCell';
import { SecondaryHeaderCell } from '../matrix/cells/SecondaryHeaderCell';
import { PrimarySecondaryCell } from '../matrix/cells/PrimarySecondaryCell';
import { PrimaryPrimaryCell } from '../matrix/cells/PrimaryPrimaryCell';
import { get } from 'svelte/store';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { RecordsViewWidget, RECORDS_VIEW_TYPE } from './RecordsViewWidget';

export const KH_MATRIX_VIEW_TYPE = 'kh-matrix-view';

/**
 * Matrix Widget for Subject/Topic matrix visualization
 * - Shows matrix table
 * - Shows columns view
 * - Delegates record display to RecordsViewWidget
 */
export class KHMatrixWidget extends ItemView {
	private currentSubject: Subject | null = null;
	private subjects: Subject[] = [];
	private plugin: HighlightSpaceRepeatPlugin;

	// Cell instances cache - reused across matrix counting and rendering
	private cellInstances: Map<string, MatrixCell> = new Map();

	// Columns state - which row is selected
	private selectedRowId: string | null = null;

	// Display toggles
	private showExpressions: boolean = true;
	private showLegend: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KH_MATRIX_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Subject Matrix';
	}

	getIcon(): string {
		return 'layout-grid';
	}

	async onOpen() {
		await this.loadData();
		await this.render();
	}

	async loadData() {
		// Subscribe to subjects changes
		subjectsStore.subscribe((data: SubjectsData) => {
			this.subjects = data.subjects;
			if (this.subjects.length > 0 && !this.currentSubject) {
				this.currentSubject = this.subjects[0];
			}
			// Recalculate cells when subjects change
			this.recalculateMatrixCounts();
		});
	}

	/**
	 * Get file-level tags (from ParsedFile.tags, which includes frontmatter tags)
	 */
	private getFileLevelTags(record: ParsedFile): string[] {
		// ParsedFile.tags already contains the file-level tags from frontmatter
		return record.tags.map(tag => tag.startsWith('#') ? tag : '#' + tag);
	}

	/**
	 * Get all tags from record (file-level + inline tags from entries)
	 */
	private getRecordTags(record: ParsedFile): string[] {
		const tags = new Set<string>();

		// Add file-level tags
		record.tags.forEach(tag => {
			const normalized = tag.startsWith('#') ? tag : '#' + tag;
			tags.add(normalized);
		});

		// Add inline tags from entries (from headers)
		for (const entry of record.entries) {
			if (entry.header?.tags) {
				entry.header.tags.forEach((tag: string) => {
					const normalized = tag.startsWith('#') ? tag : '#' + tag;
					tags.add(normalized);
				});
			}
		}

		return Array.from(tags);
	}

	/**
	 * Recalculate matrix counts from parsed data
	 */
	private async recalculateMatrixCounts(): Promise<void> {
		if (!this.currentSubject) return;

		const primaryTopics = this.currentSubject.primaryTopics || [];
		const secondaryTopics = this.currentSubject.secondaryTopics || [];

		// Clear and recreate cell instances
		this.cellInstances.clear();

		// Create SubjectCell for 1x1
		if (this.currentSubject.mainTag) {
			const cellKey = '1x1';
			const cell = new SubjectCell(
				this.currentSubject,
				this.getFileLevelTags.bind(this),
				this.getRecordTags.bind(this)
			);
			this.cellInstances.set(cellKey, cell);
		}

		// Create SecondaryHeaderCell for 1x2, 1x3, etc.
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
		});

		// Create PrimarySideCell for 2x1, 3x1, etc.
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
		});

		// Separate common vs specific secondary topics
		const commonSecondaries = secondaryTopics.filter(t =>
			!t.primaryTopicIds || t.primaryTopicIds.length === 0
		);
		const specificSecondaries = secondaryTopics.filter(t =>
			t.primaryTopicIds && t.primaryTopicIds.length > 0
		);

		// Create PrimarySecondaryCell for intersection cells
		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const rowNum = rowIndex + 2;

			// Common secondaries (main table columns)
			commonSecondaries.forEach((secondaryTopic) => {
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
			});

			// Specific secondaries for this primary
			const primarySpecificSecondaries = specificSecondaries.filter(sec =>
				sec.primaryTopicIds?.includes(primaryTopic.id)
			);
			primarySpecificSecondaries.forEach((secondaryTopic) => {
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
			});
		});

		// Create PRIMARY×PRIMARY intersection cells
		primaryTopics.forEach((clickedPrimary) => {
			primaryTopics.forEach((otherPrimary) => {
				if (clickedPrimary.id === otherPrimary.id) return;
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

		// Re-render to show updated counts
		this.render();
	}

	async render() {
		console.log('[KHMatrixWidget] ===== MATRIX RENDER STARTED =====');
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('kh-matrix-widget');

		if (!this.currentSubject) {
			container.createEl('div', {
				text: 'No subjects defined. Use the Subject Modal to create subjects.',
				cls: 'kh-empty-message'
			});
			return;
		}

		// Render matrix table (includes subject selector in 1x1 cell)
		await this.renderMatrix(container);

		// Render columns view (if row selected)
		if (this.selectedRowId) {
			await this.renderColumns(container);
		}
	}

	private async renderMatrix(container: HTMLElement) {
		if (!this.currentSubject) return;

		const matrixContainer = container.createDiv('kh-matrix-section');

		// Get parsed records from plugin
		const parsedRecords = this.getParsedRecords();

		// Render matrix using MatrixRenderer
		const renderer = new MatrixRenderer(
			this.currentSubject,
			this.subjects,
			this.cellInstances,
			parsedRecords,
			{
				onCellClick: async (cellKey: string, cellType: 'subject' | 'primary' | 'secondary' | 'intersection', event: MouseEvent) => {
					// Handle subject cell click (1x1)
					if (cellType === 'subject' && cellKey === '1x1') {
						if (!this.currentSubject) {
							new Notice('⚠️ No subject selected');
							return;
						}

						// Cmd/Ctrl/Alt + Click - open subject settings modal
						if (event.metaKey || event.ctrlKey || event.altKey) {
							new SubjectModal(this.app, this.plugin, this.currentSubject, async (updatedSubject) => {
								// Save the updated subject
								const subjectsData = get(subjectsStore);
								const index = subjectsData.subjects.findIndex(s => s.id === updatedSubject.id);
								if (index >= 0) {
									subjectsData.subjects[index] = updatedSubject;
									subjectsStore.set(subjectsData);
									await saveSubjects();
									this.currentSubject = updatedSubject;
									await this.recalculateMatrixCounts();
								}
							}).open();
							return;
						}

						// Regular click - toggle subject column view
						this.selectedRowId = this.selectedRowId === 'orphans' ? null : 'orphans';
						this.render();
						return;
					}

					// Handle Cmd+Click for primary cells - TODO: add dashboard support
					if (cellType === 'primary' && (event.metaKey || event.ctrlKey)) {
						console.log('[onCellClick] Cmd+Click on primary topic - dashboard not implemented yet');
						new Notice('Dashboard view not implemented yet');
						return;
					}

					// Regular click - toggle column view for primary row
					if (cellType === 'primary') {
						this.selectedRowId = cellKey;
						this.render();
						return;
					}

					// Click on other cells - send filter to Records View
					const cell = this.cellInstances.get(cellKey);
					if (cell) {
						const filterExpr = this.getFilterExpressionForCell(cell, cellType);
						if (filterExpr) {
							// Get topic from cell for placeholder expansion
							const primaryTopic = (cell as any).primaryTopic || null;
							this.sendFilterToPluginA(filterExpr, primaryTopic);
						}
					}
				},
				onCountClick: (type: 'F' | 'H' | 'R' | 'D', cellKey: string) => {
					const cell = this.cellInstances.get(cellKey);
					if (cell) {
						const filterExpr = this.getFilterExpressionForCell(cell, type);
						if (filterExpr) {
							// Get topic from cell for placeholder expansion
							const primaryTopic = (cell as any).primaryTopic || null;
							this.sendFilterToPluginA(filterExpr, primaryTopic, type);
						}
					}
				},
				onSubjectChange: async (subjectId: string) => {
					const subject = this.subjects.find(s => s.id === subjectId);
					if (subject) {
						this.currentSubject = subject;
						await this.recalculateMatrixCounts();
					}
				}
			}
		);

		renderer.render(matrixContainer);
	}

	private async renderColumns(container: HTMLElement) {
		if (!this.currentSubject || !this.selectedRowId) return;

		const columnsContainer = container.createDiv('kh-columns-section');

		// Get parsed records from plugin
		const parsedRecords = this.getParsedRecords();

		// Render columns using ColumnsRenderer
		const renderer = new ColumnsRenderer(
			this.currentSubject,
			this.cellInstances,
			parsedRecords,
			this.selectedRowId,
			{
				onFileClick: async (filePath: string) => {
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (file && 'extension' in file && 'stat' in file) {
						await this.app.workspace.getLeaf(false).openFile(file as any);
					}
				},
				onCountClick: (type: 'F' | 'H' | 'R' | 'D', cellKey: string) => {
					const cell = this.cellInstances.get(cellKey);
					if (cell) {
						const filterExpr = this.getFilterExpressionForCell(cell, type);
						if (filterExpr) {
							// Get topic from cell for placeholder expansion
							const primaryTopic = (cell as any).primaryTopic || null;
							this.sendFilterToPluginA(filterExpr, primaryTopic, type);
						}
					}
				}
			}
		);

		renderer.render(columnsContainer);
	}

	/**
	 * Get filter expression for a cell based on type (F/H/R/D)
	 */
	private getFilterExpressionForCell(cell: MatrixCell, type: 'F' | 'H' | 'R' | 'D' | 'subject' | 'primary' | 'secondary' | 'intersection'): string | null {
		switch (type) {
			case 'F':
				return cell.getFExpression();
			case 'H':
				return cell.getHExpression();
			case 'R':
			case 'D':
				return cell.getFilterExpression();
			default:
				return cell.getFilterExpression();
		}
	}

	/**
	 * Send filter expression to RecordsViewWidget for record display
	 */
	private async sendFilterToPluginA(filterExpression: string, primaryTopic: Topic | null = null, type?: 'F' | 'H' | 'R' | 'D') {
		console.log('[sendFilterToRecords] Called with:', filterExpression, 'primaryTopic:', primaryTopic?.name, 'type:', type);

		// Expand placeholders if subject/topic is available
		if (this.currentSubject) {
			filterExpression = PlaceholderExpansion.expandPlaceholders(
				filterExpression,
				primaryTopic,
				this.currentSubject
			);
			console.log('[sendFilterToRecords] After placeholder expansion:', filterExpression);
		}

		// Activate Records View and set filter
		await this.plugin.activateRecordsView();

		// Get the Records View instance and set filter
		const leaves = this.plugin.app.workspace.getLeavesOfType(RECORDS_VIEW_TYPE);
		if (leaves.length > 0 && leaves[0].view) {
			const recordsView = leaves[0].view as RecordsViewWidget;
			recordsView.setFilterExpression(filterExpression, type);
		}

		const typeLabel = type === 'F' ? 'Files' : type === 'H' ? 'Headers' : type === 'D' ? 'Dashboard' : 'Records';
		new Notice(`📊 ${typeLabel}: ${filterExpression}`);
	}

	/**
	 * Get parsed records from plugin
	 */
	private getParsedRecords(): ParsedFile[] {
		return this.plugin.parsedRecords || [];
	}
}
