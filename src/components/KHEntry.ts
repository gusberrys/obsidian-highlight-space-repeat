import { Component, MarkdownRenderer } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { ParsedEntry, ParsedFile, ParsedEntrySubItem } from '../interfaces/ParsedFile';
import { get } from 'svelte/store';
import { keywordsStore } from '../stores/settings-store';

/**
 * Shared component for rendering keyword records with images and quotes
 * Adapted from knowledge-base plugin
 */
export class KHEntry {
	/**
	 * Reconstruct markdown from ParsedEntry (entry text + sub-items as list)
	 * If i-keyword present, extracts images and returns { textMarkdown, images }
	 */
	private static reconstructMarkdown(
		entry: ParsedEntry,
		plugin: HighlightSpaceRepeatPlugin,
		record: ParsedFile
	): { markdown: string; subItemsMarkdown: string; images: Array<{ file: any; width?: string; embed: string; isExcalidraw: boolean }> } {
		let markdown = entry.text;
		const images: Array<{ file: any; width?: string; embed: string; isExcalidraw: boolean }> = [];

		// Check for i-keyword - only extract images if i-keyword present
		const iKeyword = entry.keywords?.find(kw => /^i\d{2}$/.test(kw));

		if (iKeyword) {
			// Extract image embeds: ![[image.png|155]] or ![[image.png]]
			// Only extract images (not block references with # or ^)
			const imageEmbedRegex = /!\[\[([^\]|#^]+?)(?:\|(\d+))?\]\]/g;
			const imageMatches = [...markdown.matchAll(imageEmbedRegex)];

			for (const match of imageMatches) {
				const filename = match[1];
				const width = match[2];

				// Resolve the file
				const file = plugin.app.metadataCache.getFirstLinkpathDest(filename, record.filePath);
				if (file) {
					// Extract images AND excalidraw files
					const ext = file.extension?.toLowerCase();
					// Excalidraw files are stored as .excalidraw.md, so check filename too
					const isExcalidraw = filename.toLowerCase().endsWith('.excalidraw') || file.path.toLowerCase().includes('.excalidraw.');
					const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext);

					if (isImage || isExcalidraw) {
						images.push({ file, width, embed: match[0], isExcalidraw });
						// Remove from markdown
						markdown = markdown.replace(match[0], '');
					}
				}
			}
		}

		// Return sub-items separately (so they can be rendered outside i-keyword wrapper)
		let subItemsMarkdown = '';
		if (entry.subItems && entry.subItems.length > 0) {
			subItemsMarkdown = this.reconstructSubItemsMarkdown(entry.subItems, 0);
		}

		return { markdown, subItemsMarkdown, images };
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
	 * Post-process rendered content for keyword highlighting and l-keyword layout
	 * Note: i-keyword (image columns) is handled upfront in renderKeywordEntry
	 */
	private static async postProcessLayout(
		container: HTMLElement,
		entry: ParsedEntry
	): Promise<void> {
		// Add keyword classes and icon to main entry paragraph
		if (entry.keywords && entry.keywords.length > 0) {
			this.addKeywordClassesToMainEntry(container, entry.keywords);
		}

		// Add keyword classes to rendered sub-items (list items)
		if (entry.subItems && entry.subItems.length > 0) {
			this.addKeywordClassesToSubItems(container, entry.subItems);
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
	 * Add keyword classes and icon to main entry paragraph
	 */
	private static addKeywordClassesToMainEntry(
		container: HTMLElement,
		keywords: string[]
	): void {
		// Find the first paragraph in the entry content
		const firstP = container.querySelector('.kh-entry-content > p');

		if (firstP) {
			// Add keyword classes
			firstP.classList.add('kh-highlighted');
			keywords.forEach(kw => firstP.classList.add(kw));
			firstP.setAttribute('data-keywords', keywords.join(' '));

			// Add icon at the start of the paragraph
			const icon = this.getKeywordIcon(keywords[0]);
			if (icon) {
				const iconSpan = document.createElement('span');
				iconSpan.className = 'kh-normal-keyword-icon';
				iconSpan.textContent = icon + ' ';
				firstP.insertBefore(iconSpan, firstP.firstChild);
			}
		}
	}

	/**
	 * Add keyword classes to rendered list items based on parsed sub-items
	 */
	private static addKeywordClassesToSubItems(
		container: HTMLElement,
		subItems: ParsedEntrySubItem[]
	): void {
		// Find all list items in the rendered content
		const listItems = Array.from(container.querySelectorAll('li'));

		// Flatten sub-items to match list items (depth-first order)
		const flatSubItems = this.flattenSubItems(subItems);

		// Match list items to sub-items by index and add keyword classes
		listItems.forEach((li, index) => {
			if (index < flatSubItems.length) {
				const subItem = flatSubItems[index];

				// Add keyword classes if present
				if (subItem.keywords && subItem.keywords.length > 0) {
					li.classList.add('kh-highlighted');
					subItem.keywords.forEach(kw => li.classList.add(kw));
					li.setAttribute('data-keywords', subItem.keywords.join(' '));

					// Add icon inline like reading view does
					const icon = this.getKeywordIcon(subItem.keywords[0]);
					if (icon) {
						// Find the list bullet span (if it exists)
						const bullet = li.querySelector('.list-bullet');

						// Create icon span
						const iconSpan = document.createElement('span');
						iconSpan.className = 'kh-normal-keyword-icon';
						iconSpan.textContent = icon + ' ';

						// Insert after bullet or at start
						if (bullet && bullet.nextSibling) {
							bullet.parentNode?.insertBefore(iconSpan, bullet.nextSibling);
						} else {
							li.insertBefore(iconSpan, li.firstChild);
						}
					}
				}
			}
		});
	}

	/**
	 * Flatten sub-items tree into depth-first list (matches DOM order)
	 */
	private static flattenSubItems(subItems: ParsedEntrySubItem[]): ParsedEntrySubItem[] {
		const flattened: ParsedEntrySubItem[] = [];

		for (const item of subItems) {
			// Add this item (skip code blocks - they don't render as <li>)
			if (item.listType !== 'code-block') {
				flattened.push(item);
			}

			// Recursively add children
			if (item.children && item.children.length > 0) {
				flattened.push(...this.flattenSubItems(item.children));
			}
		}

		return flattened;
	}

	/**
	 * Get icon for keyword from keywordsStore
	 */
	private static getKeywordIcon(keyword: string): string | null {
		const keywords = get(keywordsStore);

		// Search all categories for this keyword
		for (const category of keywords.categories) {
			for (const kw of category.keywords) {
				if (kw.keyword === keyword && kw.generateIcon) {
					return kw.generateIcon;
				}
			}
		}

		return null;
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

		// Reconstruct markdown (extracts images if i-keyword present)
		const { markdown, subItemsMarkdown, images } = this.reconstructMarkdown(entry, plugin, record);

		// Check for i-keyword
		const iKeyword = entry.keywords?.find(kw => /^i\d{2}$/.test(kw));

		if (iKeyword && images.length > 0) {
			// Two-column layout: text on left, images on right
			const wrapper = container.createDiv({ cls: `kh-record-with-images ${iKeyword}` });
			const textColumn = wrapper.createDiv({ cls: 'kh-record-text-column' });
			const imageColumn = wrapper.createDiv({ cls: 'kh-record-image-column' });

			// Render main text (without sub-items) in left column
			await MarkdownRenderer.render(
				plugin.app,
				markdown,
				textColumn,
				record.filePath,
				new Component() as any
			);

			// Render images in right column
			for (const img of images) {
				if (img.isExcalidraw) {
					// Excalidraw needs MarkdownRenderer to render properly
					await MarkdownRenderer.render(
						plugin.app,
						img.embed, // Use original embed syntax
						imageColumn,
						record.filePath,
						new Component() as any
					);
				} else {
					// Regular images - use img tag
					const resourcePath = plugin.app.vault.getResourcePath(img.file);
					const imgEl = imageColumn.createEl('img', {
						cls: 'kh-embedded-image',
						attr: {
							src: resourcePath,
							alt: img.file.name
						}
					});

					if (img.width) {
						imgEl.style.width = `${img.width}px`;
					}
				}
			}

			// Post-process for keyword classes (main paragraph only)
			await this.postProcessLayout(textColumn, entry);

			// Render sub-items OUTSIDE the two-column wrapper
			if (subItemsMarkdown) {
				const subItemsEl = container.createDiv({ cls: 'kh-entry-subitems' });
				await MarkdownRenderer.render(
					plugin.app,
					subItemsMarkdown,
					subItemsEl,
					record.filePath,
					new Component() as any
				);

				// Add keyword classes to sub-items
				if (entry.subItems && entry.subItems.length > 0) {
					this.addKeywordClassesToSubItems(subItemsEl, entry.subItems);
				}
			}
		} else {
			// No images or no i-keyword - normal rendering (everything together)
			const contentEl = container.createDiv({ cls: 'kh-entry-content' });

			const fullMarkdown = subItemsMarkdown ? markdown + '\n' + subItemsMarkdown : markdown;

			// Let Obsidian render everything
			await MarkdownRenderer.render(
				plugin.app,
				fullMarkdown,
				contentEl,
				record.filePath,
				new Component() as any
			);

			// Post-process for keyword classes and layout restructuring
			await this.postProcessLayout(contentEl, entry);
		}
	}




}
