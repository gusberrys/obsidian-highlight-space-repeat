import type { Topic } from './Topic';

export interface Subject {
	/** Unique identifier */
	id: string;

	/** Display name */
	name: string;

	/** Filter expression for subject-level filtering */
	expression?: string;

	/** Description (optional) */
	description?: string;

	/** Color for UI (optional) */
	color?: string;

	/** Icon (optional) */
	icon?: string;

	/** Enabled flag */
	enabled?: boolean;

	/** Main tag for this subject (used for tag count display) */
	mainTag?: string;

	/** Subject keyword (optional) */
	keyword?: string;

	/** Matrix data - stores icons for subject/primary/secondary intersections */
	matrix?: SubjectMatrix;

	/** Favorite filters for quick access */
	favoriteFilters?: FavoriteFilter[];

	/** Primary topics for this subject (array order = display order) */
	primaryTopics?: Topic[];

	/** Secondary topics for this subject (array order = display order) */
	secondaryTopics?: Topic[];
}

/**
 * Favorite filter for quick access
 */
export interface FavoriteFilter {
	/** Unique identifier */
	id: string;

	/** Icon/emoji for the button */
	icon: string;

	/** Filter expression (e.g., ":boo `java W: #foo \t") */
	expression: string;
}

/**
 * Matrix structure for subject icons
 * Position notation: rowXcolumn (e.g., 1x1, 1x2, 2x1, 2x2)
 * - 1x1: Subject icon
 * - 1x2, 1x3, ...: Secondary topic icons
 * - 2x1, 3x1, ...: Primary topic icons
 * - 2x2, 2x3, 3x2, 3x3, ...: Intersection cells
 */
export interface SubjectMatrix {
	/** Cell data indexed by "rowXcol" (e.g., "1x1", "2x3") */
	cells: Record<string, MatrixCell>;
}

/**
 * Individual cell in the matrix
 */
export interface MatrixCell {
	/** Icon/emoji for this cell */
	icon?: string;

	/** Optional label/name */
	label?: string;

	/** File count for this tag combination */
	fileCount?: number;

	/** Header count for this tag combination */
	headerCount?: number;

	/** Record count matching the topic's filter expression */
	recordCount?: number;
}
