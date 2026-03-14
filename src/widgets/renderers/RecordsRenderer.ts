import type { App } from 'obsidian';
import { TFile, setIcon, MarkdownRenderer, MarkdownView } from 'obsidian';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import type { ParsedFile, ParsedEntry, FlatEntry } from '../../interfaces/ParsedFile';
import type { ActiveChip } from '../../interfaces/ActiveChip';
import type { KeywordStyle } from '../../shared/keyword-style';
import { HighlightSpaceRepeatPlugin } from '../../highlight-space-repeat-plugin';
import { FilterParser } from '../../services/FilterParser';
import { FilterExpressionService } from '../../services/FilterExpressionService';
import { KHEntry } from '../../components/KHEntry';
import { getFileNameFromPath } from '../../utils/file-helpers';
import { getAllKeywords } from '../../utils/parse-helpers';
import { resolveIconKeywordNames } from '../../shared/priority-resolver';

/**
 * RecordsRenderer - Handles rendering of widget filter (records section)
 * Renders file/header/record filter results based on filter type
 */
export class RecordsRenderer {
	private app: App;
	private plugin: HighlightSpaceRepeatPlugin;
	private parsedRecords: ParsedFile[];
	private currentSubject: Subject | null;

	// Filter state
	private filterType: 'F' | 'H' | 'R' | null;
	private filterExpression: string;
	private filterContext: {
		subject: Subject;
		secondaryTopic: Topic | null;
		primaryTopic: Topic | null;
		includesSubjectTag: boolean;
	} | null;
	private filterText: string;

	// UI flags
	private activeChips: Map<string, ActiveChip>;
	private trimSubItems: boolean;
	private topRecordOnly: boolean;
	private showAll: boolean;

	// UI state
	private collapsedFiles: Set<string>;
	private expandedHeaders: Set<string>;

	// Callbacks
	private onFilterTextChange: (text: string) => void;
	private getTags: (subject: Subject, secondaryTopic: Topic | null, primaryTopic: Topic | null, includesSubjectTag: boolean) => string[];
	private getFileLevelTags: (record: ParsedFile) => string[];
	private getRecordTags: (record: ParsedFile) => string[];

	constructor(
		app: App,
		plugin: HighlightSpaceRepeatPlugin,
		parsedRecords: ParsedFile[],
		currentSubject: Subject | null,
		filterState: {
			filterType: 'F' | 'H' | 'R' | null;
			filterExpression: string;
			filterContext: {
				subject: Subject;
				secondaryTopic: Topic | null;
				primaryTopic: Topic | null;
				includesSubjectTag: boolean;
			} | null;
			filterText: string;
		},
		uiFlags: {
			activeChips: Map<string, ActiveChip>;
			trimSubItems: boolean;
			topRecordOnly: boolean;
			showAll: boolean;
		},
		uiState: {
			collapsedFiles: Set<string>;
			expandedHeaders: Set<string>;
		},
		callbacks: {
			onFilterTextChange: (text: string) => void;
			getTags: (subject: Subject, secondaryTopic: Topic | null, primaryTopic: Topic | null, includesSubjectTag: boolean) => string[];
			getFileLevelTags: (record: ParsedFile) => string[];
			getRecordTags: (record: ParsedFile) => string[];
		}
	) {
		this.app = app;
		this.plugin = plugin;
		this.parsedRecords = parsedRecords;
		this.currentSubject = currentSubject;

		this.filterType = filterState.filterType;
		this.filterExpression = filterState.filterExpression;
		this.filterContext = filterState.filterContext;
		this.filterText = filterState.filterText;

		this.activeChips = uiFlags.activeChips;
		this.trimSubItems = uiFlags.trimSubItems;
		this.topRecordOnly = uiFlags.topRecordOnly;
		this.showAll = uiFlags.showAll;

		this.collapsedFiles = uiState.collapsedFiles;
		this.expandedHeaders = uiState.expandedHeaders;

		this.onFilterTextChange = callbacks.onFilterTextChange;
		this.getTags = callbacks.getTags;
		this.getFileLevelTags = callbacks.getFileLevelTags;
		this.getRecordTags = callbacks.getRecordTags;
	}

	/**
	 * Render the widget filter (records section)
	 */
	async render(container: HTMLElement): Promise<void> {
		if (!this.filterType) {
			return; // Don't show filter if not active
		}

		const filterSection = container.createDiv({ cls: 'kh-widget-filter' });

		// Add search input for text filtering
		const searchContainer = filterSection.createDiv({
			cls: 'kh-dashboard-file-search-container',
			attr: {
				style: 'display: flex; gap: 4px; align-items: center; margin-bottom: 8px;'
			}
		});

		const searchInput = searchContainer.createEl('input', {
			cls: 'kh-dashboard-file-search-input',
			type: 'text',
			placeholder: 'Filter results...',
			value: this.filterText,
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); min-width: 150px; flex: 1; background-color: var(--background-primary);'
			}
		});

		// Search on Enter key
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.onFilterTextChange(searchInput.value.trim());
			}
		});

		const searchButton = searchContainer.createEl('button', {
			cls: 'kh-dashboard-file-search-button',
			title: 'Filter',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer; background-color: var(--interactive-accent); color: white;'
			}
		});
		setIcon(searchButton, 'search');

		searchButton.addEventListener('click', () => {
			this.onFilterTextChange(searchInput.value.trim());
		});

		const clearButton = searchContainer.createEl('button', {
			cls: 'kh-dashboard-file-search-clear',
			title: 'Clear filter',
			attr: {
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer; background-color: var(--background-primary);'
			}
		});
		setIcon(clearButton, 'x');

		clearButton.addEventListener('click', () => {
			searchInput.value = '';
			this.onFilterTextChange('');
		});

		// Flag toggle buttons (disabled for now, moved from header)
		const trimToggle = searchContainer.createEl('button', {
			cls: 'kh-filter-toggle',
			text: '💇',
			attr: {
				disabled: 'true',
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: not-allowed; opacity: 0.5;'
			}
		});
		trimToggle.title = 'Slim Records (disabled - moved from header)';

		const topToggle = searchContainer.createEl('button', {
			cls: 'kh-filter-toggle',
			text: '👑',
			attr: {
				disabled: 'true',
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: not-allowed; opacity: 0.5;'
			}
		});
		topToggle.title = 'Top Only (disabled - moved from header)';

		const showAllToggle = searchContainer.createEl('button', {
			cls: 'kh-filter-toggle',
			text: '🅰️',
			attr: {
				disabled: 'true',
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: not-allowed; opacity: 0.5;'
			}
		});
		showAllToggle.title = 'Show All (disabled - moved from header)';

		const legendToggle = searchContainer.createEl('button', {
			cls: 'kh-filter-toggle',
			text: 'ℹ️',
			attr: {
				disabled: 'true',
				style: 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: not-allowed; opacity: 0.5;'
			}
		});
		legendToggle.title = 'Legend (disabled - moved from header)';

		// Render results with text filter applied
		await this.renderFilterResults(filterSection);
	}

	/**
	 * Render filter results based on current filter type
	 */
	private async renderFilterResults(filterSection: HTMLElement): Promise<void> {
		// Remove existing results
		const existingResults = filterSection.querySelector('.kh-widget-filter-results');
		if (existingResults) {
			existingResults.remove();
		}

		const resultsContainer = filterSection.createDiv({ cls: 'kh-widget-filter-results' });

		if (!this.filterContext) {
			return;
		}

		console.log(`[WIDGET FILTER] Type: ${this.filterType}, Expression: ${this.filterExpression}`);
		console.log(`[WIDGET FILTER] Context:`, this.filterContext);

		if (this.filterType === 'F') {
			// File filter - show files matching tags
			console.log(`[WIDGET FILTER] Calling renderFileFilterResults`);
			await this.renderFileFilterResults(resultsContainer);
		} else if (this.filterType === 'H') {
			// Header filter - show headers matching keyword/tag
			console.log(`[WIDGET FILTER] Calling renderHeaderFilterResults`);
			await this.renderHeaderFilterResults(resultsContainer);
		} else if (this.filterType === 'R') {
			// Record filter - show records matching expression
			console.log(`[WIDGET FILTER] Calling renderRecordFilterResults`);
			await this.renderRecordFilterResults(resultsContainer);
		}
	}

	/**
	 * Check if file matches text filter
	 */
	private fileMatchesTextFilter(file: ParsedFile, filterText: string): boolean {
		if (!filterText) return true;

		const query = filterText.toLowerCase();

		// Check file name
		const fileName = getFileNameFromPath(file.filePath).replace('.md', '').toLowerCase();
		if (fileName.includes(query)) return true;

		// Check aliases
		if (file.aliases && file.aliases.length > 0) {
			for (const alias of file.aliases) {
				if (alias.toLowerCase().includes(query)) return true;
			}
		}

		// Check entry text content
		for (const entry of file.entries) {
			if (entry.text && entry.text.toLowerCase().includes(query)) return true;

			// Check keywords
			const keywords = getAllKeywords(entry);
			if (keywords.some(kw => kw.toLowerCase().includes(query))) return true;

			// Check subitem keywords
			if (entry.subItems) {
				for (const subItem of entry.subItems) {
					const subKeywords = subItem.keywords || [];
					if (subKeywords.some(kw => kw.toLowerCase().includes(query))) return true;
					if (subItem.content && subItem.content.toLowerCase().includes(query)) return true;
				}
			}
		}

		return false;
	}

	/**
	 * Check if entry matches text filter
	 */
	private entryMatchesTextFilter(entry: FlatEntry, file: ParsedFile, filterText: string): boolean {
		if (!filterText) return true;

		const query = filterText.toLowerCase();

		// Check file name
		const fileName = getFileNameFromPath(file.filePath).replace('.md', '').toLowerCase();
		if (fileName.includes(query)) return true;

		// Check aliases
		if (file.aliases && file.aliases.length > 0) {
			for (const alias of file.aliases) {
				if (alias.toLowerCase().includes(query)) return true;
			}
		}

		// Check entry text
		if (entry.text && entry.text.toLowerCase().includes(query)) return true;

		// Check entry keywords
		if (entry.keywords) {
			if (entry.keywords.some(kw => kw.toLowerCase().includes(query))) return true;
		}

		// Check subitems
		if (entry.subItems) {
			for (const subItem of entry.subItems) {
				if (subItem.keywords && subItem.keywords.some(kw => kw.toLowerCase().includes(query))) return true;
				if (subItem.content && subItem.content.toLowerCase().includes(query)) return true;
			}
		}

		return false;
	}

	/**
	 * Render file filter results
	 */
	private async renderFileFilterResults(container: HTMLElement): Promise<void> {
		if (!this.filterContext) return;

		const { subject, secondaryTopic, primaryTopic, includesSubjectTag } = this.filterContext;

		// Special handling for subject cell (1x1) and secondary topic cells (1x2, 1x3, etc.)
		let matchingFiles: ParsedFile[];
		if (!secondaryTopic && !primaryTopic) {
			// Subject cell (1x1): has subject tag BUT NOT any primary or secondary topic tags
			const primaryTopics = this.currentSubject?.primaryTopics || [];
			const secondaryTopics = this.currentSubject?.secondaryTopics || [];
			const primaryTopicTags = primaryTopics.map((t: Topic) => t.topicTag).filter(Boolean);
			const secondaryTopicTags = secondaryTopics.map((t: Topic) => t.topicTag).filter(Boolean);

			matchingFiles = this.parsedRecords.filter(file => {
				const fileTags = this.getFileLevelTags(file);
				// Must have subject tag
				const hasSubjectTag = subject.mainTag ? fileTags.includes(subject.mainTag) : false;
				// Must NOT have any primary topic tags
				const hasPrimaryTag = primaryTopicTags.some((tag: string) => fileTags.includes(tag));
				// Must NOT have any secondary topic tags
				const hasSecondaryTag = secondaryTopicTags.some((tag: string) => fileTags.includes(tag));
				return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
			});
		} else if (secondaryTopic && !primaryTopic) {
			// Secondary topic cell (1x2, 1x3, etc.): has secondary tag BUT NOT any primary topic tags
			const primaryTopics = this.currentSubject?.primaryTopics || [];
			const primaryTopicTags = primaryTopics.map((t: Topic) => t.topicTag).filter(Boolean);
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);

			matchingFiles = this.parsedRecords.filter(file => {
				const fileTags = this.getFileLevelTags(file);
				// Must have the secondary topic's tag
				const hasSecondaryTag = tags.every(tag => fileTags.includes(tag));
				// Must NOT have any primary topic tags
				const hasPrimaryTag = primaryTopicTags.some((tag: string) => fileTags.includes(tag));
				return hasSecondaryTag && !hasPrimaryTag;
			});
		} else if (primaryTopic && !secondaryTopic) {
			// Primary topic cell (2x1, 3x1, etc.): has primary tag BUT NOT any secondary topic tags
			const secondaryTopics = this.currentSubject?.secondaryTopics || [];
			const secondaryTopicTags = secondaryTopics.map((t: Topic) => t.topicTag).filter(Boolean);
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);

			matchingFiles = this.parsedRecords.filter(file => {
				const fileTags = this.getFileLevelTags(file);
				// Must have the primary topic's tag
				const hasPrimaryTag = tags.every(tag => fileTags.includes(tag));
				// Must NOT have any secondary topic tags
				const hasSecondaryTag = secondaryTopicTags.some((tag: string) => fileTags.includes(tag));
				return hasPrimaryTag && !hasSecondaryTag;
			});
		} else {
			// Intersection cells (2x2, 2x3, etc.): use getTags() for AND filtering
			const tags = this.getTags(subject, secondaryTopic, primaryTopic, includesSubjectTag);
			matchingFiles = this.parsedRecords.filter(file => {
				const fileTags = this.getFileLevelTags(file);
				return tags.every(tag => fileTags.includes(tag));
			});
		}

		// Apply text filter
		if (this.filterText) {
			matchingFiles = matchingFiles.filter(file => this.fileMatchesTextFilter(file, this.filterText));
		}

		if (matchingFiles.length === 0) {
			container.createEl('div', {
				text: 'No files found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		matchingFiles.forEach(file => {
			const fileItem = container.createDiv({ cls: 'kh-widget-filter-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(file.filePath),
				cls: 'kh-widget-filter-item-name'
			});
			fileItem.addEventListener('click', () => {
				const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
				if (obsidianFile) {
					this.app.workspace.getLeaf().openFile(obsidianFile as any);
				}
			});
		});
	}

	/**
	 * Render header filter results with expandable entries
	 * NOTE: This method is ~468 lines and will be implemented in a follow-up
	 */
	private async renderHeaderFilterResults(container: HTMLElement, ): Promise<void> {
		if (!this.filterContext) return;

		const { subject, secondaryTopic, primaryTopic, includesSubjectTag } = this.filterContext;

		// Group entries by header: Map<"filePath::headerText", { file, headerText, headerLevel, entries }>
		const headerGroups = new Map<string, { file: ParsedFile; headerText: string; headerLevel: number; entries: FlatEntry[] }>();

		// Collect matching headers using EXACT same logic as counting
		if (secondaryTopic && primaryTopic) {
			// Intersection logic: (topic1 in header + topic2 in file) OR (topic2 in header + topic1 in file)
			// Don't pre-filter files by tags - intersection logic checks headers individually
			// A file only needs to have at least ONE of the topic tags (or none if both are keyword-based)

			// Check if this is primary×primary intersection (both are primary topics)
			const isPrimaryPrimaryIntersection = this.currentSubject?.primaryTopics?.some(t => t.id === secondaryTopic.id);

			console.log(`[HEADER FILTER] Rendering headers for intersection:`);
			console.log(`  Primary: ${primaryTopic.name} (tag: ${primaryTopic.topicTag}, keyword: ${primaryTopic.topicKeyword})`);
			console.log(`  Secondary: ${secondaryTopic.name} (tag: ${secondaryTopic.topicTag}, keyword: ${secondaryTopic.topicKeyword})`);
			console.log(`  Is Primary×Primary: ${isPrimaryPrimaryIntersection}`);

			for (const file of this.parsedRecords) {
				// For primary×primary, use file-level tags only. For secondary×primary, use all tags
				const fileTags = isPrimaryPrimaryIntersection ? this.getFileLevelTags(file) : this.getRecordTags(file);

				// Check both topics on file level
				const topic1InFile = !!(primaryTopic.topicTag && fileTags.includes(primaryTopic.topicTag));
				const topic2InFile = !!(secondaryTopic.topicTag && fileTags.includes(secondaryTopic.topicTag));

				// Check each entry's headers (h1/h2/h3)
				for (const entry of file.entries) {
					const headerLevels = [
						entry.h1 ? { level: 1, info: entry.h1 } : null,
						entry.h2 ? { level: 2, info: entry.h2 } : null,
						entry.h3 ? { level: 3, info: entry.h3 } : null
					].filter(h => h !== null);

					for (const headerLevel of headerLevels) {
						const header = headerLevel!.info;
						if (header.text || header.keywords || header.inlineKeywords) {
							// Check topic1 (primary) in header
							let topic1KeywordMatch = false;
							if (primaryTopic.topicKeyword) {
								const headerKeywords = getAllKeywords(header);
								topic1KeywordMatch = headerKeywords.some(kw =>
									kw.toLowerCase() === primaryTopic.topicKeyword!.toLowerCase()
								);
							}
							const topic1TagMatch = !!(primaryTopic.topicTag && header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === primaryTopic.topicTag;
							}));
							const topic1InHeader = topic1KeywordMatch || topic1TagMatch;

							// Check topic2 (secondary) in header
							let topic2KeywordMatch = false;
							if (secondaryTopic.topicKeyword) {
								const headerKeywords = getAllKeywords(header);
								topic2KeywordMatch = headerKeywords.some(kw =>
									kw.toLowerCase() === secondaryTopic.topicKeyword!.toLowerCase()
								);
							}
							const topic2TagMatch = !!(secondaryTopic.topicTag && header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === secondaryTopic.topicTag;
							}));
							const topic2InHeader = topic2KeywordMatch || topic2TagMatch;

							// Check intersection: (topic1 in header + topic2 on file) OR (topic2 in header + topic1 on file)
							const validCase1 = topic1InHeader && topic2InFile;
							const validCase2 = topic2InHeader && topic1InFile;

							if (validCase1 || validCase2) {
								console.log(`  ✓ MATCH FOUND: ${file.filePath} :: ${header.text}`);
								console.log(`    validCase1 (topic1 in header + topic2 on file): ${validCase1}`);
								console.log(`    validCase2 (topic2 in header + topic1 on file): ${validCase2}`);
								console.log(`    topic1InFile: ${topic1InFile}, topic2InFile: ${topic2InFile}`);
								console.log(`    topic1InHeader: ${topic1InHeader}, topic2InHeader: ${topic2InHeader}`);
								console.log(`    File tags: ${fileTags.join(', ')}`);

								const groupKey = `${file.filePath}::${header.text}`;
								if (!headerGroups.has(groupKey)) {
									headerGroups.set(groupKey, {
										file,
										headerText: header.text,
										headerLevel: headerLevel!.level,
										entries: []
									});
								}
								headerGroups.get(groupKey)!.entries.push(entry);
							}
						}
					}
				}
			}
		} else {
			// Single topic logic: keyword OR tag in header
			const topic = secondaryTopic || primaryTopic;
			if (topic) {
				for (const file of this.parsedRecords) {
					for (const entry of file.entries) {
						const headerLevels = [
							entry.h1 ? { level: 1, info: entry.h1 } : null,
							entry.h2 ? { level: 2, info: entry.h2 } : null,
							entry.h3 ? { level: 3, info: entry.h3 } : null
						].filter(h => h !== null);

						for (const headerLevel of headerLevels) {
							const header = headerLevel!.info;
							if (header.text || header.keywords || header.inlineKeywords) {
								// Check if topic keyword is in header.keywords array
								let keywordMatch = false;
								if (topic.topicKeyword && header.keywords) {
									keywordMatch = header.keywords?.some(kw =>
										kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
									);
								}

								// Check if header tags include the topic tag
								const tagMatch = topic.topicTag && header.tags?.some(tag => {
									const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
									return normalizedTag === topic.topicTag;
								});

								if (keywordMatch || tagMatch) {
									const groupKey = `${file.filePath}::${header.text}`;
									if (!headerGroups.has(groupKey)) {
										headerGroups.set(groupKey, {
											file,
											headerText: header.text,
											headerLevel: headerLevel!.level,
											entries: []
										});
									}
									headerGroups.get(groupKey)!.entries.push(entry);
								}
							}
						}
					}
				}
			} else {
				// Subject cell: use subject's keyword OR tag
				if (subject.keyword || subject.mainTag) {
					for (const file of this.parsedRecords) {
						for (const entry of file.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text || header.keywords || header.inlineKeywords) {
									// Check if subject keyword is in header.keywords array
									let keywordMatch = false;
									if (subject.keyword && header.keywords) {
										keywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === subject.keyword!.toLowerCase()
										);
									}

									// Check if header tags include the subject tag
									const tagMatch = subject.mainTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === subject.mainTag;
									});

									if (keywordMatch || tagMatch) {
										const groupKey = `${file.filePath}::${header.text}`;
										if (!headerGroups.has(groupKey)) {
											headerGroups.set(groupKey, {
												file,
												headerText: header.text,
												headerLevel: headerLevel!.level,
												entries: []
											});
										}
										headerGroups.get(groupKey)!.entries.push(entry);
									}
								}
							}
						}
					}
				}
			}
		}

		// Apply text filter to header groups
		if (this.filterText) {
			const filteredGroups = new Map<string, { file: ParsedFile; headerText: string; headerLevel: number; entries: FlatEntry[] }>();
			for (const [key, group] of headerGroups.entries()) {
				// Filter entries that match the text filter
				const filteredEntries = group.entries.filter(entry =>
					this.entryMatchesTextFilter(entry, group.file, this.filterText)
				);
				if (filteredEntries.length > 0) {
					filteredGroups.set(key, { ...group, entries: filteredEntries });
				}
			}
			headerGroups.clear();
			filteredGroups.forEach((value, key) => headerGroups.set(key, value));
		}

		console.log(`[HEADER FILTER] Total header groups found: ${headerGroups.size}`);
		if (headerGroups.size > 0) {
			console.log(`  Headers:`);
			for (const [key, group] of headerGroups.entries()) {
				console.log(`    - ${key} (${group.entries.length} entries)`);
			}
		}

		if (headerGroups.size === 0) {
			console.log(`[HEADER FILTER] ❌ NO HEADERS FOUND - Showing empty message`);
			container.createEl('div', {
				text: 'No headers found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		for (const { file, headerText, headerLevel, entries } of headerGroups.values()) {
			// Get header info from first entry
			const firstEntry = entries[0];
			const headerInfo = headerLevel === 1 ? firstEntry.h1 : headerLevel === 2 ? firstEntry.h2 : firstEntry.h3;
			if (!headerInfo) continue;

			// Create unique ID for this header
			const headerId = `${file.filePath}:${headerLevel}:${headerText}`;
			const isExpanded = this.expandedHeaders.has(headerId);

			// Header group container
			const headerGroup = container.createDiv({ cls: 'kh-widget-filter-file-group' });

			// Header with toggle
			const headerItem = headerGroup.createDiv({ cls: 'kh-widget-filter-file-header' });

			// Toggle icon
			const toggleIcon = headerItem.createEl('span', {
				text: isExpanded ? '▼' : '▶',
				cls: 'kh-header-toggle'
			});
			toggleIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.expandedHeaders.has(headerId)) {
					this.expandedHeaders.delete(headerId);
				} else {
					this.expandedHeaders.add(headerId);
				}
				// Re-render to show/hide entries
				this.renderFilterResults(container.parentElement as HTMLElement);
			});

			// Truncate filename if longer than 10 chars
			const truncateFileName = (name: string, maxLength: number = 10): string => {
				if (name.length <= maxLength) return name;
				return name.substring(0, maxLength) + '...';
			};

			// Header content (clickable to open file)
			const headerContent = headerItem.createEl('span', {
				cls: 'kh-widget-filter-file-name'
			});
			headerContent.style.cursor = 'pointer';
			headerContent.style.display = 'inline-flex';
			headerContent.style.alignItems = 'center';
			headerContent.style.gap = '4px';

			// Filename (truncated, without .md extension)
			const fileName = getFileNameFromPath(file.filePath).replace(/\.md$/, '');
			headerContent.createEl('span', {
				text: truncateFileName(fileName),
				cls: 'kh-header-filename'
			}).style.fontWeight = 'bold';

			// Separator and icons (only display keywords, NOT inline keywords)
			const headerKeywords = headerInfo.keywords || [];
			if (headerKeywords.length > 0) {
				headerContent.createEl('span', { text: '::' }).style.opacity = '0.5';

				// Render keyword icons
				headerKeywords.forEach((kw, idx) => {
					const mark = headerContent.createEl('mark', { cls: `kh-icon ${kw}` });
					mark.innerHTML = '&nbsp;';
					if (idx < headerKeywords.length - 1) {
						headerContent.createEl('span', { text: ' ' });
					}
				});

				headerContent.createEl('span', { text: '::' }).style.opacity = '0.5';
			}

			// Header text (render markdown)
			const headerTextSpan = headerContent.createEl('span', { cls: 'kh-header-text' });
			if (headerInfo.text) {
				MarkdownRenderer.render(
					this.app,
					headerInfo.text,
					headerTextSpan,
					file.filePath,
					this.plugin
				);
			}

			// Tags
			if (headerInfo.tags && headerInfo.tags.length > 0) {
				headerInfo.tags.forEach(tag => {
					const tagEl = headerContent.createEl('span', {
						text: tag.startsWith('#') ? tag : '#' + tag,
						cls: 'kh-header-tag'
					});
					tagEl.style.color = 'var(--text-accent)';
					tagEl.style.marginLeft = '4px';
					tagEl.style.fontSize = '0.9em';
				});
			}

			headerContent.addEventListener('click', async (e: MouseEvent) => {
				// Only open file on Command/Ctrl + click
				if (e.metaKey || e.ctrlKey) {
					const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
					if (obsidianFile instanceof TFile) {
						// Open the file
						const leaf = this.app.workspace.getLeaf(false);
						await leaf.openFile(obsidianFile);

						// Search for the header line in the file
						const view = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (view && view.editor) {
							const content = view.editor.getValue();
							const lines = content.split('\n');

							// Build header pattern based on level (e.g., "## Run on" for h2)
							const headerPrefix = '#'.repeat(headerLevel);
							const headerPattern = `${headerPrefix} ${headerText}`;

							// Find the line containing this exact header
							let headerLine = -1;
							for (let i = 0; i < lines.length; i++) {
								const line = lines[i].trim();
								// Match "## headerText" or "## headerText #tag" etc
								if (line.startsWith(headerPattern)) {
									headerLine = i;
									break;
								}
							}

							// Navigate to the header line
							if (headerLine >= 0) {
								view.editor.setCursor({ line: headerLine, ch: 0 });
								const scrollToLine = Math.max(0, headerLine - 3);
								view.editor.scrollIntoView({
									from: { line: scrollToLine, ch: 0 },
									to: { line: scrollToLine, ch: 0 }
								}, true);
							}
						}
					}
				}
			});

			// Show entries if expanded
			if (isExpanded && entries && entries.length > 0) {
				const entriesContainer = headerGroup.createDiv({ cls: 'kh-widget-filter-entries' });

				for (const entry of entries) {
					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						// Resolve which keyword provides the icon based on combinePriority
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

						// Render icons from all keywords with Icon/StyleAndIcon priority
						for (const iconKeyword of iconKeywords) {
							const mark = entryItem.createEl('mark', { cls: `kh-icon ${iconKeyword}` });
							mark.innerHTML = '&nbsp;';
						}
						entryItem.createEl('span', { text: ' ', cls: 'kh-separator' });

						// Render entry text with image/quote support (compact mode)
						await KHEntry.renderKeywordEntry(
							entryItem,
							entry,
					file,
							this.plugin,
							true // compact mode for matrix
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});
					} else if (entry.type === 'codeblock') {
						const entryItem = entriesContainer.createDiv({ cls: 'kh-widget-filter-entry kh-widget-filter-codeblock' });

						// Render code block with syntax highlighting (non-blocking)
						const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							entryItem,
							file.filePath,
							this.plugin
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});
					}
				}
			}
		}
	}

	/**
	 * Render record filter results
	 * Supports W: syntax for WHERE clause (file filtering)
	 */

	private async renderRecordFilterResults(container: HTMLElement, ): Promise<void> {
		try {
			// Use FilterExpressionService.getMatchingRecords() - SINGLE SOURCE OF TRUTH
			const matchingFiles = FilterExpressionService.getMatchingRecords(
				this.parsedRecords,
				this.filterExpression,
				this.filterContext?.primaryTopic || null,
				this.filterContext?.subject,
				this.filterContext?.includesSubjectTag || false
			);

			if (matchingFiles.length === 0) {
				container.createEl('div', {
					text: 'No records found',
					cls: 'kh-widget-filter-empty'
				});
				return;
			}

			// No limit on results - show all matching entries
			let limitedFiles = matchingFiles;

			// Compile SELECT expression for UI-level filtering (topRecordOnly, trimSubItems)
			// We need this because those features filter AFTER getting the base matching records
			let selectCompiled: import('../../interfaces/FilterInterfaces').CompiledFilter | undefined;
			if ((this.topRecordOnly || this.trimSubItems) && this.filterExpression) {
				try {
					// Transform and extract SELECT clause
					const hasExplicitOperators = /\b(AND|OR)\b/.test(this.filterExpression);
					const expr = hasExplicitOperators
						? this.filterExpression
						: FilterExpressionService.transformFilterExpression(this.filterExpression);

					const hasWhere = /\s+[Ww]:\s+/.test(expr);
					const selectExpr = hasWhere ? expr.split(/\s+[Ww]:\s+/)[0].trim() : expr;
					selectCompiled = FilterParser.compile(selectExpr);
				} catch (error) {
					console.error('[renderRecordFilterResults] Failed to compile SELECT for UI filtering:', error);
				}
			}

			// Apply topRecordOnly filter if enabled - remove records where match is only in sub-items
			if (this.topRecordOnly && this.filterExpression && selectCompiled) {
				limitedFiles = limitedFiles.filter(({ entry, file }) => {
					// Keep codeblocks - they are always top-level entries
					if (entry.type === 'codeblock') {
						return true;
					}
					// For keyword entries, check if SELECT matches using ONLY top-level keywords
					// Create a copy of entry with only top-level keywords (no subitems)
					const topLevelEntry: FlatEntry = {
						...entry,
						keywords: entry.keywords || []
						// subItems are ignored for top-level matching
					};
					// Re-evaluate SELECT clause with top-level keywords only
					return FilterParser.evaluateFlatEntry(selectCompiled.ast, topLevelEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled.modifiers);
				});
			}

			// Apply trim filter if enabled - filter sub-items to only those matching SELECT clause
			if (this.trimSubItems && selectCompiled) {
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

			// Apply text filter
			if (this.filterText) {
				limitedFiles = limitedFiles.filter(({ entry, file }) =>
					this.entryMatchesTextFilter(entry, file, this.filterText)
				);
			}

			// Group records by file
			const recordsByFile = new Map<string, Array<{ entry: ParsedEntry; file: ParsedFile }>>();
			limitedFiles.forEach(({ entry, file }) => {
				const filePath = file.filePath;
				if (!recordsByFile.has(filePath)) {
					recordsByFile.set(filePath, []);
				}
				recordsByFile.get(filePath)!.push({ entry, file });
			});

			// Render grouped by file
			for (const [filePath, entries] of recordsByFile) {
				// File header (clickable to open file)
				const fileGroup = container.createDiv({ cls: 'kh-widget-filter-file-group' });
				const fileHeader = fileGroup.createDiv({ cls: 'kh-widget-filter-file-header' });
				fileHeader.style.cursor = 'pointer';

				// Check if this file is collapsed
				const isCollapsed = this.collapsedFiles.has(filePath);

				// Add toggle icon
				const toggleIcon = fileHeader.createEl('span', {
					cls: 'kh-header-toggle',
					text: isCollapsed ? '▸' : '▾'
				});
				toggleIcon.style.marginRight = '4px';

				fileHeader.createEl('span', {
					text: getFileNameFromPath(filePath).replace(/\.md$/, ''),
					cls: 'kh-widget-filter-file-name'
				});
				fileHeader.createEl('span', {
					text: ` (${entries.length})`,
					cls: 'kh-widget-filter-file-count'
				});

				// Add click handler to toggle collapse/expand
				fileHeader.addEventListener('click', async (e: MouseEvent) => {
					// Command/Ctrl + click: open file
					if (e.metaKey || e.ctrlKey) {
						const file = this.app.vault.getAbstractFileByPath(filePath);
						if (file instanceof TFile) {
							await this.app.workspace.getLeaf(false).openFile(file);
						}
					} else {
						// Regular click: toggle collapse/expand
						if (this.collapsedFiles.has(filePath)) {
							this.collapsedFiles.delete(filePath);
						} else {
							this.collapsedFiles.add(filePath);
						}
						// Re-render to show/hide entries
						await this.renderFilterResults(container.closest('.kh-widget-filter') as HTMLElement);
					}
				});

				// Entries under this file - only render if not collapsed
				if (!isCollapsed) {
					const entriesContainer = fileGroup.createDiv({ cls: 'kh-widget-filter-entries' });

				// Render all entries in PARALLEL - NO async in map, return promises directly
				await Promise.all(entries.map(({ entry, file }) => {
					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						// Resolve which keyword provides the icon based on combinePriority
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

						// Render icons from all keywords with Icon/StyleAndIcon priority
						for (const iconKeyword of iconKeywords) {
							const mark = entryItem.createEl('mark', { cls: `kh-icon ${iconKeyword}` });
							mark.innerHTML = '&nbsp;';
						}
						entryItem.createEl('span', { text: ' ', cls: 'kh-separator' });


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});


						// Return promise directly, don't await
						return KHEntry.renderKeywordEntry(
							entryItem,
							entry,
					file,
							this.plugin,
							true // compact mode for matrix
						);

					} else if (entry.type === 'codeblock') {
						const entryItem = entriesContainer.createDiv({ cls: 'kh-widget-filter-entry kh-widget-filter-codeblock' });

						// Render code block with syntax highlighting (non-blocking)
						const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							entryItem,
							file.filePath,
							this.plugin
						);


						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							const obsidianFile = this.app.vault.getAbstractFileByPath(file.filePath);
							if (obsidianFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(obsidianFile as any, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});

					return Promise.resolve();
					}
				}));
				}
			}
		} catch (error) {
			container.createEl('div', {
				text: 'Invalid filter expression',
				cls: 'kh-widget-filter-error'
			});
		}
	}


	/**
	 * Resolve which keywords should provide icons (uses centralized logic)
	 * Returns array of keyword strings to display icons from
	 */
	private resolveIconKeywords(keywordStrings: string[]): string[] {
		if (!keywordStrings || keywordStrings.length === 0) {
			return keywordStrings || [];
		}

		// Convert keyword strings to KeywordStyle objects
		const keywordStyles: KeywordStyle[] = keywordStrings
			.map(kw => this.plugin.api.getKeywordStyle(kw))
			.filter((style): style is KeywordStyle => style !== undefined);

		if (keywordStyles.length === 0) {
			return [keywordStrings[0]];
		}

		// Use centralized icon resolution logic
		return resolveIconKeywordNames(keywordStyles);
	}

	/**
	 * Get the CSS class to use for a keyword entry
	 * Uses keyword's configured CSS class (ccssc field) if available,
	 * otherwise falls back to the keyword name
	 */
	private getKeywordClass(keywordName: string): string {
		const keywordStyle = this.plugin.api.getKeywordStyle(keywordName);

		// Use configured CSS class if it exists and is not empty
		if (keywordStyle?.ccssc && keywordStyle.ccssc.trim()) {
			return keywordStyle.ccssc.trim();
		}

		// Fallback to keyword name
		return keywordName;
	}
}
