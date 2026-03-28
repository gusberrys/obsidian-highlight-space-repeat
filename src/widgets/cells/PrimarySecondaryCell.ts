import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectIntersectionHeaders } from './cell-helpers';
import { FilterExpressionService } from '../../services/FilterExpressionService';

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
		if (!expr) return [];

		// For intersections: use primary topic's AND mode (inherited from row)
		const includesSubjectTag = this.primaryTopic.andMode || false;
		return FilterExpressionService.getMatchingRecords(allRecords, expr, this.primaryTopic, this.subject, includesSubjectTag);
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
}
