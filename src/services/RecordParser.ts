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
	constructor(private app: App, private parserSettings?: ParserSettings) {
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
	 * Extract inline code languages from `{language options} code` syntax
	 * Example: `{shell icon title:'Inline If'} echo "test"` returns ["shell"]
	 * @param text The text to scan for inline code blocks
	 * @returns Array of language names found
	 */
	private extractInlineCodeLanguages(text: string): string[] {
		const languages: string[] = [];
		// Match: `{language options} code content`
		// Language must start immediately after {
		const regex = /`\{(\w+)\s*[^}]*\}\s*[^`]+`/g;
		let match;

		while ((match = regex.exec(text)) !== null) {
			languages.push(match[1].toLowerCase());
		}

		return languages;
	}

	/**
	 * Parse a file into hierarchical record structure
	 * @param file The file to parse
	 * @param parsedKeywords List of keywords to collect
	 * @returns Parsed file with hierarchical headers
	 */
	async parseFile(file: TFile, parsedKeywords: string[]): Promise<ParsedFile> {
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
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];

			// Parse headers (H1, H2, H3)
			const headerMatch = line.match(/^(#+)\s+(.+)$/);
			if (headerMatch) {
				const level = headerMatch[1].length;
				const headerContent = headerMatch[2];

				if (level === 1) {
				// Parse new H1 header
				const h1Header = this.parseHeader(headerContent, 1);

				// Update header context for flat entries
				// Header is valid if it has text OR keywords OR inlineKeywords
				currentH1Info = (h1Header.text || h1Header.keywords || h1Header.inlineKeywords) ? {
					text: h1Header.text,
					tags: h1Header.tags,
					keywords: h1Header.keywords || [],
					inlineKeywords: h1Header.inlineKeywords
				} : undefined;
				currentH2Info = undefined;
				currentH3Info = undefined;

				// Track if header has keywords - create record unless followed by another keyword entry/header
				const hasValidHeaderKeyword = h1Header.keywords?.some(k => parsedKeywords.includes(k));
				if (hasValidHeaderKeyword) {
					// Look ahead to check if next non-empty line blocks record creation
					let shouldSkip = false;
					let textLineIndex = -1;
					for (let j = i + 1; j < lines.length; j++) {
						const nextLine = lines[j].trim();
						if (!nextLine) continue; // skip blank

						// Check if next line is a header - blocks record creation
						if (nextLine.match(/^#+\s/)) {
							shouldSkip = true;
							break;
						}

						// Check if line has keyword syntax with VALID parsed keywords - blocks record creation
						const kwMatch = nextLine.match(/^([\w\s]+)::/);
						if (kwMatch) {
							const kws = kwMatch[1].trim().split(/\s+/).map(k => k.toLowerCase());
							const hasValidKeyword = kws.some(k => parsedKeywords.includes(k));
							if (hasValidKeyword) {
								shouldSkip = true;
								break;
							}
						}

						// Check if it's plain text (not list or code block)
						if (!nextLine.match(/^[-*]\s/) && !nextLine.match(/^```/)) {
							textLineIndex = j;
						}
						break;
					}

					// Create record unless blocked by another keyword entry or header
					if (!shouldSkip) {
						// Filter to only valid keywords
						const validKeywords = h1Header.keywords.filter(k => parsedKeywords.includes(k));
						const keywordsStr = validKeywords.join(' ');
						const headerText = h1Header.text || '';

						if (textLineIndex !== -1) {
							// Plain text found: combine with header text
							const textLine = lines[textLineIndex].trim();
							const combinedText = headerText ? `${headerText} ::: ${textLine}` : textLine;
							const reconstructedLine = `${keywordsStr} :: ${combinedText}`;
							const tempLines = [...lines];
							tempLines[textLineIndex] = reconstructedLine;

							const { entry: parsedEntry, nextIndex } = await this.parseKeywordEntry(
								tempLines,
								textLineIndex,
								validKeywords,
								parsedKeywords
							);

							parsedEntry.lineNumber = textLineIndex + 1;
							const flatEntry = this.createFlatEntry(parsedEntry, currentH1Info, undefined, undefined);
							flatEntries.push(flatEntry);
							i = nextIndex - 1;
						} else {
							// No plain text, but create record from header (will consume code blocks, lists, etc.)
							// Reconstruct as keyword-only line so parseKeywordEntry consumes subitems
							const reconstructedLine = `${keywordsStr} :: `;
							const tempLines = [...lines];
							tempLines[i] = reconstructedLine;

							const { entry: parsedEntry, nextIndex } = await this.parseKeywordEntry(
								tempLines,
								i,
								validKeywords,
								parsedKeywords
							);

							// Set text from header
							if (headerText) {
								parsedEntry.text = headerText;
							}
							parsedEntry.lineNumber = i + 1;
							const flatEntry = this.createFlatEntry(parsedEntry, currentH1Info, undefined, undefined);
							flatEntries.push(flatEntry);
							i = nextIndex - 1;
						}
					}
				}

				} else if (level === 2) {
					// Parse new H2 header
					const h2Header = this.parseHeader(headerContent, 2);

				// Update header context for flat entries
				// Header is valid if it has text OR keywords OR inlineKeywords
				currentH2Info = (h2Header.text || h2Header.keywords || h2Header.inlineKeywords) ? {
					text: h2Header.text,
					tags: h2Header.tags,
					keywords: h2Header.keywords || [],
					inlineKeywords: h2Header.inlineKeywords
				} : undefined;
				currentH3Info = undefined;

				// Track if header has keywords - create record unless followed by another keyword entry/header
				const hasValidHeaderKeyword = h2Header.keywords?.some(k => parsedKeywords.includes(k));
				if (hasValidHeaderKeyword) {
					// Look ahead to check if next non-empty line blocks record creation
					let shouldSkip = false;
					let textLineIndex = -1;
					for (let j = i + 1; j < lines.length; j++) {
						const nextLine = lines[j].trim();
						if (!nextLine) continue; // skip blank

						// Check if next line is a header - blocks record creation
						if (nextLine.match(/^#+\s/)) {
							shouldSkip = true;
							break;
						}

						// Check if line has keyword syntax with VALID parsed keywords - blocks record creation
						const kwMatch = nextLine.match(/^([\w\s]+)::/);
						if (kwMatch) {
							const kws = kwMatch[1].trim().split(/\s+/).map(k => k.toLowerCase());
							const hasValidKeyword = kws.some(k => parsedKeywords.includes(k));
							if (hasValidKeyword) {
								shouldSkip = true;
								break;
							}
						}

						// Check if it's plain text (not list or code block)
						if (!nextLine.match(/^[-*]\s/) && !nextLine.match(/^```/)) {
							textLineIndex = j;
						}
						break;
					}

					// Create record unless blocked by another keyword entry or header
					if (!shouldSkip) {
						// Filter to only valid keywords
						const validKeywords = h2Header.keywords.filter(k => parsedKeywords.includes(k));
						const keywordsStr = validKeywords.join(' ');
						const headerText = h2Header.text || '';

						if (textLineIndex !== -1) {
							// Plain text found: combine with header text
							const textLine = lines[textLineIndex].trim();
							const combinedText = headerText ? `${headerText} ::: ${textLine}` : textLine;
							const reconstructedLine = `${keywordsStr} :: ${combinedText}`;
							const tempLines = [...lines];
							tempLines[textLineIndex] = reconstructedLine;

							const { entry: parsedEntry, nextIndex } = await this.parseKeywordEntry(
								tempLines,
								textLineIndex,
								validKeywords,
								parsedKeywords
							);

							parsedEntry.lineNumber = textLineIndex + 1;
							const flatEntry = this.createFlatEntry(parsedEntry, currentH1Info, currentH2Info, undefined);
							flatEntries.push(flatEntry);
							i = nextIndex - 1;
						} else {
							// No plain text, but create record from header (will consume code blocks, lists, etc.)
							// Reconstruct as keyword-only line so parseKeywordEntry consumes subitems
							const reconstructedLine = `${keywordsStr} :: `;
							const tempLines = [...lines];
							tempLines[i] = reconstructedLine;

							const { entry: parsedEntry, nextIndex } = await this.parseKeywordEntry(
								tempLines,
								i,
								validKeywords,
								parsedKeywords
							);

							// Set text from header
							if (headerText) {
								parsedEntry.text = headerText;
							}
							parsedEntry.lineNumber = i + 1;
							const flatEntry = this.createFlatEntry(parsedEntry, currentH1Info, currentH2Info, undefined);
							flatEntries.push(flatEntry);
							i = nextIndex - 1;
						}
					}
				}

				} else if (level === 3) {
					// Parse new H3 header
					const h3Header = this.parseHeader(headerContent, 3);

				// Update header context for flat entries
				// Header is valid if it has text OR keywords OR inlineKeywords
				currentH3Info = (h3Header.text || h3Header.keywords || h3Header.inlineKeywords) ? {
					text: h3Header.text,
					tags: h3Header.tags,
					keywords: h3Header.keywords || [],
					inlineKeywords: h3Header.inlineKeywords
				} : undefined;

				// Track if header has keywords - create record unless followed by another keyword entry/header
				const hasValidHeaderKeyword = h3Header.keywords?.some(k => parsedKeywords.includes(k));
				if (hasValidHeaderKeyword) {
					// Look ahead to check if next non-empty line blocks record creation
					let shouldSkip = false;
					let textLineIndex = -1;
					for (let j = i + 1; j < lines.length; j++) {
						const nextLine = lines[j].trim();
						if (!nextLine) continue; // skip blank

						// Check if next line is a header - blocks record creation
						if (nextLine.match(/^#+\s/)) {
							shouldSkip = true;
							break;
						}

						// Check if line has keyword syntax with VALID parsed keywords - blocks record creation
						const kwMatch = nextLine.match(/^([\w\s]+)::/);
						if (kwMatch) {
							const kws = kwMatch[1].trim().split(/\s+/).map(k => k.toLowerCase());
							const hasValidKeyword = kws.some(k => parsedKeywords.includes(k));
							if (hasValidKeyword) {
								shouldSkip = true;
								break;
							}
						}

						// Check if it's plain text (not list or code block)
						if (!nextLine.match(/^[-*]\s/) && !nextLine.match(/^```/)) {
							textLineIndex = j;
						}
						break;
					}

					// Create record unless blocked by another keyword entry or header
					if (!shouldSkip) {
						// Filter to only valid keywords
						const validKeywords = h3Header.keywords.filter(k => parsedKeywords.includes(k));
						const keywordsStr = validKeywords.join(' ');
						const headerText = h3Header.text || '';

						if (textLineIndex !== -1) {
							// Plain text found: combine with header text
							const textLine = lines[textLineIndex].trim();
							const combinedText = headerText ? `${headerText} ::: ${textLine}` : textLine;
							const reconstructedLine = `${keywordsStr} :: ${combinedText}`;
							const tempLines = [...lines];
							tempLines[textLineIndex] = reconstructedLine;

							const { entry: parsedEntry, nextIndex } = await this.parseKeywordEntry(
								tempLines,
								textLineIndex,
								validKeywords,
								parsedKeywords
							);

							parsedEntry.lineNumber = textLineIndex + 1;
							const flatEntry = this.createFlatEntry(parsedEntry, currentH1Info, currentH2Info, currentH3Info);
							flatEntries.push(flatEntry);
							i = nextIndex - 1;
						} else {
							// No plain text, but create record from header (will consume code blocks, lists, etc.)
							// Reconstruct as keyword-only line so parseKeywordEntry consumes subitems
							const reconstructedLine = `${keywordsStr} :: `;
							const tempLines = [...lines];
							tempLines[i] = reconstructedLine;

							const { entry: parsedEntry, nextIndex } = await this.parseKeywordEntry(
								tempLines,
								i,
								validKeywords,
								parsedKeywords
							);

							// Set text from header
							if (headerText) {
								parsedEntry.text = headerText;
							}
							parsedEntry.lineNumber = i + 1;
							const flatEntry = this.createFlatEntry(parsedEntry, currentH1Info, currentH2Info, currentH3Info);
							flatEntries.push(flatEntry);
							i = nextIndex - 1;
						}
					}
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

			// Parse keyword record: foo bar baz :: text (NEW SYNTAX)
			const keywordMatch = line.match(/^([\w\s]+)::\s*(.*)$/);
			if (keywordMatch) {

				const keywordsStr = keywordMatch[1].trim();
				const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
				const keywords = [...new Set(parsedKws)];

				// Check if any keyword is in parsedKeywords list
				const hasValidKeyword = keywords.some(k => parsedKeywords.includes(k));
				if (!hasValidKeyword) {
					i++;
					continue;
				}

				const entry = await this.parseKeywordEntry(lines, i, keywords, parsedKeywords);

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

			// Parse code block: ```language (with optional parameters for plugins like Code Styler)
			const codeBlockMatch = line.match(/^```(\w+).*$/);
			if (codeBlockMatch) {

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
			inlineKeywords: entry.inlineKeywords,
			inlineCodeLanguages: entry.inlineCodeLanguages,
			text: entry.text,
			lineNumber: entry.lineNumber,
			language: entry.language,
			subItems: entry.subItems,
			srs: entry.srs
		};

		if (h1) flatEntry.h1 = h1;
		if (h2) flatEntry.h2 = h2;
		if (h3) flatEntry.h3 = h3;

		return flatEntry;
	}

	/**
	 * Parse a header line
	 * Supports:
	 * - foo bar :: text (keywords with text)
	 * - foo bar (keywords only, no text)
	 * - regular text (no keywords)
	 */
	private parseHeader(headerContent: string, level: number): ParsedHeader & { inlineKeywords?: string[] } {
		let keywords: string[] | undefined;
		let text = headerContent;

		// Check for keyword pattern: foo bar baz :: text
		const keywordMatch = headerContent.match(/^([\w\s]+)::\s*(.*)$/);

		if (keywordMatch) {
			// Pattern with :: found
			const keywordsStr = keywordMatch[1].trim();
			const parsedKeywords = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
			keywords = [...new Set(parsedKeywords)];
			text = keywordMatch[2];
		}
		// No :: found - treat as regular text (tags will be extracted below)

		// Extract tags
		const tagMatches = text.matchAll(/#([\w-]+)/g);
		const tags = Array.from(tagMatches, m => m[1]);

		// Remove tags from text
		text = text.replace(/#[\w-]+/g, '').trim();

		// Extract inline keywords from <mark> tags and inline code languages (always enabled)
		let inlineKeywords: string[] | undefined;
		let inlineCodeLanguages: string[] | undefined;

		const extractedInlineKws = this.extractInlineKeywords(text);
		if (extractedInlineKws.length > 0) {
			inlineKeywords = [...new Set(extractedInlineKws)];
		}

		const extractedCodeLangs = this.extractInlineCodeLanguages(text);
		if (extractedCodeLangs.length > 0) {
			inlineCodeLanguages = [...new Set(extractedCodeLangs)];
		}

		return {
			text: text || null,  // Return null instead of empty string
			level,
			keywords: keywords && keywords.length > 0 ? keywords : undefined,
			inlineKeywords: inlineKeywords && inlineKeywords.length > 0 ? inlineKeywords : undefined,
			inlineCodeLanguages: inlineCodeLanguages && inlineCodeLanguages.length > 0 ? inlineCodeLanguages : undefined,
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
		parsedKeywords: string[]
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
			if (continuationLine.match(/^```(\w+).*$/)) {
				break;
			}
			if (continuationLine.match(/^\s*>\s*/)) {
				break;
			}

			textLines.push(continuationLine);
			continuationIndex++;
		}

		let text = textLines.join('\n').trim();

		// Extract SRS data from HTML comment
		const { srsData, cleanText } = this.extractSRSComment(text);
		text = cleanText;

		// Extract inline keywords from <mark> tags and inline code languages (always enabled)
		let inlineKeywords: string[] | undefined;
		let inlineCodeLanguages: string[] | undefined;

		const extractedInlineKws = this.extractInlineKeywords(text);
		if (extractedInlineKws.length > 0) {
			inlineKeywords = [...new Set(extractedInlineKws)];
		}

		const extractedCodeLangs = this.extractInlineCodeLanguages(text);
		if (extractedCodeLangs.length > 0) {
			inlineCodeLanguages = [...new Set(extractedCodeLangs)];
		}

		// Collect sub-items
		const subItems: ParsedEntrySubItem[] = [];
		let j = continuationIndex;

		while (j < lines.length) {
			const subLine = lines[j];

			// Skip blank lines if followed by subitems (code, lists), but stop if followed by header/keyword entry
			if (subLine.trim() === '') {
				// Look ahead to see what comes after blank line(s)
				let lookAhead = j + 1;
				while (lookAhead < lines.length && lines[lookAhead].trim() === '') {
					lookAhead++;
				}
				if (lookAhead >= lines.length) break; // End of file

				const nextNonEmpty = lines[lookAhead].trim();
				// Stop if next content is header or keyword entry
				if (nextNonEmpty.match(/^#+\s/)) break;
				if (nextNonEmpty.match(/^[\w\s]+::/)) {
					const kws = nextNonEmpty.match(/^([\w\s]+)::/)?.[1].trim().split(/\s+/).map(k => k.toLowerCase());
					const hasValidKeyword = kws?.some(k => parsedKeywords.includes(k));
					if (hasValidKeyword) break;
				}
				// Otherwise skip blank line(s) and continue looking for subitems
				j++;
				continue;
			}

			if (subLine.match(/^#+\s/)) break;
			if (subLine.match(/^[\w\s]+::/)) break;

			// Checkbox item: - [ ] or - [x] (with optional indentation)
			const checkboxMatch = subLine.match(/^(\s*)-\s*\[([x\s])\]\s*(.*)$/);
			if (checkboxMatch) {
				const indent = checkboxMatch[1].length;
				const checked = checkboxMatch[2].toLowerCase() === 'x';
				let content = checkboxMatch[3];
				let itemKeywords: string[] | undefined;
				let itemInlineKeywords: string[] | undefined;
				let itemInlineCodeLanguages: string[] | undefined;

				// Check for keywords in checkbox (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = [...new Set(parsedKws)];
					content = kwMatch[2];
				}

				// Extract inline keywords and code languages (always enabled)
				const extractedInlineKws = this.extractInlineKeywords(content);
				if (extractedInlineKws.length > 0) {
					itemInlineKeywords = [...new Set(extractedInlineKws)];
				}

				const extractedCodeLangs = this.extractInlineCodeLanguages(content);
				if (extractedCodeLangs.length > 0) {
					itemInlineCodeLanguages = extractedCodeLangs;
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+).*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on checkbox line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+).*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+).*$/);
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
					indent,
					checked,
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined,
					inlineKeywords: itemInlineKeywords && itemInlineKeywords.length > 0 ? itemInlineKeywords : undefined,
					inlineCodeLanguages: itemInlineCodeLanguages && itemInlineCodeLanguages.length > 0 ? itemInlineCodeLanguages : undefined
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
			const dashMatch = subLine.match(/^(\s*)-\s*(.*)$/);
			if (dashMatch) {
				const indent = dashMatch[1].length;
				let content = dashMatch[2];
				let itemKeywords: string[] | undefined;
				let itemInlineKeywords: string[] | undefined;
				let itemInlineCodeLanguages: string[] | undefined;

				// Check for keywords in dash item (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = [...new Set(parsedKws)];
					content = kwMatch[2];
				}

				// Extract inline keywords and code languages (always enabled)
				const extractedInlineKws = this.extractInlineKeywords(content);
				if (extractedInlineKws.length > 0) {
					itemInlineKeywords = [...new Set(extractedInlineKws)];
				}

				const extractedCodeLangs = this.extractInlineCodeLanguages(content);
				if (extractedCodeLangs.length > 0) {
					itemInlineCodeLanguages = extractedCodeLangs;
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+).*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on dash line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+).*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+).*$/);
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
					indent,
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined,
					inlineKeywords: itemInlineKeywords && itemInlineKeywords.length > 0 ? itemInlineKeywords : undefined,
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
			const asteriskMatch = subLine.match(/^(\s*)\*\s*(.*)$/);
			if (asteriskMatch) {
				const indent = asteriskMatch[1].length;
				let content = asteriskMatch[2];
				let itemKeywords: string[] | undefined;
				let itemInlineKeywords: string[] | undefined;
				let itemInlineCodeLanguages: string[] | undefined;

				// Check for keywords in asterisk item (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = [...new Set(parsedKws)];
					content = kwMatch[2];
				}

				// Extract inline keywords and code languages (always enabled)
				const extractedInlineKws = this.extractInlineKeywords(content);
				if (extractedInlineKws.length > 0) {
					itemInlineKeywords = [...new Set(extractedInlineKws)];
				}

				const extractedCodeLangs = this.extractInlineCodeLanguages(content);
				if (extractedCodeLangs.length > 0) {
					itemInlineCodeLanguages = extractedCodeLangs;
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+).*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on asterisk line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+).*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+).*$/);
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
					indent,
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined,
					inlineKeywords: itemInlineKeywords && itemInlineKeywords.length > 0 ? itemInlineKeywords : undefined,
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
			const numberedMatch = subLine.match(/^(\s*)(\d+)\.\s*(.*)$/);
			if (numberedMatch) {
				const indent = numberedMatch[1].length;
				let content = numberedMatch[3];
				let itemKeywords: string[] | undefined;
				let itemInlineKeywords: string[] | undefined;
				let itemInlineCodeLanguages: string[] | undefined;

				// Check for keywords in numbered item (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = [...new Set(parsedKws)];
					content = kwMatch[2];
				}

				// Extract inline keywords and code languages (always enabled)
				const extractedInlineKws = this.extractInlineKeywords(content);
				if (extractedInlineKws.length > 0) {
					itemInlineKeywords = [...new Set(extractedInlineKws)];
				}

				const extractedCodeLangs = this.extractInlineCodeLanguages(content);
				if (extractedCodeLangs.length > 0) {
					itemInlineCodeLanguages = extractedCodeLangs;
				}

				// Check if content is a code block marker
				let codeBlockInListMatch = content.match(/^```(\w+).*$/);
				let nestedCodeBlock: { language: string; content: string } | undefined;

				// If no content on numbered line, check if next line is indented code block
				if (!codeBlockInListMatch && content.trim() === '' && j + 1 < lines.length) {
					const nextLine = lines[j + 1];
					// Check if next line is indented and starts with code block marker
					if (nextLine.match(/^\s+```(\w+).*$/)) {
						const indentedMatch = nextLine.match(/^\s+```(\w+).*$/);
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
					indent,
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined,
					inlineKeywords: itemInlineKeywords && itemInlineKeywords.length > 0 ? itemInlineKeywords : undefined,
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
				let itemInlineKeywords: string[] | undefined;
				let itemInlineCodeLanguages: string[] | undefined;

				// Check for keywords in blockquote (NEW SYNTAX)
				const kwMatch = content.match(/^([\w\s]+)::\s*(.*)$/);
				if (kwMatch) {
					const keywordsStr = kwMatch[1].trim();
					const parsedKws = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
					itemKeywords = [...new Set(parsedKws)];
					content = kwMatch[2];
				}

				// Extract inline keywords and code languages (always enabled)
				const extractedInlineKws = this.extractInlineKeywords(content);
				if (extractedInlineKws.length > 0) {
					itemInlineKeywords = [...new Set(extractedInlineKws)];
				}

				const extractedCodeLangs = this.extractInlineCodeLanguages(content);
				if (extractedCodeLangs.length > 0) {
					itemInlineCodeLanguages = extractedCodeLangs;
				}

				subItems.push({
					content,
					listType: 'blockquote',
					keywords: itemKeywords && itemKeywords.length > 0 ? itemKeywords : undefined,
					inlineKeywords: itemInlineKeywords && itemInlineKeywords.length > 0 ? itemInlineKeywords : undefined,
					inlineCodeLanguages: itemInlineCodeLanguages && itemInlineCodeLanguages.length > 0 ? itemInlineCodeLanguages : undefined
				});
				j++;
				continue;
			}

			// Code block: ```language (with optional indentation and parameters)
			const codeBlockMatch = subLine.match(/^\s*```(\w+).*$/);
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

		// Build tree structure from flat subItems array based on indentation
		const treeSubItems = this.buildSubItemTree(subItems);

		const entry = {
			type: 'keyword',
			lineNumber: startIndex + 1,
			text,
			keywords: keywords.length > 0 ? keywords : undefined,
			inlineKeywords: inlineKeywords && inlineKeywords.length > 0 ? inlineKeywords : undefined,
			inlineCodeLanguages: inlineCodeLanguages && inlineCodeLanguages.length > 0 ? inlineCodeLanguages : undefined,
			subItems: treeSubItems.length > 0 ? treeSubItems : undefined,
			srs: srsData
		};

		return {
			entry,
			nextIndex: j
		};
	}

	/**
	 * Build tree structure from flat subItems array based on indentation
	 */
	private buildSubItemTree(flatItems: ParsedEntrySubItem[]): ParsedEntrySubItem[] {
		if (flatItems.length === 0) return [];

		const root: ParsedEntrySubItem[] = [];
		const stack: { item: ParsedEntrySubItem; indent: number }[] = [];

		for (const item of flatItems) {
			const currentIndent = item.indent ?? 0;

			// Pop stack until we find the parent (item with smaller indent)
			while (stack.length > 0 && stack[stack.length - 1].indent >= currentIndent) {
				stack.pop();
			}

			if (stack.length === 0) {
				// Top-level item
				root.push(item);
			} else {
				// Child of the last item in stack
				const parent = stack[stack.length - 1].item;
				if (!parent.children) {
					parent.children = [];
				}
				parent.children.push(item);
			}

			// Add current item to stack
			stack.push({ item, indent: currentIndent });
		}

		return root;
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

	/**
	 * Extract SRS data from HTML comment in text
	 * Format: <!-- srs: {"ef":2.5,"i":7,"r":3,"next":"2026-03-30"} -->
	 * Returns: { srsData, cleanText }
	 */
	private extractSRSComment(text: string): {
		srsData: { ef: number; i: number; r: number; next: string } | undefined;
		cleanText: string
	} {
		// Match HTML comment with srs data
		const srsMatch = text.match(/<!--\s*srs:\s*(\{[^}]+\})\s*-->/);

		if (!srsMatch) {
			return { srsData: undefined, cleanText: text };
		}

		try {
			// Parse JSON data
			const srsData = JSON.parse(srsMatch[1]);

			// Validate required fields
			if (
				typeof srsData.ef === 'number' &&
				typeof srsData.i === 'number' &&
				typeof srsData.r === 'number' &&
				typeof srsData.next === 'string'
			) {
				// Round ef to 2 decimal places (clean up floating-point precision issues)
				srsData.ef = Math.round(srsData.ef * 100) / 100;

				// Remove SRS comment from text
				const cleanText = text.replace(srsMatch[0], '').trim();
				return { srsData, cleanText };
			}
		} catch (error) {
			// Invalid JSON - ignore
			console.warn('[RecordParser] Invalid SRS comment:', srsMatch[0]);
		}

		return { srsData: undefined, cleanText: text };
	}
}
