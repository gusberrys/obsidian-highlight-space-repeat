import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectHeadersForTopic, getMatchingRecords } from './cell-helpers';

/**
 * Primary side cell (2x1, 3x1)
 *
 * Files: Has primary topic tag (with optional subject tag if andMode is true)
 * Headers: Has primary topic keyword OR tag
 * Records: Has primary topic keyword
 */
export class PrimarySideCell extends MatrixCell {
	private primaryTopic: Topic;

	constructor(
		subject: Subject,
		primaryTopic: Topic,
		getFileLevelTags: (record: ParsedFile) => string[],
		getRecordTags: (record: ParsedFile) => string[]
	) {
		super(subject, getFileLevelTags, getRecordTags);
		this.primaryTopic = primaryTopic;
	}

	protected doCollectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.primaryTopic.topicTag) return [];

		// Filter files with primary topic tag
		let filteredRecords: ParsedFile[] = [];
		if (this.primaryTopic.andMode && this.subject.mainTag) {
			filteredRecords = allRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				return tags.includes(this.primaryTopic.topicTag!) && tags.includes(this.subject.mainTag!);
			});
		} else {
			filteredRecords = allRecords.filter(record => {
				const tags = this.getFileLevelTags(record);
				return tags.includes(this.primaryTopic.topicTag!);
			});
		}

		// Filter out files that have any secondary topic tags
		const secondaryTopics = this.subject.secondaryTopics || [];
		const secondaryTopicTags = secondaryTopics.map(t => t.topicTag).filter(Boolean);
		return filteredRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return !secondaryTopicTags.some(tag => tags.includes(tag!));
		});
	}

	protected doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		return collectHeadersForTopic(allRecords, this.primaryTopic);
	}

	protected doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const expr = this.getFilterExpression();
		if (!expr) return [];

		const andMode = this.primaryTopic.andMode || false;
		return getMatchingRecords(allRecords, expr, this.primaryTopic, this.subject, andMode);
	}

	protected doCollectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const expr = this.getDashFilterExpression();
		if (!expr) return [];

		const andMode = this.primaryTopic.andMode || false;
		return getMatchingRecords(allRecords, expr, this.primaryTopic, this.subject, andMode);
	}

	shouldShowFiles(): boolean {
		return true;
	}

	shouldShowHeaders(): boolean {
		return true;
	}

	shouldShowDashRecords(): boolean {
		return !!this.primaryTopic.dashOnlyFilterExpSide;
	}

	getFilterExpression(): string {
		return this.primaryTopic.matrixOnlyFilterExpSide || '';
	}

	getDashFilterExpression(): string {
		return this.primaryTopic.dashOnlyFilterExpSide || '';
	}

	getFExpression(): string | null {
		if (this.primaryTopic.fhDisabled) return null;
		if (!this.primaryTopic.topicTag) return null;

		const parts: string[] = [];

		// Add subject tag if AND mode
		const andMode = this.primaryTopic.andMode || false;
		if (andMode && this.subject.mainTag) {
			parts.push(this.subject.mainTag);
		}

		// Add primary tag
		parts.push(this.primaryTopic.topicTag);

		// Exclude ALL secondary tags
		if (this.subject.secondaryTopics) {
			for (const st of this.subject.secondaryTopics) {
				if (st.topicTag) parts.push(`!${st.topicTag}`);
			}
		}

		return parts.join(' AND ');
	}

	getHExpression(): string | null {
		if (this.primaryTopic.fhDisabled) return null;

		// Build (..keyword OR ##tag) for primary
		const topicParts: string[] = [];
		if (this.primaryTopic.topicKeyword) topicParts.push(`..${this.primaryTopic.topicKeyword}`);
		if (this.primaryTopic.topicTag) {
			// Strip existing # prefix before adding ##
			const tag = this.primaryTopic.topicTag.replace(/^#+/, '');
			topicParts.push(`##${tag}`);
		}

		if (topicParts.length === 0) return null;

		const topicExpr = topicParts.length > 1 ? `(${topicParts.join(' OR ')})` : topicParts[0];

		// Add subject tag if AND mode
		const andMode = this.primaryTopic.andMode || false;
		if (andMode && this.subject.mainTag) {
			return `${this.subject.mainTag} AND ${topicExpr}`;
		}

		// NO exclusions for H: - headers don't need to exclude secondary tags
		return topicExpr;
	}
}
