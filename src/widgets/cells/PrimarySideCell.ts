import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectHeadersForTopic } from './cell-helpers';
import { FilterExpressionService } from '../../services/FilterExpressionService';

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
		return FilterExpressionService.getMatchingRecords(allRecords, expr, this.primaryTopic, this.subject, andMode);
	}

	protected doCollectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const expr = this.getDashFilterExpression();
		if (!expr) return [];

		const andMode = this.primaryTopic.andMode || false;
		return FilterExpressionService.getMatchingRecords(allRecords, expr, this.primaryTopic, this.subject, andMode);
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
}
