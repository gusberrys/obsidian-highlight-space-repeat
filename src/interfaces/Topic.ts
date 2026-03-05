export interface Topic {
	/** Unique identifier */
	id: string;

	/** Topic name */
	name: string;

	/** Icon for the topic */
	icon?: string;

	/**
	 * Primary Topic IDs - ONLY for secondary topics (M:N relationship)
	 * If empty/undefined, this is a "global" secondary topic that intersects with ALL primary topics.
	 * If set, this secondary topic only creates intersection cells with the specified primary topics.
	 *
	 * Example: Maven (#mvn) secondary topic with primaryTopicIds=["java-topic", "kotlin-topic"]
	 * would show in Java and Kotlin rows, but not Python row.
	 */
	primaryTopicIds?: string[];

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
	 * BLOCK/CODE variable - Code block language for this topic
	 * - Primary topics: Used for $BLOCK/$CODE replacement in secondary topics' filter expressions
	 * - Example: "java" (will be used as `java in filters)
	 */
	topicLanguage?: string;

	/**
	 * DashFilter (Dark Blue) - Dashboard chips and SubjectDashboard evaluations
	 * PRIMARY TOPICS ONLY
	 * NOT visible in matrix (only in Dashboard View)
	 * Example: "S: .keyword :category `language W: #tag"
	 */
	dashOnlyFilterExpSide?: string;

	/**
	 * MatrixFilter for SIDE cells (RED) - Matrix record counting
	 * PRIMARY TOPICS ONLY
	 * Used for counting records in SIDE cells (2x1, 3x1)
	 * No placeholders (standalone expression)
	 * Example: "S: .def .ima .pos W: #java OR .jav OR `java"
	 */
	matrixOnlyFilterExpSide?: string;

	/**
	 * MatrixFilter for HEADER cells (GREEN) - Matrix record counting
	 * SECONDARY TOPICS ONLY
	 * Used for counting records in HEADER cells (1x2, 1x3)
	 * No placeholders, no variables (standalone expression)
	 * Example: ".oop" or "S: .def W: #oop"
	 */
	FilterExpHeader?: string;

	/**
	 * MatrixFilter for INTERSECTION cells (BLUE) - Matrix record counting with variables
	 * SECONDARY TOPICS ONLY
	 * Used for counting records in INTERSECTION cells (2x2, 2x3, 3x2, 3x3)
	 * WITH placeholders that get replaced by primary topic values:
	 *   - $TAG → primary topic's topicTag (e.g., #java)
	 *   - $KEY → primary topic's topicKeyword (e.g., .jav)
	 *   - $BLOCK/$CODE → primary topic's topicLanguage (e.g., `java)
	 *   - $TEXT → primary topic's topicText (e.g., "java")
	 * Example: "S: .def W: $TAG AND #oop"
	 */
	appliedFilterExpIntersection?: string;

	/**
	 * Keywords to activate when this topic is selected
	 * These determine which KEYWORD RECORDS are displayed from the filtered files
	 * @deprecated Legacy - use filter expressions (FilterExpHeader, appliedFilterExpIntersection, etc.) instead
	 */
	keywords?: string[];

	/**
	 * F/H Disabled mode (SECONDARY TOPICS ONLY)
	 * When true: Disables File and Header records (shows ONLY Record entries with red background)
	 * When false (default): Collects files matching tags + headers with keywords/tags
	 * Applies to: own cell AND all intersections
	 */
	fhDisabled?: boolean;

	/**
	 * My Own mode - ONLY for secondary topics, applies to OWN cell only (not intersections)
	 * When enabled:
	 * - Files: Only count if they have this topic's own tag
	 * - Headers: Only count if the header itself has this topic's tag
	 * More restrictive collection - requires the topic's own tag to be present
	 */
	myOwn?: boolean;

	/**
	 * AND mode - Require subject tag for F/H entries
	 * - Primary topics: All cells in this row require subject tag
	 * - Secondary topics: Own cell and all intersections in this column require subject tag
	 * Visual indicator: White border
	 * Mutually exclusive with My Own mode (for secondary topics)
	 */
	andMode?: boolean;
}
