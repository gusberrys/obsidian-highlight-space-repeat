import type { ParsedFile, FlatEntry } from '../../interfaces/ParsedFile';
import type { Subject } from '../../interfaces/Subject';
import type { Topic } from '../../interfaces/Topic';

/**
 * Header group structure
 */
export interface HeaderGroup {
	file: ParsedFile;
	headerText: string;
	headerLevel: number;
	entries: FlatEntry[];
}

/**
 * Abstract base class for all matrix cells
 *
 * SINGLE source of truth for cell data collection.
 * Both counting and rendering use the SAME collected data.
 * This eliminates divergence between count/render logic.
 */
export abstract class MatrixCell {
	protected subject: Subject;
	protected getFileLevelTags: (record: ParsedFile) => string[];
	protected getRecordTags: (record: ParsedFile) => string[];

	// Cache collected data (cleared on reconstruct)
	private cachedFiles?: ParsedFile[];
	private cachedHeaders?: Map<string, HeaderGroup>;
	private cachedRecords?: Array<{ entry: FlatEntry; file: ParsedFile }>;
	private cachedDashRecords?: Array<{ entry: FlatEntry; file: ParsedFile }>;

	constructor(
		subject: Subject,
		getFileLevelTags: (record: ParsedFile) => string[],
		getRecordTags: (record: ParsedFile) => string[]
	) {
		this.subject = subject;
		this.getFileLevelTags = getFileLevelTags;
		this.getRecordTags = getRecordTags;
	}

	/**
	 * SINGLE source of truth for files
	 * Both counting and rendering use this
	 */
	collectFiles(allRecords: ParsedFile[]): ParsedFile[] {
		if (this.cachedFiles) return this.cachedFiles;

		this.cachedFiles = this.doCollectFiles(allRecords);
		return this.cachedFiles;
	}

	/**
	 * SINGLE source of truth for headers
	 * Both counting and rendering use this
	 */
	collectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup> {
		if (this.cachedHeaders) return this.cachedHeaders;

		this.cachedHeaders = this.doCollectHeaders(allRecords);
		return this.cachedHeaders;
	}

	/**
	 * SINGLE source of truth for records
	 * Both counting and rendering use this
	 */
	collectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		if (this.cachedRecords) return this.cachedRecords;

		this.cachedRecords = this.doCollectRecords(allRecords);
		return this.cachedRecords;
	}

	/**
	 * Count files - just returns collected files length
	 */
	countFiles(allRecords: ParsedFile[]): number {
		return this.collectFiles(allRecords).length;
	}

	/**
	 * Count headers - just returns collected headers size
	 */
	countHeaders(allRecords: ParsedFile[]): number {
		return this.collectHeaders(allRecords).size;
	}

	/**
	 * Count records - just returns collected records length
	 */
	countRecords(allRecords: ParsedFile[]): number {
		return this.collectRecords(allRecords).length;
	}

	/**
	 * SINGLE source of truth for dashboard records
	 * Both counting and rendering use this
	 * Only applies to primary topics with dashOnlyFilterExpSide
	 */
	collectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }> {
		if (this.cachedDashRecords) return this.cachedDashRecords;

		this.cachedDashRecords = this.doCollectDashRecords(allRecords);
		return this.cachedDashRecords;
	}

	/**
	 * Count dashboard records - just returns collected dashboard records length
	 */
	countDashRecords(allRecords: ParsedFile[]): number {
		return this.collectDashRecords(allRecords).length;
	}

	// Abstract methods - each subclass must implement
	protected abstract doCollectFiles(allRecords: ParsedFile[]): ParsedFile[];
	protected abstract doCollectHeaders(allRecords: ParsedFile[]): Map<string, HeaderGroup>;
	protected abstract doCollectRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }>;
	protected abstract doCollectDashRecords(allRecords: ParsedFile[]): Array<{ entry: FlatEntry; file: ParsedFile }>;

	abstract shouldShowFiles(): boolean;
	abstract shouldShowHeaders(): boolean;
	abstract shouldShowDashRecords(): boolean;
	abstract getFilterExpression(): string;
}
