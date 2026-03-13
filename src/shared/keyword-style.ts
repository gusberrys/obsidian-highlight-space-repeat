import { CollectingStatus } from './collecting-status';
import type { CombinePriority } from './combine-priority';

/**
 * Keyword Type enum
 * - MAIN: Main keyword (standard keyword)
 * - HELP: Helper keyword (blue text, simplified display, 2 per line)
 */
export enum KeywordType {
  MAIN = 'MAIN',
  HELP = 'HELP'
}

export type KeywordStyle = {
  keyword: string;  // Primary keyword identifier (ID)
  aliases?: string[];  // Alternative names/aliases for this keyword
  color: string;
  backgroundColor: string;
  description?: string;
  generateIcon?: string;
  ccssc?: string;
  collectingStatus?: CollectingStatus;  // How this keyword is collected: IGNORED, PARSED, or SPACED
  mainKeyword?: boolean;  // DEPRECATED: Use keywordType instead
  keywordType?: KeywordType;  // Keyword type: MAIN or HELP
  combinePriority?: CombinePriority;  // For MAIN keywords only: None/Style/Icon/StyleAndIcon
  showColor?: boolean;  // Whether to show the color (default: true)
  showBackgroundColor?: boolean;  // Whether to show the background color (default: true)
  subKeywords?: string[];  // Sub-keywords for this keyword (keywords or categories prefixed with ":")
};

export type Category = {
  icon: string;  // Display name/icon for the category (was: name)
  id?: string;   // CSS class/identifier for the category (was: class)
  isHelper?: boolean;  // If true, all keywords in this category are helper keywords (blue, simplified display)
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

/**
 * Get all keyword names (primary keyword + aliases) for a KeywordStyle
 */
export function getAllKeywordNames(keyword: KeywordStyle): string[] {
  return [keyword.keyword, ...(keyword.aliases || [])];
}

/**
 * Get the keyword type (with backward compatibility)
 */
export function getKeywordType(keyword: KeywordStyle): KeywordType {
  // If keywordType is set, use it
  if (keyword.keywordType) {
    return keyword.keywordType;
  }

  // Backward compatibility: use mainKeyword boolean
  if (keyword.mainKeyword === true) {
    return KeywordType.MAIN;
  }

  // Default to MAIN
  return KeywordType.MAIN;
}


