import { Editor, MarkdownView } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { ColourSuggestModalWithToggle } from './color-modals';
import { detectCodeBlock, updateCodeBlockHeader } from '../utils/color-helpers';
import { get } from 'svelte/store';
import { settingsStore } from '../stores/settings-store';

export function insertColorCommand(plugin: HighlightSpaceRepeatPlugin) {
	return (editor: Editor, view: MarkdownView) => {
		const settings = get(settingsStore);
		const selectedText = editor.getSelection();

		// If text is selected, show toggle between local ref and global ref
		if (selectedText) {
			new ColourSuggestModalWithToggle(plugin.app, settings.colourPairs, (colour, isAll, isGlobal) => {
				if (!isAll && colour) {
					// Use the configured class from settings (L.R. Class or G.R. Class)
					const markClass = isGlobal
						? colour.globalReferenceClass
						: colour.localReferenceClass;
					// Wrap selected text in mark tag with the reference class
					editor.replaceSelection(`<mark class="${markClass}">${selectedText}</mark>`);
				}
				// isAll doesn't make sense for text selection, so ignore it
			}, false, true).open(); // false = value mode, true = for text selection
			return;
		}

		// No text selected
		const cursor = editor.getCursor();
		const codeBlockInfo = detectCodeBlock(editor, cursor.line);

		if (codeBlockInfo.isInBlock) {
			// In code block - go directly to color selection with Tab toggle for references
			new ColourSuggestModalWithToggle(plugin.app, settings.colourPairs, (colour, isAll, isGlobal) => {
				if (isAll) {
					// Generate list of all emojis
					let emojiList = '';
					settings.colourPairs.forEach(c => {
						const emoji = isGlobal ? c.globalReference : c.localReference;
						emojiList += `- ${emoji}\n`;
					});
					const cursor = editor.getCursor();
					editor.replaceRange(emojiList, cursor);
				} else if (colour) {
					if (isGlobal) {
						// Insert global reference emoji on current line
						const emoji = colour.globalReference;
						const cursor = editor.getCursor();
						editor.replaceRange(emoji, cursor);
					} else {
						// Update code block header with current line number for local reference
						// Use localReferenceClass, strip "lr-" or "lr" prefix
						const currentCursor = editor.getCursor();
						let classToUse = colour.localReferenceClass || colour.localName;
						// Strip lr- or lr prefix
						if (classToUse.startsWith('lr-')) {
							classToUse = classToUse.substring(3);
						} else if (classToUse.startsWith('lr')) {
							classToUse = classToUse.substring(2);
						}
						updateCodeBlockHeader(editor, codeBlockInfo, classToUse, currentCursor.line);
					}
				}
			}, true, false).open(); // true = reference mode, false = not text selection
		} else {
			// Not in code block - go directly to color selection with Tab toggle for values
			new ColourSuggestModalWithToggle(plugin.app, settings.colourPairs, (colour, isAll, isGlobal) => {
				if (isAll) {
					// Generate list of all emojis
					let emojiList = '';
					settings.colourPairs.forEach(c => {
						const emoji = isGlobal ? c.globalValue : c.localValue;
						emojiList += `- ${emoji}\n`;
					});
					const cursor = editor.getCursor();
					editor.replaceRange(emojiList, cursor);
				} else if (colour) {
					// Insert the emoji
					const emoji = isGlobal ? colour.globalValue : colour.localValue;
					const cursor = editor.getCursor();
					editor.replaceRange(emoji, cursor);
				}
			}, false, false).open(); // false = value mode, false = not text selection
		}
	};
}
