import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Topic } from '../../interfaces/Topic';
import type { Subject } from '../../interfaces/Subject';
import { getAllKeywords } from '../../utils/parse-helpers';
import type { HeaderGroup } from './MatrixCell';
import { FilterParser } from '../../services/FilterParser';
import { PlaceholderExpansion } from '../../services/PlaceholderExpansion';

/**
 * Shared helper: Collect headers matching a single topic (keyword OR tag)
 * NOTE: h1/h2/h3 are string values in FlatEntry, not header objects
 * We match based on entry's keywords/tags that belong to that header
 */
export function collectHeadersForTopic(
	allRecords: ParsedFile[],
	topic: { topicKeyword?: string; topicTag?: string }
): Map<string, HeaderGroup> {
	const headers = new Map<string, HeaderGroup>();

	if (!topic.topicKeyword && !topic.topicTag) {
		return headers;
	}

	for (const file of allRecords) {
		for (const entry of file.entries) {
			// Check header
			if (entry.header) {
				const header = entry.header;
				if (header.text || header.keywords || header.inlineKeywords) {
					// Check if header matches topic criteria
					let keywordMatch = false;
					if (topic.topicKeyword) {
						const headerKeywords = getAllKeywords(header);
						keywordMatch = headerKeywords.some(kw =>
							kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
						);
					}

					const tagMatch = topic.topicTag && header.tags?.some((tag: any) => {
						const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
						return normalizedTag === topic.topicTag;
					});

					if (keywordMatch || tagMatch) {
						const headerKey = `${file.filePath}::${header.text}`;
						if (!headers.has(headerKey)) {
							headers.set(headerKey, {
								file,
								headerText: header.text,
								headerLevel: 1,
								entries: []
							});
						}
						headers.get(headerKey)!.entries.push(entry);
					}
				}
			}
		}
	}

	console.log(`[collectHeaders] Collected ${headers.size} unique headers`);
	return headers;
}

/**
 * Shared helper: Collect intersection headers
 * Used by both PRIMARY_SECONDARY and PRIMARY_PRIMARY
 *
 * @param useFileLevelTagsOnly - true for PRIMARY_PRIMARY, false for PRIMARY_SECONDARY
 * @param requiredSubjectTag - if provided, file must also have this tag (for andMode)
 */
export function collectIntersectionHeaders(
	allRecords: ParsedFile[],
	primaryTopic: Topic,
	secondaryTopic: Topic,
	getFileLevelTags: (record: ParsedFile) => string[],
	getRecordTags: (record: ParsedFile) => string[],
	useFileLevelTagsOnly: boolean,
	requiredSubjectTag?: string
): Map<string, HeaderGroup> {
	const headers = new Map<string, HeaderGroup>();
	console.log(`[collectIntersectionHeaders] PRIMARY=${primaryTopic.name} SECONDARY=${secondaryTopic.name}`);

	for (const record of allRecords) {
		// For primary×primary, use file-level tags only. For primary×secondary, use all tags
		const fileTags = useFileLevelTagsOnly ? getFileLevelTags(record) : getRecordTags(record);

		// If andMode requires subject tag, skip files without it
		if (requiredSubjectTag && !fileTags.includes(requiredSubjectTag)) {
			continue;
		}

		// Check if topics are on file level
		const topic1InFile = primaryTopic.topicTag && fileTags.includes(primaryTopic.topicTag);
		const topic2InFile = secondaryTopic.topicTag && fileTags.includes(secondaryTopic.topicTag);

		// Count matching headers
		for (const entry of record.entries) {
			// Check header
			if (entry.header) {
				const header = entry.header;
				if (header.text || header.keywords || header.inlineKeywords) {
					// Check if topic1 (primary) is in this header
					let topic1KeywordMatch = false;
					if (primaryTopic.topicKeyword) {
						const headerKeywords = getAllKeywords(header);
						topic1KeywordMatch = headerKeywords.some(kw =>
							kw.toLowerCase() === primaryTopic.topicKeyword!.toLowerCase()
						);
					}
					const topic1TagMatch = primaryTopic.topicTag && header.tags?.some((tag: any) => {
						const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
						return normalizedTag === primaryTopic.topicTag;
					});
					const topic1InHeader = topic1KeywordMatch || topic1TagMatch;

					// Check if topic2 (secondary) is in this header
					let topic2KeywordMatch = false;
					if (secondaryTopic.topicKeyword) {
						const headerKeywords = getAllKeywords(header);
						topic2KeywordMatch = headerKeywords.some(kw =>
							kw.toLowerCase() === secondaryTopic.topicKeyword!.toLowerCase()
						);
					}
					const topic2TagMatch = secondaryTopic.topicTag && header.tags?.some((tag: any) => {
						const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
						return normalizedTag === secondaryTopic.topicTag;
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
								headerLevel: 1,
								entries: []
							});
						}
						headers.get(headerKey)!.entries.push(entry);
					}
				}
			}
		}
	}

	console.log(`[collectHeaders] Collected ${headers.size} unique headers`);
	return headers;
}

/**
 * Get matching records for a filter expression
 * Replaces getMatchingRecords() with direct FilterParser usage
 */
export function getMatchingRecords(
	parsedFiles: ParsedFile[],
	filterExpression: string,
	primaryTopic: Topic | null,
	subject: Subject,
	andMode?: boolean
): Array<{ entry: FlatEntry; file: ParsedFile }> {
	if (!filterExpression || !filterExpression.trim()) {
		return [];
	}

	// Expand placeholders using PlaceholderExpansion
	const expandedExpr = PlaceholderExpansion.expandPlaceholders(
		filterExpression,
		primaryTopic,
		subject
	);

	if (filterExpression !== expandedExpr) {
		console.log(`[getMatchingRecords] Expanded: "${filterExpression}" → "${expandedExpr}" (topic: ${primaryTopic?.name})`);
	}

	// Split on W: or w: to separate SELECT and WHERE clauses (case-insensitive)
	const hasWhere = /\s+[Ww]:\s+/.test(expandedExpr);
	let selectExpr = expandedExpr;
	let whereExpr = '';

	if (hasWhere) {
		const parts = expandedExpr.split(/\s+[Ww]:\s+/);
		selectExpr = parts[0].trim();
		whereExpr = parts[1]?.trim() || '';
	}

	// Add subject tag to WHERE clause if this is a green cell (AND mode enabled)
	const includesSubjectTag = andMode || false;
	if (includesSubjectTag && subject?.mainTag) {
		// Normalize: strip leading # if present, then add it back
		const subjectTag = subject.mainTag.replace(/^#/, '');
		const normalizedTag = `#${subjectTag}`;

		if (whereExpr) {
			// Only add if not already present in WHERE clause
			if (!whereExpr.includes(normalizedTag)) {
				whereExpr = `${normalizedTag} AND (${whereExpr})`;
			}
		} else {
			// Create new WHERE clause with just the subject tag
			whereExpr = normalizedTag;
		}
	}

	// Compile expressions using FilterParser
	let selectCompiled: any;
	let whereCompiled: any = null;

	try {
		selectCompiled = FilterParser.compile(selectExpr);
		if (whereExpr) {
			whereCompiled = FilterParser.compile(whereExpr);
		}
	} catch (error) {
		console.error(`[getMatchingRecords] Failed to compile expression: "${expandedExpr}"`, error);
		return [];
	}

	// Collect matching entries using FlatEntry
	const matchingEntries: Array<{ entry: FlatEntry; file: ParsedFile }> = [];

	for (const file of parsedFiles) {
		for (const entry of file.entries) {
			// First apply WHERE clause (if present)
			if (whereCompiled) {
				if (!FilterParser.evaluateFlatEntry(whereCompiled.ast, entry, undefined, whereCompiled.modifiers)) {
					continue; // Doesn't match WHERE clause, skip
				}
			}

			// Then apply SELECT clause
			if (FilterParser.evaluateFlatEntry(selectCompiled.ast, entry, undefined, selectCompiled.modifiers)) {
				matchingEntries.push({ entry, file });
			}
		}
	}

	return matchingEntries;
}
