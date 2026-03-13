import { App, Modal } from 'obsidian';
import type { KeywordStyle, Category } from '../shared/keyword-style';
import { KeywordType } from '../shared/keyword-style';
import { settingsStore } from '../stores/settings-store';
import { get } from 'svelte/store';

/**
 * Modal for selecting sub-keywords for a keyword
 * Uses chip-based UI similar to SubjectModal
 */
export class SubKeywordsModal extends Modal {
	private keyword: KeywordStyle;
	private categoryId: string;
	private onUpdate: () => void;

	// Selected sub-keywords (keywords or categories prefixed with ":")
	private selectedSubKeywords: Set<string> = new Set();

	private allKeywords: Array<{ keyword: string; icon: string; backgroundColor?: string; color?: string }> = [];
	private allCategories: Array<{ id: string; icon: string }> = [];

	constructor(
		app: App,
		keyword: KeywordStyle,
		categoryId: string,
		onUpdate: () => void
	) {
		super(app);
		this.keyword = keyword;
		this.categoryId = categoryId;
		this.onUpdate = onUpdate;

		// Load existing sub-keywords
		if (keyword.subKeywords && keyword.subKeywords.length > 0) {
			this.selectedSubKeywords = new Set(keyword.subKeywords);
		}

		// Collect available options
		this.collectAvailableOptions();
	}

	private collectAvailableOptions(): void {
		const settings = get(settingsStore);

		// Collect all keywords from all categories
		for (const category of settings.categories) {
			for (const kw of category.keywords) {
				if (kw.keyword && kw.keyword !== this.keyword.keyword) {
					// Don't include self
					this.allKeywords.push({
						keyword: kw.keyword,
						icon: kw.generateIcon || '🏷️',
						backgroundColor: kw.backgroundColor,
						color: kw.color
					});
				}
			}
		}

		// Collect all categories
		for (const category of settings.categories) {
			if (category.id) {
				this.allCategories.push({
					id: category.id,
					icon: category.icon
				});
			}
		}

		this.allKeywords.sort((a, b) => a.keyword.localeCompare(b.keyword));
	}

	/**
	 * Add all helper (non-main) keywords from current category
	 */
	private addAllAuxFromCategory(): void {
		const settings = get(settingsStore);
		const category = settings.categories.find((c: Category) => c.id === this.categoryId);
		if (!category) return;

		// Clear current selections
		this.selectedSubKeywords.clear();

		// Add all helper keywords from this category
		for (const kw of category.keywords) {
			// Skip self
			if (kw.keyword === this.keyword.keyword) continue;

			// Check if keyword is helper (not main)
			const isMain = kw.keywordType === KeywordType.MAIN || kw.mainKeyword === true;
			if (!isMain) {
				this.selectedSubKeywords.add(kw.keyword);
			}
		}

		// Save and refresh
		this.saveSelections();
		this.refreshChips();
		this.onOpen(); // Re-render to update category browser indicators
	}

	/**
	 * Save selections to keyword and trigger update
	 */
	private saveSelections(): void {
		// Update keyword's subKeywords array
		this.keyword.subKeywords = Array.from(this.selectedSubKeywords);

		// Update settings store
		const settings = get(settingsStore);
		const category = settings.categories.find((c: Category) => c.id === this.categoryId);
		if (category) {
			const kwIndex = category.keywords.findIndex((k: KeywordStyle) => k.keyword === this.keyword.keyword);
			if (kwIndex >= 0) {
				category.keywords[kwIndex] = this.keyword;
				settingsStore.set(settings);
			}
		}

		// Trigger parent update
		this.onUpdate();
	}

	/**
	 * Refresh chips display
	 */
	private refreshChips(): void {
		const chipsDisplay = this.contentEl.querySelector('.kh-subkeywords-chips-display');
		if (!chipsDisplay) return;

		chipsDisplay.empty();

		if (this.selectedSubKeywords.size === 0) {
			chipsDisplay.createEl('p', { text: 'No sub-keywords selected', cls: 'kb-empty-hint' });
		} else {
			this.selectedSubKeywords.forEach(value => {
				this.renderChip(chipsDisplay as HTMLElement, value);
			});
		}
	}

	/**
	 * Render a single chip
	 */
	private renderChip(container: HTMLElement, value: string): void {
		const chip = container.createDiv({ cls: 'kb-selected-chip kb-chip-include' });

		let icon = '🏷️';
		let displayValue = value;

		// Check if it's a category (prefixed with ":")
		if (value.startsWith(':')) {
			const categoryId = value.substring(1);
			const cat = this.allCategories.find(c => c.id === categoryId);
			icon = cat?.icon || '📁';
			displayValue = categoryId;
		} else {
			// It's a keyword
			const kw = this.allKeywords.find(k => k.keyword === value);
			icon = kw?.icon || '🏷️';
			if (kw?.backgroundColor) {
				chip.style.backgroundColor = kw.backgroundColor;
			}
			if (kw?.color) {
				chip.style.color = kw.color;
			}
		}

		chip.createSpan({ text: icon, cls: 'kb-chip-icon' });
		chip.createSpan({ text: displayValue, cls: 'kb-chip-label' });

		const removeBtn = chip.createSpan({ text: '×', cls: 'kb-chip-remove' });
		removeBtn.onclick = () => {
			this.selectedSubKeywords.delete(value);
			this.saveSelections();
			this.refreshChips();
		};

		chip.title = `${displayValue} (click × to remove)`;
	}

	/**
	 * Render category browser
	 */
	private renderCategoryBrowser(container: HTMLElement): void {
		const browserDiv = container.createDiv({ cls: 'kb-category-browser' });

		this.allCategories.forEach(category => {
			const categoryValue = `:${category.id}`;
			const isSelected = this.selectedSubKeywords.has(categoryValue);

			const categoryChip = browserDiv.createDiv({ cls: 'kb-category-chip' });

			let indicator = isSelected ? ' ✓' : ' +';
			categoryChip.style.opacity = isSelected ? '1' : '0.5';
			categoryChip.style.fontWeight = isSelected ? '700' : 'normal';

			categoryChip.textContent = `${category.icon} ${category.id}${indicator}`;
			categoryChip.title = isSelected
				? `Click to remove category :${category.id}`
				: `Click to add category :${category.id}`;

			categoryChip.onclick = () => {
				if (isSelected) {
					this.selectedSubKeywords.delete(categoryValue);
				} else {
					this.selectedSubKeywords.add(categoryValue);
				}
				this.saveSelections();
				this.refreshChips();
				// Re-render browser to update indicators
				this.onOpen();
			};
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: `Sub-keywords for: ${this.keyword.keyword}` });

		// Quick action button: Add all helper keywords from this category
		const quickActionDiv = contentEl.createDiv({ cls: 'kh-subkeywords-quick-action' });
		const auxButton = quickActionDiv.createEl('button', {
			text: '⚡ Add All Helper from Category',
			cls: 'mod-warning'
		});
		auxButton.style.marginBottom = '10px';
		auxButton.title = 'Wipe current selections and add all helper (non-main) keywords from this category';
		auxButton.onclick = () => {
			this.addAllAuxFromCategory();
		};

		// Categories section
		const categoriesSection = contentEl.createDiv({ cls: 'kb-filter-section' });
		categoriesSection.createEl('h4', { text: 'Categories' });
		this.renderCategoryBrowser(categoriesSection);

		// Keywords section
		const keywordsSection = contentEl.createDiv({ cls: 'kb-filter-section' });
		keywordsSection.createEl('h4', { text: 'Keywords' });

		// Chips display
		const chipsDisplay = keywordsSection.createDiv({ cls: 'kh-subkeywords-chips-display kb-chips-display' });
		if (this.selectedSubKeywords.size === 0) {
			chipsDisplay.createEl('p', { text: 'No sub-keywords selected', cls: 'kb-empty-hint' });
		} else {
			this.selectedSubKeywords.forEach(value => {
				if (!value.startsWith(':')) {
					// Only show keywords in this section
					this.renderChip(chipsDisplay, value);
				}
			});
		}

		// Autocomplete input
		const inputDiv = keywordsSection.createDiv({ cls: 'kb-autocomplete-container' });
		const input = inputDiv.createEl('input', {
			type: 'text',
			cls: 'kb-autocomplete-input',
			placeholder: 'Type to add keyword...'
		});

		const suggestionsDiv = inputDiv.createDiv({ cls: 'kb-autocomplete-suggestions' });

		input.addEventListener('input', () => {
			const query = input.value.toLowerCase().trim();
			suggestionsDiv.empty();

			if (!query) {
				suggestionsDiv.style.display = 'none';
				return;
			}

			// Filter keywords
			const matches = this.allKeywords.filter(kw =>
				kw.keyword.toLowerCase().includes(query) &&
				!this.selectedSubKeywords.has(kw.keyword)
			).slice(0, 10);

			if (matches.length === 0) {
				suggestionsDiv.style.display = 'none';
				return;
			}

			suggestionsDiv.style.display = 'block';

			matches.forEach(kw => {
				const suggestion = suggestionsDiv.createDiv({ cls: 'kb-autocomplete-item' });
				suggestion.textContent = `${kw.icon} ${kw.keyword}`;
				suggestion.onclick = () => {
					this.selectedSubKeywords.add(kw.keyword);
					this.saveSelections();
					this.refreshChips();
					input.value = '';
					suggestionsDiv.empty();
					suggestionsDiv.style.display = 'none';
				};
			});
		});

		// Close button
		const closeBtn = contentEl.createEl('button', {
			text: 'Close',
			cls: 'mod-cta'
		});
		closeBtn.style.marginTop = '20px';
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
