import { Component, MarkdownRenderer } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { ParsedEntry, ParsedFile, ParsedEntrySubItem } from '../interfaces/ParsedFile';

/**
 * Shared component for rendering keyword records with images and quotes
 * Adapted from knowledge-base plugin
 */
export class KHEntry {
	/**
	 * Apply basic markdown formatting to text content
	 * Kept for potential edge cases
	 */
	private static applyBasicFormatting(text: string): string {
		let result = text;

		// Step 1: Protect inline code by temporarily replacing with placeholders
		const codeBlocks: string[] = [];
		result = result.replace(/`(.+?)`/g, (match, code) => {
			const placeholder = `§§§CODEBLOCK${codeBlocks.length}§§§`;
			codeBlocks.push(`<code>${code}</code>`);
			return placeholder;
		});

		// Step 2: Apply other markdown formatting
		result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');
		result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
		result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
		result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
		result = result.replace(/==(.+?)==/g, '<mark class="exa">$1</mark>');

		// Step 3: Restore code blocks from placeholders
		codeBlocks.forEach((code, index) => {
			result = result.replace(`§§§CODEBLOCK${index}§§§`, code);
		});

		return result;
	}

	/**
	 * Reconstruct markdown from ParsedEntry (entry text + sub-items as list)
	 */
	private static reconstructMarkdown(entry: ParsedEntry): string {
		let markdown = entry.text;

		// Add sub-items as markdown list if present
		if (entry.subItems && entry.subItems.length > 0) {
			markdown += '\n' + this.reconstructSubItemsMarkdown(entry.subItems, 0);
		}

		return markdown;
	}

	/**
	 * Reconstruct sub-items as markdown list (recursive)
	 */
	private static reconstructSubItemsMarkdown(
		subItems: ParsedEntrySubItem[],
		indentLevel: number
	): string {
		const indent = '  '.repeat(indentLevel);
		const lines: string[] = [];

		for (const item of subItems) {
			// List marker based on type
			let marker = '- ';
			if (item.listType === 'numbered') marker = '1. ';
			else if (item.listType === 'checkbox') marker = item.checked ? '- [x] ' : '- [ ] ';
			else if (item.listType === 'blockquote') marker = '> ';
			else if (item.listType === 'code-block') {
				// Code blocks need special handling
				lines.push(indent + '```' + (item.codeBlockLanguage || ''));
				lines.push(indent + item.content);
				lines.push(indent + '```');

				// Handle nested items after code block
				if (item.children && item.children.length > 0) {
					lines.push(this.reconstructSubItemsMarkdown(item.children, indentLevel));
				}
				continue;
			}

			lines.push(indent + marker + item.content);

			// Nested code block
			if (item.nestedCodeBlock) {
				lines.push(indent + '  ```' + (item.nestedCodeBlock.language || ''));
				lines.push(indent + '  ' + item.nestedCodeBlock.content);
				lines.push(indent + '  ```');
			}

			// Recursive children
			if (item.children && item.children.length > 0) {
				lines.push(this.reconstructSubItemsMarkdown(item.children, indentLevel + 1));
			}
		}

		return lines.join('\n');
	}

	/**
	 * Post-process rendered content for layout restructuring
	 * Handles i-keywords (image columns) and l-keywords (list columns)
	 */
	private static async postProcessLayout(
		container: HTMLElement,
		entry: ParsedEntry
	): Promise<void> {
		// Check for i-keyword (image column layout)
		const iKeyword = entry.keywords?.find(kw => /^i\d{2}$/.test(kw));
		if (iKeyword) {
			this.restructureImagesLayout(container, iKeyword);
		}

		// Check for l-keyword (list column layout)
		const lKeyword = entry.keywords?.find(kw => /^l\d{2}$/.test(kw));
		if (lKeyword) {
			// Delay list restructuring (lists render slower)
			setTimeout(() => {
				this.restructureListsLayout(container, lKeyword);
			}, 100);
		}
	}

	/**
	 * Restructure images into two-column layout (adapted from reader-highlighter.ts)
	 */
	private static restructureImagesLayout(container: HTMLElement, iKeyword: string): void {
		// Find images in the rendered content
		const images = Array.from(container.querySelectorAll('img'));

		if (images.length === 0) return;

		// Check if already restructured
		if (container.querySelector('.kh-record-with-images')) return;

		// Create two-column wrapper
		const wrapper = document.createElement('div');
		wrapper.className = `kh-record-with-images ${iKeyword}`;

		// Create text and image columns
		const textColumn = document.createElement('div');
		textColumn.className = 'kh-record-text-column';
		const imageColumn = document.createElement('div');
		imageColumn.className = 'kh-record-image-column';

		// Move content: images to right, text to left
		const childNodes = Array.from(container.childNodes);
		childNodes.forEach((node) => {
			if (node.nodeType === Node.ELEMENT_NODE) {
				const el = node as HTMLElement;

				if (el.tagName === 'IMG') {
					imageColumn.appendChild(el);
				} else if (el.classList.contains('internal-embed') && el.querySelector('img')) {
					imageColumn.appendChild(el);
				} else {
					textColumn.appendChild(el);
				}
			} else {
				textColumn.appendChild(node);
			}
		});

		// Only restructure if both columns have content
		if (textColumn.childNodes.length > 0 && imageColumn.childNodes.length > 0) {
			container.innerHTML = '';
			wrapper.appendChild(textColumn);
			wrapper.appendChild(imageColumn);
			container.appendChild(wrapper);
		}
	}

	/**
	 * Restructure lists into two-column layout (adapted from reader-highlighter.ts)
	 */
	private static restructureListsLayout(container: HTMLElement, lKeyword: string): void {
		// Find list elements
		const lists = container.querySelectorAll('ul, ol');

		lists.forEach(list => {
			const items = Array.from(list.children) as HTMLLIElement[];

			if (items.length < 2) return;

			// Check if already restructured
			if (list.closest('.kh-l-layout')) return;

			// Create wrapper
			const wrapper = document.createElement('div');
			wrapper.className = `kh-l-layout ${lKeyword}`;

			// Create columns
			const leftColumn = document.createElement('div');
			leftColumn.className = 'kh-l-left-column';
			const rightColumn = document.createElement('div');
			rightColumn.className = 'kh-l-right-column';

			// Clone lists
			const leftList = list.cloneNode(false) as HTMLUListElement | HTMLOListElement;
			const rightList = list.cloneNode(false) as HTMLUListElement | HTMLOListElement;
			leftList.innerHTML = '';
			rightList.innerHTML = '';

			// All items except last → left, last item → right
			for (let i = 0; i < items.length - 1; i++) {
				leftList.appendChild(items[i]);
			}
			rightList.appendChild(items[items.length - 1]);

			leftColumn.appendChild(leftList);
			rightColumn.appendChild(rightList);
			wrapper.appendChild(leftColumn);
			wrapper.appendChild(rightColumn);

			// Replace original list
			list.parentNode?.replaceChild(wrapper, list);
		});
	}

	/**
	 * Render a keyword record entry with support for images and blockquotes
	 */
	static async renderKeywordEntry(
		container: HTMLElement,
		entry: ParsedEntry,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin,
		compact: boolean = false
	): Promise<void> {
		// Add compact/full mode class
		container.addClass(compact ? 'kh-entry-compact' : 'kh-entry-full');

		// Add entry keywords as classes (including VWord keywords)
		if (entry.keywords && entry.keywords.length > 0) {
			entry.keywords.forEach(kw => container.addClass(kw));
		}

		// NOTE: Icon rendering is handled by the CALLER (RecordsRenderer, SRSReviewView)
		// Don't add icons here to avoid duplicates

		// Reconstruct full markdown (entry text + sub-items as list)
		const markdown = this.reconstructMarkdown(entry);

		// Create content container
		const contentEl = container.createDiv({ cls: 'kh-entry-content' });

		// Let Obsidian render everything
		await MarkdownRenderer.render(
			plugin.app,
			markdown,
			contentEl,
			record.filePath,
			new Component() as any
		);

		// Post-process for layout restructuring
		await this.postProcessLayout(contentEl, entry);
	}




}
