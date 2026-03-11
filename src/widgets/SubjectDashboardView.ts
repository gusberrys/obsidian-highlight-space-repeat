import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, MarkdownView, Notice, setIcon } from 'obsidian';
import { DATA_PATHS } from '../shared/data-paths';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';
import type { ParsedFile, ParsedHeader, ParsedEntry, FlatEntry } from '../interfaces/ParsedFile';
import { get } from 'svelte/store';
import { settingsDataStore, subjectsStore } from '../stores/settings-store';
import { FilterParser } from '../services/FilterParser';
import { KHEntry } from '../components/KHEntry';
import { resolveIconKeywordNames } from '../shared/priority-resolver';
import type { KeywordStyle } from '../shared/keyword-style';
import { fileHasMatch } from '../utils/filter-helpers';
import { getFileNameFromPath } from '../utils/file-helpers';

export const SUBJECT_DASHBOARD_VIEW_TYPE = 'kh-subject-dashboard-view';

export class SubjectDashboardView extends ItemView {
	private plugin: HighlightSpaceRepeatPlugin;
	private currentSubject: Subject | null = null;
	private subjects: Subject[] = [];
	private selectedPrimaryTopicId: string = 'orphans';
	private activeFilterExpression: string | null = null;
	private userCustomExpression: boolean = false; // Flag to preserve user-edited expressions
	private activeChips: Set<string> = new Set(); // Chips currently in the filter expression (active)
	private availableChips: { categories: string[], keywords: string[], codeblocks: string[] } = { categories: [], keywords: [], codeblocks: [] }; // Chip palette - all chips visible (active or inactive)
	private selectedRecords: ParsedFile[] | null = null;
	private selectedContext: string = '';
	private selectedKeywordFilter: string | null = null; // Filter entries by this keyword when showing records
	private selectedTopicTag: string | null = null; // Filter headers by this tag when showing headers
	private selectedPrimaryTopic: Topic | null = null; // Primary topic for intersection
	private selectedSecondaryTopic: Topic | null = null; // Secondary topic for intersection
	private selectedHeaderMode: boolean = false; // Show headers instead of entries
	private expandedHeaders: Set<string> = new Set(); // Track expanded headers
	private collapsedFiles: Set<string> = new Set(); // Track collapsed file groups (files are expanded by default)
	private allFilesCollapsed: boolean = false; // Track if collapse/expand all button is in "all collapsed" state
	private lastAutoAppliedContext: string = ''; // Track last auto-applied filter context to avoid re-applying on re-renders
	private shouldApplyFilterOnRender: boolean = false; // Flag to request filter application on next render
	private applyChipFiltering: boolean = false; // Flag to control chip filtering (true for filter expression, false for column clicks)
	private selectedFilterExpression: string | null = null; // Filter expression to apply to entries when showing records
	private trimSubItems: boolean = false; // Slim mode: filter sub-items to only show matching keywords (\s)
	private topRecordOnly: boolean = false; // Top mode: only show records where keyword is top-level (\t)
	private showAllRecords: boolean = false; // All mode: show all records regardless of activated chips (\a)

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return SUBJECT_DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Subject Dashboard';
	}

	getIcon(): string {
		return 'layout-grid';
	}

	async onOpen(): Promise<void> {
		// Subscribe to subjects store
		subjectsStore.subscribe((data) => {
			this.subjects = data.subjects || [];

			// Preserve currently selected subject or default to first
			if (this.currentSubject) {
				this.currentSubject = this.subjects.find(s => s.id === this.currentSubject!.id) || this.currentSubject;
			} else if (this.subjects.length > 0) {
				this.currentSubject = this.subjects[0];
			}

			this.render();
		});

		this.render();
	}

	async onClose(): Promise<void> {
		// Clean up
	}

	/**
	 * Set current subject (called from command)
	 */
	setSubject(subject: Subject): void {
		this.currentSubject = subject;
		this.selectedPrimaryTopicId = 'orphans';
		this.updateFilterExpression();
		this.render();
	}

	private async render(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('kh-subject-dashboard-view');

		// Add RED border to indicate Dashboard View (uses mainDashboardFilter)
		container.style.border = '3px solid rgba(255, 0, 0, 0.3)';
		container.style.borderRadius = '4px';

		// Update filter expression based on current context
		this.updateFilterExpression();

		if (!this.currentSubject) {
			container.createEl('p', { text: 'No subject selected', cls: 'kh-empty-message' });
			return;
		}

		// Get topics from nested structure
		const primaryTopics: Topic[] = this.currentSubject.primaryTopics || [];
		const secondaryTopics: Topic[] = this.currentSubject.secondaryTopics || [];

		// Secondary topics reminder (shown at top)
		this.renderSecondaryTopicsReminder(container, secondaryTopics);

		// Sync button states from expression (before rendering header)
		this.syncButtonsFromExpression();

		// Header with subject selector, topic selector, and chips
		await this.renderHeader(container, primaryTopics);

		// Dashboard content
		await this.renderDashboard(container);

		// Selected records section (if any records selected)
		// This ensures records are shown even after re-renders (e.g., clicking chips)
		if (this.selectedRecords && this.selectedRecords.length > 0) {
			await this.renderSelectedRecords(container);
		}
	}

	/**
	 * Render secondary topics reminder at the top
	 * For fhDisabled topics, shows record count from matrix
	 */
	private renderSecondaryTopicsReminder(container: HTMLElement, secondaryTopics: Topic[]): void {
		if (secondaryTopics.length === 0) return;

		// Get selected primary topic index for matrix lookups
		const primaryTopics = this.currentSubject?.primaryTopics || [];
		const primaryTopicIndex = primaryTopics.findIndex(t => t.id === this.selectedPrimaryTopicId);

		const reminder = container.createDiv({ cls: 'kh-secondary-topics-reminder' });
		reminder.style.backgroundColor = 'var(--background-secondary)';
		reminder.style.borderRadius = '4px';
		reminder.style.fontSize = '0.9em';
		reminder.style.borderLeft = '3px solid var(--interactive-accent)';

		// Title
		const title = reminder.createEl('span', {
			text: 'Secondary Topics: ',
			cls: 'kh-reminder-title'
		});
		title.style.fontWeight = '600';
		title.style.marginRight = '8px';
		title.style.color = 'var(--text-muted)';

		// Topics container
		const topicsContainer = reminder.createEl('span', { cls: 'kh-reminder-topics' });

		// Add each topic as a compact tag
		secondaryTopics.forEach((topic, index) => {
			const topicTag = topicsContainer.createEl('span', { cls: 'kh-reminder-topic-tag' });
			topicTag.style.display = 'inline-flex';
			topicTag.style.alignItems = 'center';
			topicTag.style.gap = '4px';
			topicTag.style.padding = '2px 8px';
			topicTag.style.borderRadius = '10px';
			topicTag.style.fontSize = '0.85em';

			// Apply red styling for fhDisabled topics
			const isFHDisabled = topic.fhDisabled === true;
			if (isFHDisabled) {
				topicTag.style.backgroundColor = 'rgba(255, 100, 100, 0.15)';
				topicTag.style.border = '1px solid rgba(255, 100, 100, 0.4)';
			} else {
				topicTag.style.backgroundColor = 'var(--background-primary)';
				topicTag.style.border = '1px solid var(--background-modifier-border)';
			}

			// Icon
			if (topic.icon) {
				topicTag.createEl('span', { text: topic.icon });
			}

			// Name with # prefix if topicTag exists
			const tagText = topic.topicTag ? topic.topicTag : `#${topic.name.toLowerCase()}`;
			const tagTextEl = topicTag.createEl('span', {
				text: tagText,
				cls: 'kh-reminder-tag-text'
			});
			tagTextEl.style.color = isFHDisabled ? 'white' : 'var(--text-accent)';

		// For fhDisabled topics, add record count from matrix
		if (isFHDisabled && this.currentSubject?.matrix?.cells) {
			const col = index + 2; // Secondary topics start at column 2
			let cellKey: string | undefined;

			if (this.selectedPrimaryTopicId === 'orphans') {
				// When in orphans mode, use row 1 (secondary topic header cells: 1x2, 1x3, etc.)
				cellKey = `1x${col}`;
			} else if (primaryTopicIndex >= 0) {
				// When a primary topic is selected, use intersection cell
				const rowNum = primaryTopicIndex + 2; // Primary topics start at row 2
				cellKey = `${rowNum}x${col}`;
			}

			if (cellKey) {
				const cell = this.currentSubject.matrix.cells[cellKey];
				const recordCount = cell?.recordCount || 0;

				if (recordCount > 0) {
					const countEl = topicTag.createEl('span', {
						text: `-${recordCount}`,
						cls: 'kh-count-entries'
					});
					countEl.style.color = 'white';
					countEl.style.fontWeight = 'bold';
					countEl.style.cursor = 'pointer';

					// Add click handler to show records
					countEl.addEventListener('click', async (e) => {
						e.stopPropagation();


						// Get selected primary topic
						const selectedPrimaryTopic = this.getSelectedPrimaryTopic();

						// Use filter expression exactly like matrix does - pass ALL records and filter at entry level
						let expandedExpr: string | null = null;
						if (topic.appliedFilterExpIntersection && selectedPrimaryTopic) {
							// Intersection mode: use appliedFilterExpIntersection with primary topic placeholders
							expandedExpr = this.expandPlaceholders(
								topic.appliedFilterExpIntersection,
								selectedPrimaryTopic,
								this.currentSubject
							);
						} else if (topic.FilterExpHeader) {
							// Orphans mode: use FilterExpHeader (standalone, no placeholders)
							expandedExpr = topic.FilterExpHeader;
						}

						this.applyChipFiltering = false;
						const allRecords = await this.loadParsedRecords();
						this.selectedRecords = allRecords;
						this.selectedContext = `${topic.name}: ${recordCount} entries`;
						this.selectedKeywordFilter = null;
						this.selectedTopicTag = null;
						this.selectedHeaderMode = false;
						this.selectedFilterExpression = this.appendModifiers(expandedExpr, this.extractModifiers(this.activeFilterExpression));


						await this.updateRecordsSection();
					});
				}
			}
		}
		});
	}

	private async renderHeader(container: HTMLElement, primaryTopics: Topic[]): Promise<void> {
		const header = container.createDiv({ cls: 'kh-dashboard-view-header' });

		// Subject selector dropdown
		if (this.subjects.length > 0) {
			const select = header.createEl('select', { cls: 'kh-subject-select' });

			this.subjects.forEach(subject => {
				const option = select.createEl('option', {
					text: `${subject.icon || '📁'} ${subject.name}`,
					value: subject.id
				});
				if (this.currentSubject && subject.id === this.currentSubject.id) {
					option.selected = true;
				}
			});

			select.addEventListener('change', (e) => {
				const selectedId = (e.target as HTMLSelectElement).value;
				this.currentSubject = this.subjects.find(s => s.id === selectedId) || null;
				this.selectedPrimaryTopicId = 'orphans';
				// Clear all selection state when changing subjects
				this.activeChips.clear();
				this.availableChips = { categories: [], keywords: [], codeblocks: [] }; // Reset chip palette
				this.applyChipFiltering = false;
			this.selectedRecords = null;
				this.selectedContext = '';
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.expandedHeaders.clear();
				this.collapsedFiles.clear();
				this.allFilesCollapsed = false;
				this.userCustomExpression = false; // Reset to use new subject's expression
				this.updateFilterExpression();
				this.render();
			});
		}

		// Primary topic selector - icon buttons
		const topicButtonsContainer = header.createEl('div', { cls: 'kh-dashboard-topic-buttons' });
		topicButtonsContainer.style.display = 'inline-flex';
		topicButtonsContainer.style.gap = '4px';
		topicButtonsContainer.style.alignItems = 'center';

		// First button: Subject itself (orphans)
		const subjectButton = topicButtonsContainer.createEl('button', {
			cls: 'kh-topic-button',
			title: this.currentSubject?.name || 'Subject'
		});
		subjectButton.style.padding = '4px 8px';
		subjectButton.style.borderRadius = '4px';
		subjectButton.style.border = '1px solid var(--background-modifier-border)';
		subjectButton.style.cursor = 'pointer';
		subjectButton.style.fontSize = '1.2em';

		if (this.selectedPrimaryTopicId === 'orphans') {
			subjectButton.style.backgroundColor = 'var(--interactive-accent)';
			subjectButton.style.color = 'white';
		} else {
			subjectButton.style.backgroundColor = 'var(--background-primary)';
		}

		subjectButton.setText(this.currentSubject?.icon || '📁');
		subjectButton.addEventListener('click', () => {
			this.selectedPrimaryTopicId = 'orphans';
			this.userCustomExpression = false; // Reset to use topic's default expression
			this.availableChips = { categories: [], keywords: [], codeblocks: [] }; // Reset chip palette
			this.updateFilterExpression();
			this.render();
		});

		// Buttons for each primary topic
		primaryTopics.forEach(topic => {
			const topicButton = topicButtonsContainer.createEl('button', {
				cls: 'kh-topic-button',
				title: topic.name
			});
			topicButton.style.padding = '4px 8px';
			topicButton.style.borderRadius = '4px';
			topicButton.style.border = '1px solid var(--background-modifier-border)';
			topicButton.style.cursor = 'pointer';
			topicButton.style.fontSize = '1.2em';

			if (this.selectedPrimaryTopicId === topic.id) {
				topicButton.style.backgroundColor = 'var(--interactive-accent)';
				topicButton.style.color = 'white';
			} else {
				topicButton.style.backgroundColor = 'var(--background-primary)';
			}

			topicButton.setText(topic.icon || '📌');
			topicButton.addEventListener('click', () => {
				this.selectedPrimaryTopicId = topic.id;
				this.userCustomExpression = false; // Reset to use topic's default expression
				this.availableChips = { categories: [], keywords: [], codeblocks: [] }; // Reset chip palette
				this.updateFilterExpression();
				this.render();
			});
		});

		// Filter expression input field with buttons
		const filterDiv = header.createDiv({ cls: 'kh-dashboard-filter-expression-container' });
		filterDiv.style.display = 'flex';
		filterDiv.style.gap = '8px';
		filterDiv.style.alignItems = 'center';
		filterDiv.style.flex = '1';

		const expressionInput = filterDiv.createEl('input', {
			type: 'text',
			cls: 'kh-widget-filter-expression',
			placeholder: 'Filter expression...'
		});
		expressionInput.value = this.activeFilterExpression || '';
		expressionInput.style.flex = '1';
		expressionInput.style.minWidth = '300px';

		// Lightning button to apply filter expression
		const applyFilterButton = filterDiv.createEl('button', {
			cls: 'kh-dashboard-apply-filter-button',
			title: 'Apply filter expression'
		});
		applyFilterButton.style.padding = '4px 12px';
		applyFilterButton.style.display = 'flex';
		applyFilterButton.style.alignItems = 'center';
		applyFilterButton.style.gap = '4px';

		const lightningIcon = applyFilterButton.createSpan();
		setIcon(lightningIcon, 'zap');

		applyFilterButton.addEventListener('click', async () => {
			const newExpression = expressionInput.value.trim();
			this.activeFilterExpression = newExpression || null;
			this.userCustomExpression = true; // Mark as user-edited to prevent override

			// Request filter application
			this.shouldApplyFilterOnRender = true;

			// Trigger re-render which will update chips and apply the filter
			this.render();
		});

		// Handle Enter key to apply filter
	// Sync button states when expression input changes

		expressionInput.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				applyFilterButton.click();
			}
		});

		// 💇 Slim toggle button
		const slimToggle = filterDiv.createEl('button', {
			cls: 'kh-filter-toggle' + (this.trimSubItems ? ' kh-filter-toggle-active' : ''),
			text: '💇',
			title: 'Toggle Slim Records: Filter sub-items to only show matching keywords (\\s)'
		});
		slimToggle.onclick = () => {
			this.trimSubItems = !this.trimSubItems;
			this.toggleFilterModifier('\\s', this.trimSubItems);
		expressionInput.value = this.activeFilterExpression || '';
			this.render();
		};

		// 👑 Top Only toggle button
		const topToggle = filterDiv.createEl('button', {
			cls: 'kh-filter-toggle' + (this.topRecordOnly ? ' kh-filter-toggle-active' : ''),
			text: '👑',
			title: 'Toggle Show Top Only: Only show records where keyword is top-level (\\t)'
		});
		topToggle.onclick = () => {
			this.topRecordOnly = !this.topRecordOnly;
			this.toggleFilterModifier('\\t', this.topRecordOnly);
		expressionInput.value = this.activeFilterExpression || '';
			this.render();
		};

		// 🌐 All Records toggle button
		const allToggle = filterDiv.createEl('button', {
			cls: 'kh-filter-toggle' + (this.showAllRecords ? ' kh-filter-toggle-active' : ''),
			text: '💯',
			title: 'Toggle Show All Records: Show all records regardless of activated chips (\\a)'
		});
		allToggle.onclick = () => {
			this.showAllRecords = !this.showAllRecords;
			this.toggleFilterModifier('\\a', this.showAllRecords);
		expressionInput.value = this.activeFilterExpression || '';
			this.render();
		};

	// Sync button states when expression input changes
	expressionInput.addEventListener('input', () => {
		this.activeFilterExpression = expressionInput.value;
		this.syncButtonsFromExpression();
		// Update button classes based on new state
		slimToggle.className = 'kh-filter-toggle' + (this.trimSubItems ? ' kh-filter-toggle-active' : '');
		topToggle.className = 'kh-filter-toggle' + (this.topRecordOnly ? ' kh-filter-toggle-active' : '');
		allToggle.className = 'kh-filter-toggle' + (this.showAllRecords ? ' kh-filter-toggle-active' : '');
	});

		// Re-search button with looking glass icon
		const researchButton = filterDiv.createEl('button', {
			cls: 'kh-dashboard-research-button'
		});
		researchButton.style.padding = '4px 12px';
		researchButton.style.display = 'flex';
		researchButton.style.alignItems = 'center';
		researchButton.style.gap = '4px';

		const researchIcon = researchButton.createSpan();
		setIcon(researchIcon, 'search');
		researchButton.createSpan({ text: 'Re-search' });

		researchButton.addEventListener('click', async () => {
			// Trigger knowledge base rescan
			await this.plugin.triggerScan();
		});

		// SRS button with brain icon
		const srsButton = filterDiv.createEl('button', {
			cls: 'kh-dashboard-srs-button'
		});
		srsButton.style.padding = '4px 12px';
		srsButton.style.display = 'flex';
		srsButton.style.alignItems = 'center';
		srsButton.style.gap = '4px';

		const srsIcon = srsButton.createSpan();
		setIcon(srsIcon, 'brain');
		srsButton.createSpan({ text: 'SRS' });
		srsButton.addEventListener('click', async () => {
			// Get currently filtered records
			let filteredRecords = this.selectedRecords || [];

			// If no records selected, use all records from current view
			if (filteredRecords.length === 0) {
				const allRecords = await this.loadParsedRecords();

				// Apply current subject filter
				if (this.currentSubject?.mainTag) {
					const subjectTag = this.currentSubject.mainTag;
					filteredRecords = allRecords.filter(record => {
						const tags = this.getRecordTags(record);
						return tags.includes(subjectTag);
					});
				} else {
					filteredRecords = allRecords;
				}

				// Apply chip filters if active
				if (this.activeChips.size > 0) {
					filteredRecords = this.filterRecordsByActiveChips(filteredRecords);
				}
			}

			// Extract all entries from filtered records for SRS
			const entries: FlatEntry[] = [];
			for (const record of filteredRecords) {
				entries.push(...record.entries);
			}

			// TODO: Implement SRS integration with these entries
			new Notice(`SRS: ${entries.length} entries from ${filteredRecords.length} files`);
		});

		// Auto-render chips and apply filter if there's an active filter expression
		if (this.activeFilterExpression) {
			const parsedRecords = await this.loadParsedRecords();

			// Wrapper to ensure chips are on separate line
			const chipsWrapper = header.createDiv({ cls: 'kh-dashboard-chips-wrapper' });
			chipsWrapper.style.width = '100%';
			chipsWrapper.style.clear = 'both';
			chipsWrapper.style.marginTop = '12px';

			// Render chips container
			const chipsContainer = chipsWrapper.createDiv({ cls: 'kh-dashboard-chips-container' });
			chipsContainer.style.display = 'flex';
			chipsContainer.style.gap = '6px';
			chipsContainer.style.flexWrap = 'wrap';
			await this.renderChipFilters(chipsContainer, parsedRecords);

			// Auto-apply filter if:
			// 1. Context changed (subject or topic changed), OR
			// 2. Explicitly requested (e.g., chip click, lightning button)
			const currentContext = `${this.currentSubject?.id || 'none'}:${this.selectedPrimaryTopicId}`;
			const contextChanged = currentContext !== this.lastAutoAppliedContext;

			if (contextChanged || this.shouldApplyFilterOnRender) {
				this.lastAutoAppliedContext = currentContext;
				this.shouldApplyFilterOnRender = false; // Reset flag
				await this.applyFilterExpression(parsedRecords);
			}
		}
	}

	/**
	 * Parse filter expression to extract allowed categories, keywords, and code blocks
	 * Expression format: :category-id-category keyword1 keyword2 `codeblock`
	 */
	private parseFilterExpression(expression: string): { allowedCategoryIds: string[], allowedKeywords: string[], allowedCodeBlocks: string[] } | null {
		if (!expression || expression.trim() === '') {
			return null;
		}

		const allowedCategoryIds: string[] = [];
		const allowedKeywords: string[] = [];
		const allowedCodeBlocks: string[] = [];

		// Parse :category-name-category syntax
		const categoryRegex = /:([a-z0-9\-]+)-category/gi;
		let match;
		while ((match = categoryRegex.exec(expression)) !== null) {
			const categoryId = match[1].toLowerCase();
			allowedCategoryIds.push(categoryId);
		}

		// Remove category syntax from expression to get remaining keywords/code blocks
		const withoutCategories = expression.replace(/:([a-z0-9\-]+)-category/gi, '').trim();

		// Parse remaining space-separated keywords and code blocks
		if (withoutCategories) {
			const tokens = withoutCategories.split(/\s+/).filter(t => t.length > 0);
			tokens.forEach(token => {
				const cleanToken = token.replace(/`/g, '');
				allowedKeywords.push(cleanToken);
				allowedCodeBlocks.push(cleanToken);
			});
		}

		return { allowedCategoryIds, allowedKeywords, allowedCodeBlocks };
	}

	/**
	 * Extract available filters from parsed records
	 * Returns what's actually in the data
	 */
	private extractAvailableFilters(parsedRecords: ParsedFile[]): {
		keywords: string[],
		categories: string[],
		codeBlocks: string[]
	} {
		const keywordSet = new Set<string>();
		const categorySet = new Set<string>();
		const codeBlockSet = new Set<string>();

		// Process all records
		parsedRecords.forEach(record => {
			for (const entry of record.entries) {
				// Collect keywords
				if (entry.keywords) {
					entry.keywords.forEach(kw => keywordSet.add(kw));
				}

				// Collect code blocks
				if (entry.type === 'codeblock' && entry.language) {
					codeBlockSet.add(entry.language);
				}

				// Collect categories from keywords
				if (entry.keywords && HighlightSpaceRepeatPlugin.settings.categories) {
					entry.keywords.forEach(kw => {
						// Search through all categories to find the keyword
						for (const category of HighlightSpaceRepeatPlugin.settings.categories) {
							const keywordDef = category.keywords?.find((k: any) => k.keyword === kw);
							if (keywordDef) {
								categorySet.add(category.id || '');
								break;
							}
						}
					});
				}
			}
		});

		return {
			keywords: Array.from(keywordSet),
			categories: Array.from(categorySet),
			codeBlocks: Array.from(codeBlockSet)
		};
	}

	/**
	 * Apply filter expression to get final list of filters to display as chips
	 */
	private applySubjectExpressionToChips(
		filters: { keywords: string[], categories: string[], codeBlocks: string[] }
	): { keywords: string[], categoryIds: string[], codeBlocks: string[] } {
		const subjectExpr = this.currentSubject?.dashOnlyFilterExp || this.currentSubject?.expression;
		if (!subjectExpr) {
			return { keywords: filters.keywords, categoryIds: [], codeBlocks: filters.codeBlocks };
		}

		const parsedFilter = this.parseFilterExpression(subjectExpr);
		if (!parsedFilter) {
			return { keywords: filters.keywords, categoryIds: [], codeBlocks: filters.codeBlocks };
		}

		const finalKeywords: string[] = [];
		const finalCategoryIds: string[] = [];
		const finalCodeBlocks: string[] = [];

		// Process categories - only include if they have matching keywords in the data
		parsedFilter.allowedCategoryIds.forEach(categoryId => {
			const category = HighlightSpaceRepeatPlugin.settings.categories?.find((c: any) => c.id === categoryId);
			if (!category) return;

			const categoryKeywords = filters.keywords.filter(kw => {
				return category.keywords?.some((k: any) => k.keyword === kw);
			});

			if (categoryKeywords.length > 0) {
				finalCategoryIds.push(categoryId);
			}
		});

		// Process individual keywords - only include if present in data
		parsedFilter.allowedKeywords.forEach(kw => {
			if (filters.keywords.includes(kw)) {
				finalKeywords.push(kw);
			}
		});

		// Process code blocks - only include if present in data
		parsedFilter.allowedCodeBlocks.forEach(cb => {
			if (filters.codeBlocks.includes(cb)) {
				finalCodeBlocks.push(cb);
			}
		});

		return { keywords: finalKeywords, categoryIds: finalCategoryIds, codeBlocks: finalCodeBlocks };
	}

	private async renderDashboard(container: HTMLElement): Promise<void> {
		if (!this.currentSubject) return;

		// Get topics from nested structure
		const primaryTopics: Topic[] = this.currentSubject.primaryTopics || [];
		const secondaryTopics: Topic[] = this.currentSubject.secondaryTopics || [];

		// Render columns
		await this.renderColumns(container, primaryTopics, secondaryTopics);
	}

	/**
	 * Get currently selected primary topic (or null if orphans selected)
	 */
	private getSelectedPrimaryTopic(): Topic | null {
		if (this.selectedPrimaryTopicId === 'orphans') return null;
		if (!this.currentSubject) return null;
		const primaryTopics = this.currentSubject.primaryTopics || [];
		return primaryTopics.find(t => t.id === this.selectedPrimaryTopicId) || null;
	}

	/**
	 * Update the active filter expression based on current subject/topic selection
	 */
	private updateFilterExpression(): void {
		// If user manually edited expression, preserve it (don't override)
		if (this.userCustomExpression) {
			return;
		}

		// Extract current modifiers to preserve them
		const currentModifiers = this.extractModifiers(this.activeFilterExpression);

		const selectedPrimaryTopic = this.getSelectedPrimaryTopic();

		let baseExpression: string | null = null;

		// If primary topic selected, use its dashOnlyFilterExpSide
		if (selectedPrimaryTopic?.dashOnlyFilterExpSide) {
			baseExpression = selectedPrimaryTopic.dashOnlyFilterExpSide;
		}
		// If on subject/orphans view, use subject's dashOnlyFilterExp (fallback to legacy expression)
		else if (this.selectedPrimaryTopicId === 'orphans') {
			baseExpression = this.currentSubject?.dashOnlyFilterExp || this.currentSubject?.expression || null;
		}

		// Re-apply modifiers to the new base expression
		this.activeFilterExpression = this.appendModifiers(baseExpression, currentModifiers);

		// Reset auto-apply context when expression changes
		this.lastAutoAppliedContext = '';
		// Request filter application since expression changed
		this.shouldApplyFilterOnRender = true;
	}

	/**
	 * Extract active modifiers from expression
	 */
	private extractModifiers(expression: string | null): string[] {
		if (!expression) return [];
		const modifiers: string[] = [];
		if (expression.includes('\\s')) modifiers.push('\\s');
		if (expression.includes('\\t')) modifiers.push('\\t');
		if (expression.includes('\\a')) modifiers.push('\\a');
		return modifiers;
	}

	/**
	 * Append modifiers to an expression
	 */
	private appendModifiers(expression: string | null, modifiers: string[]): string | null {
		if (!expression) return modifiers.length > 0 ? modifiers.join(' ') : null;
		let result = expression;
		// Remove existing modifiers first
		result = result.replace(/\s*\\[sat]\s*/g, ' ').trim();
		// Add modifiers at the end
		if (modifiers.length > 0) {
			result = (result + ' ' + modifiers.join(' ')).trim();
		}
		return result || null;
	}

	/**
	 * Toggle a filter modifier (\s, \t, \a) in the active filter expression
	 */
	private toggleFilterModifier(modifier: string, isActive: boolean): void {
		if (!this.activeFilterExpression) {
			this.activeFilterExpression = '';
		}

		if (isActive) {
			// Add modifier if not present
			if (!this.activeFilterExpression.includes(modifier)) {
				this.activeFilterExpression = (this.activeFilterExpression + ' ' + modifier).trim();
			}
		} else {
			// Remove modifier
			this.activeFilterExpression = this.activeFilterExpression.replace(new RegExp('\\s*' + modifier.replace(/\\/g, '\\\\') + '\\s*', 'g'), ' ');
			this.activeFilterExpression = this.activeFilterExpression.trim();
		}
	}

	/**
	 * Sync button states from filter expression
	 * Detects modifiers in expression and activates corresponding buttons
	 */
	private syncButtonsFromExpression(): void {
		this.trimSubItems = this.activeFilterExpression?.includes('\\s') || false;
		this.topRecordOnly = this.activeFilterExpression?.includes('\\t') || false;
		this.showAllRecords = this.activeFilterExpression?.includes('\\a') || false;
	}

	/**
	 * Extract keywords/categories/languages from SELECT clause of filter expression
	 * E.g., ".def .ima .pos W: #java OR .jav" → keywords: ["def", "ima", "pos"], categories: [], languages: []
	 */
	private extractChipsFromFilterExpression(expression: string): { keywords: string[], categoryIds: string[], languages: string[] } {
		if (!expression || expression.trim() === '') {
			return { keywords: [], categoryIds: [], languages: [] };
		}

		// Extract SELECT clause (everything before W:)
		let selectClause = expression;
		if (expression.includes('W:')) {
			const parts = expression.split(/W:/);
			selectClause = parts[0].replace(/^S:/, '').trim();
		} else if (expression.startsWith('S:')) {
			selectClause = expression.substring(2).trim();
		}

		// Remove modifiers from selectClause
		selectClause = selectClause.replace(/\\[sat]/g, '').trim();

		if (!selectClause) {
			return { keywords: [], categoryIds: [], languages: [] };
		}

		const keywords: string[] = [];
		const categoryIds: string[] = [];
		const languages: string[] = [];

		// Split by space to get individual tokens
		const tokens = selectClause.split(/\s+/).filter(t => t.length > 0);

		for (const token of tokens) {
			// Category syntax: :category-id
			if (token.startsWith(':')) {
				const categoryId = token.substring(1);
				if (!categoryIds.includes(categoryId)) {
					categoryIds.push(categoryId);
				}
			}
			// Language syntax: `language
			else if (token.startsWith('`')) {
				const language = token.substring(1);
				if (!languages.includes(language)) {
					languages.push(language);
				}
			}
			// Keyword syntax: .keyword
			else if (token.startsWith('.')) {
				const keyword = token.substring(1);
				if (!keywords.includes(keyword)) {
					keywords.push(keyword);
				}
			}
		}

		return { keywords, categoryIds, languages };
	}

	/**
	 * Render chip filters parsed from subject's expression field
	 */
	private async renderChipFilters(chipsContainer: HTMLElement, parsedRecords: ParsedFile[]): Promise<void> {
		chipsContainer.empty();

		// Get selected primary topic for chip enhancement
		const selectedPrimaryTopic = this.getSelectedPrimaryTopic();

		// Parse current expression to get active chips
		if (this.activeFilterExpression) {
			const chips = this.extractChipsFromFilterExpression(this.activeFilterExpression);

			// Update activeChips (chips currently in the expression)
			this.activeChips.clear();
			chips.categoryIds.forEach(id => this.activeChips.add(`category:${id}`));
			chips.keywords.forEach(kw => {
				const isPrimary = selectedPrimaryTopic && selectedPrimaryTopic.topicKeyword === kw;
				const chipId = isPrimary ? `primary-topic:${kw}` : `keyword:${kw}`;
				this.activeChips.add(chipId);
			});
			chips.languages.forEach(lang => this.activeChips.add(`codeblock:${lang}`));

			// Update available chips palette (union of current + previous chips)
			chips.categoryIds.forEach(id => {
				if (!this.availableChips.categories.includes(id)) {
					this.availableChips.categories.push(id);
				}
			});
			chips.keywords.forEach(kw => {
				if (!this.availableChips.keywords.includes(kw)) {
					this.availableChips.keywords.push(kw);
				}
			});
			chips.languages.forEach(lang => {
				if (!this.availableChips.codeblocks.includes(lang)) {
					this.availableChips.codeblocks.push(lang);
				}
			});
		}

		// Render category chips from availableChips palette
		this.availableChips.categories.forEach(categoryId => {
			const category = HighlightSpaceRepeatPlugin.settings.categories?.find((c: any) => c.id === categoryId);
			if (!category) return;

			const chipId = `category:${categoryId}`;
			const isActive = this.activeChips.has(chipId);

			const chip = chipsContainer.createEl('button', {
				cls: `kh-dashboard-chip grid-keyword-chip ${isActive ? 'kh-chip-active' : ''}`
			});

			// Show icon with "..." indicator for categories (multiple keywords)
			const iconSpan = chip.createEl('span');
			iconSpan.textContent = (category as any).icon || '📁';
			const indicatorSpan = chip.createEl('span');
			indicatorSpan.textContent = '...';
			indicatorSpan.style.fontSize = '0.8em';
			indicatorSpan.style.opacity = '0.6';
			indicatorSpan.style.marginLeft = '2px';

			chip.title = `Category: ${(category as any).name || categoryId} (multiple keywords)`;
			chip.style.padding = '4px 10px';
			chip.style.borderRadius = '12px';
			chip.style.border = '2px solid transparent';
			chip.style.cursor = 'pointer';
			chip.style.backgroundColor = (category as any).bgColor || 'var(--background-primary)';
			chip.style.color = (category as any).color || 'var(--text-normal)';
			chip.style.opacity = isActive ? '1' : '0.2'; // MUCH MORE OBVIOUS: 1 vs 0.2
			chip.style.filter = isActive ? 'none' : 'grayscale(80%)'; // Gray out when inactive

			chip.addEventListener('click', async () => {

				// Toggle chip active state
				if (this.activeChips.has(chipId)) {
					this.activeChips.delete(chipId);
					this.removeChipFromExpression(`:${categoryId}`);
					chip.style.opacity = '0.2';
					chip.style.filter = 'grayscale(80%)';
				} else {
					this.activeChips.add(chipId);
					this.addChipToExpression(`:${categoryId}`);
					chip.style.opacity = '1';
					chip.style.filter = 'none';
				}


				// Apply filter and update ONLY records section (don't re-render header!)
				const parsedRecords = await this.loadParsedRecords();
				await this.applyFilterExpression(parsedRecords);
				await this.updateRecordsSection();
			});
		});

		// Render keyword chips from availableChips palette
		this.availableChips.keywords.forEach(keyword => {
			// ONLY mark as PRIMARY if it matches the topic's topicKeyword field
			let isPrimaryTopicKeyword = false;
			if (selectedPrimaryTopic && selectedPrimaryTopic.topicKeyword === keyword) {
				isPrimaryTopicKeyword = true;
			}

			// Search through all categories to find the keyword
			// For compound keywords (e.g., "goa.suc"), try exact match first, then fall back to first part
			let keywordDef: any = null;
			for (const category of HighlightSpaceRepeatPlugin.settings.categories || []) {
				keywordDef = category.keywords?.find((k: any) => k.keyword === keyword);
				if (keywordDef) break;
			}

			// If not found and it's a compound keyword, try first part for styling
			if (!keywordDef && keyword.includes('.')) {
				const firstPart = keyword.split('.')[0];
				for (const category of HighlightSpaceRepeatPlugin.settings.categories || []) {
					keywordDef = category.keywords?.find((k: any) => k.keyword === firstPart);
					if (keywordDef) break;
				}
			}

			if (!keywordDef) return;

			// Use different chip ID for primary topic keyword
			const chipId = isPrimaryTopicKeyword ? `primary-topic:${keyword}` : `keyword:${keyword}`;
			const isActive = this.activeChips.has(chipId);

			const chip = chipsContainer.createEl('button', {
				cls: `kh-dashboard-chip grid-keyword-chip ${isPrimaryTopicKeyword ? 'kh-primary-topic-chip' : ''} ${isActive ? 'kh-chip-active' : ''}`
			});

			// Add PRIMARY badge if this is the primary topic keyword
			if (isPrimaryTopicKeyword) {
				const badge = chip.createEl('span', {
					cls: 'kh-chip-badge',
					text: 'PRIMARY'
				});
				badge.style.fontSize = '0.7em';
				badge.style.fontWeight = 'bold';
				badge.style.marginRight = '4px';
				badge.style.padding = '2px 4px';
				badge.style.backgroundColor = 'gold';
				badge.style.color = 'black';
				badge.style.borderRadius = '3px';
			}

			// Handle compound keywords (e.g., "goa.suc" should show both icons)
			const keywordParts = keyword.split('.');
			if (keywordParts.length > 1) {
				// Compound keyword - show all icons
				keywordParts.forEach(part => {
					const mark = chip.createEl('mark', { cls: `kh-icon ${part}` });
					mark.innerHTML = '&nbsp;';
				});
				// Add text label showing the compound keyword
				const label = chip.createEl('span');
				label.textContent = `.${keyword}`;
				label.style.marginLeft = '4px';
				label.style.fontSize = '0.85em';

				chip.title = isPrimaryTopicKeyword
					? `Primary Topic: ${selectedPrimaryTopic!.name} - Shows ALL records with "${keyword}" keyword`
					: `Compound Keyword: .${keyword}`;
			} else {
				// Single keyword - show one icon only
				const mark = chip.createEl('mark', { cls: `kh-icon ${keyword}` });
				mark.innerHTML = '&nbsp;';
				chip.title = isPrimaryTopicKeyword
					? `Primary Topic: ${selectedPrimaryTopic!.name} - Shows ALL records with "${keyword}" keyword`
					: `Keyword: ${keyword}`;
			}

			chip.style.padding = '4px 10px';
			chip.style.borderRadius = '12px';
			chip.style.border = isPrimaryTopicKeyword ? '3px solid gold' : '2px solid transparent';
			chip.style.cursor = 'pointer';
			chip.style.backgroundColor = keywordDef.bgColor || 'var(--background-primary)';
			chip.style.color = keywordDef.color || 'var(--text-normal)';
			chip.style.opacity = isActive ? '1' : '0.2'; // MUCH MORE OBVIOUS: 1 vs 0.2
			chip.style.filter = isActive ? 'none' : 'grayscale(80%)'; // Gray out when inactive

			chip.addEventListener('click', async () => {

				// Clear keyword filter when using chips
				this.selectedKeywordFilter = null;

				// Toggle chip active state
				if (this.activeChips.has(chipId)) {
					this.activeChips.delete(chipId);
					this.removeChipFromExpression(`.${keyword}`);
					chip.style.opacity = '0.2';
					chip.style.filter = 'grayscale(80%)';
				} else {
					this.activeChips.add(chipId);
					this.addChipToExpression(`.${keyword}`);
					chip.style.opacity = '1';
					chip.style.filter = 'none';
				}


				// Apply filter and update ONLY records section (don't re-render header!)
				const parsedRecords = await this.loadParsedRecords();
				await this.applyFilterExpression(parsedRecords);
				await this.updateRecordsSection();
			});
		});

		// Render code block chips from availableChips palette
		this.availableChips.codeblocks.forEach(codeBlock => {
			const chipId = `codeblock:${codeBlock}`;
			const isActive = this.activeChips.has(chipId);

			const chip = chipsContainer.createEl('button', {
				cls: `kh-dashboard-chip grid-keyword-chip ${isActive ? 'kh-chip-active' : ''}`
			});
			chip.textContent = `\`${codeBlock}\``;
			chip.title = `Code block: ${codeBlock}`;
			chip.style.padding = '4px 10px';
			chip.style.borderRadius = '12px';
			chip.style.border = '2px solid transparent';
			chip.style.cursor = 'pointer';
			chip.style.backgroundColor = 'var(--background-primary)';
			chip.style.color = 'var(--text-normal)';
			chip.style.fontFamily = 'var(--font-monospace)';
			chip.style.opacity = isActive ? '1' : '0.2'; // MUCH MORE OBVIOUS: 1 vs 0.2
			chip.style.filter = isActive ? 'none' : 'grayscale(80%)'; // Gray out when inactive

			chip.addEventListener('click', async () => {

				// Toggle chip active state
				if (this.activeChips.has(chipId)) {
					this.activeChips.delete(chipId);
					this.removeChipFromExpression(`\`${codeBlock}`);
					chip.style.opacity = '0.2';
					chip.style.filter = 'grayscale(80%)';
				} else {
					this.activeChips.add(chipId);
					this.addChipToExpression(`\`${codeBlock}`);
					chip.style.opacity = '1';
					chip.style.filter = 'none';
				}


				// Apply filter and update ONLY records section (don't re-render header!)
				const parsedRecords = await this.loadParsedRecords();
				await this.applyFilterExpression(parsedRecords);
				await this.updateRecordsSection();
			});
		});
	}

	/**
	 * Filter records to only those matching active chips
	 * For primary topic chips, apply the full filterExpression to respect scope constraints
	 */
	private filterRecordsByActiveChips(parsedRecords: ParsedFile[]): ParsedFile[] {
		if (this.activeChips.size === 0) {
			return parsedRecords;
		}

		// Check if a primary topic chip is active
		const primaryTopicChips = Array.from(this.activeChips).filter(chipId => chipId.startsWith('primary-topic:'));

		if (primaryTopicChips.length > 0) {
			// Use FilterParser with the topic's filterExpression
			const selectedPrimaryTopic = this.getSelectedPrimaryTopic();
			if (selectedPrimaryTopic?.dashOnlyFilterExpSide) {
				try {
					const compiled = FilterParser.compile(selectedPrimaryTopic.dashOnlyFilterExpSide);
					const matchingRecords: ParsedFile[] = [];

					for (const record of parsedRecords) {
						const hasMatch = fileHasMatch(record, compiled, HighlightSpaceRepeatPlugin.settings.categories);
						if (hasMatch) {
							matchingRecords.push(record);
						}
					}

					return matchingRecords;
				} catch (error) {
					console.error('[SubjectDashboardView] Error applying primary topic filter:', error);
				}
			}
		}

		// Regular chip filtering (for non-primary chips)
		const activeKeywords = new Set<string>();
		const activeCategoryIds = new Set<string>();
		const activeCodeBlocks = new Set<string>();

		this.activeChips.forEach(chipId => {
			const [type, value] = chipId.split(':');
			if (type === 'keyword') {
				activeKeywords.add(value);
			} else if (type === 'primary-topic') {
				// Already handled above with filterExpression
				activeKeywords.add(value);
			} else if (type === 'category') {
				activeCategoryIds.add(value);
			} else if (type === 'codeblock') {
				activeCodeBlocks.add(value);
			}
		});

		// Get all keywords from active categories
		const categoryKeywords = new Set<string>();
		activeCategoryIds.forEach(categoryId => {
			const category = HighlightSpaceRepeatPlugin.settings.categories?.find((c: any) => c.id === categoryId);
			if (category && (category as any).keywords) {
				(category as any).keywords.forEach((kw: any) => {
					categoryKeywords.add(kw.keyword);
				});
			}
		});

		// Combine all matching keywords
		const allMatchingKeywords = new Set([...activeKeywords, ...categoryKeywords]);

		// Filter records
		return parsedRecords.filter(record => {
			// Check if record has at least one matching entry
			const hasMatch = this.recordHasMatchingEntry(
				record,
				allMatchingKeywords,
				activeCodeBlocks
			);
			return hasMatch;
		});
	}

	/**
	 * Check if record has at least one entry matching the filter criteria
	 */
	private recordHasMatchingEntry(
		record: ParsedFile,
		matchingKeywords: Set<string>,
		matchingCodeBlocks: Set<string>
	): boolean {
		for (const entry of record.entries) {
			// Check main entry keywords
			if (entry.keywords && entry.keywords.length > 0) {
				const hasMatchingKeyword = entry.keywords.some(kw =>
					matchingKeywords.has(kw)
				);
				if (hasMatchingKeyword) {
					return true;
				}
			}

			// Check subitem keywords
			if (entry.subItems && entry.subItems.length > 0) {
				for (const subItem of entry.subItems) {
					if (subItem.keywords && subItem.keywords.length > 0) {
						const hasMatchingKeyword = subItem.keywords.some(kw =>
							matchingKeywords.has(kw)
						);
						if (hasMatchingKeyword) {
							return true;
						}
					}
				}
			}

			// Check code blocks
			if (entry.type === 'codeblock' && entry.language) {
				if (matchingCodeBlocks.has(entry.language)) {
					return true;
				}
			}
		}
		return false;
	}

	private async renderColumns(container: HTMLElement, primaryTopics: Topic[], secondaryTopics: Topic[]): Promise<void> {
		// Remove existing columns
		const existingColumns = container.querySelector('.kh-dashboard-columns');
		if (existingColumns) {
			existingColumns.remove();
		}

		// Load parsed records
		// NOTE: Chips filter ENTRIES, not FILES
		// Files are filtered by topic tags only
		let parsedRecords = await this.loadParsedRecords();

		// Create columns container
		const columnsContainer = container.createDiv({ cls: 'kh-dashboard-columns' });

		// Filter files based on selected primary topic
		let filteredRecords: ParsedFile[] = [];
		if (this.selectedPrimaryTopicId === 'orphans') {
			// Get subject files: Has subject tag BUT NOT any primary or secondary topic tags
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
			filteredRecords = parsedRecords.filter(record => {
				const tags = this.getRecordTags(record);
				// Must have subject tag
				const hasSubjectTag = this.currentSubject?.mainTag ? tags.includes(this.currentSubject.mainTag) : false;
				// Must NOT have any primary topic tags
				const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag!));
				// Must NOT have any secondary topic tags
				const hasSecondaryTag = secondaryTopicTags.some(tag => tags.includes(tag!));
				return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
			});
		} else {
			// Get files for selected primary topic
			const selectedPrimaryTopic = primaryTopics.find(t => t.id === this.selectedPrimaryTopicId);
			if (selectedPrimaryTopic?.topicTag) {
				filteredRecords = this.getFilesWithTopicTag(parsedRecords, selectedPrimaryTopic.topicTag);
			}
		}

		// Render TOTALS column (for subject OR selected primary topic)
		if (this.selectedPrimaryTopicId === 'orphans') {
			// Render subject totals column
			await this.renderSubjectTotalsColumn(columnsContainer, filteredRecords, parsedRecords);
		} else {
			// Render primary topic totals column
			const selectedPrimaryTopic = primaryTopics.find(t => t.id === this.selectedPrimaryTopicId);
			if (selectedPrimaryTopic) {
				this.renderTotalsColumn(columnsContainer, selectedPrimaryTopic, filteredRecords, parsedRecords);
			}
		}

		// Render each secondary topic as a column (skip fhDisabled topics)
		secondaryTopics.forEach((topic, topicIndex) => {
			// Skip topics with fhDisabled flag - they only show record count in reminder
			if (topic.fhDisabled) return;
			this.renderColumnFiles(columnsContainer, topic, topicIndex, filteredRecords, parsedRecords);
		});
	}

	/**
	 * Render TOTALS column for selected primary topic (like matrix row header)
	 */
	private renderTotalsColumn(
		columnsContainer: HTMLElement,
		primaryTopic: Topic,
		filteredRecords: ParsedFile[],
		allRecords: ParsedFile[]
	): void {
		// Count files matching primary topic tag
		const fileCount = filteredRecords.length;

		// Count headers matching primary topic keyword/tag (check ALL files!)
		// EXACT same logic as matrix view's countHeadersForSingleTopic
		let headerCount = 0;
		const recordsWithMatchingHeaders: ParsedFile[] = [];

		// Check ALL files - headers have independent tags/keywords!
		for (const record of allRecords) {
			let hasMatchingHeader = false;

			for (const entry of record.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text) {
						// Check if topic keyword is in header.keywords array
						let keywordMatch = false;
						if (primaryTopic.topicKeyword && header.keywords) {
							keywordMatch = header.keywords?.some(kw =>
								kw.toLowerCase() === primaryTopic.topicKeyword!.toLowerCase()
							);
						}

						// Check if header tags include the topic tag
						const tagMatch = primaryTopic.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === primaryTopic.topicTag;
						});

						// DEBUG for german
						// Debug logging removed for performance

						if (keywordMatch || tagMatch) {
							headerCount++;
							hasMatchingHeader = true;
						}
					}
				}
			}

			if (hasMatchingHeader && !recordsWithMatchingHeaders.includes(record)) {
				recordsWithMatchingHeaders.push(record);
			}
		}

		// Debug logging removed for performance

		// Count entries matching primary topic's filter expression
		// For now, just count entries with the topic keyword (ignoring file tags and complex expressions)
		// TODO: Use full FilterParser evaluation like matrix view
		let recordCount = 0;
		const recordsWithMatchingEntries: ParsedFile[] = [];

		if (primaryTopic.topicKeyword) {
			for (const record of allRecords) {
				let fileHasMatchingEntry = false;

				// Entries are now flat in record.entries, no need to traverse headers
				for (const entry of record.entries) {
					// Entry matches if it has the topic keyword (in entry or subitems)
					let hasKeyword = false;

					// Check main entry keywords
					if (entry.keywords && entry.keywords.includes(primaryTopic.topicKeyword!)) {
						hasKeyword = true;
					}

					// Check subitem keywords
					if (!hasKeyword && entry.subItems && entry.subItems.length > 0) {
						for (const subItem of entry.subItems) {
							if (subItem.keywords && subItem.keywords.includes(primaryTopic.topicKeyword!)) {
								hasKeyword = true;
								break;
							}
						}
					}

					if (hasKeyword) {
						recordCount++;
						fileHasMatchingEntry = true;
					}
				}

				if (fileHasMatchingEntry) {
					recordsWithMatchingEntries.push(record);
				}
			}
		}

		// Debug logging removed for performance

		// Create totals column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column kh-dashboard-totals-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.style.cursor = 'pointer';
		header.createEl('span', {
			text: `${primaryTopic.icon || '📌'} ${primaryTopic.name}`,
			cls: 'kh-dashboard-column-title'
		});

		// Add counts in matrix style: /files +headers -entries
		// Each count is separately clickable
		const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

		// Files count
		const filesCount = countsContainer.createEl('span', {
			text: `/${fileCount}`,
			cls: 'kh-count-files'
		});
		filesCount.style.cursor = 'pointer';
		filesCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			// DON'T apply chip filtering - chips are for filter expression only!
			this.applyChipFiltering = false;
			this.selectedRecords = filteredRecords;
			this.selectedContext = `${primaryTopic.name}: ${filteredRecords.length} files`;
			this.selectedKeywordFilter = null;
			this.selectedTopicTag = null;
			this.selectedHeaderMode = false;
			this.selectedFilterExpression = null;
			await this.updateRecordsSection();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Headers count
		const headersCount = countsContainer.createEl('span', {
			text: `+${headerCount}`,
			cls: 'kh-count-headers'
		});
		headersCount.style.cursor = 'pointer';
		headersCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			// DON'T apply chip filtering - chips are for filter expression only!
			// Show headers matching the topic keyword/tag (from ALL files!)
			this.applyChipFiltering = false;
			this.selectedRecords = recordsWithMatchingHeaders;
			this.selectedContext = `${primaryTopic.name}: ${recordsWithMatchingHeaders.length} headers`;
			this.selectedKeywordFilter = primaryTopic.topicKeyword || null;
			this.selectedTopicTag = primaryTopic.topicTag || null;
			this.selectedPrimaryTopic = primaryTopic; // Set for renderSelectedHeaders
			this.selectedSecondaryTopic = null;
			this.selectedHeaderMode = true;
			await this.updateRecordsSection();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Entries count
		const entriesCount = countsContainer.createEl('span', {
			text: `-${recordCount}`,
			cls: 'kh-count-entries'
		});
		entriesCount.style.cursor = 'pointer';
		entriesCount.addEventListener('click', async (e) => {
			e.stopPropagation();

			// Use filteredRecords (already has primary topic tag on file)
			// to find records with primary topic keyword in entries
			const records: ParsedFile[] = [];
			if (primaryTopic.topicKeyword) {
				for (const record of filteredRecords) {
					const hasMatchingEntry = this.recordHasMatchingEntry(
						record,
						new Set([primaryTopic.topicKeyword]),
						new Set()
					);
					if (hasMatchingEntry) {
						records.push(record);
					}
				}
			}

			this.applyChipFiltering = false;
			this.selectedRecords = records;
			this.selectedContext = `${primaryTopic.name}: ${records.length} entries`;
			this.selectedKeywordFilter = primaryTopic.topicKeyword || null;
			this.selectedTopicTag = null;
			this.selectedHeaderMode = false;
			await this.updateRecordsSection();
		});

		// Content area - show files matching primary topic
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		// Sort files alphabetically by name
		const sortedRecords = filteredRecords.slice().sort((a, b) => {
			const nameA = getFileNameFromPath(a.filePath).toLowerCase();
			const nameB = getFileNameFromPath(b.filePath).toLowerCase();
			return nameA.localeCompare(nameB);
		});
		sortedRecords.forEach(record => {
			const fileItem = content.createDiv({ cls: 'kh-dashboard-file-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(record.filePath).replace('.md', ''),
				cls: 'kh-dashboard-file-name'
			});
			fileItem.style.cursor = 'pointer';
			fileItem.addEventListener('click', async (e: MouseEvent) => {
				// Command/Ctrl + click: Open file
				if (e.metaKey || e.ctrlKey) {
					const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
					if (file instanceof TFile) {
						await this.plugin.app.workspace.getLeaf(false).openFile(file);
					}
				}
				// Normal click: Show records from this file
				else {
					this.applyChipFiltering = false;
			this.selectedRecords = [record];
					this.selectedContext = `${getFileNameFromPath(record.filePath).replace('.md', '')} (1 file)`;
					this.selectedKeywordFilter = null;
					this.selectedTopicTag = null;
					this.selectedHeaderMode = false;
					await this.updateRecordsSection();
				}
			});
		});
	}

	/**
	 * Render column in FILES mode - show files matching topic tag
	 */
	/**
	 * Render TOTALS column for SUBJECT (1x1 cell in matrix)
	 */
	private async renderSubjectTotalsColumn(
		columnsContainer: HTMLElement,
		filteredRecords: ParsedFile[],
		allRecords: ParsedFile[]
	): Promise<void> {
		if (!this.currentSubject) return;

		// Count files (already filtered - has subject tag, no primary/secondary tags)
		const fileCount = filteredRecords.length;

		// Count headers matching subject keyword OR tag (check ALL files!)
		let headerCount = 0;
		const recordsWithMatchingHeaders: ParsedFile[] = [];

		if (this.currentSubject.keyword || this.currentSubject.mainTag) {
			for (const record of allRecords) {
				let hasMatchingHeader = false;

				for (const entry of record.entries) {
					const headerLevels = [
						entry.h1 ? { level: 1, info: entry.h1 } : null,
						entry.h2 ? { level: 2, info: entry.h2 } : null,
						entry.h3 ? { level: 3, info: entry.h3 } : null
					].filter(h => h !== null);

					for (const headerLevel of headerLevels) {
						const header = headerLevel!.info;
						if (header.text) {
							// Check if subject keyword is in header.keywords array
							let keywordMatch = false;
							if (this.currentSubject.keyword && header.keywords) {
								keywordMatch = header.keywords?.some(kw =>
									kw.toLowerCase() === this.currentSubject.keyword!.toLowerCase()
								);
							}

							// Check if header tags include the subject tag
							const tagMatch = this.currentSubject.mainTag && header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === this.currentSubject.mainTag;
							});

							if (keywordMatch || tagMatch) {
								headerCount++;
								hasMatchingHeader = true;
							}
						}
					}
				}

				if (hasMatchingHeader && !recordsWithMatchingHeaders.includes(record)) {
					recordsWithMatchingHeaders.push(record);
				}
			}
		}

		// Count entries matching subject's matrixOnlyFilterExp (primary), keyword (fallback), or expression (legacy)
		let recordCount = 0;
		const recordsWithMatchingEntries: ParsedFile[] = [];

		const matrixExpr = this.currentSubject.matrixOnlyFilterExp || this.currentSubject.expression;
		if (matrixExpr) {
			// Use matrixOnlyFilterExp or legacy expression with FilterExpressionService
			const { FilterExpressionService } = await import('../services/FilterExpressionService');
			recordCount = FilterExpressionService.countRecordsWithExpression(
				allRecords,
				matrixExpr,
				null,
				this.currentSubject,
				false
			);

			// Get files with matching entries for click handler
			const allMatchingEntries = await this.getMatchingEntriesWithExpression(allRecords, matrixExpr);
			const uniqueFiles = new Set(allMatchingEntries.map(e => e.file));
			recordsWithMatchingEntries.push(...Array.from(uniqueFiles));
		} else if (this.currentSubject.keyword) {
			// Fallback to keyword if no filter expression
			for (const record of allRecords) {
				let fileHasMatchingEntry = false;

				for (const entry of record.entries) {
					let hasKeyword = false;

					// Check main entry keywords
					if (entry.keywords && entry.keywords.includes(this.currentSubject.keyword!)) {
						hasKeyword = true;
					}

					// Check subitem keywords
					if (!hasKeyword && entry.subItems && entry.subItems.length > 0) {
						for (const subItem of entry.subItems) {
							if (subItem.keywords && subItem.keywords.includes(this.currentSubject.keyword!)) {
								hasKeyword = true;
								break;
							}
						}
					}

					if (hasKeyword) {
						recordCount++;
						fileHasMatchingEntry = true;
					}
				}

				if (fileHasMatchingEntry) {
					recordsWithMatchingEntries.push(record);
				}
			}
		}

		// Create totals column
		const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column kh-dashboard-totals-column' });

		// Column header
		const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
		header.style.cursor = 'pointer';
		header.createEl('span', {
			text: `${this.currentSubject.icon || '📁'} ${this.currentSubject.name}`,
			cls: 'kh-dashboard-column-title'
		});

		// Add counts in matrix style: /files +headers -entries
		const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

		// Files count
		const filesCount = countsContainer.createEl('span', {
			text: `/${fileCount}`,
			cls: 'kh-count-files'
		});
		filesCount.style.cursor = 'pointer';
		filesCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			this.applyChipFiltering = false;
			this.selectedRecords = filteredRecords;
			this.selectedContext = `${this.currentSubject!.name}: ${filteredRecords.length} files`;
			this.selectedKeywordFilter = null;
			this.selectedTopicTag = null;
			this.selectedHeaderMode = false;
			this.selectedFilterExpression = null;
			await this.updateRecordsSection();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Headers count
		const headersCount = countsContainer.createEl('span', {
			text: `+${headerCount}`,
			cls: 'kh-count-headers'
		});
		headersCount.style.cursor = 'pointer';
		headersCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			this.applyChipFiltering = false;
			this.selectedRecords = recordsWithMatchingHeaders;
			this.selectedContext = `${this.currentSubject!.name}: ${recordsWithMatchingHeaders.length} headers`;
			this.selectedKeywordFilter = this.currentSubject!.keyword || null;
			this.selectedTopicTag = this.currentSubject!.mainTag || null;
			this.selectedPrimaryTopic = null;
			this.selectedSecondaryTopic = null;
			this.selectedHeaderMode = true;
			await this.updateRecordsSection();
		});

		countsContainer.createEl('span', { text: ' ' });

		// Entries count
		const entriesCount = countsContainer.createEl('span', {
			text: `-${recordCount}`,
			cls: 'kh-count-entries'
		});
		entriesCount.style.cursor = 'pointer';
		entriesCount.addEventListener('click', async (e) => {
			e.stopPropagation();
			this.applyChipFiltering = false;
			this.selectedRecords = recordsWithMatchingEntries;
			this.selectedContext = `${this.currentSubject!.name}: ${recordsWithMatchingEntries.length} entries`;

			// Use matrixOnlyFilterExp if available, otherwise fallback to keyword
			const matrixExpr = this.currentSubject!.matrixOnlyFilterExp || this.currentSubject!.expression;
			if (matrixExpr) {
				this.selectedFilterExpression = this.appendModifiers(matrixExpr, this.extractModifiers(this.activeFilterExpression));
				this.selectedKeywordFilter = null;
			} else {
				this.selectedKeywordFilter = this.currentSubject!.keyword || null;
				this.selectedFilterExpression = null;
			}

			this.selectedTopicTag = null;
			this.selectedHeaderMode = false;
			await this.updateRecordsSection();
		});

		// Content area - show files matching subject tag (excluding primary/secondary tags)
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		// Sort files alphabetically by name
		const sortedRecords = filteredRecords.slice().sort((a, b) => {
			const nameA = getFileNameFromPath(a.filePath).toLowerCase();
			const nameB = getFileNameFromPath(b.filePath).toLowerCase();
			return nameA.localeCompare(nameB);
		});
		sortedRecords.forEach(record => {
			const fileItem = content.createDiv({ cls: 'kh-dashboard-file-item' });
			fileItem.createEl('span', {
				text: getFileNameFromPath(record.filePath).replace('.md', ''),
				cls: 'kh-dashboard-file-name'
			});
			fileItem.style.cursor = 'pointer';
			fileItem.addEventListener('click', async (e: MouseEvent) => {
				// Command/Ctrl + click: Open file
				if (e.metaKey || e.ctrlKey) {
					const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
					if (file instanceof TFile) {
						await this.plugin.app.workspace.getLeaf(false).openFile(file);
					}
				}
				// Normal click: Show records from this file
				else {
					this.applyChipFiltering = false;
					this.selectedRecords = [record];
					this.selectedContext = `${getFileNameFromPath(record.filePath).replace('.md', '')} (1 file)`;
					this.selectedKeywordFilter = null;
					this.selectedTopicTag = null;
					this.selectedHeaderMode = false;
					await this.updateRecordsSection();
				}
			});
		});
	}

	private renderColumnFiles(columnsContainer: HTMLElement, topic: Topic, topicIndex: number, filteredRecords: ParsedFile[], allRecords: ParsedFile[]): void {
		// Count files with topic tag
		let topicFiles: ParsedFile[] = [];
		if (topic.topicTag) {
			// When selectedPrimaryTopicId is 'orphans' (subject cell), secondary topics should exclude primary tags
			if (this.selectedPrimaryTopicId === 'orphans') {
				const primaryTopics = this.currentSubject?.primaryTopics || [];
				const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);

				topicFiles = allRecords.filter(record => {
					const tags = this.getRecordTags(record);
					// Must have the secondary topic's tag
					const hasSecondaryTag = tags.includes(topic.topicTag!);
					// Must NOT have any primary topic tags
					const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag!));
					return hasSecondaryTag && !hasPrimaryTag;
				});
			} else {
				// When a primary topic is selected, use intersection (from filteredRecords)
				topicFiles = filteredRecords.filter(record => {
					const tags = this.getRecordTags(record);
					return tags.includes(topic.topicTag!);
				});
			}
		}
		let fileCount = topicFiles.length;

		// Count headers matching topic keyword/tag (check ALL files!)
		let headerCount = 0;
		const recordsWithMatchingHeaders: ParsedFile[] = [];

		// Check ALL files for headers
		for (const record of allRecords) {
			let hasMatchingHeader = false;

			for (const entry of record.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text) {
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
							headerCount++;
							hasMatchingHeader = true;
						}
					}
				}
			}

			if (hasMatchingHeader && !recordsWithMatchingHeaders.includes(record)) {
				recordsWithMatchingHeaders.push(record);
			}
		}

		// Count entries matching topic keyword (check ALL files!)
		let recordCount = 0;
		const recordsWithMatchingEntries: ParsedFile[] = [];

		if (topic.topicKeyword) {
			for (const record of allRecords) {
				const hasMatchingEntry = this.recordHasMatchingEntry(
					record,
					new Set([topic.topicKeyword]),
					new Set()
				);

				if (hasMatchingEntry) {
					recordCount++;
					recordsWithMatchingEntries.push(record);
				}
			}
		}

		// Override counts with pre-calculated matrix data
		if (this.currentSubject?.matrix?.cells) {
			const col = topicIndex + 2; // Secondary topics start at column 2
			let cellKey: string;

			if (this.selectedPrimaryTopicId === 'orphans') {
				// When in orphans mode, use row 1 (secondary topic header cells: 1x2, 1x3, etc.)
				cellKey = `1x${col}`;
			} else {
				// When a primary topic is selected, use intersection cell
				const primaryTopics = this.currentSubject.primaryTopics || [];
				const primaryTopicIndex = primaryTopics.findIndex(t => t.id === this.selectedPrimaryTopicId);
				if (primaryTopicIndex >= 0) {
					const rowNum = primaryTopicIndex + 2; // Primary topics start at row 2
					cellKey = `${rowNum}x${col}`;
				}
			}

			if (cellKey) {
				const cell = this.currentSubject.matrix.cells[cellKey];
				if (cell) {
					fileCount = cell.fileCount || 0;
					headerCount = cell.headerCount || 0;
					recordCount = cell.recordCount || 0;
				}
			}
		}

		// Only render column if there are any files/headers/records
		if (fileCount > 0 || headerCount > 0 || recordCount > 0) {
			const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

			// Column header
			const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
			header.createEl('span', {
				text: `${topic.icon || '📌'} ${topic.name}`,
				cls: 'kh-dashboard-column-title'
			});

			// Add counts in matrix style: /files +headers -entries
			// Each count is separately clickable
			const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

			// Files count
			const filesCount = countsContainer.createEl('span', {
				text: `/${fileCount}`,
				cls: 'kh-count-files'
			});
			filesCount.style.cursor = 'pointer';
			filesCount.addEventListener('click', async (e) => {
				e.stopPropagation();
				// DON'T apply chip filtering - chips are for filter expression only!
				this.applyChipFiltering = false;
			this.selectedRecords = topicFiles;
				this.selectedContext = `${topic.name}: ${topicFiles.length} files`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.selectedFilterExpression = null;
				await this.updateRecordsSection();
			});

			countsContainer.createEl('span', { text: ' ' });

			// Headers count
			const headersCount = countsContainer.createEl('span', {
				text: `+${headerCount}`,
				cls: 'kh-count-headers'
			});
			headersCount.style.cursor = 'pointer';
			headersCount.addEventListener('click', async (e) => {
				e.stopPropagation();

				// If headerCount is 0, do nothing
				if (headerCount === 0) return;


				// Get selected primary topic for INTERSECTION logic (same as matrix)
				const selectedPrimaryTopic = this.getSelectedPrimaryTopic();


				let records: ParsedFile[];

				// When no primary topic selected (orphans), check ALL files for headers with secondary topic keyword/tag
				if (!selectedPrimaryTopic) {
					records = allRecords.filter(record => {
						// Check if this record has headers with secondary topic keyword or tag
						// NOTE: We check ALL files, not just files with specific tags
						for (const entry of record.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text) {
									// Check if SECONDARY topic is in header
									let secondaryKeywordMatch = false;
									if (topic.topicKeyword && header.keywords) {
										secondaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
										);
									}
									const secondaryTagMatch = !!(topic.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === topic.topicTag;
									}));

									if (secondaryKeywordMatch || secondaryTagMatch) {
										return true; // This record has a matching header
									}
								}
							}
						}
						return false;
					});
				} else {
					// Use INTERSECTION logic like matrix: (primary in header AND secondary on file) OR (secondary in header AND primary on file)
					records = allRecords.filter(record => {
						const fileTags = this.getRecordTags(record);

						// Check if both topics are on file level
						const primaryInFile = !!(selectedPrimaryTopic?.topicTag && fileTags.includes(selectedPrimaryTopic.topicTag));
						const secondaryInFile = !!(topic.topicTag && fileTags.includes(topic.topicTag));

						// Check if this record has any headers matching the intersection
						for (const entry of record.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text) {
									// Check if PRIMARY topic is in header
									let primaryKeywordMatch = false;
									if (selectedPrimaryTopic?.topicKeyword && header.keywords) {
										primaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === selectedPrimaryTopic.topicKeyword!.toLowerCase()
										);
									}
									const primaryTagMatch = !!(selectedPrimaryTopic?.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === selectedPrimaryTopic.topicTag;
									}));
									const primaryInHeader = primaryKeywordMatch || primaryTagMatch;

									// Check if SECONDARY topic is in header
									let secondaryKeywordMatch = false;
									if (topic.topicKeyword && header.keywords) {
										secondaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
										);
									}
									const secondaryTagMatch = !!(topic.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === topic.topicTag;
									}));
									const secondaryInHeader = secondaryKeywordMatch || secondaryTagMatch;

									// Intersection: (primary in header AND secondary on file) OR (secondary in header AND primary on file)
									const validCase1 = primaryInHeader && secondaryInFile;
									const validCase2 = secondaryInHeader && primaryInFile;

									if (validCase1 || validCase2) {
										return true; // This record has a matching header
									}
								}
							}
						}
						return false;
					});
				}


				// DON'T apply chip filtering - chips are for filter expression only!
				this.applyChipFiltering = false;
			this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} headers`;
				this.selectedPrimaryTopic = selectedPrimaryTopic;
				this.selectedSecondaryTopic = topic;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = true;


				await this.updateRecordsSection();

			});

			countsContainer.createEl('span', { text: ' ' });

			// Entries count
			const entriesCount = countsContainer.createEl('span', {
				text: `-${recordCount}`,
				cls: 'kh-count-entries'
			});
			entriesCount.style.cursor = 'pointer';
			entriesCount.addEventListener('click', async (e) => {
				e.stopPropagation();

				// If recordCount is 0, do nothing
				if (recordCount === 0) return;


				// Use filter expression exactly like matrix does - pass ALL records and filter at entry level
				let expandedExpr: string | null = null;
				if (topic.appliedFilterExpIntersection) {
					const selectedPrimaryTopic = this.getSelectedPrimaryTopic();
					// Use Dashboard's expandPlaceholders (does NOT expand .? #? `? - keeps them for FilterParser)
					expandedExpr = this.expandPlaceholders(
						topic.appliedFilterExpIntersection,
						selectedPrimaryTopic,
						this.currentSubject
					);
				}

				this.applyChipFiltering = false;
				this.selectedRecords = allRecords; // Pass ALL records, filtering happens at entry level
				this.selectedContext = `${topic.name} records`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.selectedFilterExpression = this.appendModifiers(expandedExpr, this.extractModifiers(this.activeFilterExpression)); // Store filter expression to filter entries when rendering
				await this.updateRecordsSection();
			});

			// Render files (display mode)
			const filesList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			// Sort files alphabetically by name
			const sortedTopicFiles = topicFiles.slice().sort((a, b) => {
				const nameA = getFileNameFromPath(a.filePath).toLowerCase();
				const nameB = getFileNameFromPath(b.filePath).toLowerCase();
				return nameA.localeCompare(nameB);
			});
			sortedTopicFiles.forEach(record => {
				const fileItem = filesList.createDiv({ cls: 'kh-dashboard-file-item' });
				fileItem.createEl('span', {
					text: getFileNameFromPath(record.filePath).replace('.md', ''),
					cls: 'kh-dashboard-file-name'
				});
				fileItem.style.cursor = 'pointer';
				fileItem.addEventListener('click', async (e: MouseEvent) => {
					// Command/Ctrl + click: Open file
					if (e.metaKey || e.ctrlKey) {
						const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
						if (file instanceof TFile) {
							await this.plugin.app.workspace.getLeaf(false).openFile(file);
						}
					}
					// Normal click: Show records from this file
					else {
						this.applyChipFiltering = false;
			this.selectedRecords = [record];
						this.selectedContext = `${getFileNameFromPath(record.filePath).replace('.md', '')} (1 file)`;
						this.selectedKeywordFilter = null;
						this.selectedTopicTag = null;
						this.selectedHeaderMode = false;
						await this.updateRecordsSection();
					}
				});
			});
		}
	}

	/**
	 * Render column in HEADERS mode - show headers matching topic keyword/tag
	 */
	private renderColumnHeaders(columnsContainer: HTMLElement, topic: Topic, filteredRecords: ParsedFile[], allRecords: ParsedFile[]): void {
		// Count files with topic tag (from filtered records for current primary topic)
		let topicFiles: ParsedFile[] = [];
		if (topic.topicTag) {
			topicFiles = filteredRecords.filter(record => {
				const tags = this.getRecordTags(record);
				return tags.includes(topic.topicTag!);
			});
		}
		const fileCount = topicFiles.length;

		// Count headers matching topic keyword/tag (check ALL files!)
		let headerCount = 0;
		const recordsWithMatchingHeaders: ParsedFile[] = [];
		const matchingHeaders: { record: ParsedFile; header: { text: string } }[] = [];

		// Check ALL files for headers
		for (const record of allRecords) {
			let hasMatchingHeader = false;

			for (const entry of record.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text) {
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
							matchingHeaders.push({ record, header });
							headerCount++;
							hasMatchingHeader = true;
						}
					}
				}
			}

			if (hasMatchingHeader && !recordsWithMatchingHeaders.includes(record)) {
				recordsWithMatchingHeaders.push(record);
			}
		}

		// Count entries matching topic keyword (check ALL files!)
		let recordCount = 0;
		const recordsWithMatchingEntries: ParsedFile[] = [];

		if (topic.topicKeyword) {
			for (const record of allRecords) {
				const hasMatchingEntry = this.recordHasMatchingEntry(
					record,
					new Set([topic.topicKeyword]),
					new Set()
				);

				if (hasMatchingEntry) {
					recordCount++;
					recordsWithMatchingEntries.push(record);
				}
			}
		}

		// Only render column if there are any files/headers/records
		if (fileCount > 0 || headerCount > 0 || recordCount > 0) {
			const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

			// Column header
			const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
			header.createEl('span', {
				text: `${topic.icon || '📌'} ${topic.name}`,
				cls: 'kh-dashboard-column-title'
			});

			// Add counts in matrix style: /files +headers -entries
			// Each count is separately clickable
			const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

			// Files count
			const filesCount = countsContainer.createEl('span', {
				text: `/${fileCount}`,
				cls: 'kh-count-files'
			});
			filesCount.style.cursor = 'pointer';
			filesCount.addEventListener('click', async (e) => {
				e.stopPropagation();
				// DON'T apply chip filtering - chips are for filter expression only!
				this.applyChipFiltering = false;
			this.selectedRecords = topicFiles;
				this.selectedContext = `${topic.name}: ${topicFiles.length} files`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.selectedFilterExpression = null;
				await this.updateRecordsSection();
			});

			countsContainer.createEl('span', { text: ' ' });

			// Headers count
			const headersCount = countsContainer.createEl('span', {
				text: `+${headerCount}`,
				cls: 'kh-count-headers'
			});
			headersCount.style.cursor = 'pointer';
			headersCount.addEventListener('click', async (e) => {
				e.stopPropagation();

				// If headerCount is 0, do nothing
				if (headerCount === 0) return;


				// Get selected primary topic for INTERSECTION logic (same as matrix)
				const selectedPrimaryTopic = this.getSelectedPrimaryTopic();


				let records: ParsedFile[];

				// When no primary topic selected (orphans), check ALL files for headers with secondary topic keyword/tag
				if (!selectedPrimaryTopic) {
					records = allRecords.filter(record => {
						// Check if this record has headers with secondary topic keyword or tag
						// NOTE: We check ALL files, not just files with specific tags
						for (const entry of record.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text) {
									// Check if SECONDARY topic is in header
									let secondaryKeywordMatch = false;
									if (topic.topicKeyword && header.keywords) {
										secondaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
										);
									}
									const secondaryTagMatch = !!(topic.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === topic.topicTag;
									}));

									if (secondaryKeywordMatch || secondaryTagMatch) {
										return true; // This record has a matching header
									}
								}
							}
						}
						return false;
					});
				} else {
					// Use INTERSECTION logic like matrix: (primary in header AND secondary on file) OR (secondary in header AND primary on file)
					records = allRecords.filter(record => {
						const fileTags = this.getRecordTags(record);

						// Check if both topics are on file level
						const primaryInFile = !!(selectedPrimaryTopic?.topicTag && fileTags.includes(selectedPrimaryTopic.topicTag));
						const secondaryInFile = !!(topic.topicTag && fileTags.includes(topic.topicTag));

						// Check if this record has any headers matching the intersection
						for (const entry of record.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text) {
									// Check if PRIMARY topic is in header
									let primaryKeywordMatch = false;
									if (selectedPrimaryTopic?.topicKeyword && header.keywords) {
										primaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === selectedPrimaryTopic.topicKeyword!.toLowerCase()
										);
									}
									const primaryTagMatch = !!(selectedPrimaryTopic?.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === selectedPrimaryTopic.topicTag;
									}));
									const primaryInHeader = primaryKeywordMatch || primaryTagMatch;

									// Check if SECONDARY topic is in header
									let secondaryKeywordMatch = false;
									if (topic.topicKeyword && header.keywords) {
										secondaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
										);
									}
									const secondaryTagMatch = !!(topic.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === topic.topicTag;
									}));
									const secondaryInHeader = secondaryKeywordMatch || secondaryTagMatch;

									// Intersection: (primary in header AND secondary on file) OR (secondary in header AND primary on file)
									const validCase1 = primaryInHeader && secondaryInFile;
									const validCase2 = secondaryInHeader && primaryInFile;

									if (validCase1 || validCase2) {
										return true; // This record has a matching header
									}
								}
							}
						}
						return false;
					});
				}


				// DON'T apply chip filtering - chips are for filter expression only!
				this.applyChipFiltering = false;
			this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} headers`;
				this.selectedPrimaryTopic = selectedPrimaryTopic;
				this.selectedSecondaryTopic = topic;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = true;


				await this.updateRecordsSection();

			});

			countsContainer.createEl('span', { text: ' ' });

			// Entries count
			const entriesCount = countsContainer.createEl('span', {
				text: `-${recordCount}`,
				cls: 'kh-count-entries'
			});
			entriesCount.style.cursor = 'pointer';
			entriesCount.addEventListener('click', async (e) => {
				e.stopPropagation();

				// If recordCount is 0, do nothing
				if (recordCount === 0) return;


				// Use filter expression exactly like matrix does - pass ALL records and filter at entry level
				let expandedExpr: string | null = null;
				if (topic.appliedFilterExpIntersection) {
					const selectedPrimaryTopic = this.getSelectedPrimaryTopic();
					// Use Dashboard's expandPlaceholders (does NOT expand .? #? `? - keeps them for FilterParser)
					expandedExpr = this.expandPlaceholders(
						topic.appliedFilterExpIntersection,
						selectedPrimaryTopic,
						this.currentSubject
					);
				}

				this.applyChipFiltering = false;
				this.selectedRecords = allRecords; // Pass ALL records, filtering happens at entry level
				this.selectedContext = `${topic.name} records`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.selectedFilterExpression = this.appendModifiers(expandedExpr, this.extractModifiers(this.activeFilterExpression)); // Store filter expression to filter entries when rendering
				await this.updateRecordsSection();
			});

			// Render headers (display mode)
			const headersList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			matchingHeaders.forEach(({ record, header }) => {
				const headerItem = headersList.createDiv({ cls: 'kh-dashboard-file-item' });
				headerItem.createEl('span', {
					text: `${getFileNameFromPath(record.filePath).replace('.md', '')} #${header.text}`,
					cls: 'kh-dashboard-file-name'
				});
				headerItem.style.cursor = 'pointer';
				headerItem.addEventListener('click', async (e: MouseEvent) => {
					// Only open file on Command/Ctrl + click
					if (e.metaKey || e.ctrlKey) {
						const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
						if (file instanceof TFile) {
							await this.plugin.app.workspace.getLeaf(false).openFile(file);
						}
					}
				});
			});
		}
	}

	/**
	 * Render column in RECORDS mode - show files with entries matching topic filterExpression
	 */
	private renderColumnRecords(columnsContainer: HTMLElement, topic: Topic, filteredRecords: ParsedFile[], allRecords: ParsedFile[]): void {
		// Count files with topic tag (from filtered records for current primary topic)
		let topicFiles: ParsedFile[] = [];
		if (topic.topicTag) {
			topicFiles = filteredRecords.filter(record => {
				const tags = this.getRecordTags(record);
				return tags.includes(topic.topicTag!);
			});
		}
		const fileCount = topicFiles.length;

		// Count headers matching topic keyword/tag (check ALL files!)
		let headerCount = 0;
		const recordsWithMatchingHeaders: ParsedFile[] = [];

		// Check ALL files for headers
		for (const record of allRecords) {
			let hasMatchingHeader = false;

			for (const entry of record.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text) {
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
							headerCount++;
							hasMatchingHeader = true;
						}
					}
				}
			}

			if (hasMatchingHeader && !recordsWithMatchingHeaders.includes(record)) {
				recordsWithMatchingHeaders.push(record);
			}
		}

		// Count entries matching topic keyword (check ALL files!)
		let recordCount = 0;
		const recordsWithMatchingEntries: ParsedFile[] = [];

		if (topic.topicKeyword) {
			for (const record of allRecords) {
				const hasMatchingEntry = this.recordHasMatchingEntry(
					record,
					new Set([topic.topicKeyword]),
					new Set()
				);

				if (hasMatchingEntry) {
					recordCount++;
					recordsWithMatchingEntries.push(record);
				}
			}
		}

		// Only render column if there are any files/headers/records
		if (fileCount > 0 || headerCount > 0 || recordCount > 0) {
			const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

			// Column header
			const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
			header.createEl('span', {
				text: `${topic.icon || '📌'} ${topic.name}`,
				cls: 'kh-dashboard-column-title'
			});

			// Add counts in matrix style: /files +headers -entries
			// Each count is separately clickable
			const countsContainer = header.createEl('span', { cls: 'kh-dashboard-column-count' });

			// Files count
			const filesCount = countsContainer.createEl('span', {
				text: `/${fileCount}`,
				cls: 'kh-count-files'
			});
			filesCount.style.cursor = 'pointer';
			filesCount.addEventListener('click', async (e) => {
				e.stopPropagation();
				// DON'T apply chip filtering - chips are for filter expression only!
				this.applyChipFiltering = false;
			this.selectedRecords = topicFiles;
				this.selectedContext = `${topic.name}: ${topicFiles.length} files`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.selectedFilterExpression = null;
				await this.updateRecordsSection();
			});

			countsContainer.createEl('span', { text: ' ' });

			// Headers count
			const headersCount = countsContainer.createEl('span', {
				text: `+${headerCount}`,
				cls: 'kh-count-headers'
			});
			headersCount.style.cursor = 'pointer';
			headersCount.addEventListener('click', async (e) => {
				e.stopPropagation();

				// If headerCount is 0, do nothing
				if (headerCount === 0) return;


				// Get selected primary topic for INTERSECTION logic (same as matrix)
				const selectedPrimaryTopic = this.getSelectedPrimaryTopic();


				let records: ParsedFile[];

				// When no primary topic selected (orphans), check ALL files for headers with secondary topic keyword/tag
				if (!selectedPrimaryTopic) {
					records = allRecords.filter(record => {
						// Check if this record has headers with secondary topic keyword or tag
						// NOTE: We check ALL files, not just files with specific tags
						for (const entry of record.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text) {
									// Check if SECONDARY topic is in header
									let secondaryKeywordMatch = false;
									if (topic.topicKeyword && header.keywords) {
										secondaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
										);
									}
									const secondaryTagMatch = !!(topic.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === topic.topicTag;
									}));

									if (secondaryKeywordMatch || secondaryTagMatch) {
										return true; // This record has a matching header
									}
								}
							}
						}
						return false;
					});
				} else {
					// Use INTERSECTION logic like matrix: (primary in header AND secondary on file) OR (secondary in header AND primary on file)
					records = allRecords.filter(record => {
						const fileTags = this.getRecordTags(record);

						// Check if both topics are on file level
						const primaryInFile = !!(selectedPrimaryTopic?.topicTag && fileTags.includes(selectedPrimaryTopic.topicTag));
						const secondaryInFile = !!(topic.topicTag && fileTags.includes(topic.topicTag));

						// Check if this record has any headers matching the intersection
						for (const entry of record.entries) {
							const headerLevels = [
								entry.h1 ? { level: 1, info: entry.h1 } : null,
								entry.h2 ? { level: 2, info: entry.h2 } : null,
								entry.h3 ? { level: 3, info: entry.h3 } : null
							].filter(h => h !== null);

							for (const headerLevel of headerLevels) {
								const header = headerLevel!.info;
								if (header.text) {
									// Check if PRIMARY topic is in header
									let primaryKeywordMatch = false;
									if (selectedPrimaryTopic?.topicKeyword && header.keywords) {
										primaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === selectedPrimaryTopic.topicKeyword!.toLowerCase()
										);
									}
									const primaryTagMatch = !!(selectedPrimaryTopic?.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === selectedPrimaryTopic.topicTag;
									}));
									const primaryInHeader = primaryKeywordMatch || primaryTagMatch;

									// Check if SECONDARY topic is in header
									let secondaryKeywordMatch = false;
									if (topic.topicKeyword && header.keywords) {
										secondaryKeywordMatch = header.keywords?.some(kw =>
											kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
										);
									}
									const secondaryTagMatch = !!(topic.topicTag && header.tags?.some(tag => {
										const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
										return normalizedTag === topic.topicTag;
									}));
									const secondaryInHeader = secondaryKeywordMatch || secondaryTagMatch;

									// Intersection: (primary in header AND secondary on file) OR (secondary in header AND primary on file)
									const validCase1 = primaryInHeader && secondaryInFile;
									const validCase2 = secondaryInHeader && primaryInFile;

									if (validCase1 || validCase2) {
										return true; // This record has a matching header
									}
								}
							}
						}
						return false;
					});
				}


				// DON'T apply chip filtering - chips are for filter expression only!
				this.applyChipFiltering = false;
			this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} headers`;
				this.selectedPrimaryTopic = selectedPrimaryTopic;
				this.selectedSecondaryTopic = topic;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = true;


				await this.updateRecordsSection();

			});

			countsContainer.createEl('span', { text: ' ' });

			// Entries count
			const entriesCount = countsContainer.createEl('span', {
				text: `-${recordCount}`,
				cls: 'kh-count-entries'
			});
			entriesCount.style.cursor = 'pointer';
			entriesCount.addEventListener('click', async (e) => {
				e.stopPropagation();

				// If recordCount is 0, do nothing
				if (recordCount === 0) return;


				// Use filter expression exactly like matrix does - pass ALL records and filter at entry level
				let expandedExpr: string | null = null;
				if (topic.appliedFilterExpIntersection) {
					const selectedPrimaryTopic = this.getSelectedPrimaryTopic();
					// Use Dashboard's expandPlaceholders (does NOT expand .? #? `? - keeps them for FilterParser)
					expandedExpr = this.expandPlaceholders(
						topic.appliedFilterExpIntersection,
						selectedPrimaryTopic,
						this.currentSubject
					);
				}

				this.applyChipFiltering = false;
				this.selectedRecords = allRecords; // Pass ALL records, filtering happens at entry level
				this.selectedContext = `${topic.name} records`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.selectedFilterExpression = this.appendModifiers(expandedExpr, this.extractModifiers(this.activeFilterExpression)); // Store filter expression to filter entries when rendering
				await this.updateRecordsSection();
			});

			// Render files with entries (display mode)
			const recordsList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			recordsWithMatchingEntries.forEach(record => {
				const recordItem = recordsList.createDiv({ cls: 'kh-dashboard-file-item' });
				recordItem.createEl('span', {
					text: getFileNameFromPath(record.filePath).replace('.md', ''),
					cls: 'kh-dashboard-file-name'
				});
				recordItem.style.cursor = 'pointer';
				recordItem.addEventListener('click', async (e: MouseEvent) => {
					// Only open file on Command/Ctrl + click
					if (e.metaKey || e.ctrlKey) {
						const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
						if (file instanceof TFile) {
							await this.plugin.app.workspace.getLeaf(false).openFile(file);
						}
					}
				});
			});
		}
	}

	/**
	 * Load parsed records from JSON file
	 * IMPORTANT: Enriches entries with file-level metadata (fileTags, fileName, filePath)
	 * required by FilterParser.evaluateFlatEntry
	 */
	private async loadParsedRecords(): Promise<ParsedFile[]> {
		const parsedRecordsPath = DATA_PATHS.PARSED_FILES;
		const exists = await this.plugin.app.vault.adapter.exists(parsedRecordsPath);

		if (!exists) {
			console.warn('[SubjectDashboardView] No parsed records found.');
			return [];
		}

		const jsonContent = await this.plugin.app.vault.adapter.read(parsedRecordsPath);
		const parsedFiles: ParsedFile[] = JSON.parse(jsonContent);

		// Enrich entries with file-level metadata required by FilterParser.evaluateFlatEntry
		for (const file of parsedFiles) {
			// Normalize file tags - remove # prefix if present (FilterParser expects tags WITHOUT #)
			const normalizedTags = file.tags.map(tag => tag.startsWith('#') ? tag.slice(1) : tag);

			for (const entry of file.entries) {
				// Add file-level metadata to each entry as required by FilterParser
				(entry as any).fileTags = normalizedTags;
				(entry as any).fileName = file.fileName;
				(entry as any).filePath = file.filePath;

				// Ensure entry.text exists for text filtering (W: "text")
				// If entry.text is missing or empty, use empty string to avoid errors
				if (!entry.text) {
					entry.text = '';
				}
			}
		}

		return parsedFiles;
	}

	/**
	 * Get tags from a parsed record (includes both file-level and header tags)
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
	 * Get files that have a specific topic tag
	 */
	private getFilesWithTopicTag(parsedRecords: ParsedFile[], topicTag: string): ParsedFile[] {
		// Normalize the topic tag
		const normalizedTag = topicTag.startsWith('#') ? topicTag : '#' + topicTag;

		return parsedRecords.filter(record => {
			const fileTags = this.getRecordTags(record);
			return fileTags.includes(normalizedTag);
		});
	}

	/**
	 * Get matching entries using filter expression - EXACTLY like matrix does
	 */
	private async getMatchingEntriesWithExpression(
		parsedFiles: ParsedFile[],
		filterExpression: string
	): Promise<{ entry: FlatEntry; file: ParsedFile }[]> {
		try {
			// Check if \a (show all) modifier is present
			const hasShowAllModifier = filterExpression.includes('\\a');

			// CONDITIONAL transform - EXACTLY like Matrix does
			// If expression has explicit AND/OR operators, use as-is. Otherwise transform.
			const hasExplicitOperators = /\b(AND|OR)\b/.test(filterExpression);

			let expr: string;
			if (hasExplicitOperators) {
				// Already has operators - use as-is
				expr = filterExpression;
			} else {
				// No operators - transform it (adds OR between terms)
				const { FilterExpressionService } = await import('../services/FilterExpressionService');
				expr = FilterExpressionService.transformFilterExpression(filterExpression);
			}


			// Split SELECT and WHERE clauses (case-insensitive: W: or w:)
			const hasWhere = /\s+[Ww]:\s+/.test(expr);
			let selectExpr = expr;
			let whereExpr = '';

			if (hasWhere) {
				const parts = expr.split(/\s+[Ww]:\s+/);
				selectExpr = parts[0].trim();
				whereExpr = parts[1]?.trim() || '';
			}

			// If SELECT is empty (and not using \a), return no results (all chips disabled)
			if (!hasShowAllModifier && (!selectExpr || selectExpr.trim() === '')) {
				return [];
			}

			// Compile expressions
			// If \a modifier is present, skip SELECT compilation (show all records)
			const selectCompiled = hasShowAllModifier ? null : FilterParser.compile(selectExpr);
			const whereCompiled = whereExpr ? FilterParser.compile(whereExpr) : null;

			// Debug: Check if WHERE contains text or filename filter
			if (whereExpr && (whereExpr.includes('"') || whereExpr.includes('f"'))) {
				// Show first entry's text and fileName as sample
				if (parsedFiles.length > 0 && parsedFiles[0].entries.length > 0) {
					const sampleEntry = parsedFiles[0].entries[0];
				}
			}

			const matchingEntries: { entry: FlatEntry; file: ParsedFile }[] = [];
			let checkedEntries = 0;
			let whereRejected = 0;
			let selectRejected = 0;

			// Debug: If filename filter, show first 5 files being checked
			let debugFileCount = 0;
			const isFilenameFilter = whereExpr && whereExpr.includes('f"');

			for (const file of parsedFiles) {
				for (const entry of file.entries) {
					checkedEntries++;

					// Debug filename filtering for first 5 entries
					if (isFilenameFilter && debugFileCount < 5) {
						debugFileCount++;
					}

					// First apply WHERE clause (if present)
					if (whereCompiled) {
						const whereMatches = FilterParser.evaluateFlatEntry(
							whereCompiled.ast,
							entry,
							HighlightSpaceRepeatPlugin.settings.categories,
							whereCompiled.modifiers
						);

						if (!whereMatches) {
							whereRejected++;
							continue; // Doesn't match WHERE clause, skip
						}
					}

					// Then apply SELECT clause
				// Then apply SELECT clause (unless \a is active)
				const selectMatches = hasShowAllModifier ? true : FilterParser.evaluateFlatEntry(
					selectCompiled!.ast,
					entry,
					HighlightSpaceRepeatPlugin.settings.categories,
					selectCompiled!.modifiers
				);

					if (selectMatches) {
						matchingEntries.push({ entry, file });
					} else {
						selectRejected++;
					}
				}
			}


			// Debug: If filename filter, show unique files in results
			if (isFilenameFilter && matchingEntries.length > 0) {
				const uniqueFiles = new Set(matchingEntries.map(e => e.file.fileName));
			}

			// Apply topRecordOnly filter if enabled - remove records where match is only in sub-items
			let filteredEntries = matchingEntries;
			if (this.topRecordOnly && filterExpression && !hasShowAllModifier) {
				filteredEntries = filteredEntries.filter(({ entry, file }) => {
					// Keep codeblocks - they are always top-level entries
					if (entry.type === 'codeblock') {
						return true;
					}
					// For keyword entries, check if SELECT matches using ONLY top-level keywords
					// Create a copy of entry with only top-level keywords (no subitems)
					const topLevelEntry: FlatEntry = {
						type: entry.type,
						keywords: entry.keywords || [],
						text: entry.text,
						line: entry.line,
						filePath: entry.filePath,
						subItems: [] // IMPORTANT: exclude sub-items to check only top-level
					};
					return FilterParser.evaluateFlatEntry(selectCompiled!.ast, topLevelEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled!.modifiers);
				});
			}

			// Apply trim filter if enabled - filter sub-items to only those matching SELECT clause
			if (this.trimSubItems && !hasShowAllModifier) {
				filteredEntries = filteredEntries.map(({ entry, file }) => {
					if (entry.subItems && entry.subItems.length > 0) {
						// Filter sub-items to only those matching the SELECT clause
						const filteredSubItems = entry.subItems.filter(subItem => {
							if (!subItem.keywords || subItem.keywords.length === 0) {
								return false;
							}
							// Create a FlatEntry for this subitem with its own keywords
							const subItemEntry: FlatEntry = {
								type: 'keyword',
								keywords: subItem.keywords,
								text: subItem.text,
								line: entry.line,
								filePath: entry.filePath,
								subItems: []
							};
							return FilterParser.evaluateFlatEntry(selectCompiled.ast, subItemEntry, HighlightSpaceRepeatPlugin.settings.categories, selectCompiled!.modifiers);
						});

						// Return entry with filtered sub-items
						return {
							entry: {
								...entry,
								subItems: filteredSubItems
							},
							file
						};
					}
					return { entry, file };
				});
			}

			return filteredEntries;
		} catch (error) {
			console.error('[Dashboard] Error filtering entries with expression:', error);
			return [];
		}
	}

	/**
	 * Render matching entries (from filter expression) - EXACTLY like Matrix does
	 */
	private async renderMatchingEntries(
		matchingEntries: { entry: FlatEntry; file: ParsedFile }[],
		container: HTMLElement
	): Promise<void> {
		// Group entries by file
		const recordsByFile = new Map<string, { entry: FlatEntry; file: ParsedFile }[]>();

		matchingEntries.forEach(({ entry, file }) => {
			const filePath = file.filePath;
			if (!recordsByFile.has(filePath)) {
				recordsByFile.set(filePath, []);
			}
			recordsByFile.get(filePath)!.push({ entry, file });
		});

		// Render grouped by file - EXACTLY like Matrix
		for (const [filePath, entries] of recordsByFile) {
			// Files are expanded by default, unless explicitly collapsed by user
			const isExpanded = !this.collapsedFiles.has(filePath);

			// File header (clickable to open file)
			const fileGroup = container.createDiv({ cls: 'kh-widget-filter-file-group' });
			const fileHeader = fileGroup.createDiv({ cls: 'kh-widget-filter-file-header' });

			// Toggle icon
			const toggleIcon = fileHeader.createEl('span', {
				text: isExpanded ? '▼' : '▶',
				cls: 'kh-header-toggle'
			});
			toggleIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.collapsedFiles.has(filePath)) {
					this.collapsedFiles.delete(filePath);
				} else {
					this.collapsedFiles.add(filePath);
				}
				// Re-render without blocking
				this.updateRecordsSection();
			});

			// File name wrapper (clickable to open file)
			const fileNameWrapper = fileHeader.createEl('span', {
				cls: 'kh-widget-filter-file-name'
			});
			fileNameWrapper.style.cursor = 'pointer';
			fileNameWrapper.textContent = getFileNameFromPath(filePath);

			fileHeader.createEl('span', {
				text: ` (${entries.length})`,
				cls: 'kh-widget-filter-file-count'
			});

			// Add click handler to open file (on file name only)
			fileNameWrapper.addEventListener('click', async (e: MouseEvent) => {
				// Only open file on Command/Ctrl + click
				if (e.metaKey || e.ctrlKey) {
					const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) {
						await this.plugin.app.workspace.getLeaf(false).openFile(file);
					}
				}
			});

			// Entries under this file - only render if expanded
			if (!isExpanded) {
				continue; // Skip rendering entries for collapsed files
			}

			const entriesContainer = fileGroup.createDiv({ cls: 'kh-widget-filter-entries' });

			// Render all entries in PARALLEL - same as Matrix
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
						const obsidianFile = this.plugin.app.vault.getAbstractFileByPath(file.filePath);
						if (obsidianFile && entry.lineNumber !== undefined) {
							// Open the file (or focus if already open)
							const leaf = this.plugin.app.workspace.getLeaf(false);
							await leaf.openFile(obsidianFile as any, {
								eState: { line: entry.lineNumber }
							});

							// Get the editor and navigate to the specific line
							const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
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

					// Return promise directly, don't await - use KHEntry.renderKeywordEntry for all the nuances
					return KHEntry.renderKeywordEntry(
						entryItem,
						entry,
						file,
						this.plugin,
						true // compact mode
					);

				} else if (entry.type === 'codeblock') {
					const entryItem = entriesContainer.createDiv({ cls: 'kh-widget-filter-entry kh-widget-filter-codeblock' });

					// Render code block with syntax highlighting (non-blocking)
					const codeMarkdown = '```' + (entry.language || '') + '\n' + (entry.text || '') + '\n```';
					MarkdownRenderer.renderMarkdown(
						codeMarkdown,
						entryItem,
						file.filePath,
						this
					);

					// Make entry clickable - navigate to line in source file
					entryItem.style.cursor = 'pointer';
					entryItem.addEventListener('click', async () => {
						const obsidianFile = this.plugin.app.vault.getAbstractFileByPath(file.filePath);
						if (obsidianFile && entry.lineNumber !== undefined) {
							// Open the file (or focus if already open)
							const leaf = this.plugin.app.workspace.getLeaf(false);
							await leaf.openFile(obsidianFile as any, {
								eState: { line: entry.lineNumber }
							});

							// Get the editor and navigate to the specific line
							const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
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

				return Promise.resolve();
			}));
		}
	}


	/**
	 * Filter records by a filter expression (chip filter)
	 * Returns only the records (files) that contain at least one entry matching the expression
	 */
	private async filterRecordsByExpression(parsedRecords: ParsedFile[], filterExpression: string): Promise<ParsedFile[]> {
		try {
			// Compile the filter expression
			const compiled = FilterParser.compile(filterExpression);

			// Filter records - keep only those with at least one matching entry
			const matchingRecords: ParsedFile[] = [];

			for (const record of parsedRecords) {
				// Check if any entry in this record matches the filter
				const hasMatch = fileHasMatch(record, compiled, HighlightSpaceRepeatPlugin.settings.categories);

				if (hasMatch) {
					matchingRecords.push(record);
				}
			}

			return matchingRecords;
		} catch (error) {
			console.error('[SubjectDashboardView] Error filtering records:', error);
			return parsedRecords; // Return unfiltered on error
		}
	}

	/**
	 * Update only the records section without re-rendering the entire view
	 */
	private async updateRecordsSection(): Promise<void> {

		const container = this.containerEl.children[1] as HTMLElement;


		// Remove existing records section if present
		const existingSection = container.querySelector('.kh-dashboard-records-section');
		if (existingSection) {
			existingSection.remove();
		}

		// Render new records section if we have selected records
		if (this.selectedRecords && this.selectedRecords.length > 0) {
			await this.renderSelectedRecords(container);
		} else {
		}

		// Note: selectedKeywordFilter is set externally before calling this method
		// and is NOT cleared here so it persists for the current selection
	}

	/**
	 * Render selected records section
	 * Shows records from clicked file or column, filtered by active chips
	 */
	/**
	 * Add collapse/expand all button to records section header
	 */
	private addCollapseAllButton(sectionHeader: HTMLElement): void {
		const toggleBtn = sectionHeader.createEl('button', {
			text: this.allFilesCollapsed ? 'Expand All' : 'Collapse All',
			cls: 'kh-dashboard-toggle-all-btn'
		});
		toggleBtn.title = this.allFilesCollapsed ? 'Expand all file groups' : 'Collapse all file groups';

		toggleBtn.addEventListener('click', () => {
			this.toggleAllFiles();
		});
	}

	/**
	 * Toggle all file groups between collapsed and expanded
	 */
	public toggleAllFiles(): void {
		this.allFilesCollapsed = !this.allFilesCollapsed;

		if (this.allFilesCollapsed) {
			// Collapse all: get all file paths from current records and add to collapsedFiles
			if (this.selectedRecords) {
				this.selectedRecords.forEach(record => {
					this.collapsedFiles.add(record.filePath);
				});
			}
		} else {
			// Expand all: clear collapsedFiles
			this.collapsedFiles.clear();
		}

		// Re-render to apply changes
		this.updateRecordsSection();
	}

	private async renderSelectedRecords(container: HTMLElement): Promise<void> {
		if (!this.selectedRecords || this.selectedRecords.length === 0) return;


		// Create section container
		const recordsSection = container.createDiv({ cls: 'kh-dashboard-records-section' });

		// Calculate counts for header (before rendering)
		let entriesCount = 0;
		let filesCount = 0;
		let headerText = `Records: ${this.selectedContext}`;

		// Show headers if in header mode, otherwise show entries
		if (this.selectedHeaderMode) {
			// For headers mode, just use the original context
			const sectionHeader = recordsSection.createDiv({ cls: 'kh-dashboard-records-header' });
			sectionHeader.createEl('h3', {
				text: headerText,
				cls: 'kh-dashboard-records-title'
			});
			this.addCollapseAllButton(sectionHeader);
			await this.renderSelectedHeaders(recordsSection);
		} else {
			// If we have a filter expression, get matching entries FIRST (exactly like matrix does)
			if (this.selectedFilterExpression) {
				const matchingEntries = await this.getMatchingEntriesWithExpression(
					this.selectedRecords,
					this.selectedFilterExpression
				);

				// Count entries and unique files
				entriesCount = matchingEntries.length;
				const uniqueFiles = new Set(matchingEntries.map(e => e.file.filePath));
				filesCount = uniqueFiles.size;

				// Build header with counts and filter
				headerText = `Records: ${entriesCount} ${entriesCount === 1 ? 'entry' : 'entries'} in ${filesCount} ${filesCount === 1 ? 'file' : 'files'} | Filter: ${this.selectedFilterExpression}`;

				// Section header
				const sectionHeader = recordsSection.createDiv({ cls: 'kh-dashboard-records-header' });
				sectionHeader.createEl('h3', {
					text: headerText,
					cls: 'kh-dashboard-records-title'
				});
				this.addCollapseAllButton(sectionHeader);

				// Render matching entries
				await this.renderMatchingEntries(matchingEntries, recordsSection);
			} else {
				// No filter expression - show all entries from selected records
				// Count total entries from selected records (filtered by selectedKeywordFilter if set)
				if (this.selectedKeywordFilter) {
					// Count only entries matching the keyword filter
					for (const record of this.selectedRecords) {
						for (const entry of record.entries) {
							let hasKeyword = false;

							// Check main entry keywords
							if (entry.keywords && entry.keywords.includes(this.selectedKeywordFilter)) {
								hasKeyword = true;
							}

							// Check subitem keywords
							if (!hasKeyword && entry.subItems && entry.subItems.length > 0) {
								for (const subItem of entry.subItems) {
									if (subItem.keywords && subItem.keywords.includes(this.selectedKeywordFilter)) {
										hasKeyword = true;
										break;
									}
								}
							}

							if (hasKeyword) {
								entriesCount++;
							}
						}
					}
					filesCount = this.selectedRecords.length;
					headerText = `Records: ${entriesCount} ${entriesCount === 1 ? 'entry' : 'entries'} with .${this.selectedKeywordFilter} in ${filesCount} ${filesCount === 1 ? 'file' : 'files'}`;
				} else {
					// No keyword filter - count all entries
					entriesCount = this.selectedRecords.reduce((sum, record) => sum + record.entries.length, 0);
					filesCount = this.selectedRecords.length;
					headerText = `Records: ${entriesCount} ${entriesCount === 1 ? 'entry' : 'entries'} in ${filesCount} ${filesCount === 1 ? 'file' : 'files'}`;
				}

				// Section header
				const sectionHeader = recordsSection.createDiv({ cls: 'kh-dashboard-records-header' });
				sectionHeader.createEl('h3', {
					text: headerText,
					cls: 'kh-dashboard-records-title'
				});
				this.addCollapseAllButton(sectionHeader);

				for (const record of this.selectedRecords) {
					await this.renderRecordEntries(record, recordsSection);
				}
			}
		}
	}

	/**
	 * Render selected headers (like matrix view)
	 */
	private async renderSelectedHeaders(container: HTMLElement): Promise<void> {
		if (!this.selectedRecords) return;


		const headers: { record: ParsedFile; headerText: string; headerLevel: number; entries: ParsedEntry[] }[] = [];

		// If we have BOTH topics, use INTERSECTION logic (secondary column click)
		// If we have ONLY primary topic, use SIMPLE matching (totals column click)
		const useIntersection = !!(this.selectedPrimaryTopic && this.selectedSecondaryTopic);


		// Collect matching headers
		for (const record of this.selectedRecords) {

			const fileTags = this.getRecordTags(record);

			// Check if both topics are on file level (for intersection)
			const primaryInFile = !!(this.selectedPrimaryTopic?.topicTag && fileTags.includes(this.selectedPrimaryTopic.topicTag));
			const secondaryInFile = !!(this.selectedSecondaryTopic?.topicTag && fileTags.includes(this.selectedSecondaryTopic.topicTag));

			// Group entries by their headers for this record
			const headerToEntriesMap = new Map<string, { level: number; text: string; entries: ParsedEntry[] }>();

			for (const entry of record.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text) {
						// Check if PRIMARY topic is in header
						let primaryKeywordMatch = false;
						if (this.selectedPrimaryTopic && this.selectedPrimaryTopic.topicKeyword && header.keywords) {
							const primaryKeyword = this.selectedPrimaryTopic.topicKeyword;
							primaryKeywordMatch = header.keywords?.some(kw =>
								kw.toLowerCase() === primaryKeyword.toLowerCase()
							);
						}
						let primaryTagMatch = false;
						if (this.selectedPrimaryTopic && this.selectedPrimaryTopic.topicTag && header.tags) {
							const primaryTag = this.selectedPrimaryTopic.topicTag;
							primaryTagMatch = header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === primaryTag;
							});
						}
						const primaryInHeader = primaryKeywordMatch || primaryTagMatch;

						// Check if SECONDARY topic is in header
						let secondaryKeywordMatch = false;
						if (this.selectedSecondaryTopic && this.selectedSecondaryTopic.topicKeyword && header.keywords) {
							const secondaryKeyword = this.selectedSecondaryTopic.topicKeyword;
							secondaryKeywordMatch = header.keywords?.some(kw =>
								kw.toLowerCase() === secondaryKeyword.toLowerCase()
							);
						}
						let secondaryTagMatch = false;
						if (this.selectedSecondaryTopic && this.selectedSecondaryTopic.topicTag && header.tags) {
							const secondaryTag = this.selectedSecondaryTopic.topicTag;
							secondaryTagMatch = header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === secondaryTag;
							});
						}
						const secondaryInHeader = secondaryKeywordMatch || secondaryTagMatch;

						// Determine if this header matches based on mode
						let matches = false;
						if (useIntersection) {
							// Intersection: (primary in header AND secondary on file) OR (secondary in header AND primary on file)
							const validCase1 = primaryInHeader && secondaryInFile;
							const validCase2 = secondaryInHeader && primaryInFile;
							matches = validCase1 || validCase2;
						} else if (this.selectedPrimaryTopic) {
							// Simple matching with primary topic: check if primary topic is in header
							matches = primaryInHeader;
						} else if (this.selectedSecondaryTopic) {
							// Simple matching with secondary topic (orphans mode): check if secondary topic is in header
							matches = secondaryInHeader;
						}

						if (matches) {
							// Create unique key for this header
							const headerKey = `${headerLevel!.level}:${header.text}`;

							// Initialize or update header group
							if (!headerToEntriesMap.has(headerKey)) {
								headerToEntriesMap.set(headerKey, {
									level: headerLevel!.level,
									text: header.text,
									entries: []
								});
							}

							// Add this entry to the header's entry list
							headerToEntriesMap.get(headerKey)!.entries.push(entry);
						}
					}
				}
			}

			// Convert map to headers array
			for (const headerGroup of headerToEntriesMap.values()) {
				headers.push({
					record,
					headerText: headerGroup.text,
					headerLevel: headerGroup.level,
					entries: headerGroup.entries
				});
			}
		}


		if (headers.length === 0) {
			container.createEl('div', {
				text: 'No headers found',
				cls: 'kh-widget-filter-empty'
			});
			return;
		}

		// Render each header with toggle
		for (const { record, headerText, headerLevel, entries } of headers) {
			const headerId = `${record.filePath}:${headerLevel}:${headerText}`;
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
				// Re-render without blocking
				this.updateRecordsSection();
			});

			// Filename (truncated)
			const fileName = getFileNameFromPath(record.filePath).replace('.md', '');
			const truncatedName = fileName.length > 15 ? fileName.substring(0, 12) + '...' : fileName;
			const fileSpan = headerItem.createEl('span', {
				text: truncatedName,
				cls: 'kh-widget-filter-filename'
			});
			fileSpan.title = fileName;

			// Header text
			headerItem.createEl('span', {
				text: ` #${headerText}`,
				cls: 'kh-widget-filter-header-text'
			});

			// If expanded, show entries under this header
			if (isExpanded && entries && entries.length > 0) {
				const entriesContainer = headerGroup.createDiv({ cls: 'kh-widget-filter-entries' });
				for (const entry of entries) {
					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

						// Apply keyword-based styling (background color and text color)

						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async (e: MouseEvent) => {
							// Only open file on Command/Ctrl + click
							if ((e.metaKey || e.ctrlKey) && entry.lineNumber !== undefined) {
								const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
								if (file instanceof TFile) {
									const leaf = this.plugin.app.workspace.getLeaf(false);
									await leaf.openFile(file, {
										eState: { line: entry.lineNumber }
									});

									const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
									if (view && view.editor) {
										view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
										const scrollToLine = Math.max(0, entry.lineNumber - 3);
										view.editor.scrollIntoView({
											from: { line: scrollToLine, ch: 0 },
											to: { line: scrollToLine, ch: 0 }
										}, true);
									}
								}
							}
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
							record,
							this.plugin,
							true // compact mode
						);
					} else if (entry.type === 'codeblock' && (entry as any).language) {
						// Render code block
						const codeblockItem = entriesContainer.createDiv({
							cls: 'kh-widget-filter-entry kh-widget-filter-codeblock'
						});

						codeblockItem.style.cursor = 'pointer';
						codeblockItem.addEventListener('click', async (e: MouseEvent) => {
							// Only open file on Command/Ctrl + click
							if ((e.metaKey || e.ctrlKey) && entry.lineNumber !== undefined) {
								const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
								if (file instanceof TFile) {
									const leaf = this.plugin.app.workspace.getLeaf(false);
									await leaf.openFile(file, {
										eState: { line: entry.lineNumber }
									});

									const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
									if (view && view.editor) {
										view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
										const scrollToLine = Math.max(0, entry.lineNumber - 3);
										view.editor.scrollIntoView({
											from: { line: scrollToLine, ch: 0 },
											to: { line: scrollToLine, ch: 0 }
										}, true);
									}
								}
							}
						});

						// Render code block with syntax highlighting (non-blocking)
						const codeMarkdown = '```' + ((entry as any).language || '') + '\n' + ((entry as any).text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							codeblockItem,
							record.filePath,
							this.plugin as any
						);
					}
				}
			}
		}
	}

	/**
	 * Render entries from a record
	 */
	private async renderRecordEntries(record: ParsedFile, container: HTMLElement): Promise<void> {
		for (const entry of record.entries) {
			// Filter by keyword if selectedKeywordFilter is set
			if (this.selectedKeywordFilter) {
				let hasKeyword = false;

				// Check main entry keywords
				if (entry.keywords && entry.keywords.includes(this.selectedKeywordFilter)) {
					hasKeyword = true;
				}

				// Check subitem keywords
				if (!hasKeyword && entry.subItems && entry.subItems.length > 0) {
					for (const subItem of entry.subItems) {
						if (subItem.keywords && subItem.keywords.includes(this.selectedKeywordFilter)) {
							hasKeyword = true;
							break;
						}
					}
				}

				if (!hasKeyword) continue; // Skip this entry if it doesn't have the keyword
			}
		// Apply chip filtering ONLY if flag is set (for filter expression, NOT for column clicks)
		if (this.applyChipFiltering && this.activeChips.size > 0) {
			const hasMatch = this.entryMatchesActiveChips(entry);
			if (!hasMatch) continue;
		}

			if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
				const iconKeywords = this.resolveIconKeywords(entry.keywords);
				const primaryKeyword = entry.keywords[0];
				const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
				const entryItem = container.createDiv({
					cls: `kh-widget-filter-entry ${primaryKeywordClass}`
				});

				// Apply keyword-based styling (background color and text color)

				// Make entry clickable - navigate to line in source file
				entryItem.style.cursor = 'pointer';
				entryItem.addEventListener('click', async (e: MouseEvent) => {
					// Only open file on Command/Ctrl + click
					if ((e.metaKey || e.ctrlKey) && entry.lineNumber !== undefined) {
						const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
						if (file instanceof TFile) {
							// Open the file
							const leaf = this.plugin.app.workspace.getLeaf(false);
							await leaf.openFile(file, {
								eState: { line: entry.lineNumber }
							});

							// Navigate to the specific line
							const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
							if (view && view.editor) {
								view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
								const scrollToLine = Math.max(0, entry.lineNumber - 3);
								view.editor.scrollIntoView({
									from: { line: scrollToLine, ch: 0 },
									to: { line: scrollToLine, ch: 0 }
								}, true);
							}
						}
					}
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
					record,
					this.plugin,
					true // compact mode
				);
			} else if (entry.type === 'codeblock' && (entry as any).language) {
				const codeblockItem = container.createDiv({
					cls: 'kh-widget-filter-entry codeblock kh-entry-compact'
				});

				codeblockItem.style.cursor = 'pointer';
				codeblockItem.addEventListener('click', async (e: MouseEvent) => {
					// Only open file on Command/Ctrl + click
					if ((e.metaKey || e.ctrlKey) && entry.lineNumber !== undefined) {
						const file = this.plugin.app.vault.getAbstractFileByPath(record.filePath);
						if (file instanceof TFile) {
							const leaf = this.plugin.app.workspace.getLeaf(false);
							await leaf.openFile(file, {
								eState: { line: entry.lineNumber }
							});

							const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
							if (view && view.editor) {
								view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
								const scrollToLine = Math.max(0, entry.lineNumber - 3);
								view.editor.scrollIntoView({
									from: { line: scrollToLine, ch: 0 },
									to: { line: scrollToLine, ch: 0 }
								}, true);
							}
						}
					}
				});

				// Render code block with syntax highlighting
				const codeMarkdown = '```' + ((entry as any).language || '') + '\n' + ((entry as any).text || '') + '\n```';
				MarkdownRenderer.renderMarkdown(
					codeMarkdown,
					codeblockItem,
					record.filePath,
					this.plugin as any
				);
			}
		}
	}

	/**
	 * Check if entry matches active chips
	 */
	private entryMatchesActiveChips(entry: ParsedEntry): boolean {
		if (this.activeChips.size === 0) return true;

		// Extract active filters from chip IDs
		const activeKeywords = new Set<string>();
		const activeCategoryIds = new Set<string>();
		const activeCodeBlocks = new Set<string>();

		this.activeChips.forEach(chipId => {
			const [type, value] = chipId.split(':');
			if (type === 'keyword') {
				activeKeywords.add(value);
			} else if (type === 'primary-topic') {
				// Primary topic chip behaves like a keyword chip
				activeKeywords.add(value);
			} else if (type === 'category') {
				activeCategoryIds.add(value);
			} else if (type === 'codeblock') {
				activeCodeBlocks.add(value);
			}
		});

		// Get all keywords from active categories
		const categoryKeywords = new Set<string>();
		activeCategoryIds.forEach(categoryId => {
			const category = HighlightSpaceRepeatPlugin.settings.categories?.find((c: any) => c.id === categoryId);
			if (category && (category as any).keywords) {
				(category as any).keywords.forEach((kw: any) => {
					categoryKeywords.add(kw.keyword);
				});
			}
		});

		// Combine all matching keywords
		const allMatchingKeywords = new Set([...activeKeywords, ...categoryKeywords]);

		// Check keywords
		if (entry.keywords && entry.keywords.length > 0) {
			const hasMatchingKeyword = entry.keywords.some(kw => allMatchingKeywords.has(kw));
			if (hasMatchingKeyword) return true;
		}

		// Check code blocks
		if (entry.type === 'codeblock' && entry.language) {
			if (activeCodeBlocks.has(entry.language)) return true;
		}

		return false;
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
	 * Get CSS class for keyword (used for compact mode styling)
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

	/**
	 * Add a chip to the filter expression (e.g., add ".def" or ":boo")
	 */
	private addChipToExpression(chip: string): void {
		if (!this.activeFilterExpression) {
			this.activeFilterExpression = chip;
			return;
		}

		// Check if chip already exists
		const selectClause = this.getSelectClause(this.activeFilterExpression);
		const tokens = selectClause.split(/\s+/).filter(t => t.length > 0);

		if (tokens.includes(chip)) {
			return; // Already in expression
		}

		// Add chip to SELECT clause with OR
		const whereMatch = this.activeFilterExpression.match(/\s+W:\s+/);
		if (whereMatch) {
			const parts = this.activeFilterExpression.split(/\s+W:\s+/);
			const newSelect = parts[0] + ' OR ' + chip;
			this.activeFilterExpression = newSelect + ' W: ' + parts[1];
		} else {
			this.activeFilterExpression = this.activeFilterExpression + ' OR ' + chip;
		}
	}

	/**
	 * Remove a chip from the filter expression
	 */
	private removeChipFromExpression(chip: string): void {
		if (!this.activeFilterExpression) return;

		// Get SELECT and WHERE clauses
		const whereMatch = this.activeFilterExpression.match(/\s+W:\s+/);
		let selectClause = this.activeFilterExpression;
		let whereClause = '';

		if (whereMatch) {
			const parts = this.activeFilterExpression.split(/\s+W:\s+/);
			selectClause = parts[0];
			whereClause = parts[1] || '';
		}

		// Remove chip from SELECT clause
		// Handle both simple (.def) and compound (.goa.suc) keywords
		let tokens = selectClause.split(/\s+/).filter(t => t.length > 0);
		tokens = tokens.filter(t => t !== chip && t !== 'OR' && t !== 'AND' || t === chip);
		tokens = tokens.filter(t => t !== chip);

		// Clean up orphaned OR/AND operators
		const cleaned: string[] = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token === 'OR' || token === 'AND') {
				// Only keep if there's a term before and after
				if (i > 0 && i < tokens.length - 1 &&
					tokens[i - 1] !== 'OR' && tokens[i - 1] !== 'AND' &&
					tokens[i + 1] !== 'OR' && tokens[i + 1] !== 'AND') {
					cleaned.push(token);
				}
			} else {
				cleaned.push(token);
			}
		}

		// Rebuild expression
		const newSelect = cleaned.join(' ');
		if (whereClause) {
			this.activeFilterExpression = newSelect ? newSelect + ' W: ' + whereClause : 'W: ' + whereClause;
		} else {
			this.activeFilterExpression = newSelect || null;
		}
	}

	/**
	 * Get SELECT clause from filter expression
	 */
	private getSelectClause(expression: string): string {
		if (!expression) return '';

		const whereMatch = expression.match(/\s+W:\s+/);
		if (whereMatch) {
			return expression.split(/\s+W:\s+/)[0];
		}
		return expression;
	}

	/**
	 * Apply filter expression to records and display results
	 */
	private async applyFilterExpression(parsedRecords: ParsedFile[]): Promise<void> {

		if (!this.activeFilterExpression || this.activeFilterExpression.trim() === '' || this.activeFilterExpression.trim() === 'W:') {
			// Clear display when expression is empty
			this.selectedRecords = null;
			this.selectedFilterExpression = null;
			return;
		}

		// Use FilterExpressionService to count and filter records
		const { FilterExpressionService } = await import('../services/FilterExpressionService');

		try {
			// Pass ALL records and use selectedFilterExpression to filter at entry level - EXACTLY like clicking record count
			this.applyChipFiltering = false; // No chip filtering - we're using filter expression
			this.selectedRecords = parsedRecords; // Pass ALL records
			this.selectedContext = `Filter: ${this.activeFilterExpression}`;
			this.selectedHeaderMode = false;
			this.selectedFilterExpression = this.activeFilterExpression; // CRITICAL: Set this so renderSelectedRecords filters entries!

			// Note: Don't call updateRecordsSection() here - let render() handle it to avoid double-rendering
		} catch (error) {
			console.error('[Dashboard] Error applying filter expression:', error);
		}
	}

	/**
	 * Expand placeholders in filter expression (DOES NOT expand legacy .? #? `? placeholders)
	 * Only expands: $TAG, $KEY, $BLOCK, $CODE, $TEXT
	 * This matches Matrix's behavior - legacy placeholders are kept as-is for FilterParser to handle
	 */
	private expandPlaceholders(expression: string, primaryTopic: Topic | null, subject?: Subject): string {
		if (!primaryTopic && !subject) {
			return expression;
		}

		let result = expression;

		// Expand $TAG with topicTag (or subject mainTag)
		const tagSource = primaryTopic?.topicTag || subject?.mainTag;
		if (tagSource) {
			// NORMALIZE: Strip leading # from tag if present (works regardless of storage format)
			const tagValue = tagSource.replace(/^#/, '');
			result = result.replace(/\$TAG/g, `#${tagValue}`);
		}

		// Expand $KEY with topicKeyword (or subject keyword)
		const keywordSource = primaryTopic?.topicKeyword || subject?.keyword;
		if (keywordSource) {
			result = result.replace(/\$KEY/g, `.${keywordSource}`);
		}

		// Expand $BLOCK and $CODE with topicText (language/code block)
		if (primaryTopic?.topicText) {
			result = result.replace(/\$BLOCK/g, `\`${primaryTopic.topicText}`);
			result = result.replace(/\$CODE/g, `\`${primaryTopic.topicText}`);
		}

		// Expand $TEXT with topicText
		if (primaryTopic?.topicText) {
			result = result.replace(/\$TEXT/g, `"${primaryTopic.topicText}"`);
		}

		return result;
	}
}
