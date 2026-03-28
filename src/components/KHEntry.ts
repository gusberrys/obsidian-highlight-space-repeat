import { Component, MarkdownRenderer } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { ParsedEntry, ParsedFile, ParsedEntrySubItem } from '../interfaces/ParsedFile';
import { isIKeyword } from '../shared/vword';

/**
 * Shared component for rendering keyword records with images and quotes
 * Adapted from knowledge-base plugin
 */
export class KHEntry {
	/**
	 * Check if entry has an i-keyword and return it
	 * i-keywords control image column width (i10-i90)
	 */
	private static getIKeyword(entry: ParsedEntry): string | null {
		if (!entry.keywords) return null;

		for (const keyword of entry.keywords) {
			if (isIKeyword(keyword)) {
				return keyword;
			}
		}

		return null;
	}

	/**
	 * Apply basic markdown formatting to text content
	 * Copied from knowledge-base plugin
	 */
	private static applyBasicFormatting(text: string): string {
		let result = text;

		// Step 1: Protect inline code by temporarily replacing with placeholders
		// Use a placeholder that won't be matched by markdown patterns
		const codeBlocks: string[] = [];
		result = result.replace(/`(.+?)`/g, (match, code) => {
			const placeholder = `§§§CODEBLOCK${codeBlocks.length}§§§`;
			codeBlocks.push(`<code>${code}</code>`);
			return placeholder;
		});

		// Step 2: Apply other markdown formatting
		// Bold: **text** or __text__
		result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

		// Italic: *text* or _text_ (but not ** or __)
		result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
		result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

		// Strikethrough: ~~text~~
		result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');

		// Highlight: ==text== (Obsidian syntax)
		result = result.replace(/==(.+?)==/g, '<mark class="exa">$1</mark>');

		// Step 3: Restore code blocks from placeholders
		codeBlocks.forEach((code, index) => {
			result = result.replace(`§§§CODEBLOCK${index}§§§`, code);
		});

		return result;
	}
	/**
	 * Render a keyword record entry with support for images and blockquotes
	 */
	static renderKeywordEntry(
		container: HTMLElement,
		entry: ParsedEntry,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin,
		compact: boolean = false
	): Promise<void> {
		// Add compact/full mode class
		const modeClass = compact ? 'kh-entry-compact' : 'kh-entry-full';
		container.addClass(modeClass);

		// Add entry keywords as classes (including VWord keywords like r123, i67)
		if (entry.keywords && entry.keywords.length > 0) {
			entry.keywords.forEach(kw => {
				container.addClass(kw);
			});
		}

		// Check for image embeds (not block references with # or ^)
		const imageEmbedRegex = /!\[\[([^\]|#^]+?)(?:\|(\d+))?\]\]/g;
		const imageMatches = [...entry.text.matchAll(imageEmbedRegex)];

		// Check if entry contains ONLY an image embed (nothing else besides whitespace)
		const imageOnlyRegex = /^\s*!\[\[([^\]|#^]+?)(?:\|(\d+))?\]\]\s*$/;
		const imageOnlyMatch = entry.text.match(imageOnlyRegex);

		if (imageOnlyMatch) {
			// Entry contains only an image - render the image directly
			return this.renderImageOnly(container, imageOnlyMatch, record, plugin);
		}

		// Check for block references (e.g., ![[File#^blockid]])
		const blockRefRegex = /!\[\[([^\]]+?)#\^([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
		const blockRefMatches = [...entry.text.matchAll(blockRefRegex)];

		if (blockRefMatches.length > 0) {
			// Entry contains block reference(s) - resolve and render all of them
			return this.renderWithMultipleBlockReferences(container, entry, record, plugin, blockRefMatches, compact);
		}

		// Check for blockquotes (lines starting with >)
		const blockquoteRegex = /^>\s+.+$/gm;
		const hasBlockquotes = blockquoteRegex.test(entry.text);

		// If no images and no blockquotes, render normally
		if (imageMatches.length === 0 && !hasBlockquotes) {
			return this.renderNormalText(container, entry, record, plugin, compact);
		}

		// Check if images are on same line as text (inline) or on separate lines
		const lines = entry.text.split('\n');
		let hasInlineImages = false;

		for (const match of imageMatches) {
			const imageEmbed = match[0];
			// Check if this image is on a line with other content
			for (const line of lines) {
				if (line.includes(imageEmbed)) {
					const lineWithoutImage = line.replace(imageEmbed, '').trim();
					// If line has content beyond the image (excluding just > or - markers)
					if (lineWithoutImage && !lineWithoutImage.match(/^[>\-\*]\s*$/)) {
						hasInlineImages = true;
						break;
					}
				}
			}
			if (hasInlineImages) break;
		}

		// If images are on separate lines (not inline), render normally with markdown
		if (!hasInlineImages) {
			return this.renderNormalText(container, entry, record, plugin, compact);
		}

		// If only blockquotes (no inline images), extract quotes to right column
		if (!hasInlineImages && hasBlockquotes) {
			this.renderTextWithQuotes(container, entry, record, plugin, compact);
			return Promise.resolve();
		}

		// Extract inline images and remove them from text for two-column layout
		return this.renderTextWithImages(container, entry, record, plugin, imageMatches, compact);
	}

	/**
	 * Render image-only entry (when entry contains only an image embed)
	 */
	private static renderImageOnly(
		container: HTMLElement,
		imageMatch: RegExpMatchArray,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin
	): Promise<void> {
		const filename = imageMatch[1];
		const width = imageMatch[2];

		// Resolve the file using Obsidian's API
		const file = plugin.app.metadataCache.getFirstLinkpathDest(filename, record.filePath);

		if (file) {
			const resourcePath = plugin.app.vault.getResourcePath(file);
			const imgEl = container.createEl('img', {
				cls: 'kh-image-only',
				attr: {
					src: resourcePath,
					alt: filename
				}
			});

			if (width) {
				imgEl.style.width = `${width}px`;
			} else {
				// Default max width for image-only entries
				imgEl.style.maxWidth = '100%';
			}
		} else {
			// Image file not found - show the raw text as fallback
			const span = container.createSpan({ cls: 'kh-entry-text' });
			span.textContent = imageMatch[0];
		}

		return Promise.resolve();
	}

	/**
	 * Render entry with block reference resolved
	 */
	private static async renderWithBlockReference(
		container: HTMLElement,
		entry: ParsedEntry,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin,
		blockRefMatch: RegExpMatchArray,
		compact: boolean
	): Promise<void> {
		const filePath = blockRefMatch[1];
		const blockId = blockRefMatch[2];
		const blockRefText = blockRefMatch[0];

		// Resolve the file
		const file = plugin.app.metadataCache.getFirstLinkpathDest(filePath, record.filePath);

		if (!file) {
			// File not found - render normally
			return this.renderNormalText(container, entry, record, plugin, compact);
		}

		try {
			// Read the file content
			const content = await plugin.app.vault.read(file as any);

			// Find the block with this ID
			// Block IDs are at the end of a line: "some text ^blockid"
			const blockRegex = new RegExp(`^(.+?)\\s*\\^${blockId}\\s*$`, 'm');
			const blockMatch = content.match(blockRegex);

			if (blockMatch) {
				const blockContent = blockMatch[1].trim();

				// Remove the block reference from the entry text
				const textWithoutBlockRef = entry.text.replace(blockRefText, '').trim();

				// If there's text before the block reference, render it first
				if (textWithoutBlockRef) {
					// Check what type of content is in the remaining text
					const hasWikilinks = /(?<!!)\[\[([^\]]+)\]\]/.test(textWithoutBlockRef);
					const hasMarkdownLinks = /\[([^\]]+)\]\(([^\)]+)\)/.test(textWithoutBlockRef);
					const hasLaTeX = /\$\$?.+?\$\$?/.test(textWithoutBlockRef);

					if (compact && !hasLaTeX) {
						// COMPACT mode: Use inline rendering for wikilinks
						if (hasWikilinks || hasMarkdownLinks) {
							this.renderInlineWithLinks(container, textWithoutBlockRef, record.filePath, plugin, 'kh-entry-text');
						} else {
							const textEl = container.createSpan({ cls: 'kh-entry-text' });
							const formatted = this.applyBasicFormatting(textWithoutBlockRef);
							textEl.innerHTML = formatted;
						}
					} else {
						// FULL mode OR has LaTeX: Use MarkdownRenderer for proper rendering
						const textEl = container.createDiv({ cls: 'kh-entry-text' });
						await MarkdownRenderer.render(
							plugin.app,
							textWithoutBlockRef,
							textEl,
							record.filePath,
							new Component() as any
						);
					}
				}

				// Create a blockquote-style container for the block reference
				const quoteEl = container.createEl('blockquote', { cls: 'kh-block-reference-quote' });

				// Render the block content as markdown
				await MarkdownRenderer.render(
					plugin.app,
					blockContent,
					quoteEl,
					filePath,
					new Component() as any
				);
			} else {
				// Block not found - render normally
				return this.renderNormalText(container, entry, record, plugin, compact);
			}
		} catch (error) {
			console.error('Failed to resolve block reference:', error);
			// Error reading file - render normally
			return this.renderNormalText(container, entry, record, plugin, compact);
		}
	}

	/**
	 * Render entry with multiple block references resolved
	 * Processes all block references in the entry text and renders them in order
	 * Also detects images and creates two-column layout if images are present
	 */
	private static async renderWithMultipleBlockReferences(
		container: HTMLElement,
		entry: ParsedEntry,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin,
		blockRefMatches: RegExpMatchArray[],
		compact: boolean
	): Promise<void> {
		// Build segments: text between block references
		const segments: Array<{ type: 'text' | 'blockref'; content: string; match?: RegExpMatchArray }> = [];
		let lastIndex = 0;

		for (const match of blockRefMatches) {
			// Add text segment before this block reference
			if (match.index !== undefined && match.index > lastIndex) {
				const textSegment = entry.text.substring(lastIndex, match.index);
				if (textSegment.trim()) {
					segments.push({ type: 'text', content: textSegment });
				}
			}

			// Add block reference segment
			segments.push({ type: 'blockref', content: match[0], match });

			// Update last index
			if (match.index !== undefined) {
				lastIndex = match.index + match[0].length;
			}
		}

		// Add remaining text after last block reference
		if (lastIndex < entry.text.length) {
			const textSegment = entry.text.substring(lastIndex);
			if (textSegment.trim()) {
				segments.push({ type: 'text', content: textSegment });
			}
		}

		// Scan all text segments for images
		const imageEmbedRegex = /!\[\[([^\]|#^]+?)(?:\|(\d+))?\]\]/g;
		const images: Array<{ path: string; width?: string }> = [];
		let textWithoutImages = '';

		for (const segment of segments) {
			if (segment.type === 'text') {
				// Extract images from this text segment
				const imageMatches = [...segment.content.matchAll(imageEmbedRegex)];
				let segmentText = segment.content;

				for (const match of imageMatches) {
					const filename = match[1];
					const width = match[2];

					// Resolve the file
					const file = plugin.app.metadataCache.getFirstLinkpathDest(filename, record.filePath);
					if (file) {
						const resourcePath = plugin.app.vault.getResourcePath(file);
						images.push({ path: resourcePath, width });
						// Remove image from text
						segmentText = segmentText.replace(match[0], '');
					}
				}

				textWithoutImages += segmentText;
			}
		}

		// Check if entry has an i-keyword (required for two-column layout)
		const iKeyword = this.getIKeyword(entry);

		// If images found AND i-keyword present, use two-column layout
		if (images.length > 0 && iKeyword) {
			const twoColumnWrapper = container.createDiv({ cls: `kh-record-with-images ${iKeyword}` });

			// Left column: quotes and text
			const textColumn = twoColumnWrapper.createDiv({ cls: 'kh-record-text-column' });

			// Render all segments (quotes + text) in left column
			for (const segment of segments) {
				if (segment.type === 'text') {
					// Remove images from text and render
					let textContent = segment.content;
					const imageMatches = [...segment.content.matchAll(imageEmbedRegex)];
					for (const match of imageMatches) {
						textContent = textContent.replace(match[0], '');
					}

					if (textContent.trim()) {
						const hasWikilinks = /(?<!!)\[\[([^\]]+)\]\]/.test(textContent);
						const hasMarkdownLinks = /\[([^\]]+)\]\(([^\)]+)\)/.test(textContent);
						const hasLaTeX = /\$\$?.+?\$\$?/.test(textContent);

						if (compact && !hasLaTeX) {
							if (hasWikilinks || hasMarkdownLinks) {
								this.renderInlineWithLinks(textColumn, textContent.trim(), record.filePath, plugin, 'kh-entry-text');
							} else {
								const textEl = textColumn.createSpan({ cls: 'kh-entry-text' });
								const formatted = this.applyBasicFormatting(textContent.trim());
								textEl.innerHTML = formatted;
							}
						} else {
							const textEl = textColumn.createDiv({ cls: 'kh-entry-text' });
							await MarkdownRenderer.render(
								plugin.app,
								textContent.trim(),
								textEl,
								record.filePath,
								new Component() as any
							);
						}
					}
				} else if (segment.type === 'blockref' && segment.match) {
					// Render block reference in left column
					const filePath = segment.match[1];
					const blockId = segment.match[2];
					const file = plugin.app.metadataCache.getFirstLinkpathDest(filePath, record.filePath);

					if (file) {
						try {
							const content = await plugin.app.vault.read(file as any);
							const blockRegex = new RegExp(`^(.+?)\\s*\\^${blockId}\\s*$`, 'm');
							const blockMatch = content.match(blockRegex);

							if (blockMatch) {
								const blockContent = blockMatch[1].trim();
								const quoteEl = textColumn.createEl('blockquote', { cls: 'kh-block-reference-quote' });
								await MarkdownRenderer.render(
									plugin.app,
									blockContent,
									quoteEl,
									filePath,
									new Component() as any
								);
							}
						} catch (error) {
							console.error('Failed to resolve block reference:', error);
						}
					}
				}
			}

			// Right column: images
			const imageColumn = twoColumnWrapper.createDiv({ cls: 'kh-record-image-column' });
			for (const img of images) {
				const imgEl = imageColumn.createEl('img', {
					cls: 'kh-embedded-image',
					attr: {
						src: img.path,
						alt: 'Embedded image'
					}
				});

				if (img.width) {
					imgEl.style.width = `${img.width}px`;
				}
			}
		} else {
			// No images OR no i-keyword - render segments in order (single column)
			// If images exist but no i-keyword, they'll be rendered inline with text
			for (const segment of segments) {
				if (segment.type === 'text') {
					const hasWikilinks = /(?<!!)\[\[([^\]]+)\]\]/.test(segment.content);
					const hasMarkdownLinks = /\[([^\]]+)\]\(([^\)]+)\)/.test(segment.content);
					const hasLaTeX = /\$\$?.+?\$\$?/.test(segment.content);

					if (compact && !hasLaTeX) {
						if (hasWikilinks || hasMarkdownLinks) {
							this.renderInlineWithLinks(container, segment.content.trim(), record.filePath, plugin, 'kh-entry-text');
						} else {
							const textEl = container.createSpan({ cls: 'kh-entry-text' });
							const formatted = this.applyBasicFormatting(segment.content.trim());
							textEl.innerHTML = formatted;
						}
					} else {
						const textEl = container.createDiv({ cls: 'kh-entry-text' });
						await MarkdownRenderer.render(
							plugin.app,
							segment.content.trim(),
							textEl,
							record.filePath,
							new Component() as any
						);
					}
				} else if (segment.type === 'blockref' && segment.match) {
					const filePath = segment.match[1];
					const blockId = segment.match[2];
					const file = plugin.app.metadataCache.getFirstLinkpathDest(filePath, record.filePath);

					if (file) {
						try {
							const content = await plugin.app.vault.read(file as any);
							const blockRegex = new RegExp(`^(.+?)\\s*\\^${blockId}\\s*$`, 'm');
							const blockMatch = content.match(blockRegex);

							if (blockMatch) {
								const blockContent = blockMatch[1].trim();
								const quoteEl = container.createEl('blockquote', { cls: 'kh-block-reference-quote' });
								await MarkdownRenderer.render(
									plugin.app,
									blockContent,
									quoteEl,
									filePath,
									new Component() as any
								);
							} else {
								const textEl = container.createSpan({ cls: 'kh-entry-text' });
								textEl.textContent = segment.content;
							}
						} catch (error) {
							console.error('Failed to resolve block reference:', error);
							const textEl = container.createSpan({ cls: 'kh-entry-text' });
							textEl.textContent = segment.content;
						}
					} else {
						const textEl = container.createSpan({ cls: 'kh-entry-text' });
						textEl.textContent = segment.content;
					}
				}
			}
		}

		// Render sub-items after block references
		if (entry.subItems && entry.subItems.length > 0) {
			await this.renderSubItems(container, entry.subItems, record, plugin);
		}
	}

	/**
	 * Manually parse wikilinks and create internal link elements (inline, no block tags)
	 */
	private static renderInlineWithWikilinks(
		container: HTMLElement,
		text: string,
		filePath: string,
		plugin: HighlightSpaceRepeatPlugin
	): void {
		const span = container.createSpan({ cls: 'kh-entry-text' });

		// Parse wikilinks: [[link|alias]] or [[link]]
		const wikilinkRegex = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = wikilinkRegex.exec(text)) !== null) {
			// Add text before wikilink
			if (match.index > lastIndex) {
				const beforeText = text.substring(lastIndex, match.index);
				const formatted = this.applyBasicFormatting(beforeText);
				const tempSpan = span.createSpan();
				tempSpan.innerHTML = formatted;
			}

			// Create internal link
			const linkPath = match[1];
			const linkText = match[2] || match[1];
			const link = span.createEl('a', {
				cls: 'internal-link',
				text: linkText,
				attr: {
					'data-href': linkPath,
					'href': linkPath,
					'target': '_blank',
					'rel': 'noopener'
				}
			});

			// Make link clickable
			link.addEventListener('click', (e) => {
				e.preventDefault();
				const file = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, filePath);
				if (file) {
					plugin.app.workspace.getLeaf().openFile(file as any);
				}
			});

			lastIndex = wikilinkRegex.lastIndex;
		}

		// Add remaining text after last wikilink
		if (lastIndex < text.length) {
			const afterText = text.substring(lastIndex);
			const formatted = this.applyBasicFormatting(afterText);
			const tempSpan = span.createSpan();
			tempSpan.innerHTML = formatted;
		}
	}

	/**
	 * Manually parse wikilinks and markdown links inline (for sub-items)
	 */
	private static renderInlineWithLinks(
		container: HTMLElement,
		text: string,
		filePath: string,
		plugin: HighlightSpaceRepeatPlugin,
		className: string = 'kh-subitem-content'
	): void {
		const span = container.createSpan({ cls: className });

		// Combined regex to match both wikilinks and markdown links
		// Wikilinks: [[link|alias]] or [[link]]
		// Markdown links: [text](url)
		const combinedRegex = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^\)]+)\)/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = combinedRegex.exec(text)) !== null) {
			// Add text before link
			if (match.index > lastIndex) {
				const beforeText = text.substring(lastIndex, match.index);
				const formatted = this.applyBasicFormatting(beforeText);
				const tempSpan = span.createSpan();
				tempSpan.innerHTML = formatted;
			}

			// Check if it's a wikilink or markdown link
			if (match[1]) {
				// Wikilink: [[link|alias]] or [[link]]
				const linkPath = match[1];
				const linkText = match[2] || match[1];
				const link = span.createEl('a', {
					cls: 'internal-link',
					text: linkText,
					attr: {
						'data-href': linkPath,
						'href': linkPath,
						'target': '_blank',
						'rel': 'noopener'
					}
				});

				// Make link clickable
				link.addEventListener('click', (e) => {
					e.preventDefault();
					const file = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, filePath);
					if (file) {
						plugin.app.workspace.getLeaf().openFile(file as any);
					}
				});
			} else if (match[3] && match[4]) {
				// Markdown link: [text](url)
				const linkText = match[3];
				const linkUrl = match[4];
				span.createEl('a', {
					cls: 'external-link',
					text: linkText,
					attr: {
						'href': linkUrl,
						'target': '_blank',
						'rel': 'noopener'
					}
				});
			}

			lastIndex = combinedRegex.lastIndex;
		}

		// Add remaining text after last link
		if (lastIndex < text.length) {
			const afterText = text.substring(lastIndex);
			const formatted = this.applyBasicFormatting(afterText);
			const tempSpan = span.createSpan();
			tempSpan.innerHTML = formatted;
		}
	}

	/**
	 * Render normal text without special layout
	 * COMPACT mode: Manual inline rendering for wikilinks (no block tags)
	 * FULL mode: Use MarkdownRenderer for complex markdown
	 */
	private static async renderNormalText(
		container: HTMLElement,
		entry: ParsedEntry,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin,
		compact: boolean = false
	): Promise<void> {
		// Check if we need markdown rendering
		const hasWikilinks = entry.text && /(?<!!)\[\[([^\]]+)\]\]/.test(entry.text); // Non-image wikilinks
		const hasBlockquotes = entry.text && /^>\s+.+$/gm.test(entry.text);
		const hasLaTeX = entry.text && /\$\$?.+?\$\$?/.test(entry.text); // LaTeX math expressions
		const hasCodeWithParams = entry.text && /`\{[^}]+\}/.test(entry.text); // Inline code with parameters (code-styler syntax)

		if (compact) {
			// COMPACT MODE: Manual inline rendering for wikilinks (no block tags)
			// Use MarkdownRenderer for blockquotes, code-styler syntax
			if (hasBlockquotes || hasCodeWithParams) {
				// Content needs markdown post-processors - use MarkdownRenderer
				const textEl = container.createSpan({ cls: 'kh-entry-text' });
				await MarkdownRenderer.render(
					plugin.app,
					entry.text,
					textEl,
					record.filePath,
					new Component() as any
				);
			} else if (hasWikilinks) {
				// Parse regular wikilinks manually to keep everything inline
				this.renderInlineWithWikilinks(container, entry.text, record.filePath, plugin);
			} else {
				// No special content - use fast innerHTML with basic formatting
				const span = container.createSpan({ cls: 'kh-entry-text' });
				const formattedText = this.applyBasicFormatting(entry.text);
				span.innerHTML = formattedText;
			}

			// Sub-items (compact mode - render inline)
			if (entry.subItems && entry.subItems.length > 0) {
				await this.renderSubItems(container, entry.subItems, record, plugin);
			}
		} else {
			// FULL MODE: Use inline rendering for wikilinks, MarkdownRenderer only for block content
			const hasMarkdownLinks = entry.text && /\[([^\]]+)\]\(([^\)]+)\)/.test(entry.text); // Markdown links [text](url)

			// Create text wrapper (same pattern as KB)
			const textEl = container.createSpan({ cls: 'kh-record-text' });

			// Render only primary keyword icon (highest priority)
			if (entry.keywords && entry.keywords.length > 0) {
				const primaryKeyword = entry.keywords[0];
				const mark = textEl.createEl('mark', { cls: `kh-icon ${primaryKeyword}` });
				mark.innerHTML = '&nbsp;';
				textEl.createEl('span', { text: ' ', cls: 'kh-separator' });
			}

			// Text goes in same parent as icons (inline sibling)
			// Use MarkdownRenderer ONLY for blockquotes/LaTeX (block-level content)
			// Use inline rendering for wikilinks to avoid <p> tags
			if (hasBlockquotes || hasLaTeX) {
				// Block content - use MarkdownRenderer
				const textContainer = textEl.createSpan();
				await MarkdownRenderer.render(
					plugin.app,
					entry.text,
					textContainer,
					record.filePath,
					new Component() as any
				);
			} else if (hasWikilinks || hasMarkdownLinks) {
				// Inline wikilinks/markdown links - use manual inline parsing to avoid <p> tags
				this.renderInlineWithLinks(textEl, entry.text, record.filePath, plugin, '');
			} else {
				// No special markdown - use fast innerHTML with basic formatting
				const textContainer = textEl.createSpan();
				const formattedText = this.applyBasicFormatting(entry.text);
				textContainer.innerHTML = formattedText;
			}

			// Sub-items (on new line after text wrapper)
			if (entry.subItems && entry.subItems.length > 0) {
				await this.renderSubItems(container, entry.subItems, record, plugin);
			}
		}
	}

	/**
	 * Render text with embedded images in two-column layout
	 */
	private static async renderTextWithImages(
		container: HTMLElement,
		entry: ParsedEntry,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin,
		imageMatches: RegExpMatchArray[],
		compact: boolean = false
	): Promise<void> {
		const images: Array<{ path: string; width?: string }> = [];
		let textWithoutImages = entry.text;

		// Remove images from text
		for (const match of imageMatches) {
			const fullMatch = match[0];
			const filename = match[1];
			const width = match[2];

			// Resolve the file using Obsidian's API
			const file = plugin.app.metadataCache.getFirstLinkpathDest(filename, record.filePath);

			if (file) {
				const resourcePath = plugin.app.vault.getResourcePath(file);
				images.push({ path: resourcePath, width });
				textWithoutImages = textWithoutImages.replace(fullMatch, ''); // Remove image from text
			}
		}

		if (images.length === 0) {
			// No valid images found
			await this.renderNormalText(container, entry, record, plugin, compact);
			return;
		}

		// Check if entry has an i-keyword (required for two-column layout)
		const iKeyword = this.getIKeyword(entry);

		if (!iKeyword) {
			// No i-keyword - render normally without two-column layout
			await this.renderNormalText(container, entry, record, plugin, compact);
			return;
		}

		// Create two-column layout wrapper with i-keyword class
		const twoColumnWrapper = container.createDiv({ cls: `kh-record-with-images ${iKeyword}` });

		// Left side: text content
		const textColumn = twoColumnWrapper.createDiv({ cls: 'kh-record-text-column' });

		if (textWithoutImages.trim()) {
			// Use MarkdownRenderer directly (KB plugin pattern)
			await MarkdownRenderer.render(
				plugin.app,
				textWithoutImages.trim(),
				textColumn,
				record.filePath,
				new Component() as any
			);
		}

		// Right side: images
		const imageColumn = twoColumnWrapper.createDiv({ cls: 'kh-record-image-column' });
		for (const img of images) {
			const imgEl = imageColumn.createEl('img', {
				cls: 'kh-embedded-image',
				attr: {
					src: img.path,
					alt: 'Embedded image'
				}
			});

			if (img.width) {
				imgEl.style.width = `${img.width}px`;
			}
		}

		// Render sub-items after the two-column layout
		if (entry.subItems && entry.subItems.length > 0) {
			await this.renderSubItems(container, entry.subItems, record, plugin);
		}
	}

	/**
	 * Render text with blockquotes in two-column layout
	 * Quotes go in right column when no images present
	 */
	private static renderTextWithQuotes(
		container: HTMLElement,
		entry: ParsedEntry,
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin,
		compact: boolean = false
	): void {
		// Extract blockquotes from text
		const lines = entry.text.split('\n');
		const quoteLines: string[] = [];
		const textLines: string[] = [];

		for (const line of lines) {
			if (line.trim().startsWith('>')) {
				quoteLines.push(line);
			} else {
				textLines.push(line);
			}
		}

		// Create two-column layout wrapper
		const twoColumnWrapper = container.createDiv({ cls: 'kh-record-with-images' });

		// Left side: text content (without quotes)
		const textColumn = twoColumnWrapper.createDiv({ cls: 'kh-record-text-column' });

		const textWithoutQuotes = textLines.join('\n').trim();
		if (textWithoutQuotes) {
			// Use MarkdownRenderer directly (KB plugin pattern)
			MarkdownRenderer.render(
				plugin.app,
				textWithoutQuotes,
				textColumn,
				record.filePath,
				new Component() as any
			);
		}

		// Right side: blockquotes
		const quoteColumn = twoColumnWrapper.createDiv({ cls: 'kh-record-image-column' });
		const quotesText = quoteLines.join('\n');
		if (quotesText) {
			// Fire and forget - NO await
			MarkdownRenderer.renderMarkdown(
				quotesText,
				quoteColumn,
				record.filePath,
				plugin as any
			);
		}

		// Render sub-items after the two-column layout
		if (entry.subItems && entry.subItems.length > 0) {
			this.renderSubItems(container, entry.subItems, record, plugin);
		}
	}

	/**
	 * Render sub-items (list items, blockquotes, code blocks)
	 */
	private static renderSubItems(
		container: HTMLElement,
		subItems: ParsedEntrySubItem[],
		record: ParsedFile,
		plugin: HighlightSpaceRepeatPlugin
	): Promise<void> {
		const subItemsContainer = container.createDiv({ cls: 'kh-sub-items' });

		// SYNC for loop - copied from KB
		for (let i = 0; i < subItems.length; i++) {
			const subItem = subItems[i];
			const subItemEl = subItemsContainer.createDiv({ cls: `kh-sub-item kh-sub-item-${subItem.listType}` });

			// Add keywords as classes if present
			if (subItem.keywords && subItem.keywords.length > 0) {
				subItem.keywords.forEach(kw => {
					subItemEl.addClass(kw);
				});
			}

			// Check if this is a code block sub-item
			const isCodeBlock = subItem.listType === 'code-block';

			if (isCodeBlock) {
				// Code block - fire and forget
				const codeMarkdown = '```' + (subItem.codeBlockLanguage || '') + '\n' + subItem.content + '\n```';
				MarkdownRenderer.renderMarkdown(
					codeMarkdown,
					subItemEl,
					record.filePath,
					plugin as any
				);
			} else {
				// Regular list item: marker → icon → content (KB pattern)
				let marker = '• ';
				if (subItem.listType === 'numbered') marker = `${i + 1}. `;
				else if (subItem.listType === 'checkbox') marker = subItem.checked ? '☑ ' : '☐ ';
				else if (subItem.listType === 'blockquote') marker = '> ';

				const markerSpan = subItemEl.createSpan({ cls: 'kh-subitem-marker' });
				markerSpan.textContent = marker;

				// Show only primary keyword icon (highest priority) if present (AFTER marker, BEFORE content)
				if (subItem.keywords && subItem.keywords.length > 0) {
					const primaryKeyword = subItem.keywords[0];
					const iconSpan = subItemEl.createEl('mark', { cls: `kh-icon ${primaryKeyword}` });
					iconSpan.innerHTML = '&nbsp;';
					subItemEl.createEl('span', { text: ' ', cls: 'kh-separator' });
				}

				// Content with inline link parsing (keeps everything inline, no <p> tags)
				// Check for image embeds first
				const imageEmbedRegex = /^\s*!\[\[([^\]|#^]+?)(?:\|(\d+))?\]\]\s*$/;
				const imageMatch = subItem.content.match(imageEmbedRegex);

				if (imageMatch) {
					// Sub-item contains only an image - render it
					const filename = imageMatch[1];
					const width = imageMatch[2];

					// Resolve the file using Obsidian's API
					const file = plugin.app.metadataCache.getFirstLinkpathDest(filename, record.filePath);

					if (file) {
						const resourcePath = plugin.app.vault.getResourcePath(file);
						const imgEl = subItemEl.createEl('img', {
							cls: 'kh-subitem-image',
							attr: {
								src: resourcePath,
								alt: filename
							}
						});

						if (width) {
							imgEl.style.width = `${width}px`;
						} else {
							// Default max width for sub-item images
							imgEl.style.maxWidth = '100%';
						}
					} else {
						// Image file not found - show the raw text as fallback
						const contentSpan = subItemEl.createSpan({ cls: 'kh-subitem-content' });
						contentSpan.textContent = subItem.content;
					}
				} else {
					// Not an image - check for wikilinks and markdown links
					const hasWikilinks = /(?<!!)\[\[([^\]]+)\]\]/.test(subItem.content);
					const hasMarkdownLinks = /\[([^\]]+)\]\(([^\)]+)\)/.test(subItem.content);

					if (hasWikilinks || hasMarkdownLinks) {
						// Use manual inline link parsing to avoid block <p> tags
						this.renderInlineWithLinks(subItemEl, subItem.content, record.filePath, plugin);
					} else {
						// Basic formatting only
						const contentSpan = subItemEl.createSpan({ cls: 'kh-subitem-content' });
						const formattedContent = this.applyBasicFormatting(subItem.content);
						contentSpan.innerHTML = formattedContent;
					}
				}
			}

			// Render nested code block if present - NO AWAIT
			if (subItem.nestedCodeBlock) {
				const nestedCodeEl = subItemEl.createDiv({ cls: 'kh-nested-code' });
				const nestedCodeMarkdown = '```' + (subItem.nestedCodeBlock.language || '') + '\n' + subItem.nestedCodeBlock.content + '\n```';
				MarkdownRenderer.renderMarkdown(
					nestedCodeMarkdown,
					nestedCodeEl,
					record.filePath,
					plugin as any
				);
			}
		}
		return Promise.resolve();
	}
}
