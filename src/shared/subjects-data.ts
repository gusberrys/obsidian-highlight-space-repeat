import type { Subject } from '../interfaces/Subject';

/**
 * Data structure for subjects.json file
 * Topics are nested under subjects in primaryTopics[] and secondaryTopics[] arrays
 */
export interface SubjectsData {
  subjects: Subject[];
}
