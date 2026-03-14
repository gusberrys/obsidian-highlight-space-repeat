import { MarkdownPostProcessorContext, MarkdownView, TFile } from 'obsidian';
import { DATA_PATHS } from '../shared/data-paths';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { get } from 'svelte/store';
import { settingsDataStore, subjectsStore } from '../stores/settings-store';
import type { ParsedFile, ParsedHeader } from '../interfaces/ParsedFile';
import type { Topic } from '../interfaces/Topic';
import type { SubjectsData } from '../shared/subjects-data';
import { getFileNameFromPath } from '../utils/file-helpers';

// Unique ID for dashboard container to prevent duplicates
const DASHBOARD_CONTAINER_ID = 'kh-subject-dashboard-container';

/**
 * Load parsed records from JSON file
 */
async function loadParsedRecords(plugin: HighlightSpaceRepeatPlugin): Promise<ParsedFile[]> {
	const parsedRecordsPath = DATA_PATHS.PARSED_FILES;
	const exists = await plugin.app.vault.adapter.exists(parsedRecordsPath);

	if (!exists) {
		console.warn('[SubjectDashboard] No parsed records found.');
		return [];
	}

	const jsonContent = await plugin.app.vault.adapter.read(parsedRecordsPath);
	return JSON.parse(jsonContent);
}

/**
 * Get tags from a parsed record (includes both file-level and header tags)
 * Copied from matrix view to ensure consistent tag collection
 */
function getRecordTags(record: ParsedFile): string[] {
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
 * Get files that have a specific topic tag
 */
function getFilesWithTopicTag(
	parsedRecords: ParsedFile[],
	topicTag: string
): ParsedFile[] {
	// Normalize the topic tag
	const normalizedTag = topicTag.startsWith('#') ? topicTag : '#' + topicTag;

	return parsedRecords.filter(record => {
		const fileTags = getRecordTags(record);
		return fileTags.includes(normalizedTag);
	});
}

/**
 * Render subject dashboard in reading view for files in the subjects directory
 */
export async function renderSubjectDashboard(
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	plugin: HighlightSpaceRepeatPlugin
): Promise<void> {
	// Find existing dashboard container first
	const existingDashboard = document.getElementById(DASHBOARD_CONTAINER_ID);

	// Get the current file
	const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) {
		// Not a file, remove any existing dashboard
		if (existingDashboard) {
			existingDashboard.remove();
		}
		return;
	}

	// Get pathToSubjects from settings
	const settings = get(settingsDataStore);
	const pathToSubjects = settings.pathToSubjects;

	// If pathToSubjects is not configured, skip
	if (!pathToSubjects || pathToSubjects.trim() === '') {
		if (existingDashboard) {
			existingDashboard.remove();
		}
		return;
	}

	// Normalize both paths: remove leading underscores and slashes
	const normalizedConfigPath = pathToSubjects.trim().replace(/^[_\/]+/, '').replace(/\/+$/, '');
	const normalizedFilePath = ctx.sourcePath.replace(/^[_\/]+/, '');

	// Check if file is EXACTLY in the subjects directory (not subdirectories)
	const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf('/'));
	if (fileDir !== normalizedConfigPath) {
		// Not in subjects directory, remove any existing dashboard
		if (existingDashboard) {
			existingDashboard.remove();
		}
		return;
	}

	// Extract subject name from file path
	const fileName = file.basename;

	// Find matching subject
	const subjects = get(subjectsStore).subjects;
	const matchingSubject = subjects.find(s => s.name.toLowerCase() === fileName.toLowerCase());

	// Only render if we found a matching subject
	if (!matchingSubject) {
		// Not a matching subject, remove any existing dashboard
		if (existingDashboard) {
			existingDashboard.remove();
		}
		return;
	}

	// Find the root reading view container (like subgoal-aggregator does)
	let readingView = el.closest('.markdown-reading-view');

	// If we can't find it via closest, search in the document
	if (!readingView) {
		const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			readingView = activeView.containerEl.querySelector('.markdown-reading-view');
		}
	}

	if (!readingView) {
		return; // No reading view, abort silently
	}

	// Find existing container by ID
	let dashboardContainer = document.getElementById(DASHBOARD_CONTAINER_ID) as HTMLElement;

	if (dashboardContainer) {
		// Dashboard already exists and has content, don't re-render
		if (dashboardContainer.hasChildNodes()) {
			return;
		}
		// Clear existing content if somehow empty
		dashboardContainer.empty();
	} else {
		// Create new container
		dashboardContainer = document.createElement('div');
		dashboardContainer.id = DASHBOARD_CONTAINER_ID;
		dashboardContainer.className = 'kh-subject-dashboard';

		// Insert as FIRST child of reading view (so it's at the top)
		readingView.prepend(dashboardContainer);
	}

	// Load parsed records and topics
	const parsedRecords = await loadParsedRecords(plugin);

	// Check again after async operation - another call might have finished first
	if (dashboardContainer.hasChildNodes()) {
		return;
	}

	// Get topics from nested structure
	const primaryTopics: Topic[] = matchingSubject.primaryTopics || [];
	const secondaryTopics: Topic[] = matchingSubject.secondaryTopics || [];

	// Render title row with select
	const titleRow = dashboardContainer.createDiv({ cls: 'kh-dashboard-title-row' });
	titleRow.createEl('h2', {
		text: `${matchingSubject.icon || '📁'} ${matchingSubject.name}`,
		cls: 'kh-dashboard-title'
	});

	// Create select dropdown for primary topics
	const select = titleRow.createEl('select', { cls: 'kh-dashboard-topic-select' });
	select.createEl('option', { text: 'orphans', value: 'orphans' });
	primaryTopics.forEach(topic => {
		select.createEl('option', { text: topic.name, value: topic.id });
	});

	// Function to render columns based on selected primary topic
	const renderColumns = (selectedPrimaryTopicId: string) => {
		// Clear existing columns
		const existingColumns = dashboardContainer.querySelector('.kh-dashboard-columns');
		if (existingColumns) {
			existingColumns.remove();
		}

		// Create columns container
		const columnsContainer = dashboardContainer.createDiv({ cls: 'kh-dashboard-columns' });

		// Filter files based on selected primary topic
		let filteredRecords: ParsedFile[] = [];
		if (selectedPrimaryTopicId === 'orphans') {
			// Get orphans - files that don't have any primary topic tags
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			filteredRecords = parsedRecords.filter(record => {
				const tags = getRecordTags(record);
				return !primaryTopicTags.some(tag => tags.includes(tag!));
			});
		} else {
			// Get files for selected primary topic
			const selectedPrimaryTopic = primaryTopics.find(t => t.id === selectedPrimaryTopicId);
			if (selectedPrimaryTopic?.topicTag) {
				filteredRecords = getFilesWithTopicTag(parsedRecords, selectedPrimaryTopic.topicTag);
			}
		}

		// Render each secondary topic as a column (only if it has files)
		secondaryTopics.forEach(topic => {
			// Get files for this secondary topic from filtered records
			let topicFiles: ParsedFile[] = [];
			if (topic.topicTag) {
				topicFiles = filteredRecords.filter(record => {
					const tags = getRecordTags(record);
					return tags.includes(topic.topicTag!);
				}).slice(0, 20);
			}

			// Only render column if there are files
			if (topicFiles.length > 0) {
				const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

				// Column header
				const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
				header.createEl('span', {
					text: `${topic.icon || '📌'} ${topic.name}`,
					cls: 'kh-dashboard-column-title'
				});

				header.createEl('span', {
					text: `(${topicFiles.length})`,
					cls: 'kh-dashboard-column-count'
				});

				// Render files
				const filesList = column.createDiv({ cls: 'kh-dashboard-files-list' });
				topicFiles.forEach(record => {
					const fileItem = filesList.createDiv({ cls: 'kh-dashboard-file-item' });
					fileItem.createEl('span', {
						text: getFileNameFromPath(record.filePath).replace('.md', ''),
						cls: 'kh-dashboard-file-name'
					});
					fileItem.addEventListener('click', async () => {
						const file = plugin.app.vault.getAbstractFileByPath(record.filePath);
						if (file instanceof TFile) {
							// Open in a split leaf (adjacent pane)
							const leaf = plugin.app.workspace.getLeaf('split');
							await leaf.openFile(file);
						}
					});
				});
			}
		});

		// Add "Other" column for files that don't have any secondary topic tags
		const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
		const otherFiles = filteredRecords.filter(record => {
			const tags = getRecordTags(record);
			return !secondaryTopicTags.some(tag => tags.includes(tag!));
		}).slice(0, 20);

		if (otherFiles.length > 0) {
			const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

			// Column header
			const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
			header.createEl('span', {
				text: '📋 Other',
				cls: 'kh-dashboard-column-title'
			});

			header.createEl('span', {
				text: `(${otherFiles.length})`,
				cls: 'kh-dashboard-column-count'
			});

			// Render files
			const filesList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			otherFiles.forEach(record => {
				const fileItem = filesList.createDiv({ cls: 'kh-dashboard-file-item' });
				fileItem.createEl('span', {
					text: getFileNameFromPath(record.filePath).replace('.md', ''),
					cls: 'kh-dashboard-file-name'
				});
				fileItem.addEventListener('click', async () => {
					const file = plugin.app.vault.getAbstractFileByPath(record.filePath);
					if (file instanceof TFile) {
						// Open in a split leaf (adjacent pane)
						const leaf = plugin.app.workspace.getLeaf('split');
						await leaf.openFile(file);
					}
				});
			});
		}
	};

	// Initial render with orphans
	renderColumns('orphans');

	// Listen for select changes
	select.addEventListener('change', () => {
		renderColumns(select.value);
	});
}
