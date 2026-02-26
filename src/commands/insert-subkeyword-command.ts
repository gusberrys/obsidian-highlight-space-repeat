import { App, type Command, SuggestModal } from 'obsidian';
import { get } from 'svelte/store';
import { settingsStore } from 'src/stores/settings-store';
import type { KeywordStyle, Category } from 'src/shared';

type KeywordWithCategory = KeywordStyle & { categoryName: string; priority: number };

/**
 * Get all keywords from settings
 */
function getAllKeywords(): KeywordStyle[] {
	const settings = get(settingsStore);
	const allKeywords: KeywordStyle[] = [];

	settings.categories.forEach(category => {
		category.keywords.forEach((k: KeywordStyle) => {
			if (k.keyword) {
				allKeywords.push(k);
			}
		});
	});

	return allKeywords;
}

/**
 * Find keywords already present in the line (before ::)
 */
function findPresentKeywords(line: string): KeywordStyle[] {
	const allKeywords = getAllKeywords();
	const recognized: KeywordStyle[] = [];

	// Get the part before :: (if present)
	const beforeDoubleColon = line.includes('::') ? line.split('::')[0] : line;

	// Check for each keyword if it appears in the line
	for (const keyword of allKeywords) {
		// Match keyword as whole word
		const regex = new RegExp(`\\b${keyword.keyword}\\b`, 'i');
		if (regex.test(beforeDoubleColon)) {
			recognized.push(keyword);
		}
	}

	return recognized;
}

/**
 * Get smart-prioritized subkeyword suggestions based on keywords already present in the line
 * Priority:
 * 1. subKeywords of already-present keywords that haven't been used yet
 * 2. subKeywords of the first keyword that haven't been used yet
 */
function getSmartSubkeywordSuggestions(line: string): KeywordStyle[] {
	const settings = get(settingsStore);
	const allKeywords = getAllKeywords();
	const presentKeywords = findPresentKeywords(line);

	if (presentKeywords.length === 0) {
		// No keywords present - suggest all keywords
		return allKeywords;
	}

	const suggestions: KeywordStyle[] = [];
	const alreadyUsedKeywords = new Set(presentKeywords.map(k => k.keyword.toLowerCase()));

	// Strategy: For each present keyword (from last to first), add its unused subKeywords
	// This prioritizes subKeywords of the most recently added keyword
	for (let i = presentKeywords.length - 1; i >= 0; i--) {
		const presentKeyword = presentKeywords[i];

		if (presentKeyword.subKeywords && presentKeyword.subKeywords.length > 0) {
			for (const subKeywordId of presentKeyword.subKeywords) {
				if (subKeywordId.startsWith(':')) {
					// It's a category - add all keywords from that category
					const categoryId = subKeywordId.substring(1);
					const category = settings.categories.find((c: Category) => c.id === categoryId);
					if (category) {
						category.keywords.forEach((k: KeywordStyle) => {
							if (k.keyword && !alreadyUsedKeywords.has(k.keyword.toLowerCase())) {
								// Check if not already in suggestions
								if (!suggestions.find(s => s.keyword.toLowerCase() === k.keyword.toLowerCase())) {
									suggestions.push(k);
								}
							}
						});
					}
				} else {
					// It's a keyword - add it if not used
					if (!alreadyUsedKeywords.has(subKeywordId.toLowerCase())) {
						const keyword = allKeywords.find(k => k.keyword.toLowerCase() === subKeywordId.toLowerCase());
						if (keyword) {
							// Check if not already in suggestions
							if (!suggestions.find(s => s.keyword.toLowerCase() === keyword.keyword.toLowerCase())) {
								suggestions.push(keyword);
							}
						}
					}
				}
			}
		}
	}

	// If no subKeywords found, suggest all unused keywords
	if (suggestions.length === 0) {
		return allKeywords.filter(k => !alreadyUsedKeywords.has(k.keyword.toLowerCase()));
	}

	return suggestions;
}

class SubKeywordSuggestModal extends SuggestModal<KeywordWithCategory> {
	private onChoose: (keyword: KeywordStyle) => void;
	private currentLine: string;

	constructor(app: App, currentLine: string, onChoose: (keyword: KeywordStyle) => void) {
		super(app);
		this.currentLine = currentLine;
		this.onChoose = onChoose;
	}

	getSuggestions(query: string): KeywordWithCategory[] {
		const settings = get(settingsStore);
		const smartSuggestions = getSmartSubkeywordSuggestions(this.currentLine);

		// Add category names for display
		const keywordsWithCategory: KeywordWithCategory[] = smartSuggestions.map((keyword, index) => {
			// Find which category this keyword belongs to
			let categoryName = '';
			for (const category of settings.categories) {
				if (category.keywords.some(k => k.keyword === keyword.keyword)) {
					categoryName = category.icon;
					break;
				}
			}

			return {
				...keyword,
				categoryName,
				priority: index // Lower index = higher priority
			};
		});

		if (!query) {
			return keywordsWithCategory;
		}

		const lowerQuery = query.toLowerCase();
		return keywordsWithCategory.filter(keyword => {
			const matchKeyword = keyword.keyword.toLowerCase().includes(lowerQuery);
			const matchDescription = keyword.description?.toLowerCase().includes(lowerQuery) || false;
			const matchCategory = keyword.categoryName.toLowerCase().includes(lowerQuery);
			const matchIcon = keyword.generateIcon?.toLowerCase().includes(lowerQuery) || false;

			return matchKeyword || matchDescription || matchCategory || matchIcon;
		});
	}

	renderSuggestion(keywordWithCategory: KeywordWithCategory, el: HTMLElement) {
		const container = el.createDiv({ cls: 'keyword-suggestion' });

		const mainLine = container.createDiv({ cls: 'keyword-suggestion-main' });

		// Icon and keyword
		const keywordPart = mainLine.createSpan({ cls: 'keyword-suggestion-keyword' });
		if (keywordWithCategory.generateIcon) {
			keywordPart.createSpan({ text: keywordWithCategory.generateIcon + ' ' });
		}
		keywordPart.createSpan({ text: keywordWithCategory.keyword, cls: 'keyword-text' });

		// Description
		mainLine.createSpan({
			text: `: ${keywordWithCategory.description || ''}`,
			cls: 'keyword-suggestion-category'
		});

		// Add priority indicator for top suggestions
		if (keywordWithCategory.priority < 3) {
			mainLine.createSpan({
				text: ' ⭐',
				cls: 'keyword-priority-indicator'
			});
		}

		// Add CSS for styling (reuse existing styles)
		if (!document.querySelector('#keyword-suggestion-styles')) {
			const style = document.createElement('style');
			style.id = 'keyword-suggestion-styles';
			style.textContent = `
				.keyword-suggestion {
					padding: 4px 0;
				}
				.keyword-suggestion-main {
					display: flex;
					align-items: center;
					gap: 8px;
				}
				.keyword-suggestion-keyword {
					font-weight: 600;
					color: var(--text-accent);
				}
				.keyword-suggestion-category {
					font-size: 0.85em;
					color: var(--text-muted);
					font-style: italic;
				}
				.keyword-priority-indicator {
					font-size: 0.9em;
				}
			`;
			document.head.appendChild(style);
		}
	}

	onChooseSuggestion(keywordWithCategory: KeywordWithCategory) {
		this.onChoose(keywordWithCategory);
	}
}

export const createInsertSubKeywordCommand: (app: App) => Command = (app: App) => ({
	id: 'kh-insert-subkeyword',
	name: 'Insert sub-keyword (smart suggestions)',
	editorCallback: (editor) => {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		new SubKeywordSuggestModal(app, line, (keyword: KeywordStyle) => {
			// Find insertion point: after last keyword, before ::
			let insertionPoint: number;
			const doubleColonIndex = line.indexOf('::');

			if (doubleColonIndex !== -1) {
				// Insert right before ::
				// Find the last non-whitespace character before ::
				let pos = doubleColonIndex - 1;
				while (pos >= 0 && line[pos] === ' ') {
					pos--;
				}
				insertionPoint = pos + 1;
			} else {
				// No :: found - insert at cursor position or end of recognized keywords
				const presentKeywords = findPresentKeywords(line);
				if (presentKeywords.length > 0) {
					// Find the last keyword position
					const lastKeyword = presentKeywords[presentKeywords.length - 1];
					const lastKeywordIndex = line.toLowerCase().lastIndexOf(lastKeyword.keyword.toLowerCase());
					if (lastKeywordIndex !== -1) {
						insertionPoint = lastKeywordIndex + lastKeyword.keyword.length;
					} else {
						insertionPoint = cursor.ch;
					}
				} else {
					insertionPoint = cursor.ch;
				}
			}

			// Build the new line with keyword inserted
			const beforeInsertion = line.substring(0, insertionPoint);
			const afterInsertion = line.substring(insertionPoint);

			// Add space before keyword if needed
			const needsSpaceBefore = beforeInsertion.length > 0 && beforeInsertion[beforeInsertion.length - 1] !== ' ';
			const prefix = needsSpaceBefore ? ' ' : '';

			const newLine = `${beforeInsertion}${prefix}${keyword.keyword}${afterInsertion}`;

			editor.setLine(cursor.line, newLine);

			// Position cursor after the inserted keyword
			editor.setCursor({
				line: cursor.line,
				ch: insertionPoint + prefix.length + keyword.keyword.length
			});
		}).open();
	},
});
