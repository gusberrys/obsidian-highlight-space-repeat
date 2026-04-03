import { CollectingStatus } from './collecting-status';

export type KeywordStyle = {
  keyword: string;  // Primary keyword identifier (ID)
  color: string;
  backgroundColor: string;
  description?: string;
  generateIcon?: string;
  collectingStatus?: CollectingStatus;  // How this keyword is collected: IGNORED, PARSED, or SPACED
  iconPriority?: 1 | 2 | 3;  // Icon priority: I, II, III (default: 1)
  stylePriority?: 'normal' | 'priority' | 'append';  // Style priority: normal (-), priority (👑), append (A) (default: normal)
  showColor?: boolean;  // Whether to show the color (default: true)
  showBackgroundColor?: boolean;  // Whether to show the background color (default: true)
};

export type Category = {
  icon: string;  // Display name/icon for the category (was: name)
  id?: string;   // CSS class/identifier for the category (was: class)
  keywords: KeywordStyle[];
};

export interface TagKeywordPair {
  tag: string;
  keywords: string[];
}

/**
 * Code Block Language with id and optional icon
 */
export interface CodeBlockLanguage {
  id: string;      // Code block identifier (matches ```java, ```python, etc.)
  icon?: string;   // Display icon
}

export interface Settings {
  keywordDescriptionsPath: string;  // Global directory path where keywords find their reference .md files (e.g., "foo/bar" -> "foo/bar/def.md" for keyword "def")
  keywordsDashboardFileName?: string;  // File name where the auto-generated keywords reference will be created (e.g., "home page")
  badgeExcludedPaths?: string;  // Comma-separated list of paths where badges should not be shown (e.g., "_journal, templates")
  pathToSubjects?: string;  // Directory path where subject files are stored (e.g., "/kb" -> "/kb/work.md" for subject "work")
  layoutRetryDelayMs?: number;  // Delay in milliseconds before retrying layout restructuring (default: 100)
}
