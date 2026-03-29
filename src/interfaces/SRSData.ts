/**
 * SRS (Spaced Repetition System) data types
 * File-based system using HTML comments in markdown files
 */

/**
 * Quality of recall rating (SM-2 algorithm)
 * 0 = Complete blackout
 * 1 = Incorrect response, correct one remembered
 * 2 = Incorrect response, correct one seemed easy to recall
 * 3 = Correct response recalled with serious difficulty
 * 4 = Correct response after hesitation
 * 5 = Perfect response
 */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Simplified review buttons
 */
export type ReviewButton = 'again' | 'hard' | 'good' | 'easy';
