import { App, TFile } from 'obsidian';
import type { ParsedFile, ParsedHeader, ParsedEntry, ParsedEntrySubItem, FlatEntry, HeaderInfo } from '../interfaces/ParsedFile';
import type { ParserSettings } from '../interfaces/ParserSettings';

/**
 * RecordParser - Hierarchical file parser for highlight-space-repeat
 *
 * Parses markdown files into a 3-level hierarchical structure:
 * File → H1 → H2 → H3
 *
 * Syntax: foo bar baz :: content
 * All keywords before :: are equal (space-separated)
 */
export class RecordParser {
	constructor(private app: App, private parserSettings?: ParserSettings) {}

	/**
	 * Resolve aliases to main keywords and deduplicate
	 */
	private resolveKeywords(keywords: string[], aliasMap?: Map<string, string>): string[] {
		if (!aliasMap || aliasMap.size === 0) {
			return keywords;
		}

		const resolved = keywords.map(kw => {
			const mainKeyword = aliasMap.get(kw);
			return mainKeyword || kw;
		});

		// Deduplicate
		const deduplicated = [...new Set(resolved)];
		return deduplicated;
	}

	/**
	 * Extract keywords from inline <mark class="xxx"> tags
	 * Handles both regular and escaped quotes: <mark class="syn"> or <mark class=\"syn\" x=\"⚒️\">
	 * @param text The text to scan for mark tags
	 * @returns Array of keywords found in mark class attributes
	 */
	private extractInlineKeywords(text: string): string[] {
		const keywords: string[] = [];
		// Match <mark...class="keyword"...> or <mark...class=\"keyword\"...> with any additional attributes
		// Handles escaped quotes and additional attributes like x="⚒️"
		const markRegex = /<mark[^>]*?class\s*=\s*\\?["']([^"'\\]+?)\\?["']/g;
		let match;

		while ((match = markRegex.exec(text)) !== null) {
			const classes = match[1].split(/\s+/);
			// Take all classes as potential keywords
			keywords.push(...classes.filter(c => c.length > 0).map(c => c.toLowerCase()));
		}

		return keywords;
	}

	/**
	 * Parse a file into hierarchical record structure
	 * @param file The file to parse
	 * @param parsedKeywords List of keywords to collect
	 * @param aliasMap Map of alias -> main keyword (optional)
	 * @returns Parsed file with hierarchical headers
	 */
	async parseFile(file: TFile, parsedKeywords: string[], aliasMap?: Map<string, string>): Promise<ParsedFile> {
		const content = await this.app.vault.read(file);
		const lines = content.split('\n');

		// Get file metadata
		const cache = this.app.metadataCache.getFileCache(file);
		const tags: string[] = [];
		const aliases: string[] = [];

		// Extract tags from frontmatter
		if (cache?.frontmatter?.tags) {
			const frontmatterTags = cache.frontmatter.tags;
			if (Array.isArray(frontmatterTags)) {
				tags.push(...frontmatterTags.filter(t => t && typeof t === 'string'));
			} else if (typeof frontmatterTags === 'string') {
				tags.push(frontmatterTags);
			}
		}

		// Extract aliases
		if (cache?.frontmatter?.aliases) {
			const frontmatterAliases = cache.frontmatter.aliases;
			if (Array.isArray(frontmatterAliases)) {
				aliases.push(...frontmatterAliases.filter(a => a && typeof a === 'string'));
			} else if (typeof frontmatterAliases === 'string') {
				aliases.push(frontmatterAliases);
			}
		}

		const flatEntries: FlatEntry[] = [];

		// Track inline tags from content before any headers
		const fileInlineTags = new Set<string>();

		// Track whether we're inside a code block
		let insideCodeBlock = false;

		// Current header context as HeaderInfo (for flat entries)
		let currentH1Info: HeaderInfo | undefined;
		let currentH2Info: HeaderInfo | undefined;
		let currentH3Info: HeaderInfo | undefined;

		// Header context for first-list entries (parent headers only)
		let firstListH1Info: HeaderInfo | undefined;
		let firstListH2Info: HeaderInfo | undefined;
		let firstListH3Info: HeaderInfo | undefined;

		// Track first list after header with keywords
		let firstListAfterKeywordHeader: string[] | null = null;
		let hasSeenContentAfterHeader = false;
		let firstListHeaderEntry: ParsedEntry | null = null;
		let firstListHeaderLineNumber: number | null = null;

		let i = 0;
		while (i < lines.length) {
			const line = lines[i];

			// Parse headers (H1, H2, H3)
			const headerMatch = line.match(/^(#+)\s+(.+)$/);
			if (headerMatch) {
				const level = headerMatch[1].length;
				const headerContent = headerMatch[2];

				if (level === 1) {
				// Finalize any pending first-list header entry
				if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {
					const flatEntry = this.createFlatEntry(firstListHeaderEntry,
						firstListH1Info,
						firstListH2Info,
						firstListH3Info
					);
					flatEntries.push(flatEntry);
					firstListHeaderEntry = null;
				}

				// Parse new H1 header
				const h1Header = this.parseHeader(headerContent, 1, aliasMap);

				// Update header context for flat entries
				currentH1Info = h1Header.text ? {
					text: h1Header.text,
					tags: h1Header.tags,
					keywords: h1Header.keywords || []
				} : undefined;
				currentH2Info = undefined;
				currentH3Info = undefined;

				// Track if header has keywords for first-list conversion
				if (h1Header.keywords && h1Header.keywords.length > 0) {
					firstListAfterKeywordHeader = h1Header.keywords;
					hasSeenContentAfterHeader = false;
					// Create entry for keyword header
					firstListHeaderEntry = {
						type: 'keyword',
						lineNumber: i + 1,
						text: h1Header.text || '',
						keywords: h1Header.keywords,
						subItems: []
					};
					firstListHeaderLineNumber = i + 1;
					// H1 entries have no parent headers
					firstListH1Info = undefined;
					firstListH2Info = undefined;
					firstListH3Info = undefined;
				} else {
					firstListAfterKeywordHeader = null;
					hasSeenContentAfterHeader = false;
					firstListHeaderEntry = null;
					firstListHeaderLineNumber = null;
				}

			} else if (level === 2) {
				// Finalize any pending first-list header entry
				if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {
					const flatEntry = this.createFlatEntry(firstListHeaderEntry,
						firstListH1Info,
						firstListH2Info,
						firstListH3Info
					);
					flatEntries.push(flatEntry);
					firstListHeaderEntry = null;
				}

				// Parse new H2 header
				const h2Header = this.parseHeader(headerContent, 2, aliasMap);

				// Update header context for flat entries
				currentH2Info = h2Header.text ? {
					text: h2Header.text,
					tags: h2Header.tags,
					keywords: h2Header.keywords || []
				} : undefined;
				currentH3Info = undefined;

				// Track if header has keywords for first-list conversion
				if (h2Header.keywords && h2Header.keywords.length > 0) {
					firstListAfterKeywordHeader = h2Header.keywords;
					hasSeenContentAfterHeader = false;
					// Create entry for keyword header
					firstListHeaderEntry = {
						type: 'keyword',
						lineNumber: i + 1,
						text: h2Header.text || '',
						keywords: h2Header.keywords,
						subItems: []
					};
					firstListHeaderLineNumber = i + 1;
					// H2 entries have H1 parent (if it exists)
					firstListH1Info = currentH1Info;
					firstListH2Info = undefined;
					firstListH3Info = undefined;
				} else {
					firstListAfterKeywordHeader = null;
					hasSeenContentAfterHeader = false;
					firstListHeaderEntry = null;
					firstListHeaderLineNumber = null;
				}

			} else if (level === 3) {
				// Finalize any pending first-list header entry
				if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {
					const flatEntry = this.createFlatEntry(firstListHeaderEntry,
						firstListH1Info,
						firstListH2Info,
						firstListH3Info
					);
					flatEntries.push(flatEntry);
					firstListHeaderEntry = null;
				}

				// Parse new H3 header
				const h3Header = this.parseHeader(headerContent, 3, aliasMap);

				// Update header context for flat entries
				currentH3Info = h3Header.text ? {
					text: h3Header.text,
					tags: h3Header.tags,
					keywords: h3Header.keywords || []
				} : undefined;

				// Track if header has keywords for first-list conversion
				if (h3Header.keywords && h3Header.keywords.length > 0) {
					firstListAfterKeywordHeader = h3Header.keywords;
					hasSeenContentAfterHeader = false;
					// Create entry for keyword header
					firstListHeaderEntry = {
						type: 'keyword',
						lineNumber: i + 1,
						text: h3Header.text || '',
						keywords: h3Header.keywords,
						subItems: []
					};
					firstListHeaderLineNumber = i + 1;
					// H3 entries have H1 and H2 parents (if they exist)
					firstListH1Info = currentH1Info;
					firstListH2Info = currentH2Info;
					firstListH3Info = undefined;
				} else {
					firstListAfterKeywordHeader = null;
					hasSeenContentAfterHeader = false;
					firstListHeaderEntry = null;
					firstListHeaderLineNumber = null;
				}
			}

				i++;
				continue;
			}

			// Extract inline tags from non-header lines (only if NOT in code block)
			if (!insideCodeBlock) {
				const tagMatches = line.matchAll(/#([\w-]+)/g);
				for (const match of tagMatches) {
					const tag = match[1];
					// Add to file-level tags (will be included in all entries)
					fileInlineTags.add(tag);
				}
			}

			// NEW RULE: Convert first list after keyword header to subItems of header entry
			if (firstListAfterKeywordHeader && !hasSeenContentAfterHeader && firstListHeaderEntry) {
				// Check if this is a list item
				const listItemMatch = line.match(/^\s*[-*]\s+(.+)$/);
				if (listItemMatch) {
					let itemContent = listItemMatch[1];
					let itemKeywords: string[] | undefined;

					// Check if list item has its own keywords
					const kwMatch = itemContent.match(/^([\w\s]+)::\s*(.*)$/);
					if (kwMatch) {
						const keywordsStr = kwMatch[1].trim();
						const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
						itemKeywords = this.resolveKeywords(parsedKws, aliasMap);
						itemContent = kwMatch[2];

						// If list item has keyword syntax with non-empty content, treat as separate entry
						if (itemContent.trim().length > 0) {
							// Finalize the header entry if it has any subitems
							if (firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {

								// Create flat entry with parent header context
								const flatEntry = this.createFlatEntry(firstListHeaderEntry,
									firstListH1Info,
									firstListH2Info,
									firstListH3Info
								);
								flatEntries.push(flatEntry);
							}
							firstListHeaderEntry = null;
							hasSeenContentAfterHeader = true;

							// Check if any keyword is in parsedKeywords list
							const hasValidKeyword = itemKeywords.some(k => parsedKeywords.includes(k));
							if (!hasValidKeyword) {
								i++;
								continue;
							}

							// Process as keyword entry (reconstruct line without list marker for parseKeywordEntry)
							const reconstructedLine = `${keywordsStr} :: ${itemContent}`;
							const tempLines = [...lines];
							tempLines[i] = reconstructedLine;
							const entry = await this.parseKeywordEntry(tempLines, i, itemKeywords, parsedKeywords, aliasMap);

							// Create flat entry with header context
							const flatEntry = this.createFlatEntry(
								entry.entry,
								currentH1Info,
								currentH2Info,
								currentH3Info
							);
							flatEntries.push(flatEntry);

							i = entry.nextIndex;
							continue;
						} else {
							// List item with keyword but no content - treat as subitem
							const listType = line.trim().startsWith('*') ? 'asterisk' : 'dash';
							const subItem: ParsedEntrySubItem = {
								content: itemContent,
								listType,
								keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined
							};

							if (!firstListHeaderEntry.subItems) {
								firstListHeaderEntry.subItems = [];
							}
							firstListHeaderEntry.subItems.push(subItem);

							i++;
							continue;
						}
					} else {
						// List item without keywords - treat as subitem
						const listType = line.trim().startsWith('*') ? 'asterisk' : 'dash';
						const subItem: ParsedEntrySubItem = {
							content: itemContent,
							listType,
							keywords: undefined
						};

						if (!firstListHeaderEntry.subItems) {
							firstListHeaderEntry.subItems = [];
						}
						firstListHeaderEntry.subItems.push(subItem);

						i++;
						continue;
					}
				} else if (line.trim() !== '') {
					// Non-list, non-empty content seen - finalize the header entry and disable conversion
					if (firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {

						// Create flat entry with parent header context
						const flatEntry = this.createFlatEntry(firstListHeaderEntry,
							firstListH1Info,
							firstListH2Info,
							firstListH3Info
						);
						flatEntries.push(flatEntry);
					}
					firstListHeaderEntry = null;
					hasSeenContentAfterHeader = true;
				}
			}

			// Parse keyword record: foo bar baz :: text (NEW SYNTAX)
			const keywordMatch = line.match(/^([\w\s]+)::\s*(.*)$/);
			if (keywordMatch) {
				// Finalize first-list header entry if exists
				if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {

					// Create flat entry with parent header context
					const flatEntry = this.createFlatEntry(firstListHeaderEntry,
						firstListH1Info,
						firstListH2Info,
						firstListH3Info
					);
					flatEntries.push(flatEntry);

					firstListHeaderEntry = null;
				}
				// Keyword entry seen - disable first-list conversion
				hasSeenContentAfterHeader = true;

				const keywordsStr = keywordMatch[1].trim();
				const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
				const keywords = this.resolveKeywords(parsedKws, aliasMap);

				// Check if any keyword is in parsedKeywords list
				const hasValidKeyword = keywords.some(k => parsedKeywords.includes(k));
				if (!hasValidKeyword) {
					i++;
					continue;
				}

				const entry = await this.parseKeywordEntry(lines, i, keywords, parsedKeywords, aliasMap);

				// Create flat entry with header context
				const flatEntry = this.createFlatEntry(
					entry.entry,
					currentH1Info,
					currentH2Info,
					currentH3Info
				);
				flatEntries.push(flatEntry);

				i = entry.nextIndex;
				continue;
			}

			// Parse code block: ```language
			const codeBlockMatch = line.match(/^```(\w+)\s*$/);
			if (codeBlockMatch) {
				// Finalize first-list header entry if exists
				if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {

					// Create flat entry with parent header context
					const flatEntry = this.createFlatEntry(firstListHeaderEntry,
						firstListH1Info,
						firstListH2Info,
						firstListH3Info
					);
					flatEntries.push(flatEntry);

					firstListHeaderEntry = null;
				}
				// Code block seen - disable first-list conversion
				hasSeenContentAfterHeader = true;

				const entry = this.parseCodeBlockEntry(lines, i, codeBlockMatch[1]);

				// Create flat entry with header context
				const flatEntry = this.createFlatEntry(
					entry.entry,
					currentH1Info,
					currentH2Info,
					currentH3Info
				);
				flatEntries.push(flatEntry);

				i = entry.nextIndex;
				continue;
			}

			// Track standalone code blocks (without language) to ignore tags inside them
			if (line.match(/^```\s*$/)) {
				insideCodeBlock = !insideCodeBlock;
			}

			i++;
		}

		// Finalize any pending first-list header entry
		if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0) {

			// Create flat entry with parent header context (not including the header that created this entry)
			const flatEntry = this.createFlatEntry(firstListHeaderEntry,
				firstListH1Info,
				firstListH2Info,
				firstListH3Info
			);
			flatEntries.push(flatEntry);
		}

		// Combine file tags: frontmatter + inline tags
		const allFileTags = new Set([...tags, ...fileInlineTags]);

		const parsedFile: ParsedFile = {
			filePath: file.path,
			tags: [...allFileTags],
			aliases: [...new Set(aliases)],
			entries: flatEntries
		};

		// Add file context references to each entry (for runtime use, not stored on disk)
		for (const entry of parsedFile.entries) {
			entry.filePath = parsedFile.filePath;
			entry.fileTags = parsedFile.tags;
		}

		return parsedFile;
	}

	/**
	 * Helper to create FlatEntry from ParsedEntry with current header context
	 * Note: File context (filePath, fileName, tags) is on ParsedFile, not duplicated in each entry
	 */
	private createFlatEntry(
		entry: ParsedEntry,
		h1?: HeaderInfo,
		h2?: HeaderInfo,
		h3?: HeaderInfo
	): FlatEntry {
		const flatEntry: FlatEntry = {
			type: entry.type,
			keywords: entry.keywords,
			text: entry.text,
			lineNumber: entry.lineNumber,
			language: entry.language,
			subItems: entry.subItems
		};

		if (h1) flatEntry.h1 = h1;
		if (h2) flatEntry.h2 = h2;
		if (h3) flatEntry.h3 = h3;

		return flatEntry;
	}

	/**
	 * Parse a header line (NEW SYNTAX: foo bar baz :: text)
	 */
	private parseHeader(headerContent: string, level: number, aliasMap?: Map<string, string>): ParsedHeader {
		// Check for keyword pattern: foo bar baz :: text
		const keywordMatch = headerContent.match(/^([\w\s]+)::\s*(.*)$/);
		let keywords: string[] | undefined;
		let text = headerContent;

		if (keywordMatch) {
			const keywordsStr = keywordMatch[1].trim();
			const parsedKeywords = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
			keywords = this.resolveKeywords(parsedKeywords, aliasMap);
			text = keywordMatch[2];
		}

		// Extract tags
		const tagMatches = text.matchAll(/#([\w-]+)/g);
		const tags = Array.from(tagMatches, m => m[1]);

		// Remove tags from text
		text = text.replace(/#[\w-]+/g, '').trim();

		return {
			text,
			level,
			keywords: keywords && keywords.length > 0 ? keywords : undefined,
			tags,
			entries: []
		};
	}

	/**
	 * Create a null header (for entries without headers)
	 */
	private createNullHeader(level: number): ParsedHeader {
		return {
			text: null,
			level,
			tags: [],
			entries: []
		};
	}

	/**
	 * Parse a keyword entry (NEW SYNTAX: foo bar baz :: text)
	 */
	private async parseKeywordEntry(
		lines: string[],
		startIndex: number,
		keywords: string[],
		parsedKeywords: string[],
		aliasMap?: Map<string, string>
	): Promise<{ entry: ParsedEntry; nextIndex: number }> {
		const line = lines[startIndex];
		const match = line.match(/^([\w\s]+)::\s*(.*)$/);
		if (!match) {
			return {
				entry: {
					type: 'keyword',
					lineNumber: startIndex + 1,
					text: '',
					keywords
				},
				nextIndex: startIndex + 1
			};
		}

		let remainingText = match[2];

		// Collect continuation lines
		const textLines = [remainingText];
		let continuationIndex = startIndex + 1;

		while (continuationIndex < lines.length) {
			const continuationLine = lines[continuationIndex];

			if (continuationLine.trim() === '') break;

			// Block reference - ignore completely
			const blockRefMatch = continuationLine.match(/^\^(kw-[\w-]+)$/);
			if (blockRefMatch) {
				continuationIndex++;
				continue;
			}

			if (continuationLine.match(/^#+\s/)) break;
			if (continuationLine.match(/^[\w\s]+::/)) break;
			if (continuationLine.match(/^\s*(?:[-*]|\d+\.)\s+/) ||
				continuationLine.match(/^\s*-\s*\[[x\s]]\s+/)) {
				break;
			}
			if (continuationLine.match(/^```(\w+)\s*$/)) {
				break;
			}
			if (continuationLine.match(/^\s*>\s*/)) {
				break;
			}

			textLines.push(continuationLine);
			continuationIndex++;
		}

		const text = textLines.join('\n').trim();

		// Extract inline keywords from <mark> tags if parseInlines is enabled
		let finalKeywords = keywords;
		if (this.parserSettings?.parseInlines) {
			const inlineKeywords = this.extractInlineKeywords(text);
			if (inlineKeywords.length > 0) {
				console.log('[Parser] parseInlines enabled - Found inline keywords:', inlineKeywords, 'in text:', text.substring(0, 100));
				// Combine with existing keywords and resolve aliases
				const combined = [...keywords, ...inlineKeywords];
				finalKeywords = this.resolveKeywords(combined, aliasMap);
				console.log('[Parser] Combined keywords:', keywords, '+', inlineKeywords, '=', finalKeywords);
			}
		} else {
			console.log('[Parser] parseInlines disabled or no inline keywords found in:', text.substring(0, 50));
		}

		// Collect sub-items
		const subItems: ParsedEntrySubItem[] = [];
		let j = continuationIndex;

		while (j < lines.length) {
			const subLine = lines[j];

			// Empty line ends the record
			if (subLine.trim() === '') {
				break;
			}

			if (subLine.match(/^#+\s/)) break;
			if (subLine.match(/^[\w\s]+::/)) break;

			// Checkbox item: - [ ] or - [x] (with optional indentation)
			const checkboxMatch = subLine.match(/^\s*-\s*\[([x\s])\]\s*(.*)$/);
			if (checkboxMatch) {
				const checked = checkboxMatch[1].toLowerCase() === 'x';
				let content = checkboxMatch[2];
				let itemKeywords: string[] | undefined;

				// Check for keywords in checkbox (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = this.resolveKeywords(parsedKws, aliasMap);
					content = kwMatch[2];
				}

				// Extract inline keywords from <mark> tags if parseInlines is enabled
				if (this.parserSettings?.parseInlines) {
					const inlineKeywords = this.extractInlineKeywords(content);
					if (inlineKeywords.length > 0) {
						const combined = itemKeywords ? [...itemKeywords, ...inlineKeywords] : inlineKeywords;
						itemKeywords = this.resolveKeywords(combined, aliasMap);
					}
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+)\s*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on checkbox line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+)\s*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+)\s*$/);
						if (indentedMatch) {
							codeBlockInListMatch = indentedMatch;
							j++; // Skip to the code block start line
						}
					}
				}

				if (codeBlockInListMatch) {
					const language = codeBlockInListMatch[1];
					const codeLines: string[] = [];
					j++; // Move to next line after the code block marker

					// Collect code block content (may be indented)
					while (j < lines.length) {
						const codeLine = lines[j];
						// Check for closing ``` (possibly indented)
						if (codeLine.match(/^\s*```\s*$/)) {
							j++; // Skip closing ```
							break;
						}
						codeLines.push(codeLine);
						j++;
					}

					nestedCodeBlock = {
						language,
						content: codeLines.join('\n')
					};
					// Clear content since it's now in nested code block
					content = '';
				}

				const subItem: ParsedEntrySubItem = {
					content,
					listType: 'checkbox',
					checked,
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined
				};

				if (nestedCodeBlock) {
					subItem.nestedCodeBlock = nestedCodeBlock;
				}

				subItems.push(subItem);

				// Only increment j if we didn't already do it for code block
				if (!codeBlockInListMatch) {
					j++;
				}
				continue;
			}

			// Dash list item: - content (with optional indentation)
			const dashMatch = subLine.match(/^\s*-\s*(.*)$/);
			if (dashMatch) {
				let content = dashMatch[1];
				let itemKeywords: string[] | undefined;

				// Check for keywords in dash item (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = this.resolveKeywords(parsedKws, aliasMap);
					content = kwMatch[2];
				}

				// Extract inline keywords from <mark> tags if parseInlines is enabled
				if (this.parserSettings?.parseInlines) {
					const inlineKeywords = this.extractInlineKeywords(content);
					if (inlineKeywords.length > 0) {
						const combined = itemKeywords ? [...itemKeywords, ...inlineKeywords] : inlineKeywords;
						itemKeywords = this.resolveKeywords(combined, aliasMap);
					}
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+)\s*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on dash line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+)\s*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+)\s*$/);
						if (indentedMatch) {
							codeBlockInListMatch = indentedMatch;
							j++; // Skip to the code block start line
						}
					}
				}

				if (codeBlockInListMatch) {
					const language = codeBlockInListMatch[1];
					const codeLines: string[] = [];
					j++; // Move to next line after the code block marker

					// Collect code block content (may be indented)
					while (j < lines.length) {
						const codeLine = lines[j];
						// Check for closing ``` (possibly indented)
						if (codeLine.match(/^\s*```\s*$/)) {
							j++; // Skip closing ```
							break;
						}
						codeLines.push(codeLine);
						j++;
					}

					nestedCodeBlock = {
						language,
						content: codeLines.join('\n')
					};
					// Clear content since it's now in nested code block
					content = '';
				}

				const subItem: ParsedEntrySubItem = {
					content,
					listType: 'dash',
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined
				};

				if (nestedCodeBlock) {
					subItem.nestedCodeBlock = nestedCodeBlock;
				}

				subItems.push(subItem);

				// Only increment j if we didn't already do it for code block
				if (!codeBlockInListMatch) {
					j++;
				}
				continue;
			}

			// Asterisk list item: * content (with optional indentation)
			const asteriskMatch = subLine.match(/^\s*\*\s*(.*)$/);
			if (asteriskMatch) {
				let content = asteriskMatch[1];
				let itemKeywords: string[] | undefined;

				// Check for keywords in asterisk item (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = this.resolveKeywords(parsedKws, aliasMap);
					content = kwMatch[2];
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+)\s*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on asterisk line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+)\s*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+)\s*$/);
						if (indentedMatch) {
							codeBlockInListMatch = indentedMatch;
							j++; // Skip to the code block start line
						}
					}
				}

				if (codeBlockInListMatch) {
					const language = codeBlockInListMatch[1];
					const codeLines: string[] = [];
					j++; // Move to next line after the code block marker

					// Collect code block content (may be indented)
					while (j < lines.length) {
						const codeLine = lines[j];
						// Check for closing ``` (possibly indented)
						if (codeLine.match(/^\s*```\s*$/)) {
							j++; // Skip closing ```
							break;
						}
						codeLines.push(codeLine);
						j++;
					}

					nestedCodeBlock = {
						language,
						content: codeLines.join('\n')
					};
					// Clear content since it's now in nested code block
					content = '';
				}

				const subItem: ParsedEntrySubItem = {
					content,
					listType: 'asterisk',
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined
				};

				if (nestedCodeBlock) {
					subItem.nestedCodeBlock = nestedCodeBlock;
				}

				subItems.push(subItem);

				// Only increment j if we didn't already do it for code block
				if (!codeBlockInListMatch) {
					j++;
				}
				continue;
			}

			// Numbered list item: 1. content, 2. content, etc. (with optional indentation)
			const numberedMatch = subLine.match(/^\s*(\d+)\.\s*(.*)$/);
			if (numberedMatch) {
				let content = numberedMatch[2];
				let itemKeywords: string[] | undefined;

				// Check for keywords in numbered item (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = this.resolveKeywords(parsedKws, aliasMap);
					content = kwMatch[2];
				}

				// Extract inline keywords from <mark> tags if parseInlines is enabled
				if (this.parserSettings?.parseInlines) {
					const inlineKeywords = this.extractInlineKeywords(content);
					if (inlineKeywords.length > 0) {
						const combined = itemKeywords ? [...itemKeywords, ...inlineKeywords] : inlineKeywords;
						itemKeywords = this.resolveKeywords(combined, aliasMap);
					}
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+)\s*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on numbered line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+)\s*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+)\s*$/);
						if (indentedMatch) {
							codeBlockInListMatch = indentedMatch;
							j++; // Skip to the code block start line
						}
					}
				}

				if (codeBlockInListMatch) {
					const language = codeBlockInListMatch[1];
					const codeLines: string[] = [];
					j++; // Move to next line after the code block marker

					// Collect code block content (may be indented)
					while (j < lines.length) {
						const codeLine = lines[j];
						// Check for closing ``` (possibly indented)
						if (codeLine.match(/^\s*```\s*$/)) {
							j++; // Skip closing ```
							break;
						}
						codeLines.push(codeLine);
						j++;
					}

					nestedCodeBlock = {
						language,
						content: codeLines.join('\n')
					};
					// Clear content since it's now in nested code block
					content = '';
				}

				const subItem: ParsedEntrySubItem = {
					content,
					listType: 'numbered',
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined
				};

				if (nestedCodeBlock) {
					subItem.nestedCodeBlock = nestedCodeBlock;
				}

				subItems.push(subItem);

				// Only increment j if we didn't already do it for code block
				if (!codeBlockInListMatch) {
					j++;
				}
				continue;
			}

			// Blockquote: > content (with optional indentation and space)
			const blockquoteMatch = subLine.match(/^\s*>\s*(.+)$/);
			if (blockquoteMatch) {
				let content = blockquoteMatch[1];
				let itemKeywords: string[] | undefined;

				// Check for keywords in blockquote (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = this.resolveKeywords(parsedKws, aliasMap);
					content = kwMatch[2];
				}

				// Extract inline keywords from <mark> tags if parseInlines is enabled
				if (this.parserSettings?.parseInlines) {
					const inlineKeywords = this.extractInlineKeywords(content);
					if (inlineKeywords.length > 0) {
						const combined = itemKeywords ? [...itemKeywords, ...inlineKeywords] : inlineKeywords;
						itemKeywords = this.resolveKeywords(combined, aliasMap);
					}
				}

				subItems.push({
					content,
					listType: 'blockquote',
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined
				});
				j++;
				continue;
			}

			// Code block: ```language (with optional indentation)
			const codeBlockMatch = subLine.match(/^\s*```(\w+)\s*$/);
			if (codeBlockMatch) {
				const language = codeBlockMatch[1];
				const codeLines: string[] = [];
				j++;

				// Collect code block content
				while (j < lines.length) {
					if (lines[j].trim() === '```') {
						j++;
						break;
					}
					codeLines.push(lines[j]);
					j++;
				}

				const codeContent = codeLines.join('\n');

				// Check if previous sub-item is a list type (can nest code blocks)
				const lastSubItem = subItems.length > 0 ? subItems[subItems.length - 1] : null;
				const canNest = lastSubItem &&
					['dash', 'asterisk', 'numbered', 'checkbox'].includes(lastSubItem.listType);

				if (canNest) {
					// Nest code block under last list item
					lastSubItem.nestedCodeBlock = {
						language,
						content: codeContent
					};
				} else {
					// Add as separate sub-item
					subItems.push({
						content: codeContent,
						listType: 'code-block',
						codeBlockLanguage: language
					});
				}
				continue;
			}

			break;
		}

		return {
			entry: {
				type: 'keyword',
				lineNumber: startIndex + 1,
				text,
				keywords: finalKeywords.length > 0 ? finalKeywords : undefined,
				subItems: subItems.length > 0 ? subItems : undefined
			},
			nextIndex: j
		};
	}

	/**
	 * Parse a code block entry
	 */
	private parseCodeBlockEntry(
		lines: string[],
		startIndex: number,
		language: string
	): { entry: ParsedEntry; nextIndex: number } {
		const codeLines: string[] = [];
		let i = startIndex + 1;

		while (i < lines.length) {
			if (lines[i].trim() === '```') {
				i++;
				break;
			}
			codeLines.push(lines[i]);
			i++;
		}

		return {
			entry: {
				type: 'codeblock',
				lineNumber: startIndex + 1,
				text: codeLines.join('\n'),
				language
			},
			nextIndex: i
		};
	}
}
