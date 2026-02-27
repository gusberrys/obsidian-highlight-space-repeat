import { App, TFile } from 'obsidian';
import type { ParsedRecord, RecordHeader, RecordEntry, RecordSubItem } from '../interfaces/ParsedRecord';

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
	constructor(private app: App) {}

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
	 * Parse a file into hierarchical record structure
	 * @param file The file to parse
	 * @param parsedKeywords List of keywords to collect
	 * @param aliasMap Map of alias -> main keyword (optional)
	 * @returns Parsed file with hierarchical headers
	 */
	async parseFile(file: TFile, parsedKeywords: string[], aliasMap?: Map<string, string>): Promise<ParsedRecord> {
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

		const headers: RecordHeader[] = [];

		// Track inline tags from content before any headers
		const fileInlineTags = new Set<string>();

		// Check if file contains any "pin ::" entries - if yes, create pin tab (null header)
		const hasPinEntries = lines.some(line => {
			const keywordMatch = line.match(/^([\w\s]+)::\s*(.*)$/);
			if (keywordMatch) {
				const keywordsStr = keywordMatch[1].trim();
				const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
				const resolved = this.resolveKeywords(parsedKws, aliasMap);
				// Check if any resolved keyword is "pin"
				return resolved.some(kw => kw === 'pin');
			}
			return false;
		});

		// Track whether we're inside a code block
		let insideCodeBlock = false;

		// Current header tracking - initialize with pin tab if needed
		let currentH1: RecordHeader | null = hasPinEntries ? this.createNullHeader(0) : null;
		let currentH2: RecordHeader | null = null;
		let currentH3: RecordHeader | null = null;

		// Track first list after header with keywords
		let firstListAfterKeywordHeader: string[] | null = null;
		let hasSeenContentAfterHeader = false;
		let firstListHeaderEntry: RecordEntry | null = null;
		let firstListTargetHeader: RecordHeader | null = null;
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
			// Finalize any pending first-list header entry before saving headers
			if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
				firstListTargetHeader.entries.push(firstListHeaderEntry);
				firstListHeaderEntry = null;
				firstListTargetHeader = null;
			}

					// Save all pending headers before creating new H1
					if (currentH3 && currentH2) {
						if (!currentH2.children) currentH2.children = [];
						currentH2.children.push(currentH3);
					}
					if (currentH2 && currentH1) {
						if (!currentH1.children) currentH1.children = [];
						currentH1.children.push(currentH2);
					}
					if (currentH1) {
						headers.push(currentH1);
					}

					// Create new H1
					currentH1 = this.parseHeader(headerContent, 1, aliasMap);
					currentH2 = null;
					currentH3 = null;

					// Track if header has keywords for first-list conversion
					if (currentH1.keywords && currentH1.keywords.length > 0) {
						firstListAfterKeywordHeader = currentH1.keywords;
						hasSeenContentAfterHeader = false;
						// Create entry for keyword header
						firstListHeaderEntry = {
							type: 'keyword',
							lineNumber: i + 1,
							text: currentH1.text || '',
							keywords: currentH1.keywords,
							subItems: []
						};
						firstListTargetHeader = currentH1;
						firstListHeaderLineNumber = i + 1;
					} else {
						firstListAfterKeywordHeader = null;
						hasSeenContentAfterHeader = false;
						firstListHeaderEntry = null;
						firstListTargetHeader = null;
						firstListHeaderLineNumber = null;
					}

				} else if (level === 2) {
			// Finalize any pending first-list header entry before saving headers
			if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
				firstListTargetHeader.entries.push(firstListHeaderEntry);
				firstListHeaderEntry = null;
				firstListTargetHeader = null;
			}

					// Save previous H3 and H2 before creating new H2
					if (currentH3 && currentH2) {
						if (!currentH2.children) currentH2.children = [];
						currentH2.children.push(currentH3);
					}
					if (currentH2 && currentH1) {
						if (!currentH1.children) currentH1.children = [];
						currentH1.children.push(currentH2);
					}

					// Create new H2
					if (!currentH1) {
						// Create implicit null H1 if H2 appears without H1
						currentH1 = this.createNullHeader(1);
					}
					currentH2 = this.parseHeader(headerContent, 2, aliasMap);
					currentH3 = null;

					// Track if header has keywords for first-list conversion
					if (currentH2.keywords && currentH2.keywords.length > 0) {
						firstListAfterKeywordHeader = currentH2.keywords;
						hasSeenContentAfterHeader = false;
						// Create entry for keyword header
						firstListHeaderEntry = {
							type: 'keyword',
							lineNumber: i + 1,
							text: currentH2.text || '',
							keywords: currentH2.keywords,
							subItems: []
						};
						firstListTargetHeader = currentH2;
						firstListHeaderLineNumber = i + 1;
					} else {
						firstListAfterKeywordHeader = null;
						hasSeenContentAfterHeader = false;
						firstListHeaderEntry = null;
						firstListTargetHeader = null;
						firstListHeaderLineNumber = null;
					}

				} else if (level === 3) {
			// Finalize any pending first-list header entry before saving headers
			if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
				firstListTargetHeader.entries.push(firstListHeaderEntry);
				firstListHeaderEntry = null;
				firstListTargetHeader = null;
			}

					// Save previous H3 if exists
					if (currentH3 && currentH2) {
						if (!currentH2.children) currentH2.children = [];
						currentH2.children.push(currentH3);
					}

					// Create new H3
					if (!currentH2) {
						// Create implicit null H2 if H3 appears without H2
						if (!currentH1) {
							currentH1 = this.createNullHeader(1);
						}
						currentH2 = this.createNullHeader(2);
					}
					currentH3 = this.parseHeader(headerContent, 3, aliasMap);

					// Track if header has keywords for first-list conversion
					if (currentH3.keywords && currentH3.keywords.length > 0) {
						firstListAfterKeywordHeader = currentH3.keywords;
						hasSeenContentAfterHeader = false;
						// Create entry for keyword header
						firstListHeaderEntry = {
							type: 'keyword',
							lineNumber: i + 1,
							text: currentH3.text || '',
							keywords: currentH3.keywords,
							subItems: []
						};
						firstListTargetHeader = currentH3;
						firstListHeaderLineNumber = i + 1;
					} else {
						firstListAfterKeywordHeader = null;
						hasSeenContentAfterHeader = false;
						firstListHeaderEntry = null;
						firstListTargetHeader = null;
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
					// Add to current header context, or file-level if no header
					const targetHeader = currentH3 || currentH2 || currentH1;
					if (targetHeader) {
						if (!targetHeader.tags.includes(tag)) {
							targetHeader.tags.push(tag);
						}
					} else {
						fileInlineTags.add(tag);
					}
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
							if (firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
								firstListTargetHeader.entries.push(firstListHeaderEntry);
							}
							firstListHeaderEntry = null;
							firstListTargetHeader = null;
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

							// Add entry to appropriate header level
							const targetHeader = currentH3 || currentH2 || currentH1;
							if (targetHeader) {
								targetHeader.entries.push(entry.entry);
								i = entry.nextIndex;
							} else {
								// No header - create null header
								if (!currentH1) {
									currentH1 = this.createNullHeader(0);
								}
								currentH1.entries.push(entry.entry);
								i = entry.nextIndex;
							}
							continue;
						} else {
							// List item with keyword but no content - treat as subitem
							const listType = line.trim().startsWith('*') ? 'asterisk' : 'dash';
							const subItem: RecordSubItem = {
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
						const subItem: RecordSubItem = {
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
					if (firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
						firstListTargetHeader.entries.push(firstListHeaderEntry);
					}
					firstListHeaderEntry = null;
					firstListTargetHeader = null;
					hasSeenContentAfterHeader = true;
				}
			}

			// Parse keyword record: foo bar baz :: text (NEW SYNTAX)
			const keywordMatch = line.match(/^([\w\s]+)::\s*(.*)$/);
			if (keywordMatch) {
				// Finalize first-list header entry if exists
				if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
					firstListTargetHeader.entries.push(firstListHeaderEntry);
					firstListHeaderEntry = null;
					firstListTargetHeader = null;
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

				// Add entry to appropriate header level
				const targetHeader = currentH3 || currentH2 || currentH1;
				if (targetHeader) {
					targetHeader.entries.push(entry.entry);
					i = entry.nextIndex;
				} else {
					// No header - create null header
					if (!currentH1) {
						currentH1 = this.createNullHeader(0);
					}
					currentH1.entries.push(entry.entry);
					i = entry.nextIndex;
				}
				continue;
			}

			// Parse code block: ```language
			const codeBlockMatch = line.match(/^```(\w+)\s*$/);
			if (codeBlockMatch) {
				// Finalize first-list header entry if exists
				if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
					firstListTargetHeader.entries.push(firstListHeaderEntry);
					firstListHeaderEntry = null;
					firstListTargetHeader = null;
				}
				// Code block seen - disable first-list conversion
				hasSeenContentAfterHeader = true;

				const entry = this.parseCodeBlockEntry(lines, i, codeBlockMatch[1]);

				// Add to appropriate header
				const targetHeader = currentH3 || currentH2 || currentH1;
				if (targetHeader) {
					targetHeader.entries.push(entry.entry);
					i = entry.nextIndex;
				} else {
					if (!currentH1) {
						currentH1 = this.createNullHeader(0);
					}
					currentH1.entries.push(entry.entry);
					i = entry.nextIndex;
				}
				continue;
			}

			// Track standalone code blocks (without language) to ignore tags inside them
			if (line.match(/^```\s*$/)) {
				insideCodeBlock = !insideCodeBlock;
			}

			i++;
		}

		// Finalize any pending first-list header entry
		if (firstListHeaderEntry && firstListHeaderEntry.subItems && firstListHeaderEntry.subItems.length > 0 && firstListTargetHeader) {
			firstListTargetHeader.entries.push(firstListHeaderEntry);
		}

		// Save remaining headers
		if (currentH3 && currentH2) {
			if (!currentH2.children) currentH2.children = [];
			currentH2.children.push(currentH3);
		}
		if (currentH2 && currentH1) {
			if (!currentH1.children) currentH1.children = [];
			currentH1.children.push(currentH2);
		}
		if (currentH1) {
			headers.push(currentH1);
		}

		// Combine file tags: frontmatter + inline tags from before headers
		const allFileTags = new Set([...tags, ...fileInlineTags]);

		return {
			filePath: file.path,
			fileName: file.name,
			tags: [...allFileTags],
			aliases: [...new Set(aliases)],
			headers
		};
	}

	/**
	 * Parse a header line (NEW SYNTAX: foo bar baz :: text)
	 */
	private parseHeader(headerContent: string, level: number, aliasMap?: Map<string, string>): RecordHeader {
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
	private createNullHeader(level: number): RecordHeader {
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
	): Promise<{ entry: RecordEntry; nextIndex: number }> {
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

		// Collect sub-items
		const subItems: RecordSubItem[] = [];
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

				const subItem: RecordSubItem = {
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

				const subItem: RecordSubItem = {
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

				const subItem: RecordSubItem = {
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

				const subItem: RecordSubItem = {
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
				keywords: keywords.length > 0 ? keywords : undefined,
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
	): { entry: RecordEntry; nextIndex: number } {
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
