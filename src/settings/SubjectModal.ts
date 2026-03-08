import { App, Modal, Setting } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';
import { settingsStore, subjectsStore, saveSubjects, codeBlocksStore, updateTopic } from '../stores/settings-store';
import { get } from 'svelte/store';
import { MatrixRenderer } from '../shared/MatrixRenderer';

/**
 * Column configuration for data-driven table rendering
 */
interface ColumnConfig {
	key: string;
	type: 'input' | 'checkbox' | 'button' | 'drag' | 'empty' | 'assigned-primaries';
	width: string;
	header?: string;
	field?: keyof Topic;
	maxlength?: number;
	style?: Partial<CSSStyleDeclaration>;
	buttonClass?: string;
	text?: string;
	placeholder?: string;
	cls?: string;
	tooltip?: string;
	onClick?: (topic: Topic) => void;
	getValue?: (topic: Topic) => any;
	setValue?: (topic: Topic, value: any) => void;
}

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
	private showLegend: boolean = false;

	private allKeywords: string[] = [];
	private allCategories: Array<{ id: string, icon: string }> = [];
	private allLanguages: string[] = [];

	// Column configurations for data-driven table rendering
	private primaryTopicColumns: ColumnConfig[] = [
		{ key: 'drag', type: 'drag', width: '20px', header: '📌', cls: 'kb-col-drag' },
		{ key: 'name', type: 'input', width: '90px', header: 'P. Top.', field: 'name', placeholder: 'Name', cls: 'kb-col-name' },
		{ key: 'icon', type: 'input', width: '40px', header: 'Icon', field: 'icon', placeholder: '📌', maxlength: 2, cls: 'kb-col-icon' },
		{ key: 'topicTag', type: 'input', width: '80px', header: 'Tag', field: 'topicTag', placeholder: 'tag', cls: 'kb-col-tag' },
		{ key: 'topicKeyword', type: 'input', width: '50px', header: 'Key', field: 'topicKeyword', placeholder: 'key', cls: 'kb-col-key' },
		{ key: 'topicText', type: 'input', width: '50px', header: 'Text', field: 'topicText', placeholder: 'text', cls: 'kb-col-text' },
		{ key: 'topicLanguage', type: 'input', width: '50px', header: 'Block', field: 'topicLanguage', placeholder: 'block', cls: 'kb-col-block' },
		{ key: 'andMode', type: 'checkbox', width: '20px', header: '⬜', cls: 'kb-col-and' },
		{
			key: 'dashOnlyFilterExpSide',
			type: 'input',
			width: 'auto',
			header: 'DashFilter',
			field: 'dashOnlyFilterExpSide',
			placeholder: 'DashFilter (Dashboard only)',
			cls: 'kb-col-dash',
			style: { backgroundColor: 'rgba(0, 0, 139, 0.7)', border: '1px solid rgba(0, 0, 255, 0.3)', color: 'white' }
		},
		{
			key: 'matrixOnlyFilterExpSide',
			type: 'input',
			width: 'auto',
			header: 'MatrixFilter SIDE',
			field: 'matrixOnlyFilterExpSide',
			placeholder: 'MatrixFilter SIDE (RED)',
			cls: 'kb-col-matrix-side',
			style: { backgroundColor: 'rgba(255, 0, 0, 0.6)', border: '1px solid rgba(255, 0, 0, 0.4)', color: 'white' }
		},
		{
			key: 'delete',
			type: 'button',
			width: '30px',
			header: '',
			text: '🗑️',
			buttonClass: 'kb-topic-delete-btn',
			cls: 'kb-col-delete'
		}
	];

	private secondaryTopicColumns: ColumnConfig[] = [
		{ key: 'drag', type: 'drag', width: '20px', header: '🔗', cls: 'kb-col-drag' },
		{ key: 'name', type: 'input', width: '90px', header: 'S. Top.', field: 'name', placeholder: 'Name', cls: 'kb-col-name' },
		{ key: 'icon', type: 'input', width: '40px', header: 'Icon', field: 'icon', placeholder: '🔗', maxlength: 2, cls: 'kb-col-icon' },
		{ key: 'topicTag', type: 'input', width: '80px', header: 'Tag', field: 'topicTag', placeholder: 'tag', cls: 'kb-col-tag' },
		{ key: 'topicKeyword', type: 'input', width: '40px', header: 'Key', field: 'topicKeyword', placeholder: 'key', cls: 'kb-col-key' },
		{ key: 'andMode', type: 'checkbox', width: '20px', header: '⬜', cls: 'kb-col-and' },
		{ key: 'fh', type: 'checkbox', width: '35px', header: '🔴', cls: 'kb-col-fh' },
		{
			key: 'FilterExpHeader',
			type: 'input',
			width: 'auto',
			header: 'MatrixFilter HEADER',
			field: 'FilterExpHeader',
			placeholder: 'MatrixFilter HEADER (GREEN)',
			cls: 'kb-col-filter-header',
			style: { backgroundColor: 'rgba(0, 128, 0, 0.6)', border: '1px solid rgba(0, 128, 0, 0.4)', color: 'white' },
			tooltip: 'Filter for HEADER cells (1x2, 1x3) - standalone expression, NO variables'
		},
		{
			key: 'appliedFilterExpIntersection',
			type: 'input',
			width: 'auto',
			header: 'MatrixFilter INTERSECTION',
			field: 'appliedFilterExpIntersection',
			placeholder: 'MatrixFilter INTERSECTION (BLUE)',
			cls: 'kb-col-filter-intersection',
			style: { backgroundColor: 'rgba(0, 0, 255, 0.6)', border: '1px solid rgba(0, 0, 255, 0.4)', color: 'white' },
			tooltip: 'Filter for INTERSECTION cells (2x2, 2x3) - WITH variables: $TAG, $KEY, $BLOCK/$CODE, $TEXT get replaced by primary topic values'
		},
		{
			key: 'assignedPrimaries',
			type: 'assigned-primaries',
			width: '200px',
			header: 'Assign Primary',
			cls: 'kb-col-assigned',
			tooltip: 'Click ▼ to assign this secondary topic to specific primary topics.\nIf none selected (shows "-"), it applies to ALL primary topics.'
		},
		{
			key: 'delete',
			type: 'button',
			width: '30px',
			header: '',
			text: '🗑️',
			buttonClass: 'kb-topic-delete-btn',
			cls: 'kb-col-delete'
		}
	];

	constructor(
		app: App,
		private plugin: HighlightSpaceRepeatPlugin,
		subject: Subject | null,
		onSubmit: (subject: Subject) => void
	) {
		super(app);
		this.onSubmit = onSubmit;

		// Get current settings and subjects data
		const subjectsData = get(subjectsStore);

		// If editing, clone the subject; otherwise create new
		if (subject) {
			this.subject = { ...subject };
			// Load topics from nested arrays and add type field for local editing
			this.topics = [
				...(subject.primaryTopics || []).map(t => ({ ...t, type: 'primary' as const, subjectId: subject.id })),
				...(subject.secondaryTopics || []).map(t => ({ ...t, type: 'secondary' as const, subjectId: subject.id }))
			];
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

		// Parse expression to populate selections (use dashOnlyFilterExp, fallback to legacy expression)
		const exprToParse = this.subject.dashOnlyFilterExp || this.subject.expression;
		if (exprToParse) {
			this.parseExpression(exprToParse);
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
		const dashFilterInput = document.getElementById('subject-dash-filter') as HTMLInputElement;
		if (dashFilterInput) {
			dashFilterInput.value = this.generateExpression();
			this.subject.dashOnlyFilterExp = dashFilterInput.value;
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

		// Action buttons are now at the top (in renderBasicInfo)
		// this.renderActionButtons(contentEl);
	}

	/**
	 * Render basic subject information
	 */
	private renderBasicInfo(containerEl: HTMLElement): void {
		// Name, Icon, Main Tag, and Keyword in one row with action buttons on the right
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

		const mainTagDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-with-label kb-modal-field-tag' });
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

		// Refresh matrix when tag changes (affects AND mode availability)
		mainTagInput.addEventListener('blur', () => {
			this.renderMatrixPreview();
		});

		const keywordDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-with-label kb-modal-field-key' });
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

		// DashFilter field (Dark Blue - like primary topics)
		const dashFilterDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-dash-filter' });
		dashFilterDiv.createEl('span', { text: 'DashFilter:', cls: 'kb-field-label' });
		const dashFilterInput = dashFilterDiv.createEl('input', {
			type: 'text',
			attr: { id: 'subject-dash-filter' },
			value: this.subject.dashOnlyFilterExp || this.subject.expression || '',
			placeholder: 'Dashboard filter (e.g., .keyword W: #tag)'
		});
		dashFilterInput.style.backgroundColor = 'rgba(0, 0, 139, 0.7)';
		dashFilterInput.style.border = '1px solid rgba(0, 0, 255, 0.3)';
		dashFilterInput.style.color = 'white';
		dashFilterInput.style.padding = '4px 8px';
		dashFilterInput.addEventListener('input', (e) => {
			const value = (e.target as HTMLInputElement).value;
			this.subject.dashOnlyFilterExp = value;
			this.parseExpression(value);
			// Refresh unified chips display if it exists
			const chipsDisplay = document.getElementById('kb-chips-unified');
			if (chipsDisplay) {
				this.refreshUnifiedChips(chipsDisplay);
			}
		});

		// MatrixFilter field (RED - like primary topics)
		const matrixFilterDiv = nameIconTagRow.createDiv({ cls: 'kb-modal-field-matrix-filter' });
		matrixFilterDiv.createEl('span', { text: 'MatrixFilter:', cls: 'kb-field-label' });
		const matrixFilterInput = matrixFilterDiv.createEl('input', {
			type: 'text',
			attr: { id: 'subject-matrix-filter' },
			value: this.subject.matrixOnlyFilterExp || '',
			placeholder: 'Matrix filter (e.g., .keyword W: #tag)'
		});
		matrixFilterInput.style.backgroundColor = 'rgba(255, 0, 0, 0.6)';
		matrixFilterInput.style.border = '1px solid rgba(255, 0, 0, 0.4)';
		matrixFilterInput.style.color = 'white';
		matrixFilterInput.style.padding = '4px 8px';
		matrixFilterInput.addEventListener('input', (e) => {
			const value = (e.target as HTMLInputElement).value;
			this.subject.matrixOnlyFilterExp = value;
		});

		// Add action buttons on the right side of the row
		const actions = nameIconTagRow.createDiv({ cls: 'kb-modal-actions-inline' });

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
	 * Render filter configuration section - UNIFIED
	 */
	private renderFilterConfiguration(containerEl: HTMLElement): void {
		const section = containerEl.createDiv({ cls: 'kb-filter-section kb-unified-filter' });

		// Single row: legend button + label + input + chips
		const row = section.createDiv({ cls: 'kb-unified-filter-row' });

		// Legend button
		const legendBtn = row.createEl('button', {
			cls: 'kh-filter-toggle' + (this.showLegend ? ' kh-filter-toggle-active' : ''),
			text: 'ℹ️'
		});
		legendBtn.title = 'Toggle Legend: Show explanation of border and background colors';
		legendBtn.onclick = () => {
			this.showLegend = !this.showLegend;
			this.onOpen(); // Re-render to show/hide legend
		};

		// Label
		row.createEl('span', { text: 'Add/Select:', cls: 'kb-unified-label' });

		// Unified input field with smart prefix-based autocomplete
		const inputDiv = row.createDiv({ cls: 'kb-autocomplete-container' });
		const input = inputDiv.createEl('input', {
			type: 'text',
			cls: 'kb-autocomplete-input',
			placeholder: ': category, . keyword, ` code, \\ flag'
		});

		const suggestionsEl = inputDiv.createDiv({ cls: 'kb-suggestions' });
		suggestionsEl.style.display = 'none';

		// Unified chips display showing ALL selected items (on same row)
		const chipsDisplay = row.createDiv({ cls: 'kb-chips-display' });
		chipsDisplay.id = 'kb-chips-unified';
		this.refreshUnifiedChips(chipsDisplay);

		input.oninput = () => {
			const query = input.value.trim();
			if (!query) {
				suggestionsEl.style.display = 'none';
				return;
			}

			// Detect prefix and show appropriate suggestions
			const prefix = query[0];
			let matches: Array<{ type: string, value: string, display: string, icon?: string }> = [];

			if (prefix === ':') {
				// Category suggestions (including :code-blocks)
				const search = query.substring(1).toLowerCase();
				matches = this.allCategories
					.filter(cat =>
						cat.id.toLowerCase().includes(search) && !this.selectedCategories.has(cat.id)
					)
					.map(cat => ({
						type: 'category',
						value: cat.id,
						display: cat.id,
						icon: cat.icon
					}));

				// Add :code-blocks if it matches and not selected
				if ('code-blocks'.includes(search) && !this.selectedCategories.has('code-blocks')) {
					matches.push({
						type: 'category',
						value: 'code-blocks',
						display: 'code-blocks',
						icon: '💻'
					});
				}

				matches = matches.slice(0, 10);
			} else if (prefix === '`') {
				// Code block suggestions
				const search = query.substring(1).toLowerCase();
				const codeBlocks = get(codeBlocksStore);
				matches = codeBlocks
					.filter(lang =>
						lang.id.toLowerCase().includes(search) &&
						!this.selectedKeywords.has(lang.id) &&
						!this.selectedLanguages.has(lang.id)
					)
					.map(lang => ({
						type: 'language',
						value: lang.id,
						display: lang.id,
						icon: lang.icon
					}))
					.slice(0, 10);
			} else {
				// Keyword suggestions (with or without . prefix)
				const search = prefix === '.' ? query.substring(1).toLowerCase() : query.toLowerCase();
				matches = this.allKeywords
					.filter(kw =>
						kw.toLowerCase().includes(search) &&
						!this.selectedKeywords.has(kw) &&
						!this.allLanguages.includes(kw) // exclude languages from keyword suggestions
					)
					.map(kw => {
						const config = this.findKeywordConfig(kw);
						return {
							type: 'keyword',
							value: kw,
							display: kw,
							icon: config?.generateIcon || '🏷️'
						};
					})
					.slice(0, 10);
			}

			if (matches.length === 0) {
				suggestionsEl.style.display = 'none';
				return;
			}

			suggestionsEl.empty();
			suggestionsEl.style.display = 'block';

			matches.forEach(match => {
				const suggestion = suggestionsEl.createDiv({ cls: 'kb-suggestion-item' });
				if (match.icon) {
					suggestion.createSpan({ text: match.icon + ' ', cls: 'kb-suggestion-icon' });
				}
				suggestion.createSpan({ text: match.display });

				suggestion.onclick = () => {
					if (match.type === 'category') {
						this.selectedCategories.add(match.value);
					} else if (match.type === 'language') {
						this.selectedKeywords.add(match.value);
						this.selectedLanguages.add(match.value);
					} else {
						this.selectedKeywords.add(match.value);
					}
					input.value = '';
					suggestionsEl.style.display = 'none';
					this.updateExpression();
					this.refreshUnifiedChips(chipsDisplay);
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
				if (!query) return;

				const prefix = query[0];
				let added = false;

				if (prefix === ':') {
					const categoryId = query.substring(1);
					if (this.allCategories.some(c => c.id === categoryId) && !this.selectedCategories.has(categoryId)) {
						this.selectedCategories.add(categoryId);
						added = true;
					}
				} else if (prefix === '`') {
					const langId = query.substring(1);
					if (this.allLanguages.includes(langId) && !this.selectedKeywords.has(langId)) {
						this.selectedKeywords.add(langId);
						this.selectedLanguages.add(langId);
						added = true;
					}
				} else {
					const keyword = prefix === '.' ? query.substring(1) : query;
					if (this.allKeywords.includes(keyword) && !this.selectedKeywords.has(keyword)) {
						this.selectedKeywords.add(keyword);
						added = true;
					}
				}

				if (added) {
					input.value = '';
					suggestionsEl.style.display = 'none';
					this.updateExpression();
					this.refreshUnifiedChips(chipsDisplay);
				}
			}
		};

		// Legend container (shown/hidden based on toggle)
		if (this.showLegend) {
			const legendContainer = section.createDiv({ cls: 'kh-legend-container' });

			legendContainer.createEl('h4', {
				text: 'Flags',
				cls: 'kh-legend-title'
			});

			// Create 3-column grid for flags
			const flagsGrid = legendContainer.createDiv({ cls: 'kh-legend-flags-grid' });

			// White border
			const whiteItem = flagsGrid.createDiv({ cls: 'kh-legend-flag-item' });
			whiteItem.createDiv({ cls: 'kh-legend-flag-sample kh-legend-white-border', text: '⬜' });
			const whiteDesc = whiteItem.createDiv({ cls: 'kh-legend-flag-desc' });
			whiteDesc.createEl('strong', { text: 'White border' });
			whiteDesc.appendText(' AND mode: requires subject tag for F/H');

			// Red background
			const redItem = flagsGrid.createDiv({ cls: 'kh-legend-flag-item' });
			redItem.createDiv({ cls: 'kh-legend-flag-sample kh-legend-red-bg', text: '🔴' });
			const redDesc = redItem.createDiv({ cls: 'kh-legend-flag-desc' });
			redDesc.createEl('strong', { text: 'Red background' });
			redDesc.appendText(' F/H disabled: only Record entries (R)');

			// Gold border
			const goldItem = flagsGrid.createDiv({ cls: 'kh-legend-flag-item' });
			goldItem.createDiv({ cls: 'kh-legend-flag-sample kb-matrix-myown-mode', text: '🟨' });
			const goldDesc = goldItem.createDiv({ cls: 'kh-legend-flag-desc' });
			goldDesc.createEl('strong', { text: 'Gold border' });
			goldDesc.appendText(' My Own: FILES have topic tag (NOT subject/primary tags). HEADERS have topic TAG in header (keyword not enough)');

			// Mutual exclusivity note
			const noteDiv = legendContainer.createDiv({ cls: 'kh-legend-note' });
			noteDiv.createEl('strong', { text: 'Note: ' });
			noteDiv.appendText('AND mode (⬜) and My Own mode are mutually exclusive for secondary topics. Enabling one disables the other.');

			// Filter Expression Matrix Visual Legend
			legendContainer.createEl('h4', {
				text: 'Filter Expressions',
				cls: 'kh-legend-title',
				attr: { style: 'margin-top: 16px;' }
			});

			// Create compact mini-matrix
			const matrixLegend = legendContainer.createDiv({ cls: 'kh-filter-matrix-legend' });

			// Row 1
			const row1 = matrixLegend.createDiv({ cls: 'kh-filter-matrix-row' });
			row1.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-subject', text: '1x1' });
			row1.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-header', text: '1x2' });
			row1.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-header', text: '1x3' });

			// Row 2
			const row2 = matrixLegend.createDiv({ cls: 'kh-filter-matrix-row' });
			row2.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-side', text: '2x1' });
			row2.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-intersection', text: '2x2' });
			row2.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-intersection', text: '2x3' });

			// Row 3
			const row3 = matrixLegend.createDiv({ cls: 'kh-filter-matrix-row' });
			row3.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-side', text: '3x1' });
			row3.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-intersection', text: '3x2' });
			row3.createDiv({ cls: 'kh-filter-matrix-cell kh-filter-cell-intersection', text: '3x3' });

			// Compact explanations
			const matrixExplanation = legendContainer.createDiv({ cls: 'kh-legend-matrix-explanation' });
			matrixExplanation.createEl('div', {
				text: '🟩 GREEN (FilterExpHeader): Secondary header cells - standalone, no variables',
				cls: 'kh-legend-explanation-line'
			});
			matrixExplanation.createEl('div', {
				text: '🟥 RED (MatrixFilter SIDE): Primary side cells - standalone, no placeholders',
				cls: 'kh-legend-explanation-line'
			});
			matrixExplanation.createEl('div', {
				text: '🟦 BLUE (MatrixFilter INTERSECTION): Intersection cells - WITH variables: $TAG, $KEY, $BLOCK, $TEXT',
				cls: 'kh-legend-explanation-line'
			});
			matrixExplanation.createEl('div', {
				text: '🟦 -- (DashFilter): Primary topics - Dashboard view only (NOT in matrix)',
				cls: 'kh-legend-explanation-line'
			});
		}
	}

	/**
	 * Refresh unified chips display showing all selected items
	 */
	private refreshUnifiedChips(chipsDisplay: HTMLElement): void {
		chipsDisplay.empty();

		const hasSelections = this.selectedKeywords.size > 0 || this.selectedCategories.size > 0;

		if (!hasSelections) {
			chipsDisplay.createEl('p', { text: 'No filters selected', cls: 'kb-empty-hint' });
			return;
		}

		// Render categories first
		this.selectedCategories.forEach(catId => {
			this.renderChip(chipsDisplay, catId, 'category', () => {
				this.selectedCategories.delete(catId);
				this.updateExpression();
				this.refreshUnifiedChips(chipsDisplay);
			});
		});

		// Render keywords and languages
		this.selectedKeywords.forEach(value => {
			const type = this.allLanguages.includes(value) ? 'language' : 'keyword';
			this.renderChip(chipsDisplay, value, type as 'keyword' | 'language', () => {
				this.selectedKeywords.delete(value);
				if (type === 'language') {
					this.selectedLanguages.delete(value);
				}
				this.updateExpression();
				this.refreshUnifiedChips(chipsDisplay);
			});
		});
	}

	/**
	 * Refresh chips display (legacy method - now using unified chips)
	 * This is a no-op since onOpen() re-renders everything
	 */
	private refreshChipsOnly(type: string, selected: Set<string>): void {
		// No-op: onOpen() is called after this in all cases
	}

	/**
	 * DATA-DRIVEN TABLE RENDERING METHODS
	 */

	/**
	 * Render colgroup from column configuration
	 */
	private renderColgroup(table: HTMLElement, columns: ColumnConfig[]): void {
		const colgroup = table.createEl('colgroup');
		columns.forEach(col => {
			colgroup.createEl('col', { attr: { style: `width: ${col.width}` } });
		});
	}

	/**
	 * Render table header from column configuration
	 */
	private renderTableHeader(
		thead: HTMLElement,
		columns: ColumnConfig[],
		onAddClick?: () => void
	): void {
		const headerRow = thead.createEl('tr');
		columns.forEach((col, index) => {
			const th = headerRow.createEl('th', { cls: col.cls || `kb-col-${col.key}` });

			// Special handling for name column with add button
			if (col.key === 'name' && onAddClick && col.header) {
				const titleEl = th.createEl('h3', { text: col.header, cls: 'kb-section-title' });
				// Add button inside title column
				const btn = th.createEl('button', { text: '+', cls: 'kb-add-topic-inline-btn' });
				btn.addEventListener('click', onAddClick);
			} else if (col.header) {
				th.textContent = col.header;
				// Add info icon if column has tooltip
				if (col.tooltip) {
					const infoIcon = th.createEl('span', {
						text: ' ℹ️',
						cls: 'kb-info-icon'
					});
					infoIcon.setAttribute('title', col.tooltip);
				}
			}
		});
	}

	/**
	 * Attach drag-and-drop handlers to a topic row
	 */
	private attachDragHandlers(row: HTMLElement, topic: Topic, topicType: 'primary' | 'secondary'): void {
		row.addEventListener('dragstart', (e: DragEvent) => {
			row.classList.add('kb-dragging');
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', topic.id);
			}
		});

		row.addEventListener('dragend', () => {
			row.classList.remove('kb-dragging');
			document.querySelectorAll('.kb-topic-row').forEach(r => {
				r.classList.remove('kb-drag-over');
			});
		});

		row.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}

			const draggingRow = document.querySelector('.kb-dragging');
			if (draggingRow && draggingRow !== row) {
				// Only allow dragging between same topic types
				const draggingType = draggingRow.getAttribute('data-topic-type');
				if (draggingType === topicType) {
					row.classList.add('kb-drag-over');
				}
			}
		});

		row.addEventListener('dragleave', () => {
			row.classList.remove('kb-drag-over');
		});

		row.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			row.classList.remove('kb-drag-over');

			if (!e.dataTransfer) return;

			const draggedTopicId = e.dataTransfer.getData('text/plain');
			const targetTopicId = topic.id;

			if (draggedTopicId === targetTopicId) return;

			if (topicType === 'primary') {
				this.reorderPrimaryTopics(draggedTopicId, targetTopicId);
			} else {
				this.reorderSecondaryTopics(draggedTopicId, targetTopicId);
			}
		});
	}

	/**
	 * Render a topic row from column configuration
	 */
	private renderTopicRow(
		tbody: HTMLElement,
		topic: Topic,
		columns: ColumnConfig[],
		topicType: 'primary' | 'secondary'
	): void {
		// Create table row
		const row = tbody.createEl('tr', { cls: 'kb-topic-row' });
		row.draggable = true;
		row.setAttribute('data-topic-id', topic.id);
		row.setAttribute('data-topic-type', topicType);

		// F/H disabled styling for secondary topics
		if (topicType === 'secondary' && topic.fhDisabled) {
			row.classList.add('kb-topic-card-fh-enabled');
		}

		// Attach drag-and-drop handlers
		this.attachDragHandlers(row, topic, topicType);

		// Track cells for styling
		let nameCell: HTMLElement | null = null;
		let andModeCell: HTMLElement | null = null;
		let ownCell: HTMLElement | null = null;

		// Render cells from column configuration
		columns.forEach(col => {
			const cell = row.createEl('td', { cls: col.cls || `kb-col-${col.key}` });

			// Track name cell
			if (col.key === 'name') {
				nameCell = cell;
			}

			// Track AND mode cell
			if (col.key === 'andMode') {
				andModeCell = cell;
			}

			// Track Own cell
			if (col.key === 'own') {
				ownCell = cell;
			}

			switch (col.type) {
				case 'drag':
					const handle = cell.createEl('span', { text: col.text || '⋮⋮', cls: 'kb-drag-handle' });
					handle.title = 'Drag to reorder';
					break;

				case 'input':
					const inputAttrs: Record<string, string> = { 'data-topic-id': topic.id };
					if (col.field) {
						inputAttrs['data-field'] = col.field;
					}
					const input = cell.createEl('input', {
						type: 'text',
						attr: inputAttrs,
						value: (topic as any)[col.field!] || ''
					});
					if (col.placeholder) input.placeholder = col.placeholder;
					if (col.maxlength) input.setAttribute('maxlength', col.maxlength.toString());
					if (col.style) Object.assign(input.style, col.style);

					input.addEventListener('input', (e) => {
						(topic as any)[col.field!] = (e.target as HTMLInputElement).value;
					});

					// Auto-save on blur and refresh matrix
					input.addEventListener('blur', async () => {
						updateTopic(topic.id, topic);
						this.renderMatrixPreview();
					});
					break;

				case 'checkbox':
					this.renderCheckboxCell(cell, topic, col, topicType, row, nameCell, andModeCell, ownCell);
					break;

				case 'button':
					const btn = cell.createEl('button', {
						text: col.text || '',
						cls: col.buttonClass || 'kb-modal-btn'
					});
					if (col.tooltip) btn.title = col.tooltip;

					// Handle specific button actions
					if (col.key === 'delete') {
						btn.addEventListener('click', () => this.removeTopic(topic.id));
					} else if (col.onClick) {
						btn.addEventListener('click', () => col.onClick!(topic));
					}
					break;

				case 'assigned-primaries':
					this.renderAssignedPrimariesCell(cell, topic);
					break;

				case 'empty':
					// Empty cell for spacing/alignment
					break;
			}
		});


	}

	/**
	 * Render checkbox cell with specific logic for different checkbox types
	 */
	private renderCheckboxCell(
		cell: HTMLElement,
		topic: Topic,
		col: ColumnConfig,
		topicType: string,
		row: HTMLElement,
		nameCell: HTMLElement | null,
		andModeCell: HTMLElement | null,
		ownCell: HTMLElement | null
	): void {
		if (col.key === 'andMode') {
			// AND mode checkbox
			const input = cell.createEl('input', {
				type: 'checkbox',
				cls: 'kb-topic-and-mode-checkbox'
			});

			input.checked = topic.andMode || false;

			input.disabled = !this.subject.mainTag;
			input.title = this.subject.mainTag
				? (topicType === 'primary'
					? 'If checked, this primary topic and ALL its intersections will require the subject tag on files for F/H entries'
					: 'AND mode: Require subject tag for F/H entries')
				: 'Subject must have a tag to enable this option';

			if (topic.andMode) {
				input.style.border = '2px solid white';
				if (topicType === 'primary') {
					row.style.border = '2px solid white';
				} else {
					if (nameCell) nameCell.style.border = '2px solid white';
					cell.style.border = '2px solid white';
				}
			}

			input.addEventListener('change', async (e) => {
				const isChecked = (e.target as HTMLInputElement).checked;
				topic.andMode = isChecked;

				if (isChecked) {
					input.style.border = '2px solid white';
					if (topicType === 'primary') {
						row.style.border = '2px solid white';
					} else {
						if (nameCell) nameCell.style.border = '2px solid white';
						cell.style.border = '2px solid white';
					}
				} else {
					input.style.border = '';
					if (topicType === 'primary') {
						row.style.border = '';
					} else {
						if (nameCell) nameCell.style.border = '';
						cell.style.border = '';
					}
				}

				// Save and refresh matrix
				updateTopic(topic.id, topic);
				this.renderMatrixPreview();
			});

		} else if (col.key === 'fh') {
			// F/H checkbox for secondary topics - DISABLE F/H checkbox
			const checkbox = cell.createEl('input', { type: 'checkbox', cls: 'kb-fh-checkbox' });
			// INVERTED: checked = disabled
			const isFHDisabled = topic.fhDisabled;
			checkbox.checked = !!isFHDisabled;
			if (isFHDisabled) {
				checkbox.setAttribute('checked', 'checked');
			}
			checkbox.title = 'Disable F/H: Disable File and Header records (SECONDARY TOPICS ONLY)\n\nWhen CHECKED (RED): Shows ONLY Record entries (R), no files/headers\nWhen UNCHECKED: Collects files matching tags + headers with keywords/tags\n\nApplies to: own cell AND all intersections';

			checkbox.addEventListener('change', async (e) => {
				const isChecked = (e.target as HTMLInputElement).checked;
				// INVERTED: checked = disabled, so fhDisabled = isChecked
				topic.fhDisabled = isChecked;

				// Update row styling
				if (isChecked) { // CHECKED = DISABLED = RED
					row.classList.add('kb-topic-card-fh-enabled');
				} else { // UNCHECKED = ENABLED = NO RED
					row.classList.remove('kb-topic-card-fh-enabled');
				}

				// Save and refresh matrix
				updateTopic(topic.id, topic);
				this.renderMatrixPreview();
			});

		}
	}

	/**
	 * Render Assigned Primaries cell - shows which primary topics this secondary topic is assigned to
	 */
	private renderAssignedPrimariesCell(cell: HTMLElement, topic: Topic): void {
		const primaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'primary');

		// Container for the cell content
		const container = cell.createDiv({ cls: 'kb-assigned-primaries-container' });

		// If no primaryTopicIds or empty array, show "-" (applies to ALL)
		if (!topic.primaryTopicIds || topic.primaryTopicIds.length === 0) {
			const globalIndicator = container.createSpan({
				text: '-',
				cls: 'kb-global-indicator',
				attr: { title: 'This secondary topic applies to ALL primary topics' }
			});
			globalIndicator.style.fontSize = '1.2em';
			globalIndicator.style.color = 'var(--text-muted)';
			globalIndicator.style.fontWeight = 'bold';
		} else {
			// Show badge chips for assigned primaries
			const badgesContainer = container.createDiv({ cls: 'kb-assigned-badges' });

			topic.primaryTopicIds.forEach(primaryId => {
				const primary = primaryTopics.find(p => p.id === primaryId);
				if (primary) {
					const badge = badgesContainer.createDiv({ cls: 'kb-assigned-badge' });

					// Icon
					badge.createSpan({
						text: primary.icon || '📌',
						cls: 'kb-assigned-badge-icon'
					});

					// Remove button
					const removeBtn = badge.createSpan({
						text: '×',
						cls: 'kb-assigned-badge-remove'
					});
					removeBtn.addEventListener('click', () => {
						// Remove this primary from the assignments
						topic.primaryTopicIds = topic.primaryTopicIds!.filter(id => id !== primaryId);

						// Re-render the cell
						cell.empty();
						this.renderAssignedPrimariesCell(cell, topic);
					});

					badge.title = `${primary.name} (click × to remove)`;
				}
			});
		}

		// Add selector dropdown for adding more primaries
		if (primaryTopics.length > 0) {
			const selectorContainer = container.createDiv({ cls: 'kb-primary-selector-container' });

			// Get unassigned primaries
			const assignedIds = topic.primaryTopicIds || [];
			const unassignedPrimaries = primaryTopics.filter(p => !assignedIds.includes(p.id));

			if (unassignedPrimaries.length > 0) {
				const select = selectorContainer.createEl('select', { cls: 'kb-primary-selector' });

				// Default option - just a down arrow indicator
				const defaultOption = select.createEl('option', {
					text: '▼',
					value: ''
				});
				defaultOption.disabled = true;
				defaultOption.selected = true;

				// Options for each unassigned primary
				unassignedPrimaries.forEach(primary => {
					const option = select.createEl('option', {
						text: `${primary.icon || '📌'} ${primary.name}`,
						value: primary.id
					});
				});

				// Handle selection
				select.addEventListener('change', () => {
					const selectedId = select.value;
					if (selectedId) {
						// Initialize array if needed
						if (!topic.primaryTopicIds) {
							topic.primaryTopicIds = [];
						}

						// Add the selected primary
						topic.primaryTopicIds.push(selectedId);

						// Re-render the cell
						cell.empty();
						this.renderAssignedPrimariesCell(cell, topic);
					}
				});
			}
		}
	}

	/**
	 * Render topics sections
	 */
	private renderTopicsSections(containerEl: HTMLElement): void {
		const primaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'primary');
		const secondaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'secondary');

		// Primary Topics Section
		this.renderPrimaryTopicsSection(containerEl, primaryTopics);

		// Secondary Topics Section
		this.renderSecondaryTopicsSection(containerEl, secondaryTopics);
	}

	/**
	 * Render Primary Topics section using data-driven approach
	 */
	private renderPrimaryTopicsSection(containerEl: HTMLElement, primaryTopics: Topic[]): void {
		const section = containerEl.createDiv({ cls: 'kb-topic-section' });

		// Create table with fixed column widths
		const table = section.createEl('table', { cls: 'kb-primary-topics-table' });

		// Render colgroup from configuration
		this.renderColgroup(table, this.primaryTopicColumns);

		// Render header from configuration
		const thead = table.createEl('thead');
		this.renderTableHeader(
			thead,
			this.primaryTopicColumns,
			() => this.addPrimaryTopic()
		);

		// Render table body
		const tbody = table.createEl('tbody');

		if (primaryTopics.length === 0) {
			const emptyRow = tbody.createEl('tr');
			const emptyCell = emptyRow.createEl('td', {
				attr: { colspan: this.primaryTopicColumns.length.toString() },
				cls: 'kb-empty-hint'
			});
			emptyCell.textContent = 'No primary topics. Click "+" to create one.';
		} else {
			primaryTopics.forEach(topic => {
				this.renderTopicRow(tbody, topic, this.primaryTopicColumns, 'primary');
			});
		}
	}

	/**
	 * Render Secondary Topics section using data-driven approach
	 */
	private renderSecondaryTopicsSection(containerEl: HTMLElement, secondaryTopics: Topic[]): void {
		const section = containerEl.createDiv({ cls: 'kb-topic-section' });

		// Create table with fixed column widths
		const table = section.createEl('table', { cls: 'kb-secondary-topics-table' });

		// Render colgroup from configuration
		this.renderColgroup(table, this.secondaryTopicColumns);

		// Render header from configuration
		const thead = table.createEl('thead');
		this.renderTableHeader(
			thead,
			this.secondaryTopicColumns,
			() => this.addSecondaryTopic()
		);

		// Render table body
		const tbody = table.createEl('tbody');

		if (secondaryTopics.length === 0) {
			const emptyRow = tbody.createEl('tr');
			const emptyCell = emptyRow.createEl('td', {
				attr: { colspan: this.secondaryTopicColumns.length.toString() },
				cls: 'kb-empty-hint'
			});
			emptyCell.textContent = 'No secondary topics. Click "+" to create one.';
		} else {
			secondaryTopics.forEach(topic => {
				this.renderTopicRow(tbody, topic, this.secondaryTopicColumns, 'secondary');
			});
		}
	}

	/**
	 * Render Matrix section
	 */
	private renderMatrixSection(containerEl: HTMLElement): void {
		// Initialize matrix if it doesn't exist
		if (!this.subject.matrix) {
			this.subject.matrix = { cells: {} };
		}

		// Use shared MatrixRenderer to render the table (display only - no click handlers)
		MatrixRenderer.renderMatrixTable(containerEl, this.subject, this.topics, {
			showScanButton: true,
			onScanClick: () => this.scanMatrixFileCounts()
			// NO onCellClick - this is a preview/display only, not interactive
		});
	}

	/**
	 * Refresh matrix display after topic changes (without closing modal)
	 */
	private renderMatrixPreview(): void {
		// Re-render the entire modal to update all visual indicators
		// This ensures checkboxes, radio buttons, and all styling are refreshed
		this.onOpen();
	}

	/**
	 * Get tag filter information for a cell
	 */
	private getTagsForCell(cellKey: string, secondaryTopic: Topic | null, primaryTopic: Topic | null): { tags: string[], description: string } {
		const andMode = secondaryTopic?.andMode || primaryTopic?.andMode || false;

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
	 * Scan file counts for all matrix cells
	 */
	private async scanMatrixFileCounts(): Promise<void> {
		const primaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'primary');
		const secondaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'secondary');

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

			let fileCount: number;
			let headerCount: number;

			const { tags } = this.getTagsForCell(cellKey, topic, null);
			fileCount = this.countFilesWithTags(files, tags);
			headerCount = this.countHeadersForSingleTopic(files, tags, topic);

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

				// For intersections: ONLY use primary topic's AND mode (inherited from row)
				// Secondary topic's AND mode does NOT apply to intersections
				const includesSubjectTag = primaryTopic.andMode || false;

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
				const onlyFileTagMatch = !keyword1Match && !tag1Match && tag1InFile && !keyword2Match && !tag2Match && tag2InFile;

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
		const newTopic: any = {
			id: `topic-${Date.now()}`,
			name: '',
			type: 'primary',  // Temporary field for modal editing only
			subjectId: this.subject.id  // Temporary field for modal editing only
		};
		this.topics.push(newTopic);
		this.onOpen(); // Re-render
	}

	/**
	 * Add a new secondary topic
	 */
	private addSecondaryTopic(): void {
		const newTopic: any = {
			id: `topic-${Date.now()}`,
			name: '',
			type: 'secondary',  // Temporary field for modal editing only
			subjectId: this.subject.id  // Temporary field for modal editing only
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
		const primaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'primary');
		const currentIndex = primaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex <= 0) return; // Already at top or not found

		// Swap with previous topic in the main topics array
		const currentTopic = primaryTopics[currentIndex];
		const previousTopic = primaryTopics[currentIndex - 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const previousMainIndex = this.topics.findIndex(t => t.id === previousTopic.id);

		// Swap positions in main array (position determines order now)
		[this.topics[currentMainIndex], this.topics[previousMainIndex]] =
		[this.topics[previousMainIndex], this.topics[currentMainIndex]];

		this.onOpen(); // Re-render
	}

	/**
	 * Move primary topic down
	 */
	private movePrimaryTopicDown(topicId: string): void {
		const primaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'primary');
		const currentIndex = primaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex < 0 || currentIndex >= primaryTopics.length - 1) return; // Already at bottom or not found

		// Swap with next topic in the main topics array
		const currentTopic = primaryTopics[currentIndex];
		const nextTopic = primaryTopics[currentIndex + 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const nextMainIndex = this.topics.findIndex(t => t.id === nextTopic.id);

		// Swap positions in main array (position determines order now)
		[this.topics[currentMainIndex], this.topics[nextMainIndex]] =
		[this.topics[nextMainIndex], this.topics[currentMainIndex]];

		this.onOpen(); // Re-render
	}

	/**
	 * Move secondary topic up
	 */
	private moveSecondaryTopicUp(topicId: string): void {
		const secondaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'secondary');
		const currentIndex = secondaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex <= 0) return; // Already at top or not found

		// Swap with previous topic in the main topics array
		const currentTopic = secondaryTopics[currentIndex];
		const previousTopic = secondaryTopics[currentIndex - 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const previousMainIndex = this.topics.findIndex(t => t.id === previousTopic.id);

		// Swap positions in main array (position determines order now)
		[this.topics[currentMainIndex], this.topics[previousMainIndex]] =
		[this.topics[previousMainIndex], this.topics[currentMainIndex]];

		this.onOpen(); // Re-render
	}

	/**
	 * Move secondary topic down
	 */
	private moveSecondaryTopicDown(topicId: string): void {
		const secondaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'secondary');
		const currentIndex = secondaryTopics.findIndex(t => t.id === topicId);

		if (currentIndex < 0 || currentIndex >= secondaryTopics.length - 1) return; // Already at bottom or not found

		// Swap with next topic in the main topics array
		const currentTopic = secondaryTopics[currentIndex];
		const nextTopic = secondaryTopics[currentIndex + 1];

		const currentMainIndex = this.topics.findIndex(t => t.id === currentTopic.id);
		const nextMainIndex = this.topics.findIndex(t => t.id === nextTopic.id);

		// Swap positions in main array (position determines order now)
		[this.topics[currentMainIndex], this.topics[nextMainIndex]] =
		[this.topics[nextMainIndex], this.topics[currentMainIndex]];

		this.onOpen(); // Re-render
	}

	/**
	 * Reorder primary topics via drag-and-drop
	 */
	private reorderPrimaryTopics(draggedTopicId: string, targetTopicId: string): void {
		const primaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'primary');
		const draggedIndex = primaryTopics.findIndex(t => t.id === draggedTopicId);
		const targetIndex = primaryTopics.findIndex(t => t.id === targetTopicId);

		if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return;

		const draggedTopic = primaryTopics[draggedIndex];

		// Find dragged topic's position in the main topics array
		const draggedMainIndex = this.topics.findIndex(t => t.id === draggedTopicId);

		// Remove from current position
		this.topics.splice(draggedMainIndex, 1);

		// Find new target position after removal (may have shifted)
		const newTargetMainIndex = this.topics.findIndex(t => t.id === targetTopicId);

		// Insert at new position (before target if dragging down, after target if dragging up)
		const insertIndex = draggedIndex < targetIndex ? newTargetMainIndex + 1 : newTargetMainIndex;
		this.topics.splice(insertIndex, 0, draggedTopic);

		this.onOpen(); // Re-render
	}

	/**
	 * Reorder secondary topics via drag-and-drop
	 */
	private reorderSecondaryTopics(
		draggedTopicId: string,
		targetTopicId: string
	): void {
		const secondaryTopics = (this.topics as any[]).filter((t: any) => t.type === 'secondary');

		const draggedIndex = secondaryTopics.findIndex(t => t.id === draggedTopicId);
		const targetIndex = secondaryTopics.findIndex(t => t.id === targetTopicId);

		if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return;

		const draggedTopic = secondaryTopics[draggedIndex];

		// Find dragged topic's position in the main topics array
		const draggedMainIndex = this.topics.findIndex(t => t.id === draggedTopicId);

		// Remove from current position
		this.topics.splice(draggedMainIndex, 1);

		// Find new target position after removal (may have shifted)
		const newTargetMainIndex = this.topics.findIndex(t => t.id === targetTopicId);

		// Insert at new position (before target if dragging down, after target if dragging up)
		const insertIndex = draggedIndex < targetIndex ? newTargetMainIndex + 1 : newTargetMainIndex;
		this.topics.splice(insertIndex, 0, draggedTopic);

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
			// Get filter expressions from inputs
			const dashFilter = (document.getElementById('subject-dash-filter') as HTMLInputElement)?.value || '';
			const matrixFilter = (document.getElementById('subject-matrix-filter') as HTMLInputElement)?.value || '';

			// Update subject with both filters
			this.subject.dashOnlyFilterExp = dashFilter || undefined;
			this.subject.matrixOnlyFilterExp = matrixFilter || undefined;

			// Clear legacy expression field
			delete this.subject.expression;

			// Clear matrix counts and remove empty cells before saving
			if (this.subject.matrix?.cells) {
				Object.keys(this.subject.matrix.cells).forEach(cellKey => {
					const cell = this.subject.matrix!.cells[cellKey];
					delete cell.fileCount;
					delete cell.headerCount;
					delete cell.recordCount;

					// Delete cell if it's now empty
					if (Object.keys(cell).length === 0) {
						delete this.subject.matrix!.cells[cellKey];
					}
				});

				// Delete entire matrix if cells is now empty
				if (Object.keys(this.subject.matrix.cells).length === 0) {
					delete this.subject.matrix;
				}
			}

			// Separate topics into primary and secondary, removing legacy/temporary fields
			const primaryTopics = (this.topics as any[])
				.filter((t: any) => t.type === 'primary')
				.map((t: any) => {
					const cleanTopic: any = { ...t };
					delete cleanTopic.type;  // Temporary field used during editing
					delete cleanTopic.subjectId;  // Temporary field used during editing
					delete cleanTopic.order;  // Legacy field, order is now array position
					return cleanTopic;
				});

			const secondaryTopics = (this.topics as any[])
				.filter((t: any) => t.type === 'secondary')
				.map((t: any) => {
					const cleanTopic: any = { ...t };
					delete cleanTopic.type;  // Temporary field used during editing
					delete cleanTopic.subjectId;  // Temporary field used during editing
					delete cleanTopic.order;  // Legacy field, order is now array position
					return cleanTopic;
				});

			// Update subject with nested topics
			this.subject.primaryTopics = primaryTopics.length > 0 ? primaryTopics : undefined;
			this.subject.secondaryTopics = secondaryTopics.length > 0 ? secondaryTopics : undefined;

			// Update subjects store
			subjectsStore.update(data => {
				// Update or add subject
				const existingIndex = data.subjects.findIndex((s: Subject) => s.id === this.subject.id);
				if (existingIndex >= 0) {
					data.subjects[existingIndex] = this.subject;
				} else {
					data.subjects.push(this.subject);
				}

				return data;
			});

			// Save subjects
			await saveSubjects();


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
