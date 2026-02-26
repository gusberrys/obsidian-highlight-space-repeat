import { App, Modal, Setting } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';
import { settingsStore, subjectsStore, saveSubjects, codeBlocksStore, importGlobalTopic } from '../stores/settings-store';
import { get } from 'svelte/store';
import type { GlobalTopic } from '../shared/subjects-data';

/**
 * Modal for creating/editing subjects with autocomplete inputs for keywords and categories
 */
export class SubjectModal extends Modal {
	private subject: Subject;
	private onSubmit: (subject: Subject) => void;
	private topics: Topic[] = [];

	// Filter selections
	private selectedKeywords: Set<string> = new Set();
	private selectedCategories: Set<string> = new Set();
	private selectedLanguages: Set<string> = new Set();
	private whereClause: string = ''; // Preserve WHERE clause (after W:)

	private allKeywords: string[] = [];
	private allCategories: Array<{ id: string, icon: string }> = [];
	private allLanguages: string[] = [];

	constructor(
		app: App,
		private plugin: HighlightSpaceRepeatPlugin,
		subject: Subject | null,
		onSubmit: (subject: Subject) => void
	) {
		super(app);
		this.onSubmit = onSubmit;

		// Get current settings and subjects data
		const currentSettings = get(settingsStore);
		const subjectsData = get(subjectsStore);

		// If editing, clone the subject; otherwise create new
		if (subject) {
			this.subject = { ...subject };
			// Load topics for this subject
			this.topics = subjectsData.topics.filter((t: Topic) => t.subjectId === subject.id);
		} else {
			// Create new subject with unique ID
			this.subject = {
				id: `subject-${Date.now()}`,
				name: '',
				enabled: true
			};
			this.topics = [];
		}

		// Collect all available options
		this.collectAvailableOptions();

		// Parse expression to populate selections
		if (this.subject.expression) {
			this.parseExpression(this.subject.expression);
		} else if ((this.subject as any).chips) {
			// Fallback: Load from chips if no expression
			const chips = (this.subject as any).chips;
			if (chips.includeKeywords?.length > 0) {
				this.selectedKeywords = new Set(chips.includeKeywords);
			}
			if (chips.includeCategories?.length > 0) {
				this.selectedCategories = new Set(chips.includeCategories);
			}
			if (chips.includeLanguages?.length > 0) {
				this.selectedLanguages = new Set(chips.includeLanguages);
			}
		}
	}

	private collectAvailableOptions(): void {
		// Get keyword data from settings store
		const settings = get(settingsStore);

		// Keywords
		for (const category of settings.categories) {
			for (const kw of category.keywords) {
				if (kw.keyword) {
					this.allKeywords.push(kw.keyword);
				}
			}
		}

		// Categories
		for (const category of settings.categories) {
			this.allCategories.push({
				id: category.id || '',
				icon: category.icon
			});
		}

		// Languages - get from codeBlocks store
		const codeBlocks = get(codeBlocksStore);
		this.allLanguages = codeBlocks.map((l) => l.id).sort();

		// Merge languages into keywords list for unified selection
		this.allKeywords.push(...this.allLanguages);
		this.allKeywords.sort();
	}

	/**
	 * Parse expression and update selected sets
	 * Supports: keyword/language (auto-detected), :category, keyword.pair
	 * Preserves WHERE clause (after W:) separately
	 * Languages are treated as keywords from user perspective
	 */
	private parseExpression(expression: string): void {
		this.selectedKeywords.clear();
		this.selectedCategories.clear();
		this.selectedLanguages.clear();
		this.whereClause = '';

		if (!expression || !expression.trim()) return;

		// Check if expression starts with W: (WHERE-only)
		const whereOnlyMatch = expression.trim().match(/^W:\s+(.+)$/i);
		if (whereOnlyMatch) {
			this.whereClause = whereOnlyMatch[1];
			return;
		}

		// Split at W: to separate SELECT from WHERE clause
		const parts = expression.split(/\s+W:\s+/i);
		const selectPart = parts[0];

		// Preserve WHERE clause if it exists
		if (parts.length > 1) {
			this.whereClause = parts.slice(1).join(' W: '); // In case there are multiple W: (shouldn't happen but be safe)
		}

		// Split by space and comma, filter empty
		const tokens = selectPart.split(/[\s,]+/).filter(t => t.trim());

		for (const token of tokens) {
			if (token.startsWith(':')) {
				// Category: :category-name
				const categoryClass = token.substring(1);
				this.selectedCategories.add(categoryClass);
			} else if (token && !token.match(/^(AND|OR)$/i)) {
				// Keyword or Language (auto-detect)
				// Add to selectedKeywords for UI purposes
				this.selectedKeywords.add(token);

				// If it's a language, also add to selectedLanguages for filtering
				if (this.allLanguages.includes(token)) {
					this.selectedLanguages.add(token);
				}
			}
		}
	}

	/**
	 * Generate expression from current selections
	 * Languages are included in keywords - no special syntax needed
	 * Appends preserved WHERE clause if it exists
	 */
	private generateExpression(): string {
		const parts: string[] = [];

		// Add categories with : prefix
		this.selectedCategories.forEach(cat => parts.push(`:${cat}`));

		// Add keywords (includes languages)
		this.selectedKeywords.forEach(kw => parts.push(kw));

		let expression = parts.join(' ');

		// Append WHERE clause if it exists
		if (this.whereClause) {
			expression += (expression ? ' ' : '') + 'W: ' + this.whereClause;
		}

		return expression;
	}

	/**
	 * Update expression input field from current selections
	 */
	private updateExpression(): void {
		const exprInput = document.getElementById('subject-expression') as HTMLInputElement;
		if (exprInput) {
			exprInput.value = this.generateExpression();
			this.subject.expression = exprInput.value;
		}
	}

	/**
	 * Refresh all chip displays
	 */
	private refreshAllChips(): void {
		this.refreshChipsOnly('keyword', this.selectedKeywords);
		this.refreshChipsOnly('category', this.selectedCategories);
	}

	/**
	 * Refresh only the chips display without re-rendering the entire form
	 */
	private refreshChipsOnly(type: 'keyword' | 'category' | 'language', selected: Set<string>): void {
		const chipsDisplay = document.getElementById(`kb-chips-${type}`);
		if (!chipsDisplay) return;

		chipsDisplay.empty();

		if (selected.size === 0) {
			chipsDisplay.createEl('p', { text: 'No items selected', cls: 'kb-empty-hint' });
		} else {
			selected.forEach(value => {
				this.renderChip(chipsDisplay, value, type, () => {
					selected.delete(value);
					this.updateExpression();
					this.refreshChipsOnly(type, selected);
				});
			});
		}
	}

	private renderChip(
		container: HTMLElement,
		value: string,
		type: 'keyword' | 'category' | 'language',
		onRemove: () => void
	): void {
		const chip = container.createDiv({ cls: 'kb-selected-chip kb-chip-include' });

		// Find config for styling
		let icon = '🏷️';
		let displayType: string = type;

		if (type === 'keyword') {
			// Check if this keyword is actually a language
			const isLanguage = this.allLanguages.includes(value);

			if (isLanguage) {
				// Style as language
				const codeBlocks = get(codeBlocksStore);
				const lang = codeBlocks.find((l) => l.id === value);
				icon = lang?.icon || '💻';
				displayType = 'code block';
			} else {
				// Style as keyword
				const config = this.findKeywordConfig(value);
				icon = config?.generateIcon || '🏷️';
				if (config?.backgroundColor) {
					chip.style.backgroundColor = config.backgroundColor;
				}
				if (config?.color) {
					chip.style.color = config.color;
				}
			}
		} else if (type === 'category') {
			// Handle virtual code-blocks category
			if (value === 'code-blocks') {
				icon = '💻';
			} else {
				const cat = this.allCategories.find(c => c.id === value);
				icon = cat?.icon || '📁';
			}
		}

		chip.createSpan({ text: icon, cls: 'kb-chip-icon' });
		chip.createSpan({ text: value, cls: 'kb-chip-label' });

		const removeBtn = chip.createSpan({ text: '×', cls: 'kb-chip-remove' });
		removeBtn.onclick = onRemove;

		chip.title = `${displayType}: ${value} (click × to remove)`;
	}

	private findKeywordConfig(keyword: string): any {
		const settings = get(settingsStore);
		for (const category of settings.categories) {
			const found = category.keywords.find((k: any) => k.keyword === keyword);
			if (found) return found;
		}
		return null;
	}

	/**
	 * Render visual category browser - click to add/remove category
	 */
	private renderCategoryBrowser(containerEl: HTMLElement, selected: Set<string>): void {
		const browserDiv = containerEl.createDiv({ cls: 'kb-category-browser' });

		// Display all categories as clickable chips
		this.allCategories.forEach(category => {
			const isSelected = selected.has(category.id);

			const categoryChip = browserDiv.createDiv({ cls: 'kb-category-chip' });

			// Visual indicator
			let indicator = '';
			if (isSelected) {
				indicator = ' ✓';
				categoryChip.style.opacity = '1';
				categoryChip.style.fontWeight = '700';
			} else {
				indicator = ' +';
				categoryChip.style.opacity = '0.5';
			}

			categoryChip.textContent = `${category.icon} ${category.id}${indicator}`;
			categoryChip.title = isSelected
				? `Click to remove category :${category.id}`
				: `Click to add category :${category.id}`;

			categoryChip.onclick = () => {
				if (isSelected) {
					selected.delete(category.id);
				} else {
					selected.add(category.id);
				}
				this.updateExpression();
				this.refreshChipsOnly('category', selected);
				// Re-render to update indicators
				this.onOpen();
			};
		});

		// Add Code Blocks virtual category (works like other categories)
		if (this.allLanguages.length > 0) {
			const isSelected = selected.has('code-blocks');

			const categoryChip = browserDiv.createDiv({ cls: 'kb-category-chip' });

			// Visual indicator
			let indicator = '';
			if (isSelected) {
				indicator = ' ✓';
				categoryChip.style.opacity = '1';
				categoryChip.style.fontWeight = '700';
			} else {
				indicator = ' +';
				categoryChip.style.opacity = '0.5';
			}

			categoryChip.textContent = `💻 Code Blocks :code-blocks${indicator}`;
			categoryChip.title = isSelected
				? `Click to remove category :code-blocks`
				: `Click to add category :code-blocks`;

			categoryChip.onclick = () => {
				if (isSelected) {
					selected.delete('code-blocks');
				} else {
					selected.add('code-blocks');
				}
				this.updateExpression();
				this.refreshChipsOnly('category', selected);
				// Re-render to update indicators
				this.onOpen();
			};
		}
	}

	private renderFilterSection(
		containerEl: HTMLElement,
		title: string,
		type: 'keyword' | 'category' | 'language',
		allOptions: string[],
		selected: Set<string>
	): void {
		const section = containerEl.createDiv({ cls: 'kb-filter-section' });

		// Header
		const header = section.createDiv({ cls: 'kb-filter-header' });
		header.createEl('h4', { text: title });

		// Category browser (ONLY for categories) - no separate chips display
		if (type === 'category') {
			this.renderCategoryBrowser(section, selected);
		} else {
			// Chips display (for keywords only)
			const chipsDisplay = section.createDiv({ cls: 'kb-chips-display' });
			chipsDisplay.id = `kb-chips-${type}`;
			if (selected.size === 0) {
				chipsDisplay.createEl('p', { text: 'No items selected', cls: 'kb-empty-hint' });
			} else {
				selected.forEach(value => {
					this.renderChip(chipsDisplay, value, type, () => {
						selected.delete(value);
						this.updateExpression();
						this.refreshChipsOnly(type, selected);
					});
				});
			}
		}

		// Input field with autocomplete (only for keywords, not categories)
		if (type !== 'category') {
			const inputDiv = section.createDiv({ cls: 'kb-autocomplete-container' });
			const input = inputDiv.createEl('input', {
				type: 'text',
				cls: 'kb-autocomplete-input',
				placeholder: `Type to add ${title.toLowerCase()}...`
			});

			const suggestionsEl = inputDiv.createDiv({ cls: 'kb-suggestions' });
			suggestionsEl.style.display = 'none';

			input.oninput = () => {
				const query = input.value.toLowerCase().trim();
				if (!query) {
					suggestionsEl.style.display = 'none';
					return;
				}

				const matches = allOptions.filter(opt =>
					opt.toLowerCase().includes(query) && !selected.has(opt)
				).slice(0, 10);

				if (matches.length === 0) {
					suggestionsEl.style.display = 'none';
					return;
				}

				suggestionsEl.empty();
				suggestionsEl.style.display = 'block';

				matches.forEach(match => {
					const suggestion = suggestionsEl.createDiv({ cls: 'kb-suggestion-item' });
					suggestion.textContent = match;
					suggestion.onclick = () => {
						selected.add(match);
						input.value = '';
						suggestionsEl.style.display = 'none';
						this.updateExpression();
						this.refreshChipsOnly(type, selected);
					};
				});
			};

			input.onblur = () => {
				setTimeout(() => {
					suggestionsEl.style.display = 'none';
				}, 200);
			};

			input.onkeydown = (e) => {
				if (e.key === 'Enter') {
					const query = input.value.trim();
					if (allOptions.includes(query) && !selected.has(query)) {
						selected.add(query);
						input.value = '';
						suggestionsEl.style.display = 'none';
						this.updateExpression();
						this.refreshChipsOnly(type, selected);
					}
				}
			};
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('kb-subject-modal');

		// Basic info section
		this.renderBasicInfo(contentEl);

		// Filter configuration section
		this.renderFilterConfiguration(contentEl);

		// Render topics sections (only if editing)
		if (this.subject.id && this.subject.id !== `subject-${Date.now()}`) {
			this.renderTopicsSections(contentEl);

			// Render matrix section
			this.renderMatrixSection(contentEl);

			// Render favorite filters section
			this.renderFavoriteFiltersSection(contentEl);
		}

		// Action buttons
		this.renderActionButtons(contentEl);
	}

	/**
	 * Render basic subject information
	 */
	private renderBasicInfo(containerEl: HTMLElement): void {
		// Name, Icon, Main Tag, and Keyword in one row
		const nameIconTagRow = containerEl.createDiv({ cls: 'kb-modal-row kb-basic-info-row' });

		const nameDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-with-label' });
		nameDiv.createEl('span', { text: 'NAME', cls: 'kb-field-label' });
		const nameInput = nameDiv.createEl('input', {
			type: 'text',
			attr: { id: 'subject-name' },
			value: this.subject.name,
			placeholder: 'e.g., Bathory'
		});
		nameInput.addEventListener('input', (e) => {
			this.subject.name = (e.target as HTMLInputElement).value;
		});

		const iconDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-icon-with-label' });
		iconDiv.createEl('span', { text: 'ICON', cls: 'kb-field-label' });
		const iconInput = iconDiv.createEl('input', {
			type: 'text',
			attr: { id: 'subject-icon' },
			value: this.subject.icon || '',
			placeholder: '🎯'
		});
		iconInput.setAttribute('maxlength', '10');
		iconInput.addEventListener('input', (e) => {
			this.subject.icon = (e.target as HTMLInputElement).value;
		});

		const mainTagDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-with-label' });
		mainTagDiv.createEl('span', { text: 'TAG', cls: 'kb-field-label' });
		const mainTagInput = mainTagDiv.createEl('input', {
			type: 'text',
			attr: { id: 'subject-main-tag' },
			value: this.subject.mainTag || '',
			placeholder: 'e.g., #german'
		});
		mainTagInput.addEventListener('input', (e) => {
			this.subject.mainTag = (e.target as HTMLInputElement).value;
		});

		const keywordDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-with-label' });
		keywordDiv.createEl('span', { text: 'KEY', cls: 'kb-field-label' });
		const keywordInput = keywordDiv.createEl('input', {
			type: 'text',
			attr: { id: 'subject-keyword' },
			value: this.subject.keyword || '',
			placeholder: 'e.g., bathory'
		});
		keywordInput.addEventListener('input', (e) => {
			this.subject.keyword = (e.target as HTMLInputElement).value;
		});
	}

	/**
	 * Render filter configuration section
	 */
	private renderFilterConfiguration(containerEl: HTMLElement): void {
		// Filter configuration header and expression input on one line
		const filterConfigRow = containerEl.createDiv({ cls: 'kb-filter-config-row' });
		filterConfigRow.createEl('h3', { text: '🏷️ Filter Configuration', cls: 'kb-section-title kb-inline-title' });

		const exprFieldDiv = filterConfigRow.createDiv({ cls: 'kb-modal-field kb-expr-field-inline' });
		const exprLabel = exprFieldDiv.createEl('label', {
			text: 'Expression: ',
			cls: 'kb-filter-label'
		});
		exprLabel.style.fontSize = '0.8em';
		exprLabel.style.color = 'var(--text-muted)';
		exprLabel.style.marginRight = '8px';

		const exprInput = exprFieldDiv.createEl('textarea', {
			attr: { id: 'subject-expression', rows: '2' },
			value: this.subject.expression || this.generateExpression(),
			placeholder: 'S: .keyword :category `language W: #tag'
		});
		exprInput.style.width = '100%';
		exprInput.style.resize = 'vertical';

		// Parse expression on input and update chips
		exprInput.oninput = () => {
			this.parseExpression(exprInput.value);
			this.subject.expression = exprInput.value;
			this.refreshAllChips();
		};

		// Filter sections side-by-side (compact)
		const filterSectionsRow = containerEl.createDiv({ cls: 'kb-filter-sections-row' });

		// Keywords section (includes languages)
		this.renderFilterSection(
			filterSectionsRow,
			'Keywords & Code Blocks',
			'keyword',
			this.allKeywords,
			this.selectedKeywords
		);

		// Categories section
		this.renderFilterSection(
			filterSectionsRow,
			'Groups (Categories)',
			'category',
			this.allCategories.map(c => c.id),
			this.selectedCategories
		);
	}

	/**
	 * Render topics sections
	 */
	private renderTopicsSections(containerEl: HTMLElement): void {
		const primaryTopics = this.topics.filter(t => t.type === 'primary');
		const secondaryTopics = this.topics.filter(t => t.type === 'secondary');

		// Primary Topics Section
		this.renderPrimaryTopicsSection(containerEl, primaryTopics);

		// Global Topics Import Section (shown before secondary topics)
		this.renderGlobalTopicsImportSection(containerEl);

		// Secondary Topics Section
		this.renderSecondaryTopicsSection(containerEl, secondaryTopics);
	}

	/**
	 * Render Primary Topics section
	 */
	private renderPrimaryTopicsSection(containerEl: HTMLElement, primaryTopics: Topic[]): void {
		const section = containerEl.createDiv({ cls: 'kb-topic-section' });

		// Header with Add button
		const header = section.createDiv({ cls: 'kb-topic-section-header' });
		header.createEl('h3', { text: '📌 Primary Topics', cls: 'kb-section-title' });

		const addBtn = header.createEl('button', {
			text: '+ Add',
			cls: 'kb-add-topic-inline-btn'
		});
		addBtn.addEventListener('click', () => {
			this.addPrimaryTopic();
		});

		// Topics container
		const topicsContainer = section.createDiv({ cls: 'kb-topics-container' });

		if (primaryTopics.length === 0) {
			topicsContainer.createEl('p', {
				text: 'No primary topics. Click "+ Add" to create one.',
				cls: 'kb-empty-hint'
			});
		} else {
			primaryTopics.forEach(topic => {
				this.renderPrimaryTopicFields(topicsContainer, topic);
			});
		}
	}

	/**
	 * Render Primary Topic fields
	 */
	private renderPrimaryTopicFields(container: HTMLElement, topic: Topic): void {
		const topicCard = container.createDiv({ cls: 'kb-topic-card' });
		const row = topicCard.createDiv({ cls: 'kb-modal-row' });

		// Reorder controls
		const primaryTopics = this.topics.filter(t => t.type === 'primary');
		const currentIndex = primaryTopics.findIndex(t => t.id === topic.id);
		const isFirst = currentIndex === 0;
		const isLast = currentIndex === primaryTopics.length - 1;

		const reorderControls = row.createDiv({ cls: 'kb-topic-reorder-controls' });

		const upBtn = reorderControls.createEl('button', {
			text: '▲',
			cls: 'kb-topic-move-btn'
		});
		upBtn.disabled = isFirst;
		upBtn.title = isFirst ? 'Already first' : 'Move up';
		upBtn.addEventListener('click', () => {
			this.movePrimaryTopicUp(topic.id);
		});

		const downBtn = reorderControls.createEl('button', {
			text: '▼',
			cls: 'kb-topic-move-btn'
		});
		downBtn.disabled = isLast;
		downBtn.title = isLast ? 'Already last' : 'Move down';
		downBtn.addEventListener('click', () => {
			this.movePrimaryTopicDown(topic.id);
		});

		// Name field (70px for primary)
		const nameField = row.createDiv({ cls: 'kb-topic-field-name kb-topic-field-name-primary' });
		const nameInput = nameField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'name' },
			value: topic.name
		});
		nameInput.placeholder = 'Name';
		nameInput.addEventListener('input', (e) => {
			topic.name = (e.target as HTMLInputElement).value;
		});

		// Icon field (35px for primary)
		const iconField = row.createDiv({ cls: 'kb-topic-field-icon kb-topic-field-icon-primary' });
		const iconInput = iconField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'icon' },
			value: topic.icon || ''
		});
		iconInput.placeholder = '📌';
		iconInput.setAttribute('maxlength', '10');
		iconInput.addEventListener('input', (e) => {
			topic.icon = (e.target as HTMLInputElement).value;
		});

		// TAG field (compact with label)
		const tagField = row.createDiv({ cls: 'kb-topic-field-compact' });
		tagField.createEl('label', { text: 'TAG' });
		const tagInput = tagField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'topicTag' },
			value: topic.topicTag || ''
		});
		tagInput.placeholder = '#java';
		tagInput.addEventListener('input', (e) => {
			topic.topicTag = (e.target as HTMLInputElement).value;
		});

		// KEY field (compact with label)
		const keyField = row.createDiv({ cls: 'kb-topic-field-compact' });
		keyField.createEl('label', { text: 'KEY' });
		const keyInput = keyField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'topicKeyword' },
			value: topic.topicKeyword || ''
		});
		keyInput.placeholder = 'java';
		keyInput.addEventListener('input', (e) => {
			topic.topicKeyword = (e.target as HTMLInputElement).value;
		});

		// TEXT field (compact with label)
		const textField = row.createDiv({ cls: 'kb-topic-field-compact' });
		textField.createEl('label', { text: 'TEXT' });
		const textInput = textField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'topicText' },
			value: topic.topicText || ''
		});
		textInput.placeholder = 'Java';
		textInput.addEventListener('input', (e) => {
			topic.topicText = (e.target as HTMLInputElement).value;
		});

		// Main Dashboard Filter field (RED - for Dashboard View chips)
		const dashboardFilterField = row.createDiv({ cls: 'kb-topic-field-expr' });
		const dashboardFilterInput = dashboardFilterField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'mainDashboardFilter' },
			value: topic.mainDashboardFilter || ''
		});
		dashboardFilterInput.placeholder = 'Dashboard Filter (RED): S: .keyword :category W: #tag';
		dashboardFilterInput.style.backgroundColor = 'rgba(255, 0, 0, 0.1)'; // RED background
		dashboardFilterInput.style.border = '1px solid rgba(255, 0, 0, 0.3)';
		dashboardFilterInput.addEventListener('input', (e) => {
			topic.mainDashboardFilter = (e.target as HTMLInputElement).value;
		});

		// Matrix Record Filter field (BLUE - for Matrix View counting)
		const exprField = row.createDiv({ cls: 'kb-topic-field-expr' });
		const exprInput = exprField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'filterExpression' },
			value: topic.filterExpression || ''
		});
		exprInput.placeholder = 'Matrix Filter (BLUE): :category keyword W: #tag';
		exprInput.style.backgroundColor = 'rgba(0, 0, 255, 0.1)'; // BLUE background
		exprInput.style.border = '1px solid rgba(0, 0, 255, 0.3)';
		exprInput.addEventListener('input', (e) => {
			topic.filterExpression = (e.target as HTMLInputElement).value;
		});

		// Delete button
		const deleteBtn = row.createEl('button', {
			text: '🗑️',
			cls: 'kb-topic-delete-btn'
		});
		deleteBtn.addEventListener('click', () => {
			this.removeTopic(topic.id);
		});
	}

	/**
	 * Render Global Topics Import section
	 */
	private renderGlobalTopicsImportSection(containerEl: HTMLElement): void {
		const subjectsData = get(subjectsStore);
		const globalTopics = subjectsData.globalTopics || [];

		// Don't show section if there are no global topics
		if (globalTopics.length === 0) {
			return;
		}

		const section = containerEl.createDiv({ cls: 'kb-topic-section' });

		// Header
		const header = section.createDiv({ cls: 'kb-topic-section-header' });
		const titleEl = header.createEl('h3', { text: '🌐 Import Global Topics', cls: 'kb-section-title' });

		// Info icon with tooltip
		const infoIcon = titleEl.createEl('span', {
			text: ' ℹ️',
			cls: 'kb-info-icon'
		});
		infoIcon.setAttribute('title', 'Check global topics to import them as secondary topics for this subject');

		// Container for global topic checkboxes
		const globalTopicsContainer = section.createDiv({ cls: 'kb-global-topics-import-container' });

		// Get IDs of already imported global topics to check for duplicates
		const importedGlobalTopicIds = new Set<string>();
		this.topics.forEach(topic => {
			// Check if this topic was imported from a global topic
			// We can identify this by checking if the topic properties match a global topic
			globalTopics.forEach(gt => {
				if (topic.name === gt.name &&
					topic.icon === gt.icon &&
					topic.topicTag === gt.topicTag &&
					topic.topicKeyword === gt.topicKeyword &&
					topic.filterExpression === gt.filterExpression) {
					importedGlobalTopicIds.add(gt.id);
				}
			});
		});

		globalTopics.forEach(globalTopic => {
			const checkboxRow = globalTopicsContainer.createDiv({ cls: 'kb-global-topic-checkbox-row' });

			// Checkbox
			const checkbox = checkboxRow.createEl('input', {
				type: 'checkbox'
			});
			checkbox.checked = importedGlobalTopicIds.has(globalTopic.id);
			checkbox.disabled = importedGlobalTopicIds.has(globalTopic.id);

			// Label with global topic info
			const label = checkboxRow.createEl('label');
			label.style.cursor = importedGlobalTopicIds.has(globalTopic.id) ? 'default' : 'pointer';

			// Icon
			if (globalTopic.icon) {
				label.createSpan({ text: globalTopic.icon + ' ', cls: 'kb-global-topic-icon' });
			}

			// Name
			label.createSpan({ text: globalTopic.name || 'Unnamed', cls: 'kb-global-topic-name' });

			// Details (TAG, KEY, filter)
			const detailsSpan = label.createSpan({ cls: 'kb-global-topic-details' });
			const details: string[] = [];
			if (globalTopic.topicTag) details.push(`TAG: ${globalTopic.topicTag}`);
			if (globalTopic.topicKeyword) details.push(`KEY: ${globalTopic.topicKeyword}`);
			if (globalTopic.filterExpression) details.push(`Filter: ${globalTopic.filterExpression}`);
			detailsSpan.textContent = details.length > 0 ? ` (${details.join(', ')})` : '';

			// Already imported indicator
			if (importedGlobalTopicIds.has(globalTopic.id)) {
				const importedBadge = label.createSpan({ text: ' ✓ Already imported', cls: 'kb-imported-badge' });
			}

			// Checkbox change handler
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					// Import the global topic
					const newTopicId = importGlobalTopic(globalTopic.id, this.subject.id);

					// Get the newly created topic from the store and add it to local topics
					const subjectsData = get(subjectsStore);
					const newTopic = subjectsData.topics.find((t: Topic) => t.id === newTopicId);
					if (newTopic) {
						this.topics.push(newTopic);
					}

					// Re-render to show the new topic
					this.onOpen();
				}
			});

			// Label click handler
			label.addEventListener('click', (e) => {
				if (!importedGlobalTopicIds.has(globalTopic.id)) {
					e.preventDefault();
					checkbox.checked = !checkbox.checked;
					checkbox.dispatchEvent(new Event('change'));
				}
			});
		});
	}

	/**
	 * Render Secondary Topics section
	 */
	private renderSecondaryTopicsSection(containerEl: HTMLElement, secondaryTopics: Topic[]): void {
		const section = containerEl.createDiv({ cls: 'kb-topic-section' });

		// Header with Add button
		const header = section.createDiv({ cls: 'kb-topic-section-header' });
		const titleEl = header.createEl('h3', { text: '🔗 Secondary Topics', cls: 'kb-section-title' });

		// Info icon with tooltip
		const infoIcon = titleEl.createEl('span', {
			text: ' ℹ️',
			cls: 'kb-info-icon'
		});
		infoIcon.setAttribute('title', 'Secondary topics can use placeholders that expand to primary topic values:\n#? expands to TAG, .? expands to KEY, `? expands to TEXT');

		const addBtn = header.createEl('button', {
			text: '+ Add',
			cls: 'kb-add-topic-inline-btn'
		});
		addBtn.addEventListener('click', () => {
			this.addSecondaryTopic();
		});

		// Topics container
		const topicsContainer = section.createDiv({ cls: 'kb-topics-container' });

		if (secondaryTopics.length === 0) {
			topicsContainer.createEl('p', {
				text: 'No secondary topics. Click "+ Add" to create one.',
				cls: 'kb-empty-hint'
			});
		} else {
			secondaryTopics.forEach(topic => {
				this.renderSecondaryTopicFields(topicsContainer, topic);
			});
		}
	}

	/**
	 * Render Secondary Topic fields
	 */
	private renderSecondaryTopicFields(container: HTMLElement, topic: Topic): void {
		const topicCard = container.createDiv({ cls: 'kb-topic-card' });
		const row = topicCard.createDiv({ cls: 'kb-modal-row' });

		// Reorder controls
		const secondaryTopics = this.topics.filter(t => t.type === 'secondary');
		const currentIndex = secondaryTopics.findIndex(t => t.id === topic.id);
		const isFirst = currentIndex === 0;
		const isLast = currentIndex === secondaryTopics.length - 1;

		const reorderControls = row.createDiv({ cls: 'kb-topic-reorder-controls' });

		const upBtn = reorderControls.createEl('button', {
			text: '▲',
			cls: 'kb-topic-move-btn'
		});
		upBtn.disabled = isFirst;
		upBtn.title = isFirst ? 'Already first' : 'Move up';
		upBtn.addEventListener('click', () => {
			this.moveSecondaryTopicUp(topic.id);
		});

		const downBtn = reorderControls.createEl('button', {
			text: '▼',
			cls: 'kb-topic-move-btn'
		});
		downBtn.disabled = isLast;
		downBtn.title = isLast ? 'Already last' : 'Move down';
		downBtn.addEventListener('click', () => {
			this.moveSecondaryTopicDown(topic.id);
		});

		// Name field (regular width for secondary)
		const nameField = row.createDiv({ cls: 'kb-topic-field-name' });
		const nameInput = nameField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'name' },
			value: topic.name
		});
		nameInput.placeholder = 'Name';
		nameInput.addEventListener('input', (e) => {
			topic.name = (e.target as HTMLInputElement).value;
		});

		// Icon field (regular width for secondary)
		const iconField = row.createDiv({ cls: 'kb-topic-field-icon' });
		const iconInput = iconField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'icon' },
			value: topic.icon || ''
		});
		iconInput.placeholder = '🔗';
		iconInput.setAttribute('maxlength', '10');
		iconInput.addEventListener('input', (e) => {
			topic.icon = (e.target as HTMLInputElement).value;
		});

		// TAG field (compact with label)
		const tagField = row.createDiv({ cls: 'kb-topic-field-compact' });
		tagField.createEl('label', { text: 'TAG' });
		const tagInput = tagField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'topicTag' },
			value: topic.topicTag || ''
		});
		tagInput.placeholder = '#grammar';
		tagInput.addEventListener('input', (e) => {
			topic.topicTag = (e.target as HTMLInputElement).value;
		});

		// KEY field (compact with label)
		const keyField = row.createDiv({ cls: 'kb-topic-field-compact' });
		keyField.createEl('label', { text: 'KEY' });
		const keyInput = keyField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'topicKeyword' },
			value: topic.topicKeyword || ''
		});
		keyInput.placeholder = 'doc';
		keyInput.addEventListener('input', (e) => {
			topic.topicKeyword = (e.target as HTMLInputElement).value;
		});

		// F/H/R checkboxes (compact)
		const fhrField = row.createDiv({ cls: 'kb-topic-field-fhr' });

		// F checkbox
		const fCheck = fhrField.createEl('input', { type: 'checkbox' });
		fCheck.checked = topic.showFileRecords ?? true;
		fCheck.title = 'F: Show file records';
		fCheck.addEventListener('change', (e) => {
			topic.showFileRecords = (e.target as HTMLInputElement).checked;
		});
		fhrField.createEl('label', { text: 'F' });

		// H checkbox
		const hCheck = fhrField.createEl('input', { type: 'checkbox' });
		hCheck.checked = topic.showHeaderRecords ?? true;
		hCheck.title = 'H: Show header records';
		hCheck.addEventListener('change', (e) => {
			topic.showHeaderRecords = (e.target as HTMLInputElement).checked;
		});
		fhrField.createEl('label', { text: 'H' });

		// R checkbox
		const rCheck = fhrField.createEl('input', { type: 'checkbox' });
		rCheck.checked = topic.showRecordRecords ?? true;
		rCheck.title = 'R: Show record records';
		rCheck.addEventListener('change', (e) => {
			topic.showRecordRecords = (e.target as HTMLInputElement).checked;
		});
		fhrField.createEl('label', { text: 'R' });

		// Filter Expression field (takes remaining space)
		const exprField = row.createDiv({ cls: 'kb-topic-field-expr' });
		const exprInput = exprField.createEl('input', {
			type: 'text',
			attr: { 'data-topic-id': topic.id, 'data-field': 'filterExpression' },
			value: topic.filterExpression || ''
		});
		exprInput.placeholder = 'Filter (can use #?, .?, `?)';
		exprInput.addEventListener('input', (e) => {
			topic.filterExpression = (e.target as HTMLInputElement).value;
		});

		// Delete button
		const deleteBtn = row.createEl('button', {
			text: '🗑️',
			cls: 'kb-topic-delete-btn'
		});
		deleteBtn.addEventListener('click', () => {
			this.removeTopic(topic.id);
		});
	}

	/**
	 * Render Matrix section
	 */
	private renderMatrixSection(containerEl: HTMLElement): void {
		const primaryTopics = this.topics.filter(t => t.type === 'primary');
		const secondaryTopics = this.topics.filter(t => t.type === 'secondary');

		// Only show matrix if we have at least one primary or secondary topic
		if (primaryTopics.length === 0 && secondaryTopics.length === 0) {
			return;
		}

		const section = containerEl.createDiv({ cls: 'kb-matrix-section' });

		// Initialize matrix if it doesn't exist
		if (!this.subject.matrix) {
			this.subject.matrix = { cells: {} };
		}

		// Scan button
		const scanBtn = section.createEl('button', {
			text: '🔍 Scan File Counts',
			cls: 'kb-matrix-scan-btn'
		});
		scanBtn.addEventListener('click', () => {
			this.scanMatrixFileCounts();
		});

		// Create table
		const table = section.createEl('table', { cls: 'kb-matrix-table' });

		// Header row
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');

		// Cell 1x1: Subject
		const cell1x1 = headerRow.createEl('th', { cls: 'kb-matrix-cell kb-matrix-header-cell' });
		const cellKey1x1 = '1x1';

		// Get or create cell data for subject
		if (!this.subject.matrix!.cells[cellKey1x1]) {
			this.subject.matrix!.cells[cellKey1x1] = {};
		}
		const cellData1x1 = this.subject.matrix!.cells[cellKey1x1];

		// Display icon and counts
		let displayText1x1 = this.subject.icon || '📁';
		if (cellData1x1.fileCount !== undefined) {
			displayText1x1 += ` /${cellData1x1.fileCount}`;
			if (cellData1x1.headerCount !== undefined) {
				displayText1x1 += ` +${cellData1x1.headerCount}`;
			}
		}
		cell1x1.textContent = displayText1x1;
		cell1x1.setAttribute('title', `1x1: Subject (${this.subject.mainTag || 'no tag'})`);
		cell1x1.style.cursor = 'default';

		// Cells 1x2, 1x3, ...: Secondary topics (clickable for AND mode)
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const cell = headerRow.createEl('th', { cls: 'kb-matrix-cell kb-matrix-header-cell' });

			// Get or create cell data
			if (!this.subject.matrix!.cells[cellKey]) {
				this.subject.matrix!.cells[cellKey] = {};
			}
			const cellData = this.subject.matrix!.cells[cellKey];

			// Apply AND mode styling
			if (cellData.andMode) {
				cell.classList.add('kb-matrix-and-mode');
			}

			// Display icon and counts
			let displayText = topic.icon || '🔗';
			if (cellData.fileCount !== undefined) {
				displayText += ` /${cellData.fileCount}`;
				if (cellData.headerCount !== undefined) {
					displayText += ` +${cellData.headerCount}`;
				}
			}
			cell.textContent = displayText;

			const tags = this.getTagsForCell(cellKey, topic, null);
			cell.setAttribute('title', `${cellKey}: ${topic.name}\nClick to toggle: ${tags.description}`);
			cell.style.cursor = 'pointer';

			cell.addEventListener('click', () => {
				this.toggleCellAndMode(cellKey);
			});
		});

		// Data rows
		const tbody = table.createEl('tbody');

		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const row = tbody.createEl('tr');
			const rowNum = rowIndex + 2;

			// Cell 2x1, 3x1, ...: Primary topics (clickable for AND mode)
			const cellKey = `${rowNum}x1`;
			const rowHeaderCell = row.createEl('th', { cls: 'kb-matrix-cell kb-matrix-row-header-cell' });

			// Get or create cell data
			if (!this.subject.matrix!.cells[cellKey]) {
				this.subject.matrix!.cells[cellKey] = {};
			}
			const cellData = this.subject.matrix!.cells[cellKey];

			// Apply AND mode styling
			if (cellData.andMode) {
				rowHeaderCell.classList.add('kb-matrix-and-mode');
			}

			// Display icon and counts
			let displayText = primaryTopic.icon || '📌';
			if (cellData.fileCount !== undefined) {
				displayText += ` /${cellData.fileCount}`;
				if (cellData.headerCount !== undefined) {
					displayText += ` +${cellData.headerCount}`;
				}
			}
			rowHeaderCell.textContent = displayText;

			const tags = this.getTagsForCell(cellKey, null, primaryTopic);
			rowHeaderCell.setAttribute('title', `${cellKey}: ${primaryTopic.name}\nClick to toggle: ${tags.description}`);
			rowHeaderCell.style.cursor = 'pointer';

			rowHeaderCell.addEventListener('click', () => {
				this.toggleCellAndMode(cellKey);
			});

			// Intersection cells: 2x2, 2x3, 3x2, 3x3, ...
			secondaryTopics.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;
				const cell = row.createEl('td', { cls: 'kb-matrix-cell kb-matrix-data-cell' });

				// Get or create cell data
				if (!this.subject.matrix!.cells[intersectionKey]) {
					this.subject.matrix!.cells[intersectionKey] = {};
				}
				const cellData = this.subject.matrix!.cells[intersectionKey];

				// Check if either primary or secondary has AND mode enabled
				const primaryCellKey = `${rowNum}x1`;
				const secondaryCellKey = `1x${col}`;
				const primaryAndMode = this.subject.matrix!.cells[primaryCellKey]?.andMode || false;
				const secondaryAndMode = this.subject.matrix!.cells[secondaryCellKey]?.andMode || false;
				const includesSubjectTag = primaryAndMode || secondaryAndMode;

				// Apply green styling if subject tag is included
				if (includesSubjectTag) {
					cell.classList.add('kb-matrix-and-mode');
				}

				// Display icon and counts
				const displayIcon = cellData?.icon || '·';
				let displayText = displayIcon;
				if (cellData.fileCount !== undefined) {
					displayText += ` /${cellData.fileCount}`;
					if (cellData.headerCount !== undefined) {
						displayText += ` +${cellData.headerCount}`;
					}
				}
				cell.textContent = displayText;

				// Build title with tag information
				const tags = this.getTagsForIntersection(primaryTopic, secondaryTopic, includesSubjectTag);
				cell.setAttribute('title', `${intersectionKey}: ${primaryTopic.name} × ${secondaryTopic.name}\n${tags.description}`);
			});
		});
	}

	/**
	 * Get tag filter information for a cell
	 */
	private getTagsForCell(cellKey: string, secondaryTopic: Topic | null, primaryTopic: Topic | null): { tags: string[], description: string } {
		const cellData = this.subject.matrix?.cells[cellKey];
		const andMode = cellData?.andMode || false;

		let tags: string[] = [];
		let description = '';

		if (secondaryTopic) {
			// Secondary topic cell (1x2, 1x3, etc.)
			if (andMode && this.subject.mainTag) {
				tags = [this.subject.mainTag, secondaryTopic.topicTag || ''].filter(t => t);
				description = `${this.subject.mainTag} AND ${secondaryTopic.topicTag || 'no-tag'}`;
			} else {
				tags = [secondaryTopic.topicTag || ''].filter(t => t);
				description = secondaryTopic.topicTag || 'no-tag';
			}
		} else if (primaryTopic) {
			// Primary topic cell (2x1, 3x1, etc.)
			if (andMode && this.subject.mainTag) {
				tags = [this.subject.mainTag, primaryTopic.topicTag || ''].filter(t => t);
				description = `${this.subject.mainTag} AND ${primaryTopic.topicTag || 'no-tag'}`;
			} else {
				tags = [primaryTopic.topicTag || ''].filter(t => t);
				description = primaryTopic.topicTag || 'no-tag';
			}
		}

		return { tags, description };
	}

	/**
	 * Get tag filter information for an intersection cell
	 */
	private getTagsForIntersection(primaryTopic: Topic, secondaryTopic: Topic, includesSubjectTag: boolean): { tags: string[], description: string } {
		let tags: string[] = [];
		let description = '';

		const primaryTag = primaryTopic.topicTag || '';
		const secondaryTag = secondaryTopic.topicTag || '';

		if (includesSubjectTag && this.subject.mainTag) {
			// Include all three tags
			tags = [this.subject.mainTag, primaryTag, secondaryTag].filter(t => t);
			description = `${this.subject.mainTag} AND ${primaryTag || 'no-tag'} AND ${secondaryTag || 'no-tag'}`;
		} else {
			// Just primary and secondary
			tags = [primaryTag, secondaryTag].filter(t => t);
			description = `${primaryTag || 'no-tag'} AND ${secondaryTag || 'no-tag'}`;
		}

		return { tags, description };
	}

	/**
	 * Toggle AND mode for a cell and re-render
	 */
	private toggleCellAndMode(cellKey: string): void {
		if (!this.subject.matrix!.cells[cellKey]) {
			this.subject.matrix!.cells[cellKey] = {};
		}

		const cellData = this.subject.matrix!.cells[cellKey];
		cellData.andMode = !cellData.andMode;

		// Re-render the matrix
		this.onOpen();
	}

	/**
	 * Scan file counts for all matrix cells
	 */
	private async scanMatrixFileCounts(): Promise<void> {
		const primaryTopics = this.topics.filter(t => t.type === 'primary');
		const secondaryTopics = this.topics.filter(t => t.type === 'secondary');

		// Get all markdown files
		const files = this.app.vault.getMarkdownFiles();

		// Scan subject cell (1x1)
		if (this.subject.mainTag) {
			const cellKey1x1 = '1x1';
			const tags = [this.subject.mainTag].filter(t => t);
			const fileCount = this.countFilesWithTags(files, tags);

			if (!this.subject.matrix!.cells[cellKey1x1]) {
				this.subject.matrix!.cells[cellKey1x1] = {};
			}
			this.subject.matrix!.cells[cellKey1x1].fileCount = fileCount;
			// Subject doesn't count headers (no keyword/tag to search in headers)
			this.subject.matrix!.cells[cellKey1x1].headerCount = 0;
		}

		// Scan secondary topic cells (1x2, 1x3, etc.)
		secondaryTopics.forEach((topic, index) => {
			const col = index + 2;
			const cellKey = `1x${col}`;
			const { tags } = this.getTagsForCell(cellKey, topic, null);

			const fileCount = this.countFilesWithTags(files, tags);
			const headerCount = this.countHeadersForSingleTopic(files, tags, topic);

			if (!this.subject.matrix!.cells[cellKey]) {
				this.subject.matrix!.cells[cellKey] = {};
			}
			this.subject.matrix!.cells[cellKey].fileCount = fileCount;
			this.subject.matrix!.cells[cellKey].headerCount = headerCount;
		});

		// Scan primary topic cells (2x1, 3x1, etc.)
		primaryTopics.forEach((topic, index) => {
			const rowNum = index + 2;
			const cellKey = `${rowNum}x1`;
			const { tags } = this.getTagsForCell(cellKey, null, topic);

			const fileCount = this.countFilesWithTags(files, tags);
			const headerCount = this.countHeadersForSingleTopic(files, tags, topic);

			if (!this.subject.matrix!.cells[cellKey]) {
				this.subject.matrix!.cells[cellKey] = {};
			}
			this.subject.matrix!.cells[cellKey].fileCount = fileCount;
			this.subject.matrix!.cells[cellKey].headerCount = headerCount;
		});

		// Scan intersection cells (2x2, 2x3, 3x2, 3x3, etc.)
		primaryTopics.forEach((primaryTopic, rowIndex) => {
			const rowNum = rowIndex + 2;

			secondaryTopics.forEach((secondaryTopic, colIndex) => {
				const col = colIndex + 2;
				const intersectionKey = `${rowNum}x${col}`;

				// Check if either primary or secondary has AND mode enabled
				const primaryCellKey = `${rowNum}x1`;
				const secondaryCellKey = `1x${col}`;
				const primaryAndMode = this.subject.matrix!.cells[primaryCellKey]?.andMode || false;
				const secondaryAndMode = this.subject.matrix!.cells[secondaryCellKey]?.andMode || false;
				const includesSubjectTag = primaryAndMode || secondaryAndMode;

				// Get tags for this intersection
				const { tags } = this.getTagsForIntersection(primaryTopic, secondaryTopic, includesSubjectTag);
				const fileCount = this.countFilesWithTags(files, tags);
				const headerCount = this.countHeadersForIntersection(files, tags, primaryTopic, secondaryTopic);

				if (!this.subject.matrix!.cells[intersectionKey]) {
					this.subject.matrix!.cells[intersectionKey] = {};
				}
				this.subject.matrix!.cells[intersectionKey].fileCount = fileCount;
				this.subject.matrix!.cells[intersectionKey].headerCount = headerCount;
			});
		});

		// Re-render to show counts
		this.onOpen();
	}

	/**
	 * Count files that have ALL specified tags
	 */
	private countFilesWithTags(files: any[], tags: string[]): number {
		if (tags.length === 0) return 0;

		return files.filter(file => {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) return false;

			const fileTags = cache.tags?.map(t => t.tag) || [];
			const frontmatterTags = cache.frontmatter?.tags || [];
			const allTags = [...fileTags, ...frontmatterTags].map(t =>
				typeof t === 'string' ? (t.startsWith('#') ? t : '#' + t) : ''
			);

			// Check if file has ALL required tags
			return tags.every(tag => allTags.includes(tag));
		}).length;
	}

	/**
	 * Get all tags for a file (frontmatter + inline)
	 */
	private getFileTags(file: any): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];

		const fileTags = cache.tags?.map(t => t.tag) || [];
		const frontmatterTags = cache.frontmatter?.tags || [];
		return [...fileTags, ...frontmatterTags].map(t =>
			typeof t === 'string' ? (t.startsWith('#') ? t : '#' + t) : ''
		);
	}

	/**
	 * Count headers for a single topic
	 * Header matches if: header contains keyword OR header has actual tag (with #)
	 * (Not just text matching tag name without #)
	 */
	private countHeadersForSingleTopic(files: any[], requiredTags: string[], topic: Topic): number {
		const matchingFiles = files.filter(file => {
			const fileTags = this.getFileTags(file);
			return requiredTags.every(tag => fileTags.includes(tag));
		});

		let count = 0;
		for (const file of matchingFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.headings) continue;

			for (const heading of cache.headings) {
				const headerLower = heading.heading.toLowerCase();

				// Check keyword match with word boundaries (must be complete word, not substring)
				let keywordMatch = false;
				if (topic.topicKeyword) {
					const keywordRegex = new RegExp('\\b' + topic.topicKeyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
					keywordMatch = keywordRegex.test(headerLower);
				}

				// Check if header contains the actual tag with # (e.g., "# foo #kroxy")
				const tagMatch = topic.topicTag && heading.heading.includes(topic.topicTag);

				if (keywordMatch || tagMatch) {
					count++;
				}
			}
		}

		return count;
	}

	/**
	 * Count headers for intersection
	 * Header matches if:
	 *   (keyword1 in header OR tag1 in header OR tag1 in file) AND
	 *   (keyword2 in header OR tag2 in header OR tag2 in file) BUT NOT
	 *   (ONLY tag1 in file AND ONLY tag2 in file)
	 */
	private countHeadersForIntersection(files: any[], requiredTags: string[], topic1: Topic, topic2: Topic): number {
		const matchingFiles = files.filter(file => {
			const fileTags = this.getFileTags(file);
			return requiredTags.every(tag => fileTags.includes(tag));
		});

		let count = 0;
		for (const file of matchingFiles) {
			const fileTags = this.getFileTags(file);
			const tag1InFile = topic1.topicTag && fileTags.includes(topic1.topicTag);
			const tag2InFile = topic2.topicTag && fileTags.includes(topic2.topicTag);

			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.headings) continue;

			for (const heading of cache.headings) {
				const headerLower = heading.heading.toLowerCase();

				// Check topic1 matches - keyword (word boundary) OR actual tag with #
				let keyword1Match = false;
				if (topic1.topicKeyword) {
					const keywordRegex = new RegExp('\\b' + topic1.topicKeyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
					keyword1Match = keywordRegex.test(headerLower);
				}
				const tag1Match = topic1.topicTag && heading.heading.includes(topic1.topicTag);
				const topic1Match = keyword1Match || tag1Match || tag1InFile;

				// Check topic2 matches - keyword (word boundary) OR actual tag with #
				let keyword2Match = false;
				if (topic2.topicKeyword) {
					const keywordRegex = new RegExp('\\b' + topic2.topicKeyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
					keyword2Match = keywordRegex.test(headerLower);
				}
				const tag2Match = topic2.topicTag && heading.heading.includes(topic2.topicTag);
				const topic2Match = keyword2Match || tag2Match || tag2InFile;

				// Both topics must match
				if (!topic1Match || !topic2Match) {
					continue;
				}

				// But NOT if both matches are ONLY from file tags
				const onlyFileTagMatch = !keyword1Match && !tag1Match && tag1InFile &&
				                        !keyword2Match && !tag2Match && tag2InFile;

				if (!onlyFileTagMatch) {
					count++;
				}
			}
		}

		return count;
	}

	/**
	 * Render Favorite Filters section
	 */
	private renderFavoriteFiltersSection(containerEl: HTMLElement): void {
		const section = containerEl.createDiv({ cls: 'kb-topic-section' });

		// Header with Add button
		const header = section.createDiv({ cls: 'kb-topic-section-header' });
		header.createEl('h3', { text: '⭐ Favorite Filters', cls: 'kb-section-title' });

		const addBtn = header.createEl('button', {
			text: '+ Add',
			cls: 'kb-add-topic-inline-btn'
		});
		addBtn.addEventListener('click', () => {
			this.openFavoriteFilterModal();
		});

		// Filters container
		const filtersContainer = section.createDiv({ cls: 'kb-topics-container' });

		if (!this.subject.favoriteFilters || this.subject.favoriteFilters.length === 0) {
			filtersContainer.createEl('p', {
				text: 'No favorite filters. Click "+ Add" to create one.',
				cls: 'kb-empty-hint'
			});
		} else {
			this.subject.favoriteFilters.forEach(filter => {
				this.renderFavoriteFilterRow(filtersContainer, filter);
			});
		}
	}

	/**
	 * Render a single favorite filter row
	 */
	private renderFavoriteFilterRow(container: HTMLElement, filter: any): void {
		const filterCard = container.createDiv({ cls: 'kb-topic-card' });
		const row = filterCard.createDiv({ cls: 'kb-modal-row' });

		// Icon field
		const iconField = row.createDiv({ cls: 'kb-topic-field-icon' });
		const iconInput = iconField.createEl('input', {
			type: 'text',
			value: filter.icon || '⭐'
		});
		iconInput.placeholder = '⭐';
		iconInput.setAttribute('maxlength', '10');
		iconInput.addEventListener('input', (e) => {
			filter.icon = (e.target as HTMLInputElement).value;
		});

		// Expression field (takes remaining space)
		const exprField = row.createDiv({ cls: 'kb-topic-field-expr' });
		const exprInput = exprField.createEl('input', {
			type: 'text',
			value: filter.expression || ''
		});
		exprInput.placeholder = 'Filter expression (e.g., :boo `java W: #foo \\t)';
		exprInput.addEventListener('input', (e) => {
			filter.expression = (e.target as HTMLInputElement).value;
		});

		// Delete button
		const deleteBtn = row.createEl('button', {
			text: '🗑️',
			cls: 'kb-topic-delete-btn'
		});
		deleteBtn.addEventListener('click', () => {
			this.removeFavoriteFilter(filter.id);
		});
	}

	/**
	 * Open modal to add new favorite filter
	 */
	private openFavoriteFilterModal(): void {
		const modal = new FavoriteFilterModal(
			this.app,
			this.subject,
			(newFilter: any) => {
				if (!this.subject.favoriteFilters) {
					this.subject.favoriteFilters = [];
				}
				this.subject.favoriteFilters.push(newFilter);
				this.onOpen(); // Re-render
			}
		);
		modal.open();
	}

	/**
	 * Remove a favorite filter
	 */
	private removeFavoriteFilter(filterId: string): void {
		if (!this.subject.favoriteFilters) return;
		this.subject.favoriteFilters = this.subject.favoriteFilters.filter(f => f.id !== filterId);
		this.onOpen(); // Re-render
	}

	/**
	 * Render action buttons
	 */
	private renderActionButtons(containerEl: HTMLElement): void {
		const actions = containerEl.createDiv({ cls: 'kb-modal-actions' });

		// Cancel button
		const cancelBtn = actions.createEl('button', {
			text: 'Cancel',
			cls: 'kb-modal-btn'
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		// Save button
		const saveBtn = actions.createEl('button', {
			text: 'Save',
			cls: 'kb-modal-btn kb-modal-btn-primary'
		});
		saveBtn.addEventListener('click', () => {
			this.save();
		});
	}

	/**
	 * Add a new primary topic
	 */
	private addPrimaryTopic(): void {
		const newTopic: Topic = {
			id: `topic-${Date.now()}`,
			name: '',
			type: 'primary',
			subjectId: this.subject.id,
			keywords: [],
			order: this.topics.filter(t => t.type === 'primary').length
		};
		this.topics.push(newTopic);
		this.onOpen(); // Re-render
	}

	/**
	 * Add a new secondary topic
	 */
	private addSecondaryTopic(): void {
		const newTopic: Topic = {
			id: `topic-${Date.now()}`,
			name: '',
			type: 'secondary',
			subjectId: this.subject.id,
			keywords: [],
			order: this.topics.filter(t => t.type === 'secondary').length
		};
		this.topics.push(newTopic);
		this.onOpen(); // Re-render
	}

	/**
	 * Remove a topic
	 */
	private removeTopic(topicId: string): void {
		this.topics = this.topics.filter(t => t.id !== topicId);
		this.onOpen(); // Re-render
	}

	/**
	 * Move primary topic up
	 */
	private movePrimaryTopicUp(topicId: string): void {
		const primaryTopics = this.topics.filter(t => t.type === 'primary');
		const currentIndex = primaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex <= 0) return; // Already at top or not found

		// Swap with previous topic in the main topics array
		const currentTopic = primaryTopics[currentIndex];
		const previousTopic = primaryTopics[currentIndex - 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const previousMainIndex = this.topics.findIndex(t => t.id === previousTopic.id);

		// Swap positions in main array
		[this.topics[currentMainIndex], this.topics[previousMainIndex]] =
		[this.topics[previousMainIndex], this.topics[currentMainIndex]];

		// Update order fields
		[currentTopic.order, previousTopic.order] = [previousTopic.order, currentTopic.order];

		this.onOpen(); // Re-render
	}

	/**
	 * Move primary topic down
	 */
	private movePrimaryTopicDown(topicId: string): void {
		const primaryTopics = this.topics.filter(t => t.type === 'primary');
		const currentIndex = primaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex < 0 || currentIndex >= primaryTopics.length - 1) return; // Already at bottom or not found

		// Swap with next topic in the main topics array
		const currentTopic = primaryTopics[currentIndex];
		const nextTopic = primaryTopics[currentIndex + 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const nextMainIndex = this.topics.findIndex(t => t.id === nextTopic.id);

		// Swap positions in main array
		[this.topics[currentMainIndex], this.topics[nextMainIndex]] =
		[this.topics[nextMainIndex], this.topics[currentMainIndex]];

		// Update order fields
		[currentTopic.order, nextTopic.order] = [nextTopic.order, currentTopic.order];

		this.onOpen(); // Re-render
	}

	/**
	 * Move secondary topic up
	 */
	private moveSecondaryTopicUp(topicId: string): void {
		const secondaryTopics = this.topics.filter(t => t.type === 'secondary');
		const currentIndex = secondaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex <= 0) return; // Already at top or not found

		// Swap with previous topic in the main topics array
		const currentTopic = secondaryTopics[currentIndex];
		const previousTopic = secondaryTopics[currentIndex - 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const previousMainIndex = this.topics.findIndex(t => t.id === previousTopic.id);

		// Swap positions in main array
		[this.topics[currentMainIndex], this.topics[previousMainIndex]] =
		[this.topics[previousMainIndex], this.topics[currentMainIndex]];

		// Update order fields
		[currentTopic.order, previousTopic.order] = [previousTopic.order, currentTopic.order];

		this.onOpen(); // Re-render
	}

	/**
	 * Move secondary topic down
	 */
	private moveSecondaryTopicDown(topicId: string): void {
		const secondaryTopics = this.topics.filter(t => t.type === 'secondary');
		const currentIndex = secondaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex < 0 || currentIndex >= secondaryTopics.length - 1) return; // Already at bottom or not found

		// Swap with next topic in the main topics array
		const currentTopic = secondaryTopics[currentIndex];
		const nextTopic = secondaryTopics[currentIndex + 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const nextMainIndex = this.topics.findIndex(t => t.id === nextTopic.id);

		// Swap positions in main array
		[this.topics[currentMainIndex], this.topics[nextMainIndex]] =
		[this.topics[nextMainIndex], this.topics[currentMainIndex]];

		// Update order fields
		[currentTopic.order, nextTopic.order] = [nextTopic.order, currentTopic.order];

		this.onOpen(); // Re-render
	}

	/**
	 * Save and close
	 */
	private async save(): Promise<void> {
		// Validate subject name
		if (!this.subject.name.trim()) {
			// Show error
			return;
		}

		try {
			// Get expression (source of truth)
			const expression = (document.getElementById('subject-expression') as HTMLInputElement)?.value || '';

			// Update subject with expression and chips
			this.subject.expression = expression || undefined;
			(this.subject as any).chips = {
				includeKeywords: Array.from(this.selectedKeywords),
				excludeKeywords: [],
				includeCategories: Array.from(this.selectedCategories),
				excludeCategories: [],
				includeLanguages: Array.from(this.selectedLanguages),
				excludeLanguages: []
			};

			// Update subjects store
			subjectsStore.update(data => {
				// Update or add subject
				const existingIndex = data.subjects.findIndex((s: Subject) => s.id === this.subject.id);
				if (existingIndex >= 0) {
					data.subjects[existingIndex] = this.subject;
				} else {
					data.subjects.push(this.subject);
				}

				// Remove old topics for this subject
				data.topics = data.topics.filter((t: Topic) => t.subjectId !== this.subject.id);

				// Add new topics
				data.topics.push(...this.topics);

				return data;
			});

			console.log('[SubjectModal] Saving subjects...', {
				subjectId: this.subject.id,
				topicsCount: this.topics.length
			});

			// Save subjects
			await saveSubjects();

			console.log('[SubjectModal] Save completed successfully');

			// Call onSubmit callback
			this.onSubmit(this.subject);

			// Close modal
			this.close();
		} catch (error) {
			console.error('[SubjectModal] Error saving subject:', error);
			// Don't close the modal on error, allow user to try again
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for creating/editing favorite filters
 */
class FavoriteFilterModal extends Modal {
	private subject: Subject;
	private onSubmit: (filter: any) => void;
	private icon: string = '⭐';
	private expression: string = '';

	constructor(app: App, subject: Subject, onSubmit: (filter: any) => void) {
		super(app);
		this.subject = subject;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('kb-favorite-filter-modal');

		contentEl.createEl('h2', { text: 'Add Favorite Filter' });

		// Icon input
		new Setting(contentEl)
			.setName('Icon')
			.setDesc('Emoji icon for the button')
			.addText((text) => {
				text.setValue(this.icon)
					.onChange((value) => {
						this.icon = value;
					});
				text.inputEl.setAttribute('maxlength', '10');
			});

		// Expression input
		new Setting(contentEl)
			.setName('Filter Expression')
			.setDesc('Filter expression (e.g., ":boo `java W: #foo \\t")')
			.addTextArea((text) => {
				text.setValue(this.expression)
					.onChange((value) => {
						this.expression = value;
					});
				text.inputEl.rows = 3;
			});

		// Buttons
		new Setting(contentEl)
			.addButton((btn) => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()))
			.addButton((btn) => btn
				.setButtonText('Save')
				.setCta()
				.onClick(() => {
					if (!this.expression) {
						return;
					}

					const newFilter = {
						id: Date.now().toString(),
						icon: this.icon,
						expression: this.expression
					};

					this.onSubmit(newFilter);
					this.close();
				}));
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
