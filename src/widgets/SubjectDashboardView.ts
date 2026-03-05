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
	private activeChips: Set<string> = new Set();
	private selectedRecords: ParsedFile[] | null = null;
	private selectedContext: string = '';
	private selectedKeywordFilter: string | null = null; // Filter entries by this keyword when showing records
	private selectedTopicTag: string | null = null; // Filter headers by this tag when showing headers
	private selectedHeaderMode: boolean = false; // Show headers instead of entries
	private expandedHeaders: Set<string> = new Set(); // Track expanded headers

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

		// Header with subject selector, topic selector, and chips
		await this.renderHeader(container, primaryTopics);

		// Dashboard content
		await this.renderDashboard(container);

		// Selected records section (if any records selected)
		if (this.selectedRecords && this.selectedRecords.length > 0) {
			await this.renderSelectedRecords(container);
		}
	}

	/**
	 * Render secondary topics reminder at the top
	 */
	private renderSecondaryTopicsReminder(container: HTMLElement, secondaryTopics: Topic[]): void {
		if (secondaryTopics.length === 0) return;

		const reminder = container.createDiv({ cls: 'kh-secondary-topics-reminder' });
		reminder.style.padding = '8px 12px';
		reminder.style.marginBottom = '8px';
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
		topicsContainer.style.display = 'inline-flex';
		topicsContainer.style.flexWrap = 'wrap';
		topicsContainer.style.gap = '6px';

		// Add each topic as a compact tag
		secondaryTopics.forEach((topic, index) => {
			const topicTag = topicsContainer.createEl('span', { cls: 'kh-reminder-topic-tag' });
			topicTag.style.display = 'inline-flex';
			topicTag.style.alignItems = 'center';
			topicTag.style.gap = '4px';
			topicTag.style.padding = '2px 8px';
			topicTag.style.backgroundColor = 'var(--background-primary)';
			topicTag.style.borderRadius = '10px';
			topicTag.style.fontSize = '0.85em';
			topicTag.style.border = '1px solid var(--background-modifier-border)';

			// Icon
			if (topic.icon) {
				topicTag.createEl('span', { text: topic.icon });
			}

			// Name with # prefix if topicTag exists
			const tagText = topic.topicTag ? topic.topicTag : `#${topic.name.toLowerCase()}`;
			topicTag.createEl('span', {
				text: tagText,
				cls: 'kh-reminder-tag-text'
			}).style.color = 'var(--text-accent)';

			// Add separator if not last
			if (index < secondaryTopics.length - 1) {
				topicsContainer.createEl('span', {
					text: '•',
					cls: 'kh-reminder-separator'
				}).style.color = 'var(--text-faint)';
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
				this.selectedRecords = null;
				this.selectedContext = '';
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				this.expandedHeaders.clear();
				this.updateFilterExpression();
				this.render();
			});
		}

		// Primary topic selector (moved from renderDashboard)
		const topicSelect = header.createEl('select', { cls: 'kh-dashboard-topic-select' });
		topicSelect.createEl('option', { text: 'orphans', value: 'orphans' });
		primaryTopics.forEach(topic => {
			topicSelect.createEl('option', { text: topic.name, value: topic.id });
		});
		topicSelect.value = this.selectedPrimaryTopicId;

		topicSelect.addEventListener('change', () => {
			this.selectedPrimaryTopicId = topicSelect.value;
			this.updateFilterExpression();
			this.render();
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

		// Handle input changes - update chips when user modifies expression
		expressionInput.addEventListener('change', async () => {
			const newExpression = expressionInput.value.trim();
			this.activeFilterExpression = newExpression || null;

			// Re-render chips with new expression
			const existingChipsContainer = header.querySelector('.kh-dashboard-chips-container');
			if (existingChipsContainer) {
				existingChipsContainer.remove();
			}

			if (newExpression) {
				const parsedRecords = await this.loadParsedRecords();
				const chipsContainer = header.createDiv({ cls: 'kh-dashboard-chips-container' });
				await this.renderChipFilters(chipsContainer, parsedRecords);
			}
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

			console.log('[SubjectDashboard] SRS button clicked, entries:', entries.length);
			// TODO: Implement SRS integration with these entries
			new Notice(`SRS: ${entries.length} entries from ${filteredRecords.length} files`);
		});

		// Render chip filters if primary topic has mainDashboardFilter configured
		const selectedPrimaryTopic = this.getSelectedPrimaryTopic();
		const shouldRenderChips = selectedPrimaryTopic?.dashOnlyFilterExpSide || selectedPrimaryTopic?.dashOnlyFilterExpSide || selectedPrimaryTopic?.topicKeyword;

		if (shouldRenderChips) {
			const parsedRecords = await this.loadParsedRecords();
			const chipsContainer = header.createDiv({ cls: 'kh-dashboard-chips-container' });
			await this.renderChipFilters(chipsContainer, parsedRecords);
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
	private applyFilterExpression(
		filters: { keywords: string[], categories: string[], codeBlocks: string[] }
	): { keywords: string[], categoryIds: string[], codeBlocks: string[] } {
		if (!this.currentSubject?.expression) {
			return { keywords: filters.keywords, categoryIds: [], codeBlocks: filters.codeBlocks };
		}

		const parsedFilter = this.parseFilterExpression(this.currentSubject.expression);
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
		const selectedPrimaryTopic = this.getSelectedPrimaryTopic();

		// Priority: Primary topic's mainDashboardFilter > filterExpression > empty
		if (selectedPrimaryTopic?.dashOnlyFilterExpSide) {
			this.activeFilterExpression = selectedPrimaryTopic.dashOnlyFilterExpSide;
		} else if (selectedPrimaryTopic?.dashOnlyFilterExpSide) {
			this.activeFilterExpression = selectedPrimaryTopic.dashOnlyFilterExpSide;
		} else {
			this.activeFilterExpression = null;
		}
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

		let finalFilters: { keywords: string[], categoryIds: string[], codeBlocks: string[] } = { keywords: [], categoryIds: [], codeBlocks: [] };

		// Priority: Use activeFilterExpression (which may be user-edited or from topic/subject)
		if (this.activeFilterExpression) {
			const chips = this.extractChipsFromFilterExpression(this.activeFilterExpression);
			finalFilters.keywords = chips.keywords;
			finalFilters.categoryIds = chips.categoryIds;
			finalFilters.codeBlocks = chips.languages;
		}

		// Render category chips
		finalFilters.categoryIds.forEach(categoryId => {
			const category = HighlightSpaceRepeatPlugin.settings.categories?.find((c: any) => c.id === categoryId);
			if (!category) return;

			const chipId = `category:${categoryId}`;
			const isActive = this.activeChips.has(chipId);

			const chip = chipsContainer.createEl('button', {
				cls: `kh-dashboard-chip grid-keyword-chip ${isActive ? 'kh-chip-active' : ''}`
			});
			chip.textContent = (category as any).icon || '📁';
			chip.title = `Category: ${(category as any).name || categoryId}`;
			chip.style.padding = '4px 10px';
			chip.style.borderRadius = '12px';
			chip.style.border = '2px solid transparent';
			chip.style.cursor = 'pointer';
			chip.style.backgroundColor = (category as any).bgColor || 'var(--background-primary)';
			chip.style.color = (category as any).color || 'var(--text-normal)';

			chip.addEventListener('click', () => {
				// Toggle chip active state
				if (this.activeChips.has(chipId)) {
					this.activeChips.delete(chipId);
				} else {
					this.activeChips.add(chipId);
				}
				this.render();
			});
		});

		// Render keyword chips
		finalFilters.keywords.forEach(keyword => {
			// ONLY mark as PRIMARY if it matches the topic's topicKeyword field
			let isPrimaryTopicKeyword = false;
			if (selectedPrimaryTopic && selectedPrimaryTopic.topicKeyword === keyword) {
				isPrimaryTopicKeyword = true;
			}

			// Search through all categories to find the keyword
			let keywordDef: any = null;
			for (const category of HighlightSpaceRepeatPlugin.settings.categories || []) {
				keywordDef = category.keywords?.find((k: any) => k.keyword === keyword);
				if (keywordDef) break;
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

			// Render icon using mark element
			const mark = chip.createEl('mark', { cls: `kh-icon ${keyword}` });
			mark.innerHTML = '&nbsp;';

			chip.title = isPrimaryTopicKeyword
				? `Primary Topic: ${selectedPrimaryTopic!.name} - Shows ALL records with "${keyword}" keyword`
				: `Keyword: ${keyword}`;
			chip.style.padding = '4px 10px';
			chip.style.borderRadius = '12px';
			chip.style.border = isPrimaryTopicKeyword ? '3px solid gold' : '2px solid transparent';
			chip.style.cursor = 'pointer';
			chip.style.backgroundColor = keywordDef.bgColor || 'var(--background-primary)';
			chip.style.color = keywordDef.color || 'var(--text-normal)';

			chip.addEventListener('click', async () => {
				// Clear keyword filter when using chips
				this.selectedKeywordFilter = null;

				// Toggle chip active state
				if (this.activeChips.has(chipId)) {
					this.activeChips.delete(chipId);
					this.render();
				} else {
					this.activeChips.add(chipId);

					// For primary topic chip, automatically show ALL records
					if (isPrimaryTopicKeyword) {
						let allRecords = await this.loadParsedRecords();

						// Filter by active chips (including this primary topic chip)
						if (this.activeChips.size > 0) {
							allRecords = this.filterRecordsByActiveChips(allRecords);
						}

						this.selectedRecords = allRecords;
						this.selectedContext = `All Records - ${selectedPrimaryTopic!.name} (${allRecords.length})`;

						// Update records section
						await this.updateRecordsSection();
					}

					this.render();
				}
			});
		});

		// Render code block chips
		finalFilters.codeBlocks.forEach(codeBlock => {
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

			chip.addEventListener('click', () => {
				// Toggle chip active state
				if (this.activeChips.has(chipId)) {
					this.activeChips.delete(chipId);
				} else {
					this.activeChips.add(chipId);
				}
				this.render();
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
			// Get orphans - files that don't have any primary topic tags
			const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
			filteredRecords = parsedRecords.filter(record => {
				const tags = this.getRecordTags(record);
				return !primaryTopicTags.some(tag => tags.includes(tag!));
			});
		} else {
			// Get files for selected primary topic
			const selectedPrimaryTopic = primaryTopics.find(t => t.id === this.selectedPrimaryTopicId);
			if (selectedPrimaryTopic?.topicTag) {
				filteredRecords = this.getFilesWithTopicTag(parsedRecords, selectedPrimaryTopic.topicTag);
			}
		}

		// Render TOTALS column for selected primary topic (like matrix row header)
		const selectedPrimaryTopic = primaryTopics.find(t => t.id === this.selectedPrimaryTopicId);
		if (selectedPrimaryTopic && this.selectedPrimaryTopicId !== 'orphans') {
			this.renderTotalsColumn(columnsContainer, selectedPrimaryTopic, filteredRecords, parsedRecords);
		}

		// Render each secondary topic as a column
		secondaryTopics.forEach((topic, topicIndex) => {
			this.renderColumnFiles(columnsContainer, topic, topicIndex, filteredRecords, parsedRecords);
		});

		// Add "Other" column - files that don't have any secondary topic tags
		const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
		const otherFiles = filteredRecords.filter(record => {
			const tags = this.getRecordTags(record);
			return !secondaryTopicTags.some(tag => tags.includes(tag!));
		}).slice(0, 10);

		if (otherFiles.length > 0) {
			const column = columnsContainer.createDiv({ cls: 'kh-dashboard-column' });

			// Column header
			const header = column.createDiv({ cls: 'kh-dashboard-column-header' });
			header.style.cursor = 'pointer';
			header.createEl('span', {
				text: '📋 Other',
				cls: 'kh-dashboard-column-title'
			});

			header.createEl('span', {
				text: `(${otherFiles.length})`,
				cls: 'kh-dashboard-column-count'
			});

			// Click handler for column header - show all records from this column
			header.addEventListener('click', async () => {
				this.selectedKeywordFilter = null;
				this.selectedRecords = otherFiles;
				this.selectedContext = `Other (${otherFiles.length} files)`;
				await this.updateRecordsSection();
			});

			// Render files
			const filesList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			otherFiles.forEach(record => {
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
						if (primaryTopic.topicKeyword === 'ger' || primaryTopic.topicTag === '#german') {
							if (keywordMatch || tagMatch) {
								console.log(`[DASHBOARD DEBUG] Found matching header:`, {
									filePath: record.filePath,
									headerText: header.text,
									headerKeywords: header.keywords,
									headerTags: header.tags,
									topicKeyword: primaryTopic.topicKeyword,
									topicTag: primaryTopic.topicTag,
									keywordMatch,
									tagMatch
								});
							}
						}

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

		console.log(`[DASHBOARD DEBUG] Primary topic "${primaryTopic.name}" header count:`, {
			topicKeyword: primaryTopic.topicKeyword,
			topicTag: primaryTopic.topicTag,
			headerCount,
			totalRecords: allRecords.length
		});

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

		console.log(`[DASHBOARD DEBUG] Entry count for "${primaryTopic.name}":`, {
			filterExpression: primaryTopic.dashOnlyFilterExpSide,
			topicKeyword: primaryTopic.topicKeyword,
			topicTag: primaryTopic.topicTag,
			recordCount
		});

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
			// Apply chip filtering if chips are active
			let records = filteredRecords;
			if (this.activeChips.size > 0) {
				records = this.filterRecordsByActiveChips(records);
			}
			this.selectedRecords = records;
			this.selectedContext = `${primaryTopic.name}: ${records.length} files`;
			this.selectedKeywordFilter = null;
			this.selectedTopicTag = null;
			this.selectedHeaderMode = false;
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
			// Apply chip filtering if chips are active
			let records = recordsWithMatchingHeaders;
			if (this.activeChips.size > 0) {
				records = this.filterRecordsByActiveChips(records);
			}
			// Show headers matching the topic keyword/tag (from ALL files!)
			this.selectedRecords = records;
			this.selectedContext = `${primaryTopic.name}: ${records.length} headers`;
			this.selectedKeywordFilter = primaryTopic.topicKeyword || null;
			this.selectedTopicTag = primaryTopic.topicTag || null;
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
			// Show entries matching the topic keyword
			const recordsToShow = recordCount > 0 ? recordsWithMatchingEntries : filteredRecords;
			// Apply chip filtering if chips are active
			let records = recordsToShow;
			if (this.activeChips.size > 0) {
				records = this.filterRecordsByActiveChips(records);
			}
			this.selectedRecords = records;
			this.selectedContext = `${primaryTopic.name}: ${records.length} entries`;
			this.selectedKeywordFilter = primaryTopic.topicKeyword || null;
			this.selectedTopicTag = null;
			this.selectedHeaderMode = false;
			await this.updateRecordsSection();
		});

		// Content area - show files matching primary topic
		const content = column.createDiv({ cls: 'kh-dashboard-files-list' });
		const limitedFiles = filteredRecords.slice(0, 10);
		limitedFiles.forEach(record => {
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
	private renderColumnFiles(columnsContainer: HTMLElement, topic: Topic, topicIndex: number, filteredRecords: ParsedFile[], allRecords: ParsedFile[]): void {
		// Count files with topic tag (from filtered records for current primary topic)
		let topicFiles: ParsedFile[] = [];
		if (topic.topicTag) {
			topicFiles = filteredRecords.filter(record => {
				const tags = this.getRecordTags(record);
				return tags.includes(topic.topicTag!);
			});
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
			const primaryTopics = this.currentSubject.primaryTopics || [];
			const primaryTopicIndex = primaryTopics.findIndex(t => t.id === this.selectedPrimaryTopicId);

			if (primaryTopicIndex >= 0) {
				const rowNum = primaryTopicIndex + 2; // Primary topics start at row 2
				const cellKey = `${rowNum}x${col}`;
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
				// Apply chip filtering if chips are active
				let records = topicFiles;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} files`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
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
				// Apply chip filtering if chips are active
				let records = recordsWithMatchingHeaders;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} headers`;
				this.selectedKeywordFilter = topic.topicKeyword || null;
				this.selectedTopicTag = topic.topicTag || null;
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
				// Apply chip filtering if chips are active
				let records = recordsWithMatchingEntries;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} entries`;
				this.selectedKeywordFilter = topic.topicKeyword || null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				await this.updateRecordsSection();
			});

			// Render files (display mode)
			const filesList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			topicFiles.slice(0, 10).forEach(record => {
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
				// Apply chip filtering if chips are active
				let records = topicFiles;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} files`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
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
				// Apply chip filtering if chips are active
				let records = recordsWithMatchingHeaders;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} headers`;
				this.selectedKeywordFilter = topic.topicKeyword || null;
				this.selectedTopicTag = topic.topicTag || null;
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
				// Apply chip filtering if chips are active
				let records = recordsWithMatchingEntries;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} entries`;
				this.selectedKeywordFilter = topic.topicKeyword || null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				await this.updateRecordsSection();
			});

			// Render headers (display mode)
			const headersList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			matchingHeaders.slice(0, 10).forEach(({ record, header }) => {
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
				// Apply chip filtering if chips are active
				let records = topicFiles;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} files`;
				this.selectedKeywordFilter = null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
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
				// Apply chip filtering if chips are active
				let records = recordsWithMatchingHeaders;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} headers`;
				this.selectedKeywordFilter = topic.topicKeyword || null;
				this.selectedTopicTag = topic.topicTag || null;
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
				// Apply chip filtering if chips are active
				let records = recordsWithMatchingEntries;
				if (this.activeChips.size > 0) {
					records = this.filterRecordsByActiveChips(records);
				}
				this.selectedRecords = records;
				this.selectedContext = `${topic.name}: ${records.length} entries`;
				this.selectedKeywordFilter = topic.topicKeyword || null;
				this.selectedTopicTag = null;
				this.selectedHeaderMode = false;
				await this.updateRecordsSection();
			});

			// Render files with entries (display mode)
			const recordsList = column.createDiv({ cls: 'kh-dashboard-files-list' });
			recordsWithMatchingEntries.slice(0, 10).forEach(record => {
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
	 */
	private async loadParsedRecords(): Promise<ParsedFile[]> {
		const parsedRecordsPath = DATA_PATHS.PARSED_FILES;
		const exists = await this.plugin.app.vault.adapter.exists(parsedRecordsPath);

		if (!exists) {
			console.warn('[SubjectDashboardView] No parsed records found.');
			return [];
		}

		const jsonContent = await this.plugin.app.vault.adapter.read(parsedRecordsPath);
		return JSON.parse(jsonContent);
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
		}

		// Note: selectedKeywordFilter is set externally before calling this method
		// and is NOT cleared here so it persists for the current selection
	}

	/**
	 * Render selected records section
	 * Shows records from clicked file or column, filtered by active chips
	 */
	private async renderSelectedRecords(container: HTMLElement): Promise<void> {
		if (!this.selectedRecords || this.selectedRecords.length === 0) return;

		// Create section container
		const recordsSection = container.createDiv({ cls: 'kh-dashboard-records-section' });

		// Section header
		const sectionHeader = recordsSection.createDiv({ cls: 'kh-dashboard-records-header' });
		sectionHeader.createEl('h3', {
			text: `Records: ${this.selectedContext}`,
			cls: 'kh-dashboard-records-title'
		});

		// Show headers if in header mode, otherwise show entries
		if (this.selectedHeaderMode) {
			await this.renderSelectedHeaders(recordsSection);
		} else {
			// Show all selected records (don't filter at record level)
			// Filtering happens at entry level in renderRecordEntries
			for (const record of this.selectedRecords) {
				// Create temporary container to check if any entries will be rendered
				const tempContainer = createDiv();
				await this.renderRecordEntries(record, tempContainer);

				// Only add file header and entries if there are actual entries
				if (tempContainer.childNodes.length > 0) {
					// File header
					const fileHeader = recordsSection.createDiv({ cls: 'kh-dashboard-record-file' });
					fileHeader.createEl('strong', { text: getFileNameFromPath(record.filePath).replace('.md', '') });

					// Container for entries
					const entriesContainer = recordsSection.createDiv({ cls: 'kh-dashboard-record-entries' });

					// Move entries from temp container to real container
					while (tempContainer.firstChild) {
						entriesContainer.appendChild(tempContainer.firstChild);
					}
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

		// Collect matching headers (EXACT same logic as counting)
		for (const record of this.selectedRecords) {
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
						// Check if keyword is in header.keywords array
						let keywordMatch = false;
						if (this.selectedKeywordFilter && header.keywords) {
							keywordMatch = header.keywords?.some(kw =>
								kw.toLowerCase() === this.selectedKeywordFilter!.toLowerCase()
							);
						}

						// Check if header tags include the topic tag
						let tagMatch = false;
						if (this.selectedTopicTag && header.tags) {
							tagMatch = header.tags?.some(tag => {
								const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
								return normalizedTag === this.selectedTopicTag;
							});
						}

						if (keywordMatch || tagMatch) {
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

			// Filter entries by active chips if any are selected
			if (this.activeChips.size > 0) {
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
}
