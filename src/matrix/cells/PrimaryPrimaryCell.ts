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

		// If either topic has andMode enabled, also require subject tag
		const requiresSubjectTag = (this.primaryTopic1.andMode || this.primaryTopic2.andMode) && this.subject.mainTag;

		const filtered = allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			const hasBothPrimaryTags = tags.includes(this.primaryTopic1.topicTag!) && tags.includes(this.primaryTopic2.topicTag!);

			if (requiresSubjectTag) {
				return hasBothPrimaryTags && tags.includes(this.subject.mainTag!);
			}
			return hasBothPrimaryTags;
		});

		return filtered;
	}

	protected doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		// If either topic has andMode enabled, require subject tag
		const requiresSubjectTag = (this.primaryTopic1.andMode || this.primaryTopic2.andMode) && this.subject.mainTag;

		return collectIntersectionHeaders(
			allRecords,
			this.primaryTopic1,
			this.primaryTopic2,
			this.getFileLevelTags,
			this.getRecordTags,
			true, // Use file-level tags only for PRIMARY_PRIMARY
			requiresSubjectTag ? this.subject.mainTag : undefined
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
							records.push({ entry: { ...entry, text: subItem.content, keywords: subItem.keywords }, file });
						}
					}
				}
			}
		}

		return records;
	}

	protected doCollectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// PRIMARY×PRIMARY cells don't have dashboard filter
		return [];
	}

	shouldShowFiles(): boolean {
		return true;
	}

	shouldShowHeaders(): boolean {
		return true;
	}

	shouldShowDashRecords(): boolean {
		return false;
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

	getFExpression(): string | null {
		// Check if BOTH topics allow F/H
		if (this.primaryTopic1.fhDisabled || this.primaryTopic2.fhDisabled) return null;
		if (!this.primaryTopic1.topicTag || !this.primaryTopic2.topicTag) return null;

		const parts: string[] = [];

		// Add subject tag if AND mode on EITHER primary
		const andMode = this.primaryTopic1.andMode || this.primaryTopic2.andMode || false;
		if (andMode && this.subject.mainTag) {
			parts.push(this.subject.mainTag);
		}

		// Add BOTH primary tags
		parts.push(this.primaryTopic1.topicTag);
		parts.push(this.primaryTopic2.topicTag);

		return parts.join(' AND ');
	}

	getHExpression(): string | null {
		// Check if BOTH topics allow F/H
		if (this.primaryTopic1.fhDisabled || this.primaryTopic2.fhDisabled) return null;

		// Similar to PrimarySecondaryCell, but with two primaries
		const parts: string[] = [];

		// Case 1: primary1 in header AND primary2 in file
		const primary1HeaderParts: string[] = [];
		if (this.primaryTopic1.topicKeyword) primary1HeaderParts.push(`..${this.primaryTopic1.topicKeyword}`);
		if (this.primaryTopic1.topicTag) {
			const tag = this.primaryTopic1.topicTag.replace(/^#+/, '');
			primary1HeaderParts.push(`##${tag}`);
		}

		if (primary1HeaderParts.length > 0 && this.primaryTopic2.topicTag) {
			const expr = primary1HeaderParts.length > 1
				? `(${primary1HeaderParts.join(' OR ')})`
				: primary1HeaderParts[0];
			parts.push(`(${expr} AND ${this.primaryTopic2.topicTag})`);
		}

		// Case 2: primary2 in header AND primary1 in file
		const primary2HeaderParts: string[] = [];
		if (this.primaryTopic2.topicKeyword) primary2HeaderParts.push(`..${this.primaryTopic2.topicKeyword}`);
		if (this.primaryTopic2.topicTag) {
			const tag = this.primaryTopic2.topicTag.replace(/^#+/, '');
			primary2HeaderParts.push(`##${tag}`);
		}

		if (primary2HeaderParts.length > 0 && this.primaryTopic1.topicTag) {
			const expr = primary2HeaderParts.length > 1
				? `(${primary2HeaderParts.join(' OR ')})`
				: primary2HeaderParts[0];
			parts.push(`(${expr} AND ${this.primaryTopic1.topicTag})`);
		}

		// Case 3: BOTH in header
		if (this.primaryTopic1.topicTag && this.primaryTopic2.topicTag) {
			const tag1 = this.primaryTopic1.topicTag.replace(/^#+/, '');
			const tag2 = this.primaryTopic2.topicTag.replace(/^#+/, '');
			parts.push(`(##${tag1} AND ##${tag2})`);
		}

		if (parts.length === 0) return null;

		let expr = parts.join(' OR ');

		// Add subject tag if AND mode
		const andMode = this.primaryTopic1.andMode || this.primaryTopic2.andMode || false;
		if (andMode && this.subject.mainTag) {
			expr = `${this.subject.mainTag} AND (${expr})`;
		}

		return expr;
	}
}
