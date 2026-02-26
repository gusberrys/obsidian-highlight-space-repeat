export interface Topic {
	/** Unique identifier */
	id: string;

	/** Topic name */
	name: string;

	/** Icon for the topic */
	icon?: string;

	/** Type of topic */
	type: 'primary' | 'secondary';

	/** Subject this topic belongs to */
	subjectId: string;

	/**
	 * TAG variable - Tag for this topic
	 * - Primary topics: Used for TAG replacement in secondary topics
	 * - Secondary topics: Used for tag counting in file counts display
	 */
	topicTag?: string;

	/**
	 * KEY variable - Keyword for this topic
	 * - Primary topics: Used for KEY replacement in secondary topics' filter expressions
	 * - Secondary topics: Used for keyword counting
	 */
	topicKeyword?: string;

	/** TEXT variable - Text string to use when this is primary topic */
	topicText?: string;

	/**
	 * Main Dashboard Filter (RED) - used for generating chips in Subject Dashboard
	 * Only used for PRIMARY topics
	 * Example: "S: .keyword :category `language W: #tag"
	 */
	mainDashboardFilter?: string;

	/**
	 * Matrix Record Filter (BLUE) - used for counting records in Matrix View
	 * Can use #?, .?, and `? placeholders for secondary topics
	 *
	 * Placeholders (secondary topics only):
	 * - #? gets replaced with the primary topic's topicTag (e.g., #german)
	 * - .? gets replaced with the primary topic's topicKeyword (e.g., .ger)
	 * - `? gets replaced with the primary topic's topicLanguage (e.g., `java)
	 */
	filterExpression?: string;

	/**
	 * Keywords to activate when this topic is selected
	 * These determine which KEYWORD RECORDS are displayed from the filtered files
	 */
	keywords: string[];

	/** Order for display */
	order: number;

	/** Show File (F) records in matrix - records matching file tags */
	showFileRecords?: boolean;

	/** Show Header (H) records in matrix - records matching keywords/tags in headers */
	showHeaderRecords?: boolean;

	/** Show Record (R) records in matrix - records matching filterExpression */
	showRecordRecords?: boolean;
}
