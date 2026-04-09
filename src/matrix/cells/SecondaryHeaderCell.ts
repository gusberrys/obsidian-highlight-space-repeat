import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectHeadersForTopic, getMatchingRecords } from './cell-helpers';

/**
 * Secondary header cell (1x2, 1x3)
 *
 * Files: Has secondary topic tag (uses record-level tags)
 * Headers: Has secondary topic keyword OR tag
 * Records: TODO
 */
export class SecondaryHeaderCell extends MatrixCell {
	private secondaryTopic: Topic;

	constructor(
		subject: Subject,
		secondaryTopic: Topic,
		getFileLevelTags: (record: ParsedFile) => string[],
		getRecordTags: (record: ParsedFile) => string[]
	) {
		super(subject, getFileLevelTags, getRecordTags);
		this.secondaryTopic = secondaryTopic;
	}

	protected doCollectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (!this.secondaryTopic.topicTag) return [];

		// Filter files with secondary topic tag (file-level)
		let filteredRecords = allRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return tags.includes(this.secondaryTopic.topicTag!);
		});

		// Filter out files that have any primary topic tags
		const primaryTopics = this.subject.primaryTopics || [];
		const primaryTopicTags = primaryTopics.map(t => t.topicTag).filter(Boolean);
		return filteredRecords.filter(record => {
			const tags = this.getFileLevelTags(record);
			return !primaryTopicTags.some(tag => tags.includes(tag!));
		});
	}

	protected doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		return collectHeadersForTopic(allRecords, this.secondaryTopic);
	}

	protected doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const expr = this.getFilterExpression();
		if (!expr) return [];

		return getMatchingRecords(allRecords, expr, null, this.subject, false);
	}

	protected doCollectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		// Secondary topic cells don't have dashboard filter
		return [];
	}

	shouldShowFiles(): boolean {
		return !this.secondaryTopic.fhDisabled;
	}

	shouldShowHeaders(): boolean {
		return !this.secondaryTopic.fhDisabled;
	}

	shouldShowDashRecords(): boolean {
		return false;
	}

	getFilterExpression(): string {
		return this.secondaryTopic.FilterExpHeader || '';
	}

	getFExpression(): string | null {
		if (this.secondaryTopic.fhDisabled) return null;
		if (!this.secondaryTopic.topicTag) return null;

		const parts: string[] = [];

		// Add subject tag if AND mode
		const andMode = this.secondaryTopic.andMode || false;
		if (andMode && this.subject.mainTag) {
			parts.push(this.subject.mainTag);
		}

		// Add secondary tag
		parts.push(this.secondaryTopic.topicTag);

		// Exclude ALL primary tags
		if (this.subject.primaryTopics) {
			for (const pt of this.subject.primaryTopics) {
				if (pt.topicTag) parts.push(`!${pt.topicTag}`);
			}
		}

		return parts.join(' AND ');
	}

	getHExpression(): string | null {
		if (this.secondaryTopic.fhDisabled) return null;

		// Build (..keyword OR ##tag) for secondary
		const topicParts: string[] = [];
		if (this.secondaryTopic.topicKeyword) topicParts.push(`..${this.secondaryTopic.topicKeyword}`);
		if (this.secondaryTopic.topicTag) {
			// Strip existing # prefix before adding ##
			const tag = this.secondaryTopic.topicTag.replace(/^#+/, '');
			topicParts.push(`##${tag}`);
		}

		if (topicParts.length === 0) return null;

		const topicExpr = topicParts.length > 1 ? `(${topicParts.join(' OR ')})` : topicParts[0];

		// Add subject tag if AND mode
		const andMode = this.secondaryTopic.andMode || false;
		if (andMode && this.subject.mainTag) {
			return `${this.subject.mainTag} AND ${topicExpr}`;
		}

		// NO exclusions for H: - headers don't need to exclude primary tags
		return topicExpr;
	}
}
