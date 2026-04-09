import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectHeadersForTopic, getMatchingRecords } from './cell-helpers';

/**
 * Subject cell (1x1)
 *
 * Files: Has subject tag BUT NOT any primary or secondary tags
 * Headers: Has subject keyword OR tag
 * Records: Matches subject's matrixOnlyFilterExp
 */
export class SubjectCell extends MatrixCell {
	constructor(
		subject: Subject,
		getFileLevelTags: (record: ParsedFile) => string[],
		getRecordTags: (record: ParsedFile) => string[]
	) {
		super(subject, getFileLevelTags, getRecordTags);
	}

	protected doCollectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		// Files with subject tag BUT NOT any primary or secondary tags
		const primaryTopics = this.subject.primaryTopics || [];
		const secondaryTopics = this.subject.secondaryTopics || [];
		const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
		const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);

		return allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			const hasSubjectTag = this.subject.mainTag ? tags.includes(this.subject.mainTag) : false;
			const hasPrimaryTag = primaryTopicTags.some(tag => tags.includes(tag!));
			const hasSecondaryTag = secondaryTopicTags.some(tag => tags.includes(tag!));
			return hasSubjectTag && !hasPrimaryTag && !hasSecondaryTag;
		});
	}

	protected doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		return collectHeadersForTopic(allRecords, {
			topicKeyword: this.subject.keyword,
			topicTag: this.subject.mainTag
		});
	}

	protected doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const expr = this.getFilterExpression();
		if (!expr) return [];

		return getMatchingRecords(allRecords, expr, null, this.subject, false);
	}

	protected doCollectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// Subject cell doesn't have dashboard filter
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
		return this.subject.matrixOnlyFilterExp || this.subject.expression || '';
	}

	getFExpression(): string | null {
		if (!this.subject.mainTag) return null;

		// Build exclusions: exclude ALL primary and secondary tags
		const exclusions: string[] = [];

		if (this.subject.primaryTopics) {
			for (const pt of this.subject.primaryTopics) {
				if (pt.topicTag) exclusions.push(`!${pt.topicTag}`);
			}
		}

		if (this.subject.secondaryTopics) {
			for (const st of this.subject.secondaryTopics) {
				if (st.topicTag) exclusions.push(`!${st.topicTag}`);
			}
		}

		const parts = [this.subject.mainTag, ...exclusions];
		return parts.join(' AND ');
	}

	getHExpression(): string | null {
		if (!this.subject.mainTag) return null;
		// Headers: no exclusions needed
		return this.subject.mainTag;
	}
}
