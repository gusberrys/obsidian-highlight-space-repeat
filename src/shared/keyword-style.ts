import { CollectingStatus } from './collecting-status';
import type { CombinePriority } from './combine-priority';

export type KeywordStyle = {
  keyword: string;  // Primary keyword identifier (ID)
  color: string;
  backgroundColor: string;
  description?: string;
  generateIcon?: string;
  collectingStatus?: CollectingStatus;  // How this keyword is collected: IGNORED, PARSED, or SPACED
  combinePriority?: CombinePriority;  // Priority: None/Style/Icon/StyleAndIcon
  showColor?: boolean;  // Whether to show the color (default: true)
  showBackgroundColor?: boolean;  // Whether to show the background color (default: true)
  subKeywords?: string[];  // Sub-keywords for this keyword (keywords or categories prefixed with ":")
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
}
