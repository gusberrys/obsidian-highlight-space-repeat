import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';

/**
 * Global topic - a secondary topic template that can be imported into multiple subjects
 * Similar to Topic but without subjectId since it's not tied to a specific subject
 */
export interface GlobalTopic {
  /** Unique identifier */
  id: string;

  /** Topic name */
  name: string;

  /** Icon for the topic */
  icon?: string;

  /** TAG variable - Tag for this topic */
  topicTag?: string;

  /** KEY variable - Keyword for this topic */
  topicKeyword?: string;

  /** TEXT variable - Text string */
  topicText?: string;

  /** Filter expression (can use #?, .?, and `? placeholders) */
  filterExpression?: string;

  /** Show File (F) records in matrix - records matching file tags */
  showFileRecords?: boolean;

  /** Show Header (H) records in matrix - records matching keywords/tags in headers */
  showHeaderRecords?: boolean;

  /** Show Record (R) records in matrix - records matching filterExpression */
  showRecordRecords?: boolean;
}

/**
 * Data structure for subjects.json file
 * Stores subjects and their associated topics separately from keywords
 */
export interface SubjectsData {
  subjects: Subject[];
  topics: Topic[];
  globalTopics?: GlobalTopic[];
}
