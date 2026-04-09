import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectIntersectionHeaders, getMatchingRecords } from './cell-helpers';

/**
 * Primary × Secondary intersection cell (2x2, 2x3)
 *
 * Files: Has BOTH primary and secondary tags (file-level)
 * Headers: Intersection logic (one in header + other on file)
 * Records: TODO
 */
export class PrimarySecondaryCell extends MatrixCell {
	private primaryTopic: Topic;
	private secondaryTopic: Topic;

	constructor(
		subject: Subject,
		primaryTopic: Topic,
		secondaryTopic: Topic,
		getFileLevelTags: (record: ParsedFile) => string[],
		getRecordTags: (record: ParsedFile) => string[]
	) {
		super(subject, getFileLevelTags, getRecordTags);
		this.primaryTopic = primaryTopic;
		this.secondaryTopic = secondaryTopic;
	}

	protected doCollectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.primaryTopic.topicTag || !this.secondaryTopic.topicTag) return [];

		return allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return tags.includes(this.primaryTopic.topicTag!) && tags.includes(this.secondaryTopic.topicTag!);
		});
	}

	protected doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		return collectIntersectionHeaders(
			allRecords,
			this.primaryTopic,
			this.secondaryTopic,
			this.getFileLevelTags,
			this.getRecordTags,
			false, // Use record-level tags for PRIMARY_SECONDARY
			undefined // No subject tag requirement for PRIMARY_SECONDARY headers
		);
	}

	protected doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const expr = this.getFilterExpression();
		console.log(`[PrimarySecondaryCell] ${this.primaryTopic.name} × ${this.secondaryTopic.name} - Expression: "${expr}"`);

		if (!expr) {
			console.log(`[PrimarySecondaryCell] No expression, returning empty`);
			return [];
		}

		// For intersections: use primary topic's AND mode (inherited from row)
		const includesSubjectTag = this.primaryTopic.andMode || false;
		const results = getMatchingRecords(allRecords, expr, this.primaryTopic, this.subject, includesSubjectTag);
		console.log(`[PrimarySecondaryCell] ${this.primaryTopic.name} × ${this.secondaryTopic.name} - Count: ${results.length}`);

		return results;
	}

	protected doCollectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// Intersection cells don't have dashboard filter
		return [];
	}

	shouldShowFiles(): boolean {
		return !this.primaryTopic.fhDisabled && !this.secondaryTopic.fhDisabled;
	}

	shouldShowHeaders(): boolean {
		return !this.primaryTopic.fhDisabled && !this.secondaryTopic.fhDisabled;
	}

	shouldShowDashRecords(): boolean {
		return false;
	}

	getFilterExpression(): string {
		return this.secondaryTopic.appliedFilterExpIntersection || '';
	}

	getFExpression(): string | null {
		// Check if BOTH topics allow F/H
		if (this.primaryTopic.fhDisabled || this.secondaryTopic.fhDisabled) return null;
		if (!this.primaryTopic.topicTag || !this.secondaryTopic.topicTag) return null;

		const parts: string[] = [];

		// Add subject tag if AND mode
		const andMode = this.primaryTopic.andMode || false;
		if (andMode && this.subject.mainTag) {
			parts.push(this.subject.mainTag);
		}

		// Add primary AND secondary tags (no exclusions for intersection)
		parts.push(this.primaryTopic.topicTag);
		parts.push(this.secondaryTopic.topicTag);

		return parts.join(' AND ');
	}

	getHExpression(): string | null {
		// Check if BOTH topics allow F/H
		if (this.primaryTopic.fhDisabled || this.secondaryTopic.fhDisabled) return null;

		// Build intersection header expression:
		// (..primary AND #secondary) OR (..secondary AND #primary) OR (##primary AND ##secondary)

		const parts: string[] = [];

		// Case 1: primary keyword/tag in header AND secondary tag in file
		const primaryHeaderParts: string[] = [];
		if (this.primaryTopic.topicKeyword) primaryHeaderParts.push(`..${this.primaryTopic.topicKeyword}`);
		if (this.primaryTopic.topicTag) {
			const tag = this.primaryTopic.topicTag.replace(/^#+/, '');
			primaryHeaderParts.push(`##${tag}`);
		}

		if (primaryHeaderParts.length > 0 && this.secondaryTopic.topicTag) {
			const primaryHeaderExpr = primaryHeaderParts.length > 1
				? `(${primaryHeaderParts.join(' OR ')})`
				: primaryHeaderParts[0];
			parts.push(`(${primaryHeaderExpr} AND ${this.secondaryTopic.topicTag})`);
		}

		// Case 2: secondary keyword/tag in header AND primary tag in file
		const secondaryHeaderParts: string[] = [];
		if (this.secondaryTopic.topicKeyword) secondaryHeaderParts.push(`..${this.secondaryTopic.topicKeyword}`);
		if (this.secondaryTopic.topicTag) {
			const tag = this.secondaryTopic.topicTag.replace(/^#+/, '');
			secondaryHeaderParts.push(`##${tag}`);
		}

		if (secondaryHeaderParts.length > 0 && this.primaryTopic.topicTag) {
			const secondaryHeaderExpr = secondaryHeaderParts.length > 1
				? `(${secondaryHeaderParts.join(' OR ')})`
				: secondaryHeaderParts[0];
			parts.push(`(${secondaryHeaderExpr} AND ${this.primaryTopic.topicTag})`);
		}

		// Case 3: BOTH tags in header
		if (this.primaryTopic.topicTag && this.secondaryTopic.topicTag) {
			const primaryTag = this.primaryTopic.topicTag.replace(/^#+/, '');
			const secondaryTag = this.secondaryTopic.topicTag.replace(/^#+/, '');
			parts.push(`(##${primaryTag} AND ##${secondaryTag})`);
		}

		if (parts.length === 0) return null;

		let expr = parts.join(' OR ');

		// Add subject tag if AND mode
		const andMode = this.primaryTopic.andMode || false;
		if (andMode && this.subject.mainTag) {
			expr = `${this.subject.mainTag} AND (${expr})`;
		}

		return expr;
	}
}
