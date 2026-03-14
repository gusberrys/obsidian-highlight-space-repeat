import type { ParsedFile, FlatEntry } from '../interfaces/ParsedFile';
import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';
import { getAllKeywords } from '../utils/parse-helpers';

/**
 * Matrix cell types - each has different data collection logic
 */
export enum MatrixCellType {
	SUBJECT,              // 1x1: subject only, no topics
	SECONDARY_HEADER,     // 1x2, 1x3: secondary without primary
	PRIMARY_SIDE,         // 2x1, 3x1: primary without secondary
	PRIMARY_SECONDARY,    // 2x2, 2x3: primary × secondary intersection
	PRIMARY_PRIMARY       // jenkins × docker: primary × primary intersection
}

/**
 * Header group structure
 */
export interface HeaderGroup {
	file: ParsedFile;
	headerText: string;
	headerLevel: number;
	entries: FlatEntry[];
}

/**
 * MatrixCell - SINGLE source of truth for cell data collection
 *
 * Both counting and rendering use the SAME collected data.
 * This eliminates divergence between count/render logic.
 */
export class MatrixCell {
	private cellType: MatrixCellType;
	private subject: Subject;
	private primaryTopic?: Topic;
	private secondaryTopic?: Topic;

	// Helper functions injected from widget (to avoid circular deps)
	private getFileLevelTags: (record: ParsedFile) => string[];
	private getRecordTags: (record: ParsedFile) => string[];

	// Cache collected data (cleared on reconstruct)
	private cachedFiles?: ParsedFile[];
	private cachedHeaders?: Map<string, HeaderGroup>;
	private cachedRecords?: Array<{ entry: FlatEntry; file: ParsedFile }>;

	constructor(
		cellType: MatrixCellType,
		subject: Subject,
		getFileLevelTags: (record: ParsedFile) => string[],
		getRecordTags: (record: ParsedFile) => string[],
		primaryTopic?: Topic,
		secondaryTopic?: Topic
	) {
		this.cellType = cellType;
		this.subject = subject;
		this.primaryTopic = primaryTopic;
		this.secondaryTopic = secondaryTopic;
		this.getFileLevelTags = getFileLevelTags;
		this.getRecordTags = getRecordTags;
	}

	/**
	 * SINGLE source of truth for files
	 * Both counting and rendering use this
	 */
	collectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (this.cachedFiles) return this.cachedFiles;

		this.cachedFiles = this.doCollectFiles(allRecords);
		return this.cachedFiles;
	}

	/**
	 * SINGLE source of truth for headers
	 * Both counting and rendering use this
	 */
	collectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		if (this.cachedHeaders) return this.cachedHeaders;

		this.cachedHeaders = this.doCollectHeaders(allRecords);
		return this.cachedHeaders;
	}

	/**
	 * SINGLE source of truth for records
	 * Both counting and rendering use this
	 */
	collectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		if (this.cachedRecords) return this.cachedRecords;

		this.cachedRecords = this.doCollectRecords(allRecords);
		return this.cachedRecords;
	}

	/**
	 * Count files - just returns collected files length
	 */
	countFiles(allRecords: ParsedFile[]): number {
		return this.collectFiles(allRecords).length;
	}

	/**
	 * Count headers - just returns collected headers size
	 */
	countHeaders(allRecords: ParsedFile[]): number {
		return this.collectHeaders(allRecords).size;
	}

	/**
	 * Count records - just returns collected records length
	 */
	countRecords(allRecords: ParsedFile[]): number {
		return this.collectRecords(allRecords).length;
	}

	/**
	 * Check if files should be shown (respects fhDisabled flag)
	 */
	shouldShowFiles(): boolean {
		if (this.cellType === MatrixCellType.SECONDARY_HEADER && this.secondaryTopic?.fhDisabled) {
			return false;
		}
		if (this.cellType === MatrixCellType.PRIMARY_SECONDARY) {
			return !this.primaryTopic?.fhDisabled && !this.secondaryTopic?.fhDisabled;
		}
		return true;
	}

	/**
	 * Check if headers should be shown (respects fhDisabled flag)
	 */
	shouldShowHeaders(): boolean {
		return this.shouldShowFiles(); // Same logic for now
	}

	/**
	 * Get filter expression for this cell type
	 */
	getFilterExpression(): string {
		switch (this.cellType) {
			case MatrixCellType.SUBJECT:
				return this.subject.matrixOnlyFilterExp || this.subject.expression || '';

			case MatrixCellType.SECONDARY_HEADER:
				return this.secondaryTopic?.FilterExpHeader || '';

			case MatrixCellType.PRIMARY_SIDE:
				return this.primaryTopic?.matrixOnlyFilterExpSide || '';

			case MatrixCellType.PRIMARY_SECONDARY:
				return this.secondaryTopic?.appliedFilterExpIntersection || '';

			case MatrixCellType.PRIMARY_PRIMARY:
				// Build expression: (keyword1 OR keyword2) W: tag1 AND tag2
				const selectParts = [];
				if (this.primaryTopic?.topicKeyword) selectParts.push(`.${this.primaryTopic.topicKeyword}`);
				if (this.secondaryTopic?.topicKeyword) selectParts.push(`.${this.secondaryTopic.topicKeyword}`);

				const whereParts = [];
				if (this.primaryTopic?.topicTag) whereParts.push(this.primaryTopic.topicTag);
				if (this.secondaryTopic?.topicTag) whereParts.push(this.secondaryTopic.topicTag);

				let expr = '';
				if (selectParts.length > 0) {
					expr = selectParts.length > 1 ? `(${selectParts.join(' OR ')})` : selectParts[0];
				}
				if (whereParts.length > 0) {
					const whereClause = whereParts.join(' AND ');
					expr = expr ? `${expr} W: ${whereClause}` : `W: ${whereClause}`;
				}
				return expr;

			default:
				return '';
		}
	}

	/**
	 * Collect files based on cell type
	 */
	private doCollectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		switch (this.cellType) {
			case MatrixCellType.SUBJECT:
				return this.collectSubjectFiles(allRecords);

			case MatrixCellType.SECONDARY_HEADER:
				return this.collectSecondaryHeaderFiles(allRecords);

			case MatrixCellType.PRIMARY_SIDE:
				return this.collectPrimarySideFiles(allRecords);

			case MatrixCellType.PRIMARY_SECONDARY:
				return this.collectPrimarySecondaryFiles(allRecords);

			case MatrixCellType.PRIMARY_PRIMARY:
				return this.collectPrimaryPrimaryFiles(allRecords);

			default:
				return [];
		}
	}

	/**
	 * Collect headers based on cell type
	 */
	private doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		switch (this.cellType) {
			case MatrixCellType.SUBJECT:
				return this.collectSubjectHeaders(allRecords);

			case MatrixCellType.SECONDARY_HEADER:
				return this.collectSecondaryHeaderHeaders(allRecords);

			case MatrixCellType.PRIMARY_SIDE:
				return this.collectPrimarySideHeaders(allRecords);

			case MatrixCellType.PRIMARY_SECONDARY:
				return this.collectIntersectionHeaders(allRecords, false);

			case MatrixCellType.PRIMARY_PRIMARY:
				return this.collectIntersectionHeaders(allRecords, true);

			default:
				return new Map();
		}
	}

	/**
	 * Collect records based on cell type
	 */
	private doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		switch (this.cellType) {
			case MatrixCellType.SUBJECT:
				return this.collectSubjectRecords(allRecords);

			case MatrixCellType.SECONDARY_HEADER:
				return this.collectSecondaryHeaderRecords(allRecords);

			case MatrixCellType.PRIMARY_SIDE:
				return this.collectPrimarySideRecords(allRecords);

			case MatrixCellType.PRIMARY_SECONDARY:
				return this.collectPrimarySecondaryRecords(allRecords);

			case MatrixCellType.PRIMARY_PRIMARY:
				return this.collectPrimaryPrimaryRecords(allRecords);

			default:
				return [];
		}
	}

	// ==================== SUBJECT (1x1) ====================

	private collectSubjectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		// Files with subject tag BUT NOT any primary or secondary tags
		// TODO: Get primary/secondary topics from subject
		const primaryTopicTags: string[] = []; // Will need to pass this in
		const secondaryTopicTags: string[] = []; // Will need to pass this in

		return allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			const hasSubjectTag = this.subject.mainTag ? tags.includes(this.subject.mainTag) : false;
			const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag));
			const hasSecondaryTag = secondaryTopicTags.some(tag => tags.includes(tag));
			return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
		});
	}

	private collectSubjectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		const headers = new Map<string, HeaderGroup>();

		if (!this.subject.keyword && !this.subject.mainTag) {
			return headers;
		}

		for (const file of allRecords) {
			for (const entry of file.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text || header.keywords || header.inlineKeywords) {
						let keywordMatch = false;
						if (this.subject.keyword) {
							const headerKeywords = getAllKeywords(header);
							keywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === this.subject.keyword!.toLowerCase()
							);
						}

						const tagMatch = this.subject.mainTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === this.subject.mainTag;
						});

						if (keywordMatch || tagMatch) {
							const headerKey = `${file.filePath}::${header.text}`;
							if (!headers.has(headerKey)) {
								headers.set(headerKey, {
									file,
									headerText: header.text,
									headerLevel: headerLevel!.level,
									entries: []
								});
							}
							headers.get(headerKey)!.entries.push(entry);
						}
					}
				}
			}
		}

		return headers;
	}

	private collectSubjectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// TODO: Implement using FilterExpressionService or keyword matching
		return [];
	}

	// ==================== SECONDARY HEADER (1x2, 1x3) ====================

	private collectSecondaryHeaderFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.secondaryTopic?.topicTag) return [];

		return allRecords.filter(record => {
			const tags = this.getRecordTags(record);
			return tags.includes(this.secondaryTopic.topicTag!);
		});
	}

	private collectSecondaryHeaderHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		const headers = new Map<string, HeaderGroup>();

		if (!this.secondaryTopic) return headers;

		for (const file of allRecords) {
			for (const entry of file.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text || header.keywords || header.inlineKeywords) {
						let keywordMatch = false;
						if (this.secondaryTopic.topicKeyword) {
							const headerKeywords = getAllKeywords(header);
							keywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === this.secondaryTopic.topicKeyword!.toLowerCase()
							);
						}

						const tagMatch = this.secondaryTopic.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === this.secondaryTopic.topicTag;
						});

						if (keywordMatch || tagMatch) {
							const headerKey = `${file.filePath}::${header.text}`;
							if (!headers.has(headerKey)) {
								headers.set(headerKey, {
									file,
									headerText: header.text,
									headerLevel: headerLevel!.level,
									entries: []
								});
							}
							headers.get(headerKey)!.entries.push(entry);
						}
					}
				}
			}
		}

		return headers;
	}

	private collectSecondaryHeaderRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// TODO: Implement
		return [];
	}

	// ==================== PRIMARY SIDE (2x1, 3x1) ====================

	private collectPrimarySideFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.primaryTopic?.topicTag) return [];

		// Check andMode flag
		if (this.primaryTopic.andMode && this.subject.mainTag) {
			return allRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				return tags.includes(this.primaryTopic.topicTag!) && tags.includes(this.subject.mainTag!);
			});
		} else {
			return allRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				return tags.includes(this.primaryTopic.topicTag!);
			});
		}
	}

	private collectPrimarySideHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		const headers = new Map<string, HeaderGroup>();

		if (!this.primaryTopic) return headers;

		for (const file of allRecords) {
			for (const entry of file.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text || header.keywords || header.inlineKeywords) {
						let keywordMatch = false;
						if (this.primaryTopic.topicKeyword) {
							const headerKeywords = getAllKeywords(header);
							keywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === this.primaryTopic.topicKeyword!.toLowerCase()
							);
						}

						const tagMatch = this.primaryTopic.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === this.primaryTopic.topicTag;
						});

						if (keywordMatch || tagMatch) {
							const headerKey = `${file.filePath}::${header.text}`;
							if (!headers.has(headerKey)) {
								headers.set(headerKey, {
									file,
									headerText: header.text,
									headerLevel: headerLevel!.level,
									entries: []
								});
							}
							headers.get(headerKey)!.entries.push(entry);
						}
					}
				}
			}
		}

		return headers;
	}

	private collectPrimarySideRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// TODO: Implement
		return [];
	}

	// ==================== PRIMARY × SECONDARY (2x2, 2x3) ====================

	private collectPrimarySecondaryFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.primaryTopic?.topicTag || !this.secondaryTopic?.topicTag) return [];

		return allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return tags.includes(this.primaryTopic.topicTag!) && tags.includes(this.secondaryTopic.topicTag!);
		});
	}

	private collectPrimarySecondaryRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// TODO: Implement
		return [];
	}

	// ==================== PRIMARY × PRIMARY ====================

	private collectPrimaryPrimaryFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.primaryTopic?.topicTag || !this.secondaryTopic?.topicTag) return [];

		return allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return tags.includes(this.primaryTopic.topicTag!) && tags.includes(this.secondaryTopic.topicTag!);
		});
	}

	private collectPrimaryPrimaryRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// Files with BOTH tags, entries with EITHER keyword
		const records: Array<{ entry: FlatEntry; file: ParsedFile }> = [];

		if (!this.primaryTopic?.topicTag || !this.secondaryTopic?.topicTag) {
			return records;
		}

		const filesWithBothTags = this.collectFiles(allRecords);

		for (const file of filesWithBothTags) {
			for (const entry of file.entries) {
				const entryKeywords = getAllKeywords(entry);

				// Count if entry has EITHER keyword
				if ((this.primaryTopic.topicKeyword && entryKeywords.includes(this.primaryTopic.topicKeyword)) ||
					(this.secondaryTopic.topicKeyword && entryKeywords.includes(this.secondaryTopic.topicKeyword))) {
					records.push({ entry, file });
				}

				// Also check subItems
				if (entry.subItems && entry.subItems.length > 0) {
					for (const subItem of entry.subItems) {
						const subItemKeywords = getAllKeywords(subItem);
						if ((this.primaryTopic.topicKeyword && subItemKeywords.includes(this.primaryTopic.topicKeyword)) ||
							(this.secondaryTopic.topicKeyword && subItemKeywords.includes(this.secondaryTopic.topicKeyword))) {
							// Create a pseudo-entry for subItem
							records.push({ entry: { ...entry, text: subItem.text, keywords: subItem.keywords }, file });
						}
					}
				}
			}
		}

		return records;
	}

	// ==================== INTERSECTION HEADERS (shared logic) ====================

	/**
	 * Collect intersection headers
	 * Used by both PRIMARY_SECONDARY and PRIMARY_PRIMARY
	 *
	 * @param useFileLevelTagsOnly - true for PRIMARY_PRIMARY, false for PRIMARY_SECONDARY
	 */
	private collectIntersectionHeaders(allRecords: ParsedFile[], useFileLevelTagsOnly: boolean): Map<string, HeaderGroup> {
		const headers = new Map<string, HeaderGroup>();

		if (!this.primaryTopic || !this.secondaryTopic) {
			return headers;
		}

		for (const record of allRecords) {
			// For primary×primary, use file-level tags only. For primary×secondary, use all tags
			const fileTags = useFileLevelTagsOnly ? this.getFileLevelTags(record) : this.getRecordTags(record);

			// Check if topics are on file level
			const topic1InFile = this.primaryTopic.topicTag && fileTags.includes(this.primaryTopic.topicTag);
			const topic2InFile = this.secondaryTopic.topicTag && fileTags.includes(this.secondaryTopic.topicTag);

			// Count matching headers
			for (const entry of record.entries) {
				const headerLevels = [
					entry.h1 ? { level: 1, info: entry.h1 } : null,
					entry.h2 ? { level: 2, info: entry.h2 } : null,
					entry.h3 ? { level: 3, info: entry.h3 } : null
				].filter(h => h !== null);

				for (const headerLevel of headerLevels) {
					const header = headerLevel!.info;
					if (header.text || header.keywords || header.inlineKeywords) {
						// Check if topic1 is in header
						let topic1KeywordMatch = false;
						if (this.primaryTopic.topicKeyword) {
							const headerKeywords = getAllKeywords(header);
							topic1KeywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === this.primaryTopic.topicKeyword!.toLowerCase()
							);
						}
						const topic1TagMatch = this.primaryTopic.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === this.primaryTopic.topicTag;
						});
						const topic1InHeader = topic1KeywordMatch || topic1TagMatch;

						// Check if topic2 is in header
						let topic2KeywordMatch = false;
						if (this.secondaryTopic.topicKeyword) {
							const headerKeywords = getAllKeywords(header);
							topic2KeywordMatch = headerKeywords.some(kw =>
								kw.toLowerCase() === this.secondaryTopic.topicKeyword!.toLowerCase()
							);
						}
						const topic2TagMatch = this.secondaryTopic.topicTag && header.tags?.some(tag => {
							const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
							return normalizedTag === this.secondaryTopic.topicTag;
						});
						const topic2InHeader = topic2KeywordMatch || topic2TagMatch;

						// Apply the intersection rule: one in header + other on file
						const validCase1 = topic1InHeader && topic2InFile;
						const validCase2 = topic2InHeader && topic1InFile;

						if (validCase1 || validCase2) {
							const headerKey = `${record.filePath}::${header.text}`;
							if (!headers.has(headerKey)) {
								headers.set(headerKey, {
									file: record,
									headerText: header.text,
									headerLevel: headerLevel!.level,
									entries: []
								});
							}
							headers.get(headerKey)!.entries.push(entry);
						}
					}
				}
			}
		}

		return headers;
	}
}
