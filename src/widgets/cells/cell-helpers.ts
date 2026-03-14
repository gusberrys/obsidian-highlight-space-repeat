import type { ParsedFile, FlatEntry, ParsedHeader } from '../../interfaces/ParsedFile';
import type { Topic } from '../../interfaces/Topic';
import { getAllKeywords } from '../../utils/parse-helpers';
import type { HeaderGroup } from './MatrixCell';

/**
 * Shared helper: Collect headers matching a single topic (keyword OR tag)
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
			const headerLevels = [
				entry.h1 ? { level: 1, info: entry.h1 } : null,
				entry.h2 ? { level: 2, info: entry.h2 } : null,
				entry.h3 ? { level: 3, info: entry.h3 } : null
			].filter(h => h !== null);

			for (const headerLevel of headerLevels) {
				const header = headerLevel!.info;
				if (header.text || header.keywords || header.inlineKeywords) {
					let keywordMatch = false;
					if (topic.topicKeyword) {
						const headerKeywords = getAllKeywords(header);
						keywordMatch = headerKeywords.some(kw =>
							kw.toLowerCase() === topic.topicKeyword!.toLowerCase()
						);
					}

					const tagMatch = topic.topicTag && header.tags?.some(tag => {
						const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
						return normalizedTag === topic.topicTag;
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

/**
 * Shared helper: Collect intersection headers
 * Used by both PRIMARY_SECONDARY and PRIMARY_PRIMARY
 *
 * @param useFileLevelTagsOnly - true for PRIMARY_PRIMARY, false for PRIMARY_SECONDARY
 */
export function collectIntersectionHeaders(
	allRecords: ParsedFile[],
	primaryTopic: Topic,
	secondaryTopic: Topic,
	getFileLevelTags: (record: ParsedFile) => string[],
	getRecordTags: (record: ParsedFile) => string[],
	useFileLevelTagsOnly: boolean
): Map<string, HeaderGroup> {
	const headers = new Map<string, HeaderGroup>();

	for (const record of allRecords) {
		// For primary×primary, use file-level tags only. For primary×secondary, use all tags
		const fileTags = useFileLevelTagsOnly ? getFileLevelTags(record) : getRecordTags(record);

		// Check if topics are on file level
		const topic1InFile = primaryTopic.topicTag && fileTags.includes(primaryTopic.topicTag);
		const topic2InFile = secondaryTopic.topicTag && fileTags.includes(secondaryTopic.topicTag);

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
					if (primaryTopic.topicKeyword) {
						const headerKeywords = getAllKeywords(header);
						topic1KeywordMatch = headerKeywords.some(kw =>
							kw.toLowerCase() === primaryTopic.topicKeyword!.toLowerCase()
						);
					}
					const topic1TagMatch = primaryTopic.topicTag && header.tags?.some(tag => {
						const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
						return normalizedTag === primaryTopic.topicTag;
					});
					const topic1InHeader = topic1KeywordMatch || topic1TagMatch;

					// Check if topic2 is in header
					let topic2KeywordMatch = false;
					if (secondaryTopic.topicKeyword) {
						const headerKeywords = getAllKeywords(header);
						topic2KeywordMatch = headerKeywords.some(kw =>
							kw.toLowerCase() === secondaryTopic.topicKeyword!.toLowerCase()
						);
					}
					const topic2TagMatch = secondaryTopic.topicTag && header.tags?.some(tag => {
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
