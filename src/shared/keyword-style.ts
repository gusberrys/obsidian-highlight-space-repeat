import { CollectingStatus } from './collecting-status';
import type { CombinePriority } from './combine-priority';

/**
 * Keyword Type enum
 * - MAIN: Main keyword (cannot be used as auxiliary)
 * - AUXILIARY: Can be used as auxiliary keyword
 * - HELP: Helper keyword (blue text, simplified display, 2 per line)
 */
export enum KeywordType {
  MAIN = 'MAIN',
  AUXILIARY = 'AUXILIARY',
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
  mainKeyword?: boolean;  // DEPRECATED: Use keywordType instead. Whether this IS a main keyword (true) or CAN BE used as auxiliary (false). Default: false (can be auxiliary)
  keywordType?: KeywordType;  // Keyword type: MAIN, AUXILIARY, or HELP
  combinePriority?: CombinePriority;  // For MAIN keywords only: None/Style/Icon/StyleAndIcon. Auxiliary keywords always append their icons.
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

/**
 * Auxiliary Keyword - lightweight keyword for adding metadata/tags inline
 */
export interface AuxiliaryKeyword {
  icon: string;  // Icon/emoji for the auxiliary keyword
  keyword: string;  // The keyword identifier to match in text (e.g., "l11" in "goa :: (l11)")
  description: string;  // Description for filtering/searching
  class?: string;  // Optional CSS class
  color?: string;  // Text color (synced from keyword)
  backgroundColor?: string;  // Background color (synced from keyword)
  isSynced?: boolean;  // Whether this is synced from a main keyword
}

/**
 * Auxiliary Keyword Category - groups auxiliary keywords
 */
export interface AuxiliaryCategory {
  icon: string;  // Display name/icon for the category (was: name)
  id?: string;   // CSS class/identifier for the category (was: class)
  auxiliaryKeywords: AuxiliaryKeyword[];
  isSynced?: boolean;  // Whether this category is synced from keywords
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

  // Default to AUXILIARY
  return KeywordType.AUXILIARY;
}


