import type { ParsedFile } from '../interfaces/ParsedFile';

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
export function stripParsedRecordsForSave(parsedRecords: ParsedFile[]): any[] {
	return parsedRecords.map(file => {
		const fileRecord: any = {
			filePath: file.filePath,
			tags: file.tags
		};

		// Omit empty aliases array
		if (file.aliases && file.aliases.length > 0) {
			fileRecord.aliases = file.aliases;
		}

		fileRecord.entries = file.entries.map((entry: any) => {
			// Explicitly build entry without file context properties
			const stripped: any = {
				type: entry.type,
				keywords: entry.keywords,
				text: entry.text,
				lineNumber: entry.lineNumber
			};
			if (entry.language) stripped.language = entry.language;
			if (entry.subItems) stripped.subItems = entry.subItems;

			// Strip empty tags/keywords from headers
			if (entry.h1) {
				const h1: any = { text: entry.h1.text };
				if (entry.h1.keywords && entry.h1.keywords.length > 0) h1.keywords = entry.h1.keywords;
				if (entry.h1.tags && entry.h1.tags.length > 0) h1.tags = entry.h1.tags;
				stripped.h1 = h1;
			}
			if (entry.h2) {
				const h2: any = { text: entry.h2.text };
				if (entry.h2.keywords && entry.h2.keywords.length > 0) h2.keywords = entry.h2.keywords;
				if (entry.h2.tags && entry.h2.tags.length > 0) h2.tags = entry.h2.tags;
				stripped.h2 = h2;
			}
			if (entry.h3) {
				const h3: any = { text: entry.h3.text };
				if (entry.h3.keywords && entry.h3.keywords.length > 0) h3.keywords = entry.h3.keywords;
				if (entry.h3.tags && entry.h3.tags.length > 0) h3.tags = entry.h3.tags;
				stripped.h3 = h3;
			}

			return stripped;
		});

		return fileRecord;
	});
}
