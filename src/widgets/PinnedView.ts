import { App, ItemView, WorkspaceLeaf, TFile, MarkdownView, Notice, MarkdownRenderer } from 'obsidian';
import type { ParsedFile, ParsedHeader, ParsedEntry } from '../interfaces/ParsedFile';
import { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import { KHEntry } from '../components/KHEntry';
import type { KeywordStyle } from '../shared/keyword-style';
import { RecordParser } from '../services/RecordParser';
import { getAllKeywords } from '../utils/parse-helpers';

export const PINNED_VIEW_TYPE = 'kh-pinned-view';

export class PinnedView extends ItemView {
	private plugin: HighlightSpaceRepeatPlugin;
	private lastOpenedFile: TFile | null = null;
	private parser: RecordParser;
	private refreshInterval: number | null = null;
	private lastRenderedHash: string = '';
	private activeFilter: string = 'pin'; // Single active filter: 'pin', keyword name, category icon, or code name
	private showOnlyPinned: boolean = true; // Toggle: true = only pinned entries, false = all entries

	constructor(leaf: WorkspaceLeaf, plugin: HighlightSpaceRepeatPlugin) {
		super(leaf);
		this.plugin = plugin;
		const { get } = require('svelte/store');
		const { settingsStore } = require('../stores/settings-store');
		const settings = get(settingsStore);
		this.parser = new RecordParser(this.app, settings.parserSettings);
	}

	/**
	 * Get the CSS class to use for a keyword entry
	 * COPIED FROM MATRIX WIDGET
	 */
	private getKeywordClass(keywordName: string): string {
		const keywordStyle = this.plugin.api.getKeywordStyle(keywordName);

		return keywordStyle?.keyword || keywordName;
	}

	/**
	 * Resolve which keywords should provide icons based on iconPriority
	 * Returns array of keyword strings to display icons from
	 */
	private resolveIconKeywords(keywordStrings: string[]): string[] {
		if (!keywordStrings || keywordStrings.length === 0) {
			return keywordStrings || [];
		}

		// Convert keyword strings to KeywordStyle objects
		const keywordStyles: KeywordStyle[] = keywordStrings
			.map(kw => this.plugin.api.getKeywordStyle(kw))
			.filter((style): style is KeywordStyle => style !== undefined);

		if (keywordStyles.length === 0) {
			return [keywordStrings[0]];
		}

		// Find highest icon priority
		const maxIconPriority = Math.max(...keywordStyles.map(k => k.iconPriority || 1));

		// Get all keywords with highest priority that have icons
		const winnersWithIcons = keywordStyles
			.filter(k => (k.iconPriority || 1) === maxIconPriority && k.generateIcon)
			.map(k => k.keyword);

		// Return winner keywords, or first keyword if none have icons
		return winnersWithIcons.length > 0 ? winnersWithIcons : [keywordStrings[0]];
	}

	getViewType(): string {
		return PINNED_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Pinned Items';
	}

	getIcon(): string {
		return 'pin';
	}

	async onOpen(): Promise<void> {
		// Listen for file opens to track last opened file
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) {
					this.lastOpenedFile = file;
					this.render();
				}
			})
		);

		// Set up auto-refresh every 10 seconds
		this.refreshInterval = window.setInterval(() => {
			this.render();
		}, 10000);

		// Initial render
		this.render();
	}

	async onClose(): Promise<void> {
		// Stop auto-refresh
		if (this.refreshInterval !== null) {
			window.clearInterval(this.refreshInterval);
			this.refreshInterval = null;
		}
	}

	private async render(): Promise<void> {
		// console.log('[Pinned View] 🔄 Render called at', new Date().toLocaleTimeString());

		// Check if we have a file open
		if (!this.lastOpenedFile) {
			const container = this.containerEl.children[1];
			container.empty();
			container.addClass('kh-pinned-view-container');
			container.createEl('div', {
				text: 'No file currently open',
				cls: 'kh-pinned-empty'
			});
			this.lastRenderedHash = '';
			return;
		}

		// Parse the current file
		// console.log('[Pinned View] 📖 Parsing file:', this.lastOpenedFile.path);
		const currentRecord = await this.getCurrentFileRecord();
		if (!currentRecord) {
			const container = this.containerEl.children[1];
			container.empty();
			container.addClass('kh-pinned-view-container');
			container.createEl('div', {
				text: 'Could not load file data',
				cls: 'kh-pinned-empty'
			});
			this.lastRenderedHash = '';
			return;
		}

		// Get pinned items from the already-parsed record
		const pinnedHeaders = this.extractPinnedHeaders(currentRecord);

		// Get headers for chip generation AND display (respects showOnlyPinned flag)
		const headersToDisplay = this.showOnlyPinned ? pinnedHeaders : this.extractAllHeaders(currentRecord);

		// Create hash of current state (file path + headers used for display and chips + activeFilter + showOnlyPinned)
		const currentHash = this.computeHash(this.lastOpenedFile.path, pinnedHeaders) +
			this.computeHash('chips', headersToDisplay) +
			`|filter:${this.activeFilter}|pinned:${this.showOnlyPinned}`;

		// Check if anything changed - if not, skip re-render
		if (currentHash === this.lastRenderedHash) {
			// console.log('[Pinned View] ⏭️  No changes detected, skipping re-render');
			return;
		}

		// console.log('[Pinned View] ✨ Changes detected, re-rendering');
		this.lastRenderedHash = currentHash;

		// Clear and rebuild container
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('kh-pinned-view-container');

		// Detect subject from file tags
		const { matchedSubject } = await this.detectSubjectFromTags();

		// File name with subject icon (shortened to 5 chars max) + chips inline
		const headerRow = container.createEl('div', { cls: 'kh-pinned-header-row' });
		headerRow.style.display = 'flex';
		headerRow.style.gap = '8px';
		headerRow.style.alignItems = 'center';
		headerRow.style.flexWrap = 'wrap';

		const fileNameEl = headerRow.createEl('div', { cls: 'kh-pinned-filename' });
		if (matchedSubject) {
			const subjectName = matchedSubject.name.length > 5
				? matchedSubject.name.substring(0, 5) + '...'
				: matchedSubject.name;
			const fileName = this.lastOpenedFile.basename.length > 5
				? this.lastOpenedFile.basename.substring( 0, 5) + '...'
				: this.lastOpenedFile.basename;
			fileNameEl.createSpan({ text: `${matchedSubject.icon} ${subjectName} ` });
			fileNameEl.createSpan({ text: fileName, attr: { style: 'opacity: 0.6;' } });
		} else {
			const fileName = this.lastOpenedFile.basename.length > 5
				? this.lastOpenedFile.basename.substring(0, 5) + '...'
				: this.lastOpenedFile.basename;
			fileNameEl.createSpan({ text: fileName });
		}
		fileNameEl.style.fontSize = '0.9em';
		fileNameEl.style.margin = '0';
		fileNameEl.style.padding = '0';
		fileNameEl.style.whiteSpace = 'nowrap';

		// Add chip filters inline (using headersToDisplay to respect checkbox state)
		await this.renderChipFilters(headerRow as HTMLElement, headersToDisplay, matchedSubject);

		// Add checkbox for toggling pinned-only mode
		const checkboxWrapper = headerRow.createEl('label', { cls: 'kh-pinned-checkbox-wrapper' });
		checkboxWrapper.style.marginLeft = 'auto';
		checkboxWrapper.style.display = 'flex';
		checkboxWrapper.style.alignItems = 'center';
		checkboxWrapper.style.gap = '4px';
		checkboxWrapper.style.cursor = 'pointer';
		checkboxWrapper.style.fontSize = '0.85em';

		const checkbox = checkboxWrapper.createEl('input', { type: 'checkbox' });
		checkbox.checked = this.showOnlyPinned;
		checkbox.addEventListener('change', async () => {
			this.showOnlyPinned = checkbox.checked;
			await this.render();
		});

		checkboxWrapper.createSpan({ text: '📌', attr: { style: 'font-size: 1em;' } });

		// Add SRS review button with due card count tooltip
		const srsBtn = headerRow.createEl('button', {
			text: '🧠',
			cls: 'kh-pinned-srs-btn',
			title: 'Loading...'
		});
		srsBtn.style.padding = '2px 8px';
		srsBtn.style.fontSize = '0.9em';
		srsBtn.style.cursor = 'pointer';

		// Update tooltip with due card count (always use pinnedHeaders for SRS)
		this.updateSRSButtonTooltip(srsBtn, pinnedHeaders);

		srsBtn.addEventListener('click', async () => {
			await this.startSRSReview(pinnedHeaders);
		});

		if (headersToDisplay.length === 0) {
			const emptyMessage = this.showOnlyPinned ? 'No pinned items in this file' : 'No entries in this file';
			container.createEl('div', {
				text: emptyMessage,
				cls: 'kh-pinned-empty'
			});
			return;
		}

		// Display items using same structure as matrix widget
		const entriesContainer = container.createDiv({ cls: 'kh-pinned-entries' });

		for (const header of headersToDisplay) {
			// First pass: check if ANY entries will be displayed under this header
			let hasDisplayableEntries = false;
			const entriesToRender: Array<{ entry: ParsedEntry; shouldDisplay: boolean }> = [];

			if (header.entries && header.entries.length > 0) {
				for (const entry of header.entries) {
					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						// Check if this entry contains "pin" keyword (NOT in text content)
						const hasPinKeyword = entry.keywords.some(kw =>
							kw.toLowerCase().includes('pin')
						);

						const hasPinInSubItems = entry.subItems?.some(subItem =>
							subItem.keywords?.some(kw => kw.toLowerCase().includes('pin'))
						) || false;

						// Determine if entry should be displayed
						let shouldDisplay = false;

						if (!this.showOnlyPinned) {
							// Show all entries mode: check if entry matches active filter
							if (this.activeFilter === 'pin') {
								// Pin filter in "show all" mode: show all entries (respecting filter expression)
								shouldDisplay = this.shouldDisplayEntry(entry, matchedSubject);
							} else {
								// Other filters: show if matches filter
								shouldDisplay = this.shouldDisplayEntry(entry, matchedSubject);
							}
						} else {
							// Pinned only mode (original behavior)
							if (this.activeFilter === 'pin') {
								// Pin filter: show only entries with pin keyword
								shouldDisplay = (hasPinKeyword || hasPinInSubItems) && this.shouldDisplayEntry(entry, matchedSubject);
							} else {
								// Other filters (category, keyword, code): show if matches filter
								shouldDisplay = this.shouldDisplayEntry(entry, matchedSubject);
							}
						}

						if (shouldDisplay) {
							hasDisplayableEntries = true;
						}
						entriesToRender.push({ entry, shouldDisplay });
					} else if (entry.type === 'codeblock' && (entry as any).language) {
						// Handle codeblock entries
						let shouldDisplay = false;

						if (!this.showOnlyPinned) {
							// Show all entries mode
							if (this.activeFilter === 'pin') {
								// Respect filter expression
								shouldDisplay = this.shouldDisplayEntry(entry, matchedSubject);
							} else if (this.activeFilter === (entry as any).language) {
								// Filter by code block language (also respects filter expression)
								shouldDisplay = this.shouldDisplayEntry(entry, matchedSubject);
							}
						}
						// Note: In pinned mode, codeblocks without pin keyword won't show

						if (shouldDisplay) {
							hasDisplayableEntries = true;
						}
						entriesToRender.push({ entry, shouldDisplay });
					}
				}
			}

			// Only render header if there are displayable entries
			if (hasDisplayableEntries) {
				// Render header text only if it exists and is not empty
				if (header.text && header.text.trim() !== '') {
					const headerEl = entriesContainer.createDiv({ cls: 'kh-pinned-header-text' });
					headerEl.createEl('span', {
						text: `${'#'.repeat(header.level)} ${header.text}`,
						cls: 'kh-pinned-header-marker'
					});
				}

				// Now render all entries that should be displayed
				for (const { entry, shouldDisplay } of entriesToRender) {
					if (!shouldDisplay) continue;

					if (entry.type === 'keyword' && entry.keywords && entry.keywords.length > 0) {
						// EXACT SAME CODE AS MATRIX WIDGET
						const iconKeywords = this.resolveIconKeywords(entry.keywords);
						const primaryKeyword = entry.keywords[0];
						const primaryKeywordClass = this.getKeywordClass(primaryKeyword);
						const entryItem = entriesContainer.createDiv({
							cls: `kh-widget-filter-entry ${primaryKeywordClass}`
						});

						// Make entry clickable - navigate to line in source file
						entryItem.style.cursor = 'pointer';
						entryItem.addEventListener('click', async () => {
							if (this.lastOpenedFile && entry.lineNumber !== undefined) {
								// Open the file (or focus if already open)
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(this.lastOpenedFile, {
									eState: { line: entry.lineNumber }
								});

								// Get the editor and navigate to the specific line
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									// Set cursor to the beginning of the line
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									// Scroll to a few lines above the target to ensure visibility with padding
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									// Scroll the line into view
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});

						// Render icons from all keywords with Icon/StyleAndIcon priority
						for (const iconKeyword of iconKeywords) {
							const mark = entryItem.createEl('mark', { cls: `kh-icon ${iconKeyword}` });
							mark.innerHTML = '&nbsp;';
						}
						entryItem.createEl('span', { text: ' ', cls: 'kh-separator' });

						// Render entry text with image/quote support (compact mode)
						await KHEntry.renderKeywordEntry(
							entryItem,
							entry,
							currentRecord,
							this.plugin,
							true // compact mode for matrix
						);
					} else if (entry.type === 'codeblock' && (entry as any).language) {
						const codeblockItem = entriesContainer.createDiv({
							cls: 'kh-widget-filter-entry codeblock kh-entry-compact'
						});

						codeblockItem.style.cursor = 'pointer';
						codeblockItem.addEventListener('click', async () => {
							if (this.lastOpenedFile && entry.lineNumber !== undefined) {
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(this.lastOpenedFile, {
									eState: { line: entry.lineNumber }
								});

								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
									const scrollToLine = Math.max(0, entry.lineNumber - 3);
									view.editor.scrollIntoView({
										from: { line: scrollToLine, ch: 0 },
										to: { line: scrollToLine, ch: 0 }
									}, true);
								}
							}
						});

						// Use MarkdownRenderer directly for code blocks (same as KHEntry.renderSubItems)
						const codeMarkdown = '```' + ((entry as any).language || '') + '\n' + ((entry as any).text || '') + '\n```';
						MarkdownRenderer.renderMarkdown(
							codeMarkdown,
							codeblockItem,
							currentRecord.filePath,
							this.plugin as any
						);
					}
				}
			}
		}

		// console.log('[Pinned View] ✅ Render complete');
	}

	/**
	 * Compute a hash of the current state to detect changes
	 * Uses file path + stringified pinned headers data
	 */
	private computeHash(filePath: string, pinnedHeaders: Array<{ text: string; level: number; keywords: string[]; entries: ParsedEntry[] }>): string {
		// Create a simplified representation of pinned headers for hashing
		const headerData = pinnedHeaders.map(header => ({
			text: header.text,
			level: header.level,
			keywords: header.keywords,
			entryCount: header.entries?.length || 0,
			entries: header.entries?.map(entry => ({
				keywords: entry.keywords,
				text: entry.text,
				subItemCount: entry.subItems?.length || 0
			}))
		}));

		// Simple string hash (file path + JSON representation)
		const dataString = filePath + JSON.stringify(headerData);
		return dataString;
	}

	/**
	 * Parse the currently open file directly using RecordParser
	 */
	private async getCurrentFileRecord(): Promise<ParsedFile | null> {
		if (!this.lastOpenedFile) {
			return null;
		}

		try {
			// Get keywords to parse from settings
			const keywordsToParse = this.getKeywordsToParse();

			// Parse file directly
			const parsedRecord = await this.parser.parseFile(
				this.lastOpenedFile,
				keywordsToParse
			);

			return parsedRecord;
		} catch (error) {
			console.error('[Pinned View] Error parsing current file:', error);
			return null;
		}
	}

	/**
	 * Get keywords that should be parsed from settings
	 * For Pinned View, we parse ALL keywords to ensure we catch everything
	 */
	private getKeywordsToParse(): string[] {
		const keywordsToParse: string[] = [];
		const categories = this.plugin.api.getCategories();

		// Parse ALL keywords, not just PARSED/SPACED ones
		for (const category of categories) {
			for (const keyword of category.keywords) {
				keywordsToParse.push(keyword.keyword);
			}
		}

		// Always include "pin" keyword for the pinned view, regardless of whether it's in settings
		if (!keywordsToParse.some(kw => kw.toLowerCase() === 'pin')) {
			keywordsToParse.push('pin');
		}

		// console.log('[Pinned View] Keywords to parse:', keywordsToParse);
		return keywordsToParse;
	}

	/**
	 * Get alias map from settings
	 * For Pinned View, include ALL keyword aliases
	 */
	/**
	 * Extract ALL headers with entries from a parsed record (for chip generation)
	 */
	private extractAllHeaders(currentRecord: ParsedFile): Array<{ text: string; level: number; keywords: string[]; entries: ParsedEntry[] }> {
		// Group entries by their headers using a Map
		const headerMap = new Map<string, { text: string; level: number; keywords: string[]; entries: ParsedEntry[] }>();

		for (const entry of currentRecord.entries) {
			// Check all header levels (h1, h2, h3) for this entry
			const headerLevels = [
				entry.h1 ? { level: 1, info: entry.h1 } : null,
				entry.h2 ? { level: 2, info: entry.h2 } : null,
				entry.h3 ? { level: 3, info: entry.h3 } : null
			].filter(h => h !== null);

			for (const headerLevel of headerLevels) {
				const header = headerLevel!.info;
				if (header.text || header.keywords || header.inlineKeywords) {
					// Use text if available, otherwise use keywords joined with space
					const headerIdentifier = header.text || (header.keywords ? header.keywords.join(' ') : '');
					const headerKey = `${headerLevel!.level}:${headerIdentifier}`;
					if (!headerMap.has(headerKey)) {
						headerMap.set(headerKey, {
							text: header.text,
							level: headerLevel!.level,
							keywords: header.keywords || [],
							entries: []
						});
					}
					headerMap.get(headerKey)!.entries.push(entry);
				}
			}
		}

		return Array.from(headerMap.values());
	}

	/**
	 * Extract headers containing "pin" keyword from a parsed record
	 * ONLY matches on keywords in header.keywords or entry.keywords - NOT on text content
	 * If showOnlyPinned is false, returns ALL headers with entries
	 */
	private extractPinnedHeaders(currentRecord: ParsedFile): Array<{ text: string; level: number; keywords: string[]; entries: ParsedEntry[] }> {
		// If showOnlyPinned is false, return ALL headers (same as extractAllHeaders)
		if (!this.showOnlyPinned) {
			return this.extractAllHeaders(currentRecord);
		}

		// Original behavior: only pinned headers
		// Group entries by their headers, but only include headers with "pin" keyword
		const headerMap = new Map<string, { text: string; level: number; keywords: string[]; entries: ParsedEntry[] }>();

		for (const entry of currentRecord.entries) {
			// Check all header levels (h1, h2, h3) for this entry
			const headerLevels = [
				entry.h1 ? { level: 1, info: entry.h1 } : null,
				entry.h2 ? { level: 2, info: entry.h2 } : null,
				entry.h3 ? { level: 3, info: entry.h3 } : null
			].filter(h => h !== null);

			for (const headerLevel of headerLevels) {
				const header = headerLevel!.info;
				if (header.text || header.keywords || header.inlineKeywords) {
					// Check if header keywords contain "pin" (includes inline keywords)
					const headerKeywords = getAllKeywords(header);
					const headerContainsPinKeyword = headerKeywords.some(kw =>
						kw.toLowerCase().includes('pin')
					);

					// Check if entry contains "pin" in keywords (NOT text content)
					const keywordMatch = entry.keywords?.some(kw => kw.toLowerCase().includes('pin'));
					const subItemMatch = entry.subItems?.some(subItem =>
						subItem.keywords?.some(kw => kw.toLowerCase().includes('pin'))
					);
					const entryHasPin = keywordMatch || subItemMatch;

					// Only include this header if it has pin keyword or this entry has pin
					if (headerContainsPinKeyword || entryHasPin) {
						const headerKey = `${headerLevel!.level}:${header.text}`;
						if (!headerMap.has(headerKey)) {
							headerMap.set(headerKey, {
								text: header.text,
								level: headerLevel!.level,
								keywords: header.keywords || [],
								entries: []
							});
						}
						headerMap.get(headerKey)!.entries.push(entry);
					}
				}
			}
		}

		return Array.from(headerMap.values());
	}

	/**
	 * Check if an entry should be displayed based on current filter state
	 * Also checks against subject filter expression if active
	 */
	private shouldDisplayEntry(entry: ParsedEntry, matchedSubject: any | null): boolean {
		// First, check if entry passes subject filter expression (if any)
		if (matchedSubject && matchedSubject.expression) {
			if (!this.entryMatchesFilterExpression(entry, matchedSubject.expression)) {
				return false; // Entry doesn't match global filter expression, hide it
			}
		}

		// If active filter is 'pin', show all entries (that passed expression check above)
		if (this.activeFilter === 'pin') {
			return true;
		}

		// Check if it's a category filter (category:fun)
		if (this.activeFilter.startsWith('category:')) {
			const categoryId = this.activeFilter.replace('category:', '');
			const categories = this.plugin.api.getCategories();
			const category = categories.find(cat => cat.id === categoryId);

			if (category && entry.keywords) {
				// Check if entry has any keyword from this category
				const hasKeywordFromCategory = entry.keywords.some(entryKw =>
					category.keywords.some(catKw => catKw.keyword === entryKw)
				);
				if (hasKeywordFromCategory) {
					return true;
				}
			}
			return false;
		}

		// Check if it's a keyword filter
		if (entry.keywords?.some(kw => kw === this.activeFilter)) {
			return true;
		}

		// Check if it's a category icon filter (legacy - for backward compatibility)
		const categories = this.plugin.api.getCategories();
		const entryCategories = entry.keywords?.map(kw => {
			const category = categories.find(cat =>
				cat.keywords.some(k => k.keyword === kw)
			);
			return category?.icon;
		}).filter((icon): icon is string => icon !== undefined);

		if (entryCategories?.some(cat => cat === this.activeFilter)) {
			return true;
		}

		// Check if it's a codeblock entry matching the filter
		if (entry.type === 'codeblock' && (entry as any).language === this.activeFilter) {
			return true;
		}

		// Check if it's a code block filter (inline code in text)
		if (entry.text?.includes(`\`${this.activeFilter}\``)) {
			return true;
		}

		return false;
	}

	/**
	 * Check if an entry matches the subject's filter expression
	 */
	private entryMatchesFilterExpression(entry: ParsedEntry, expression: string): boolean {
		const parsedFilter = this.parseFilterExpression(expression);
		if (!parsedFilter) {
			return true; // No filter, show all
		}

		const allCategories = this.plugin.api.getCategories();

		// Check if entry matches any allowed category
		if (parsedFilter.allowedCategoryIds.length > 0 && entry.keywords) {
			for (const categoryId of parsedFilter.allowedCategoryIds) {
				const category = allCategories.find(cat => cat.id === categoryId);
				if (category) {
					const hasKeywordFromCategory = entry.keywords.some(entryKw =>
						category.keywords.some(catKw => catKw.keyword === entryKw)
					);
					if (hasKeywordFromCategory) {
						return true;
					}
				}
			}
		}

		// Check if entry matches any allowed keyword
		if (parsedFilter.allowedKeywords.length > 0 && entry.keywords) {
			if (entry.keywords.some(kw => parsedFilter.allowedKeywords.includes(kw))) {
				return true;
			}
		}

		// Check if entry is a code block matching allowed languages
		if (parsedFilter.allowedCodeBlocks.length > 0 && entry.type === 'codeblock') {
			const lang = (entry as any).language;
			if (lang && parsedFilter.allowedCodeBlocks.includes(lang)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Render chip filters for keywords, categories, and code blocks
	 */
	private async renderChipFilters(container: HTMLElement, pinnedHeaders: Array<{ text: string; level: number; keywords: string[]; entries: ParsedEntry[] }>, matchedSubject: any | null): Promise<void> {
		console.log('[Pinned View] 🎨 renderChipFilters called with:', {
			headersCount: pinnedHeaders.length,
			showOnlyPinned: this.showOnlyPinned,
			matchedSubject: matchedSubject?.name,
			filterExpression: matchedSubject?.expression
		});

		// Extract available filters from pinned entries
		const rawFilters = this.extractAvailableFilters(pinnedHeaders);

		console.log('[Pinned View] 📊 Raw filters extracted:', rawFilters);

		// Apply filter expression from detected subject (if any)
		const filters = this.applyFilterExpression(rawFilters, matchedSubject);

		console.log('[Pinned View] ✅ Final filters after expression:', filters);

		// Pin chip (first and active by default)
		this.renderChip(container, '📌', 'pin', this.activeFilter === 'pin', async (value) => {
			this.activeFilter = value;
			await this.render();
		});

		// Keyword chips (only if no filter expression active)
		filters.keywords.forEach(keyword => {
			const style = this.plugin.api.getKeywordStyle(keyword);
			const icon = style?.generateIcon || keyword;
			this.renderChip(container, icon, keyword, this.activeFilter === keyword, async (value) => {
				this.activeFilter = value;
				await this.render();
			});
		});

		// Category chips (from filter expression)
		const allCategories = this.plugin.api.getCategories();
		filters.categoryIds.forEach(categoryId => {
			const category = allCategories.find(cat => cat.id === categoryId);
			if (category) {
				const chipValue = `category:${categoryId}`; // Use category: prefix to distinguish from keyword filters
				this.renderChip(container, category.icon, chipValue, this.activeFilter === chipValue, async (value) => {
					this.activeFilter = value;
					await this.render();
				});
			}
		});

		// Code block chips
		filters.codeBlocks.forEach(codeBlock => {
			this.renderChip(container, `\`${codeBlock}\``, codeBlock, this.activeFilter === codeBlock, async (value) => {
				this.activeFilter = value;
				await this.render();
			});
		});
	}

	/**
	 * Detect subject from file tags and return subjects + subjects list
	 */
	private async detectSubjectFromTags(): Promise<{ subjects: any[], matchedSubject: any | null }> {
		if (!this.lastOpenedFile) {
			return { subjects: [], matchedSubject: null };
		}

		// Load subjects from subjects.json
		const subjectsData = await this.plugin.loadSubjects();
		if (!subjectsData || !subjectsData.subjects || subjectsData.subjects.length === 0) {
			console.log('[Pinned View] ❌ No subjects configured');
			return { subjects: [], matchedSubject: null };
		}

		const subjects = subjectsData.subjects;

		// Get tags from BOTH frontmatter AND body content
		const tags: string[] = [];

		// 1. Get frontmatter tags (using Obsidian's metadata cache)
		const fileCache = this.app.metadataCache.getFileCache(this.lastOpenedFile);
		if (fileCache?.frontmatter?.tags) {
			const frontmatterTags = fileCache.frontmatter.tags;
			if (Array.isArray(frontmatterTags)) {
				// tags: [IT, work]
				frontmatterTags.forEach((tag: string) => {
					tags.push(tag.startsWith('#') ? tag : `#${tag}`);
				});
			} else if (typeof frontmatterTags === 'string') {
				// tags: IT
				tags.push(frontmatterTags.startsWith('#') ? frontmatterTags : `#${frontmatterTags}`);
			}
		}

		// 2. Get inline tags from body content
		const content = await this.app.vault.read(this.lastOpenedFile);
		const tagRegex = /#[\w\-\/]+/g;
		const inlineTags = content.match(tagRegex) || [];
		tags.push(...inlineTags);

		// Remove duplicates
		const uniqueTags = [...new Set(tags)];

		console.log('[Pinned View] 🏷️ Extracted tags from file:', uniqueTags);
		console.log('[Pinned View] 📚 Available subjects:', subjects.map((s: any) =>
			`${s.name} (mainTag: ${s.mainTag})`
		));

		// Match tags to subjects using mainTag field
		// Collect ALL matching subjects, then pick the most specific one (lowest fileCount)
		const matchingSubjects: any[] = [];
		for (const tag of uniqueTags) {
			const tagLower = tag.toLowerCase();
			for (const subject of subjects) {
				if (!subject.enabled) continue;

				const mainTagLower = subject.mainTag?.toLowerCase();
				if (mainTagLower === tagLower) {
					console.log(`[Pinned View] ✅ Tag "${tag}" matches subject "${subject.name}" (mainTag: ${subject.mainTag})`);
					matchingSubjects.push(subject);
				}
			}
		}

		// Pick the most specific subject (lowest fileCount)
		let matchedSubject: any | null = null;
		if (matchingSubjects.length > 0) {
			matchedSubject = matchingSubjects.reduce((mostSpecific, current) => {
				const currentFileCount = current.matrix?.cells?.['1x1']?.fileCount ?? Infinity;
				const mostSpecificFileCount = mostSpecific.matrix?.cells?.['1x1']?.fileCount ?? Infinity;
				return currentFileCount < mostSpecificFileCount ? current : mostSpecific;
			});

			console.log('[Pinned View] 🎯 Matched subject:', matchedSubject.name);
			console.log('[Pinned View] 📋 Subject icon:', matchedSubject.icon);
			console.log('[Pinned View] 📋 Subject fileCount:', matchedSubject.matrix?.cells?.['1x1']?.fileCount);
			console.log('[Pinned View] 📋 Subject expression:', matchedSubject.expression);
		} else {
			console.log('[Pinned View] ❌ No matching subject found - showing all chips');
		}

		return { subjects, matchedSubject };
	}

	/**
	 * Render subject detection box
	 */
	private async renderSubjectDetectionBox(container: HTMLElement, matchedSubject: any | null): Promise<void> {
		if (!this.lastOpenedFile) return;

		// Extract tags from content
		const fileCache = this.app.metadataCache.getFileCache(this.lastOpenedFile);
		const content = await this.app.vault.read(this.lastOpenedFile);

		// Get frontmatter tags
		const frontmatterTags: string[] = [];
		if (fileCache?.frontmatter?.tags) {
			const fmTags = fileCache.frontmatter.tags;
			if (Array.isArray(fmTags)) {
				fmTags.forEach((tag: string) => frontmatterTags.push(tag.startsWith('#') ? tag : `#${tag}`));
			} else if (typeof fmTags === 'string') {
				frontmatterTags.push(fmTags.startsWith('#') ? fmTags : `#${fmTags}`);
			}
		}

		// Get inline tags
		const tagRegex = /#[\w\-\/]+/g;
		const inlineTags = content.match(tagRegex) || [];
		const allTags = [...new Set([...frontmatterTags, ...inlineTags])];

		// ALWAYS show subject detection box for debugging
		const subjectRow = container.createDiv({ cls: 'kh-pinned-subject-row' });
		subjectRow.style.display = 'flex';
		subjectRow.style.flexDirection = 'column';
		subjectRow.style.gap = '4px';
		subjectRow.style.fontSize = '0.9em';
		subjectRow.style.marginBottom = '8px';
		subjectRow.style.padding = '8px';
		subjectRow.style.background = 'var(--background-secondary)';
		subjectRow.style.borderRadius = '6px';

		// First row: Subject label + detected subject
		const subjectLabelRow = subjectRow.createDiv();
		subjectLabelRow.style.display = 'flex';
		subjectLabelRow.style.alignItems = 'center';
		subjectLabelRow.style.gap = '8px';

		subjectLabelRow.createSpan({
			text: '📁 Subject:',
			attr: { style: 'font-weight: 600; color: var(--text-muted);' }
		});

		if (!matchedSubject) {
			// No subject matched - show warning
			const noSubjectSpan = subjectLabelRow.createSpan({
				text: `⚠️ NO MATCH`
			});
			noSubjectSpan.style.fontWeight = '700';
			noSubjectSpan.style.color = 'var(--text-error)';
		} else {
			const icon = matchedSubject.icon || '❓';
			const subjectSpan = subjectLabelRow.createSpan({ text: `${icon} ${matchedSubject.name}` });
			subjectSpan.style.fontWeight = '700';
			subjectSpan.style.fontSize = '1.1em';
			subjectSpan.style.color = 'var(--interactive-accent)';
		}

		// Second row: Tags found in file
		const tagsRow = subjectRow.createDiv();
		tagsRow.style.fontSize = '0.85em';
		tagsRow.style.color = 'var(--text-muted)';
		tagsRow.createSpan({ text: `Tags: ${allTags.join(', ') || 'none'}` });

		// Third row: Filter expression (if subject matched)
		if (matchedSubject) {
			const filterRow = subjectRow.createDiv();
			filterRow.style.fontSize = '0.85em';

			if (!matchedSubject.expression) {
				filterRow.style.color = 'var(--text-warning)';
				filterRow.createSpan({ text: '⚠️ No filter expression configured' });
			} else {
				filterRow.style.color = 'var(--text-success)';
				filterRow.createSpan({ text: `✅ Filter: ${matchedSubject.expression}` });
			}
		}
	}

	/**
	 * Parse filter expression
	 * Supports:
	 * - ":category-name-category" for categories
	 * - Space-separated keywords (e.g., "pos java")
	 * - Code blocks (e.g., "java")
	 */
	private parseFilterExpression(expression: string): { allowedCategoryIds: string[], allowedKeywords: string[], allowedCodeBlocks: string[] } | null {
		if (!expression || expression.trim() === '') {
			return null;
		}

		const allowedCategoryIds: string[] = [];
		const allowedKeywords: string[] = [];
		const allowedCodeBlocks: string[] = [];

		// Parse :category-name-category syntax
		const categoryRegex = /:([a-z0-9\-]+)-category/gi;
		let match;
		while ((match = categoryRegex.exec(expression)) !== null) {
			const categoryId = match[1].toLowerCase();
			allowedCategoryIds.push(categoryId);
			console.log('[Pinned View] Filter expression includes category:', categoryId);
		}

		// Remove category syntax from expression to get remaining keywords/code blocks
		const withoutCategories = expression.replace(/:([a-z0-9\-]+)-category/gi, '').trim();

		// Parse remaining space-separated keywords and code blocks
		if (withoutCategories) {
			const tokens = withoutCategories.split(/\s+/).filter(t => t.length > 0);
			tokens.forEach(token => {
				// Strip backticks from code block tokens (e.g., `java -> java)
				const cleanToken = token.replace(/`/g, '');

				// Both keywords and code blocks are just added to their respective lists
				// The applyFilterExpression will determine which is which based on what's in the file
				allowedKeywords.push(cleanToken);
				allowedCodeBlocks.push(cleanToken);
				console.log('[Pinned View] Filter expression includes keyword/codeblock:', cleanToken);
			});
		}

		return (allowedCategoryIds.length > 0 || allowedKeywords.length > 0 || allowedCodeBlocks.length > 0)
			? { allowedCategoryIds, allowedKeywords, allowedCodeBlocks }
			: null;
	}

	/**
	 * Extract available keywords, categories, and code blocks from pinned entries
	 */
	private extractAvailableFilters(pinnedHeaders: Array<{ text: string; level: number; keywords: string[]; entries: ParsedEntry[] }>): { keywords: string[], categories: string[], codeBlocks: string[] } {
		console.log('[Pinned View] 🔍 extractAvailableFilters called with', pinnedHeaders.length, 'headers');

		const keywords = new Set<string>();
		const categories = new Set<string>();
		const codeBlocks = new Set<string>();

		// Extract from pinned headers
		pinnedHeaders.forEach((header, headerIndex) => {
			console.log('[Pinned View] 📝 Processing header', headerIndex, '- entries:', header.entries?.length || 0);
			if (header.entries) {
				header.entries.forEach((entry, entryIndex) => {
					console.log('[Pinned View] 📌 Entry', entryIndex, 'type:', entry.type, 'keywords:', entry.keywords);
					// Extract keywords (excluding 'pin' since we have a dedicated Pin chip)
					if (entry.keywords) {
						entry.keywords.forEach(kw => {
							if (kw.toLowerCase() !== 'pin') {
								keywords.add(kw);
							}
						});
					}

					// Extract code blocks from codeblock-type entries
					if (entry.type === 'codeblock' && (entry as any).language) {
						const lang = (entry as any).language;
						console.log('[Pinned View] 📦 Found codeblock entry with language:', lang);
						codeBlocks.add(lang);
					}

					// Extract inline code blocks from text (looking for ` ` patterns)
					if (entry.text) {
						const codeBlockRegex = /`([^`]+)`/g;
						let match;
						while ((match = codeBlockRegex.exec(entry.text)) !== null) {
							codeBlocks.add(match[1]);
						}
					}
				});
			}
		});

		// Get ONLY categories that have keywords present in the pinned entries
		const allCategories = this.plugin.api.getCategories();
		const keywordsArray = Array.from(keywords);
		allCategories.forEach(cat => {
			// Check if this category has any keywords in the pinned entries
			const hasKeywordsInCategory = cat.keywords.some(k =>
				keywordsArray.includes(k.keyword)
			);
			if (hasKeywordsInCategory) {
				categories.add(cat.icon);
			}
		});

		const result = {
			keywords: Array.from(keywords),
			categories: Array.from(categories),
			codeBlocks: Array.from(codeBlocks)
		};

		console.log('[Pinned View] Available filters:', {
			keywords: result.keywords,
			categories: result.categories,
			codeBlocks: result.codeBlocks
		});

		return result;
	}

	/**
	 * Apply filter expression from detected subject to limit available chips
	 * Returns category IDs and secondary topic keywords when expression is :category-name
	 */
	private applyFilterExpression(
		filters: { keywords: string[], categories: string[], codeBlocks: string[] },
		matchedSubject: any | null
	): { keywords: string[], categoryIds: string[], secondaryTopics: string[], codeBlocks: string[] } {
		console.log('[Pinned View] 🔍 applyFilterExpression called:');
		console.log('  - matchedSubject:', matchedSubject);
		console.log('  - available keywords:', filters.keywords);

		if (!matchedSubject) {
			console.log('[Pinned View] ❌ No matched subject - showing all keywords');
			return { keywords: filters.keywords, categoryIds: [], secondaryTopics: [], codeBlocks: filters.codeBlocks };
		}

		if (!matchedSubject.expression) {
			console.log('[Pinned View] ⚠️ No filter expression configured for subject:', matchedSubject.name);
			return { keywords: filters.keywords, categoryIds: [], secondaryTopics: [], codeBlocks: filters.codeBlocks };
		}

		const filterExpression = matchedSubject.expression;
		console.log('[Pinned View] ✅ Filter expression for subject:', matchedSubject.name, '→', filterExpression);

		const parsedFilter = this.parseFilterExpression(filterExpression);
		if (!parsedFilter) {
			console.log('[Pinned View] ❌ Failed to parse filter expression:', filterExpression);
			return { keywords: filters.keywords, categoryIds: [], secondaryTopics: [], codeBlocks: filters.codeBlocks };
		}

		console.log('[Pinned View] 📊 Parsed filter:', {
			categoryIds: parsedFilter.allowedCategoryIds,
			keywords: parsedFilter.allowedKeywords,
			codeBlocks: parsedFilter.allowedCodeBlocks
		});

		// Return category IDs and secondary topics
		const allCategories = this.plugin.api.getCategories();
		const validCategoryIds: string[] = [];
		const secondaryTopics: string[] = [];
		const filteredKeywords: string[] = [];
		const filteredCodeBlocks: string[] = [];

		// Process categories
		parsedFilter.allowedCategoryIds.forEach(categoryId => {
			const category = allCategories.find(cat => cat.id === categoryId);
			if (category) {
				// Check if this category has any keywords in the pinned entries
				const hasKeywordsInPinned = category.keywords.some(k =>
					filters.keywords.includes(k.keyword)
				);
				console.log(`[Pinned View] Category "${categoryId}" (${category.icon}):`, {
					hasKeywords: hasKeywordsInPinned,
					categoryKeywords: category.keywords.map(k => k.keyword),
					pinnedKeywords: filters.keywords
				});
				if (hasKeywordsInPinned) {
					console.log('[Pinned View] ✅ Including category chip:', categoryId, category.icon);
					validCategoryIds.push(categoryId);

					// Extract secondary topics (keywords from this category that have matches)
					category.keywords.forEach(k => {
						if (filters.keywords.includes(k.keyword)) {
							secondaryTopics.push(k.keyword);
							console.log('[Pinned View] 🔖 Adding secondary topic:', k.keyword);
						}
					});
				} else {
					console.log('[Pinned View] ⚠️ Skipping category (no keywords in pinned entries):', categoryId);
				}
			} else {
				console.log('[Pinned View] ❌ Category not found:', categoryId);
			}
		});

		// Process individual keywords
		parsedFilter.allowedKeywords.forEach(keyword => {
			if (filters.keywords.includes(keyword)) {
				filteredKeywords.push(keyword);
				console.log('[Pinned View] ✅ Including keyword chip:', keyword);
			}
		});

		// Process code blocks
		parsedFilter.allowedCodeBlocks.forEach(codeBlock => {
			if (filters.codeBlocks.includes(codeBlock)) {
				filteredCodeBlocks.push(codeBlock);
				console.log('[Pinned View] ✅ Including code block chip:', codeBlock);
			}
		});

		console.log('[Pinned View] 🎯 Final results:', {
			categoryIds: validCategoryIds,
			secondaryTopics: secondaryTopics,
			keywords: filteredKeywords,
			codeBlocks: filteredCodeBlocks
		});

		return {
			keywords: filteredKeywords,
			categoryIds: validCategoryIds,
			secondaryTopics: secondaryTopics,
			codeBlocks: filteredCodeBlocks
		};
	}

	/**
	 * Render a single chip (single-selection mode)
	 */
	private renderChip(
		container: HTMLElement,
		label: string,
		value: string,
		active: boolean,
		onChange: (value: string) => Promise<void>
	): void {
		const chip = container.createEl('button', { cls: 'kh-pinned-chip' });
		chip.textContent = label;
		chip.style.padding = '4px 10px';
		chip.style.borderRadius = '12px';
		chip.style.border = '1px solid var(--background-modifier-border)';
		chip.style.cursor = 'pointer';
		chip.style.fontSize = '0.8em';
		chip.style.transition = 'all 0.2s ease';
		chip.style.background = active ? 'var(--interactive-accent)' : 'var(--background-primary)';
		chip.style.color = active ? 'var(--text-on-accent)' : 'var(--text-normal)';

		if (active) {
			chip.style.borderColor = 'var(--interactive-accent)';
		}

		console.log(`[Pinned View] 🎨 Rendering chip "${label}" (value: ${value}, active: ${active})`);

		chip.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			console.log(`[Pinned View] 🖱️ Chip clicked: "${label}" (value: ${value})`);
			console.log(`[Pinned View] 🔄 Setting activeFilter from "${this.activeFilter}" to "${value}"`);
			await onChange(value);
			console.log(`[Pinned View] ✅ After onChange, activeFilter is now: "${this.activeFilter}"`);
		});
	}

	/**
	 * Update SRS button tooltip with due card count
	 */
	private async updateSRSButtonTooltip(button: HTMLElement, pinnedHeaders: Array<{ text: string; level: number; keywords: string[]; entries: ParsedEntry[] }>): Promise<void> {
		try {
			if (!this.lastOpenedFile) {
				button.title = 'SRS Review: No file open';
				return;
			}

			// Get ALL SRS entries from this file
			const allEntries = this.plugin.srsManager.getAllSRSEntries(this.plugin.parsedRecords);
			const allFileEntries = allEntries.filter(({ file }) => file.filePath === this.lastOpenedFile!.path);

			if (allFileEntries.length === 0) {
				button.title = 'SRS Review: No entries found in this file';
				return;
			}

			// Count due entries
			const dueEntries = this.plugin.srsManager.getDueEntries(this.plugin.parsedRecords);
			const dueFileEntries = dueEntries.filter(({ file }) => file.filePath === this.lastOpenedFile!.path);

			if (dueFileEntries.length === 0) {
				button.title = `SRS Review: No entries due today (${allFileEntries.length} total in file)`;
			} else {
				button.title = `SRS Review: ${dueFileEntries.length} entries due for review (${allFileEntries.length} total in file)`;
			}
		} catch (error) {
			console.error('[PinnedView] Error updating SRS tooltip:', error);
			button.title = 'SRS Review';
		}
	}

	/**
	 * Start SRS review for ALL entries in the file
	 */
	private async startSRSReview(pinnedHeaders: Array<{ text: string; level: number; keywords: string[]; entries: ParsedEntry[] }>): Promise<void> {
		if (!this.lastOpenedFile) {
			new Notice('No file currently open');
			return;
		}

		// Get ALL SRS entries from this file
		const allEntries = this.plugin.srsManager.getAllSRSEntries(this.plugin.parsedRecords);
		const allFileEntries = allEntries.filter(({ file }) => file.filePath === this.lastOpenedFile.path);

		if (allFileEntries.length === 0) {
			new Notice('No SRS entries found in this file.');
			return;
		}

		// Filter to only DUE entries
		const dueEntries = this.plugin.srsManager.getDueEntries(this.plugin.parsedRecords);
		const dueFileEntries = dueEntries.filter(({ file }) => file.filePath === this.lastOpenedFile!.path);

		if (dueFileEntries.length === 0) {
			new Notice(`Found ${allFileEntries.length} entries in this file, but none are due for review today.`);
			return;
		}

		new Notice(`Starting SRS review: ${dueFileEntries.length} entries due (${allFileEntries.length} total in file)`);

		// Start review session with DUE entries only
		await this.plugin.activateSRSReviewView(dueFileEntries);
	}
}
