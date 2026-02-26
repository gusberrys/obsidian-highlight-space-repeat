import { Editor, EditorSuggest, TFile } from 'obsidian';
import type { App, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from 'obsidian';
import { get } from 'svelte/store';
import { settingsStore } from './stores/settings-store';
import type { KeywordStyle, Category } from './shared';

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

	// For each present keyword (from last to first), add its unused subKeywords
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

export class SubKeywordSuggest extends EditorSuggest<KeywordStyle> {
	constructor(app: App) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		// Get the current line
		const line = editor.getLine(cursor.line);
		const textBeforeCursor = line.substring(0, cursor.ch);

		// Trigger on // (two slashes)
		const triggerMatch = textBeforeCursor.match(/\/\/$/);

		if (triggerMatch) {
			// Find where to insert the suggestion (replace //)
			const slashIndex = textBeforeCursor.lastIndexOf('//');
			if (slashIndex === -1) return null;

			return {
				start: { line: cursor.line, ch: slashIndex },
				end: { line: cursor.line, ch: slashIndex + 2 },
				query: ''
			};
		}

		return null;
	}

	getSuggestions(context: EditorSuggestContext): KeywordStyle[] {
		const editor = context.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// Get smart suggestions based on the current line
		const smartSuggestions = getSmartSubkeywordSuggestions(line);

		const query = context.query.toLowerCase();

		if (!query) {
			return smartSuggestions;
		}

		// Filter by keyword, description, or icon
		return smartSuggestions.filter((kw: KeywordStyle) =>
			kw.keyword.toLowerCase().includes(query) ||
			kw.description?.toLowerCase().includes(query) ||
			kw.generateIcon?.includes(query)
		);
	}

	renderSuggestion(keyword: KeywordStyle, el: HTMLElement): void {
		const container = el.createDiv({ cls: 'subkeyword-suggestion' });

		// Icon
		if (keyword.generateIcon) {
			container.createSpan({
				text: keyword.generateIcon + ' ',
				cls: 'subkeyword-icon'
			});
		}

		// Keyword name
		container.createSpan({
			text: keyword.keyword,
			cls: 'subkeyword-name'
		});

		// Description
		if (keyword.description) {
			container.createSpan({
				text: ' - ' + keyword.description,
				cls: 'subkeyword-description'
			});
		}

		// Add CSS for styling
		if (!document.querySelector('#subkeyword-suggestion-styles')) {
			const style = document.createElement('style');
			style.id = 'subkeyword-suggestion-styles';
			style.textContent = `
				.subkeyword-suggestion {
					padding: 4px 8px;
					display: flex;
					align-items: center;
					gap: 4px;
				}
				.subkeyword-icon {
					font-size: 1.2em;
				}
				.subkeyword-name {
					color: var(--text-accent);
					font-weight: 500;
				}
				.subkeyword-description {
					color: var(--text-muted);
					font-size: 0.9em;
				}
			`;
			document.head.appendChild(style);
		}
	}

	selectSuggestion(keyword: KeywordStyle, evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;

		const editor = this.context.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// Find // trigger
		const slashIndex = line.lastIndexOf('//');
		if (slashIndex === -1) return;

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
			// No :: found - insert at // position
			const presentKeywords = findPresentKeywords(line);
			if (presentKeywords.length > 0) {
				// Find the last keyword position
				const lastKeyword = presentKeywords[presentKeywords.length - 1];
				const lastKeywordIndex = line.toLowerCase().lastIndexOf(lastKeyword.keyword.toLowerCase());
				if (lastKeywordIndex !== -1) {
					insertionPoint = lastKeywordIndex + lastKeyword.keyword.length;
				} else {
					insertionPoint = slashIndex;
				}
			} else {
				insertionPoint = slashIndex;
			}
		}

		// Build the new line
		const beforeInsertion = line.substring(0, insertionPoint);
		const afterInsertion = line.substring(insertionPoint);

		// Remove // from the after part
		const afterWithoutSlash = afterInsertion.replace(/^\/\//, '');

		// Add space before keyword if needed
		const needsSpaceBefore = beforeInsertion.length > 0 && beforeInsertion[beforeInsertion.length - 1] !== ' ';
		const prefix = needsSpaceBefore ? ' ' : '';

		const newLine = `${beforeInsertion}${prefix}${keyword.keyword}${afterWithoutSlash}`;

		// Replace the line
		editor.setLine(cursor.line, newLine);

		// Position cursor after the inserted keyword
		editor.setCursor({
			line: cursor.line,
			ch: insertionPoint + prefix.length + keyword.keyword.length
		});
	}
}
