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
			new ColourSuggestModalWithToggle(plugin.app, settings.colorEntries, (colorEntry, isAll, isGlobal) => {
				if (!isAll && colorEntry) {
					// Generate class name from CC (color class)
					const className = isGlobal
						? `gr${colorEntry.cc}`  // Global Reference: grr, grb, etc.
						: `lr${colorEntry.cc}`;  // Local Reference: lrr, lrb, etc.
					// Wrap selected text in mark tag with the reference class
					editor.replaceSelection(`<mark class="${className}">${selectedText}</mark>`);
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
			new ColourSuggestModalWithToggle(plugin.app, settings.colorEntries, (colorEntry, isAll, isGlobal) => {
				if (isAll) {
					// Generate list of all emojis
					let emojiList = '';
					settings.colorEntries.forEach(c => {
						const emoji = isGlobal ? c.grIcon : c.lrIcon;
						emojiList += `- ${emoji}\n`;
					});
					const cursor = editor.getCursor();
					editor.replaceRange(emojiList, cursor);
				} else if (colorEntry) {
					if (isGlobal) {
						// Insert global reference emoji on current line
						const emoji = colorEntry.grIcon;
						const cursor = editor.getCursor();
						editor.replaceRange(emoji, cursor);
					} else {
						// Update code block header with CC (color class)
						const currentCursor = editor.getCursor();
						updateCodeBlockHeader(editor, codeBlockInfo, colorEntry.cc, currentCursor.line);
					}
				}
			}, true, false).open(); // true = reference mode, false = not text selection
		} else {
			// Not in code block - go directly to color selection with Tab toggle for values
			new ColourSuggestModalWithToggle(plugin.app, settings.colorEntries, (colorEntry, isAll, isGlobal) => {
				if (isAll) {
					// Generate list of all emojis
					let emojiList = '';
					settings.colorEntries.forEach(c => {
						const emoji = isGlobal ? c.gvIcon : c.lvIcon;
						emojiList += `- ${emoji}\n`;
					});
					const cursor = editor.getCursor();
					editor.replaceRange(emojiList, cursor);
				} else if (colorEntry) {
					// Insert the emoji
					const emoji = isGlobal ? colorEntry.gvIcon : colorEntry.lvIcon;
					const cursor = editor.getCursor();
					editor.replaceRange(emoji, cursor);
				}
			}, false, false).open(); // false = value mode, false = not text selection
		}
	};
}
