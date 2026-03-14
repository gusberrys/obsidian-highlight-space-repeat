import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import { getAllKeywords } from '../../utils/parse-helpers';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectIntersectionHeaders } from './cell-helpers';

/**
 * Primary × Primary intersection cell (e.g., jenkins × docker)
 *
 * Files: Has BOTH primary topic tags (file-level only)
 * Headers: Intersection logic with file-level tags only
 * Records: Files with BOTH tags, entries with EITHER keyword
 */
export class PrimaryPrimaryCell extends MatrixCell {
	private primaryTopic1: Topic;
	private primaryTopic2: Topic;

	constructor(
		subject: Subject,
		primaryTopic1: Topic,
		primaryTopic2: Topic,
		getFileLevelTags: (record: ParsedFile) => string[],
		getRecordTags: (record: ParsedFile) => string[]
	) {
		super(subject, getFileLevelTags, getRecordTags);
		this.primaryTopic1 = primaryTopic1;
		this.primaryTopic2 = primaryTopic2;
	}

	protected doCollectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.primaryTopic1.topicTag || !this.primaryTopic2.topicTag) return [];

		return allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return tags.includes(this.primaryTopic1.topicTag!) && tags.includes(this.primaryTopic2.topicTag!);
		});
	}

	protected doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		return collectIntersectionHeaders(
			allRecords,
			this.primaryTopic1,
			this.primaryTopic2,
			this.getFileLevelTags,
			this.getRecordTags,
			true // Use file-level tags only for PRIMARY_PRIMARY
		);
	}

	protected doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// Files with BOTH tags, entries with EITHER keyword
		const records: Array<{ entry: FlatEntry; file: ParsedFile }> = [];

		if (!this.primaryTopic1.topicTag || !this.primaryTopic2.topicTag) {
			return records;
		}

		const filesWithBothTags = this.collectFiles(allRecords);

		for (const file of filesWithBothTags) {
			for (const entry of file.entries) {
				const entryKeywords = getAllKeywords(entry);

				// Count if entry has EITHER keyword
				if ((this.primaryTopic1.topicKeyword && entryKeywords.includes(this.primaryTopic1.topicKeyword)) ||
					(this.primaryTopic2.topicKeyword && entryKeywords.includes(this.primaryTopic2.topicKeyword))) {
					records.push({ entry, file });
				}

				// Also check subItems
				if (entry.subItems && entry.subItems.length > 0) {
					for (const subItem of entry.subItems) {
						const subItemKeywords = getAllKeywords(subItem);
						if ((this.primaryTopic1.topicKeyword && subItemKeywords.includes(this.primaryTopic1.topicKeyword)) ||
							(this.primaryTopic2.topicKeyword && subItemKeywords.includes(this.primaryTopic2.topicKeyword))) {
							// Create a pseudo-entry for subItem
							records.push({ entry: { ...entry, text: subItem.text, keywords: subItem.keywords }, file });
						}
					}
				}
			}
		}

		return records;
	}

	shouldShowFiles(): boolean {
		return true;
	}

	shouldShowHeaders(): boolean {
		return true;
	}

	getFilterExpression(): string {
		// Build expression: (keyword1 OR keyword2) W: tag1 AND tag2
		const selectParts = [];
		if (this.primaryTopic1.topicKeyword) selectParts.push(`.${this.primaryTopic1.topicKeyword}`);
		if (this.primaryTopic2.topicKeyword) selectParts.push(`.${this.primaryTopic2.topicKeyword}`);

		const whereParts = [];
		if (this.primaryTopic1.topicTag) whereParts.push(this.primaryTopic1.topicTag);
		if (this.primaryTopic2.topicTag) whereParts.push(this.primaryTopic2.topicTag);

		let expr = '';
		if (selectParts.length > 0) {
			expr = selectParts.length > 1 ? `(${selectParts.join(' OR ')})` : selectParts[0];
		}
		if (whereParts.length > 0) {
			const whereClause = whereParts.join(' AND ');
			expr = expr ? `${expr} W: ${whereClause}` : `W: ${whereClause}`;
		}
		return expr;
	}
}
