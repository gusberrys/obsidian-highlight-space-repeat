import type { MarkdownPostProcessorContext } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { CollectingStatus, isSpaced } from '../shared/collecting-status';
import type { ParsedEntry, ParsedFile, ParsedHeader, FlatEntry } from '../interfaces/ParsedFile';
import { settingsStore, settingsDataStore } from '../stores/settings-store';
import { get } from 'svelte/store';
import { DATA_PATHS } from '../shared/data-paths';
import { getFileNameFromPath } from '../utils/file-helpers';


/**
 * Get collecting status for keywords
 */
function getCollectingStatus(keywords: string[]): CollectingStatus | null {
	const settings = get(settingsStore);

	for (const keyword of keywords) {
		// Find keyword in categories
		for (const category of settings.categories) {
			const keywordObj = category.keywords.find((k: any) => k.keyword === keyword);
			if (keywordObj && keywordObj.collectingStatus) {
				return keywordObj.collectingStatus;
			}
		}
	}

	return null;
}

/**
 * Load parsed records from JSON file
 */
async function loadParsedRecords(plugin: HighlightSpaceRepeatPlugin): Promise<ParsedFile[] | null> {
	try {
		const data = await plugin.app.vault.adapter.read(DATA_PATHS.PARSED_FILES);
		return JSON.parse(data);
	} catch (error) {
		console.log('[RecordBadge] Failed to load parsed records:', error);
		return null;
	}
}

/**
 * Find a parsed entry by line number in flat entries array
 */
function findEntryByLineNumber(record: ParsedFile, targetLineNumber: number): FlatEntry | null {
	// Entries are now flat in record.entries
	return record.entries.find(e => e.lineNumber === targetLineNumber) || null;
}

/**
 * Convert a parsed entry to YAML format
 */
function entryToYaml(entry: ParsedEntry): string {
	let yaml = `type: ${entry.type}\n`;
	yaml += `lineNumber: ${entry.lineNumber}\n`;
	yaml += `text: "${entry.text}"\n`;

	if (entry.keywords && entry.keywords.length > 0) {
		yaml += 'keywords:\n';
		for (const kw of entry.keywords) {
			yaml += `  - ${kw}\n`;
		}
	}

	if (entry.subItems && entry.subItems.length > 0) {
		yaml += 'subItems:\n';
		for (const subItem of entry.subItems) {
			if (subItem.listType === 'code-block') {
				yaml += '  - content: |\n';
				const indentedCode = subItem.content.split('\n').map(line => `      ${line}`).join('\n');
				yaml += `${indentedCode}\n`;
				yaml += `    listType: code-block\n`;
				if (subItem.codeBlockLanguage) {
					yaml += `    codeBlockLanguage: ${subItem.codeBlockLanguage}\n`;
				}
			} else {
				yaml += `  - content: "${subItem.content}"\n`;
				yaml += `    listType: ${subItem.listType}\n`;
			}
		}
	}

	if (entry.language) {
		yaml += `language: ${entry.language}\n`;
	}

	return yaml;
}

/**
 * Check if text has any SRS-testable patterns
 */
function hasTestablePatterns(text: string): boolean {
	// Check for {{...}}, `code`, :::, or **bold**
	const hasCurly = /\{\{[^}]+\}\}/.test(text);
	const hasCode = /`[^`]+`/.test(text);
	const hasCodeBlock = /```[\s\S]+?```/.test(text);
	const hasTriple = /:::/.test(text);
	const hasBold = /\*\*[^*]+\*\*/.test(text);

	return hasCurly || hasCode || hasCodeBlock || hasTriple || hasBold;
}

/**
 * Check if entry or its sub-items have testable patterns or content
 */
function entryHasTestableContent(entry: ParsedEntry): boolean {
	// Check main text
	if (hasTestablePatterns(entry.text)) {
		return true;
	}

	// Having sub-items makes it testable (testing recall of sub-items)
	if (entry.subItems && entry.subItems.length > 0) {
		return true;
	}

	return false;
}

/**
 * Find header containing this entry and check if it has the same keyword
 */
function findHeaderWithKeyword(entry: FlatEntry, keyword: string): string | null {
	// Check each header level (h1, h2, h3) for the keyword
	const headerLevels = [
		entry.h3 ? { info: entry.h3 } : null,  // Check h3 first (most specific)
		entry.h2 ? { info: entry.h2 } : null,
		entry.h1 ? { info: entry.h1 } : null
	].filter(h => h !== null);

	for (const headerLevel of headerLevels) {
		const header = headerLevel!.info;
		const headerHasKeyword = header.keywords?.includes(keyword);
		if (headerHasKeyword && header.text) {
			return header.text;
		}
	}

	return null;
}

/**
 * Check if entry is at top level (no meaningful header)
 */
function isEntryAtTopLevel(entry: FlatEntry): boolean {
	// Entry is at top level if all headers are null or have empty text
	const h1Empty = !entry.h1 || !entry.h1.text || entry.h1.text.trim() === '';
	const h2Empty = !entry.h2 || !entry.h2.text || entry.h2.text.trim() === '';
	const h3Empty = !entry.h3 || !entry.h3.text || entry.h3.text.trim() === '';

	return h1Empty && h2Empty && h3Empty;
}

/**
 * SRS Pattern Hiding Logic (copied from SRSReviewView)
 */
function getHighestPriorityPattern(text: string): 'curly' | 'code' | 'triple' | 'bold' | null {
	// Priority 1: {{content}}
	if (/\{\{[^}]+\}\}/.test(text)) {
		return 'curly';
	}

	// Priority 2: `code` or ```code blocks```
	if (/`[^`]+`/.test(text) || /```[\s\S]+?```/.test(text)) {
		return 'code';
	}

	// Priority 3: :::
	if (/:::/.test(text)) {
		return 'triple';
	}

	// Priority 4: **bold**
	if(/\*\*[^*]+\*\*/.test(text)) {
		return 'bold';
	}

	return null;
}

function hideContent(text: string): string {
	const pattern = getHighestPriorityPattern(text);

	if (!pattern) {
		return text;
	}

	switch (pattern) {
		case 'curly':
			return text.replace(/\{\{[^}]+\}\}/g, '___');

		case 'code':
			return text
				.replace(/```[\s\S]+?```/g, '___')
				.replace(/`[^`]+`/g, '___');

		case 'triple':
			const parts = text.split(':::');
			return parts[0] || text;

		case 'bold':
			return text.replace(/\*\*([^*]+)\*\*/g, '*___*');

		default:
			return text;
	}
}

/**
 * Convert entry to SRS preview format (with patterns hidden)
 */
function entryToSRSPreview(entry: ParsedEntry, context?: string, _unused?: string): string {
	let mainText = entry.text;
	let hasExplicitPatterns = hasTestablePatterns(mainText);

	// Check if sub-items have patterns
	let subItemsHavePatterns = false;
	if (entry.subItems) {
		for (const subItem of entry.subItems) {
			if (hasTestablePatterns(subItem.content)) {
				subItemsHavePatterns = true;
				break;
			}
			if (subItem.nestedCodeBlock && hasTestablePatterns(subItem.nestedCodeBlock.content)) {
				subItemsHavePatterns = true;
				break;
			}
		}
	}

	// If no explicit patterns in text or sub-items, use context (header or filename) as bold
	if (!hasExplicitPatterns && !subItemsHavePatterns && context) {
		// Use context as bold (will be hidden in SRS)
		mainText = `**${context}**: ${mainText}`;
	}

	let preview = `${hideContent(mainText)}`;

	if (entry.subItems && entry.subItems.length > 0) {
		preview += '\n\nSub-items:';
		for (const subItem of entry.subItems) {
			const marker = subItem.listType === 'dash' ? '•' :
			               subItem.listType === 'asterisk' ? '*' :
			               subItem.listType === 'numbered' ? '1.' :
			               subItem.listType === 'checkbox' ? (subItem.checked ? '[x]' : '[ ]') : '';
			preview += `\n  ${marker} ${hideContent(subItem.content)}`;

			// Handle nested code blocks
			if (subItem.nestedCodeBlock) {
				preview += `\n    Code: ${hideContent(subItem.nestedCodeBlock.content)}`;
			}
		}
	}

	return preview;
}

/**
 * Add record badges to reading view
 */
export function addRecordBadgesToReadingView(element: HTMLElement, context: MarkdownPostProcessorContext, plugin: HighlightSpaceRepeatPlugin): void {
	// Check if current file path is excluded from badges
	const settings = get(settingsDataStore);
	const currentPath = context.sourcePath;
	if (settings.badgeExcludedPaths && currentPath) {
		const excludedPaths = settings.badgeExcludedPaths.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
		const isExcluded = excludedPaths.some((excludedPath: string) => {
			// Check if path starts with excluded path (folder match) or exact file match
			return currentPath.startsWith(excludedPath) || currentPath === excludedPath;
		});
		if (isExcluded) {
			return;
		}
	}

	const sectionInfo = context.getSectionInfo(element);
	const baseLineNumber = sectionInfo?.lineStart ?? 0;

	// Find all elements with kh-highlighted class (keyword entries that have been processed)
	const highlightedElements = element.querySelectorAll('.kh-highlighted');

	highlightedElements.forEach((el) => {
		const htmlEl = el as HTMLElement;

		// Extract keywords from data-keywords attribute
		const keywordsAttr = htmlEl.getAttribute('data-keywords');
		if (!keywordsAttr) {
			return;
		}

		const keywords = keywordsAttr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);
		if (keywords.length === 0) {
			return;
		}

		// Check collecting status
		const status = getCollectingStatus(keywords);
		if (!status) {
			return;
		}

		// Don't show badges for IGNORED keywords
		if (status === CollectingStatus.IGNORED) {
			return;
		}

		// Find the parent paragraph container (el-p)
		let container = htmlEl.parentElement;
		while (container && !container.classList.contains('el-p')) {
			container = container.parentElement;
		}

		if (!container) {
			return;
		}

		// Calculate actual line number in the file
		const lineNumber = baseLineNumber + 1;

		// Determine badge (IGNORED filtered above)
		// SPACED → 🔄, PARSED → ✅
		const badge = isSpaced(status) ? '🔄' : '✅';

		// Create badge element
		const badgeEl = document.createElement('span');
		badgeEl.className = 'reading-view-record-badge';
		badgeEl.textContent = badge;

		// Store file path and line number as data attributes
		badgeEl.setAttribute('data-file-path', currentPath);
		badgeEl.setAttribute('data-line-number', lineNumber.toString());

		// Create tooltip (empty initially)
		const tooltip = document.createElement('div');
		tooltip.className = 'record-badge-tooltip';
		tooltip.innerHTML = '<pre>Loading...</pre>';
		badgeEl.appendChild(tooltip);

		// Load actual parsed data on hover
		badgeEl.addEventListener('mouseenter', async () => {
			tooltip.classList.add('visible');

			// Try to load the actual parsed entry
			const parsedRecords = await loadParsedRecords(plugin);
			if (!parsedRecords) {
				tooltip.innerHTML = '<pre>Error: Could not load parsed records</pre>';
				return;
			}

			// Find the record for this file
			const fileRecord = parsedRecords.find(record => record.filePath === currentPath);
			if (!fileRecord) {
				tooltip.innerHTML = `<pre>No parsed data found for this file</pre>`;
				return;
			}

			// Find the entry at this line number
			const entry = findEntryByLineNumber(fileRecord, lineNumber);
			if (!entry) {
				tooltip.innerHTML = `<pre>No parsed entry found at line ${lineNumber}</pre>`;
				return;
			}

			// Convert entry to YAML and display
			const yaml = entryToYaml(entry);
			let tooltipContent = `<pre>${yaml}</pre>`;

			// For SPACED entries, also show SRS preview
			if (isSpaced(status)) {
				// Check if there's something to hide
				const hasPatterns = entryHasTestableContent(entry);
				const atTopLevel = isEntryAtTopLevel(entry);
				const headerWithKeyword = findHeaderWithKeyword(entry, keywords[0]);
				const shouldShowSRS = hasPatterns || atTopLevel || headerWithKeyword !== null;

				if (shouldShowSRS) {
					// Determine context
					const fileNameWithoutExt = getFileNameFromPath(fileRecord.filePath).replace(/\.[^/.]+$/, '');
					let contextToUse: string | undefined = undefined;
					if (headerWithKeyword) {
						contextToUse = headerWithKeyword;
					} else if (atTopLevel) {
						contextToUse = fileNameWithoutExt;
					}

					// Generate SRS preview
					const preview = entryToSRSPreview(entry, contextToUse, undefined);
					tooltipContent += `<div class="srs-preview-header" style="margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--background-modifier-border);">SRS Preview (patterns hidden):</div><pre>${preview}</pre>`;
				}
			}

			tooltip.innerHTML = tooltipContent;
		});

		badgeEl.addEventListener('mouseleave', () => {
			tooltip.classList.remove('visible');
		});

		// Insert badge at the beginning of the container
		container.insertBefore(badgeEl, container.firstChild);

		// Add SRS preview badge (brain icon) - ONLY if there's something to hide
		if (isSpaced(status)) {
			// Load entry to check if there's something to hide
			loadParsedRecords(plugin).then(parsedRecords => {
				if (!parsedRecords) {
					return;
				}

				const fileRecord = parsedRecords.find(record => record.filePath === currentPath);
				if (!fileRecord) {
					return;
				}

				const entry = findEntryByLineNumber(fileRecord, lineNumber);
				if (!entry) {
					return;
				}

				// Check for 6 cases where brain should show:
				// 1-4: Has testable patterns ({{, `, :::, **)
				const hasPatterns = entryHasTestableContent(entry);

				// 5: Entry is at top level (no header) → hide filename
				const atTopLevel = isEntryAtTopLevel(entry);

				// 6: Entry is under header with same keyword → hide header
				const headerWithKeyword = findHeaderWithKeyword(entry, keywords[0]);

				// Show brain ONLY if one of the 6 cases is true
				const shouldShowBrain = hasPatterns || atTopLevel || headerWithKeyword !== null;

				if (!shouldShowBrain) {
					return;
				}

				const srsBadgeEl = document.createElement('span');
				srsBadgeEl.className = 'reading-view-srs-badge';
				srsBadgeEl.textContent = '🧠';

				// Store file path and line number as data attributes
				srsBadgeEl.setAttribute('data-file-path', currentPath);
				srsBadgeEl.setAttribute('data-line-number', lineNumber.toString());

				// Create tooltip for SRS preview
				const srsTooltip = document.createElement('div');
				srsTooltip.className = 'srs-badge-tooltip';
				srsTooltip.innerHTML = '<pre>Loading preview...</pre>';
				srsBadgeEl.appendChild(srsTooltip);

				// Load SRS preview on hover
				srsBadgeEl.addEventListener('mouseenter', async () => {
					srsTooltip.classList.add('visible');

					// Get filename without extension for context
					const fileNameWithoutExt = getFileNameFromPath(fileRecord.filePath).replace(/\.[^/.]+$/, '');

					// Determine context: header if available, otherwise filename if at top level
					let contextToUse: string | undefined = undefined;
					if (headerWithKeyword) {
						contextToUse = headerWithKeyword;
					} else if (atTopLevel) {
						contextToUse = fileNameWithoutExt;
					}

					// Convert entry to SRS preview with hidden patterns
					const preview = entryToSRSPreview(entry, contextToUse, undefined);
					srsTooltip.innerHTML = `<div class="srs-preview-header">SRS Preview (patterns hidden):</div><pre>${preview}</pre>`;
				});

				srsBadgeEl.addEventListener('mouseleave', () => {
					srsTooltip.classList.remove('visible');
				});

				// Insert SRS badge after the record badge
				container.insertBefore(srsBadgeEl, badgeEl.nextSibling);
			});
		}
	});
}
