import type { ParsedFile, FlatEntry, ParsedEntrySubItem, HeaderInfo } from '../interfaces/ParsedFile';

/**
 * Get all keywords for filtering/counting (combines regular keywords + inline keywords)
 * @param entry - Entry or sub-item with keywords
 * @returns Combined array of all keywords
 */
export function getAllKeywords(entry: FlatEntry | ParsedEntrySubItem | HeaderInfo): string[] {
	const keywords: string[] = [];
	if (entry.keywords) keywords.push(...entry.keywords);
	if (entry.inlineKeywords) keywords.push(...entry.inlineKeywords);
	return keywords;
}

/**
 * Strip parsed records for space-efficient JSON storage
 *
 * Optimizations:
 * - Remove fileName (derived from filePath at runtime)
 * - Omit empty aliases array
 * - Omit empty keywords/tags from headers
 * - Remove file context properties (filePath, fileName, fileTags) from entries
 *
 * @param parsedRecords - Parsed records with full data in memory
 * @returns Stripped records ready for JSON.stringify
 */
