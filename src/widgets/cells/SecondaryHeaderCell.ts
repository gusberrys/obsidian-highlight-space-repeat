import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';
import { MatrixCell, type HeaderGroup } from './MatrixCell';
import { collectHeadersForTopic } from './cell-helpers';
import { FilterExpressionService } from '../../services/FilterExpressionService';

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

		return allRecords.filter(record => {
			const tags = this.getRecordTags(record);
			return tags.includes(this.secondaryTopic.topicTag!);
		});
	}

	protected doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		return collectHeadersForTopic(allRecords, this.secondaryTopic);
	}

	protected doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		const expr = this.getFilterExpression();
		if (!expr) return [];

		return FilterExpressionService.getMatchingRecords(allRecords, expr, null, this.subject, false);
	}

	shouldShowFiles(): boolean {
		return !this.secondaryTopic.fhDisabled;
	}

	shouldShowHeaders(): boolean {
		return !this.secondaryTopic.fhDisabled;
	}

	getFilterExpression(): string {
		return this.secondaryTopic.FilterExpHeader || '';
	}
}
