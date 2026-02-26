/**
 * Public API for the Highlight Space Repeat plugin.
 * Other plugins can access this via:
 *
 * const api = app.plugins.plugins['obsidian-highlight-space-repeat']?.api;
 * if (api) {
 *   const keywords = await api.getAllKeywords();
 * }
 */

import type { KeywordStyle, Category } from './shared';

/**
 * Public API interface for external plugins to use
 */
export interface HighlightSpaceRepeatAPI {
  /**
   * Get all keyword definitions with their styles (colors, icons, etc.)
   * @returns Array of keyword style objects
   */
  getAllKeywordStyles(): KeywordStyle[];

  /**
   * Get a specific keyword's style by keyword name
   * @param keyword - The keyword to look up
   * @returns KeywordStyle or undefined if not found
   */
  getKeywordStyle(keyword: string): KeywordStyle | undefined;

  /**
   * Get all categories (groups of keywords)
   * @returns Array of categories
   */
  getCategories(): Category[];

  /**
   * Check if a keyword is defined in the settings
   * @param keyword - The keyword to check
   * @returns true if keyword exists
   */
  hasKeyword(keyword: string): boolean;

  /**
   * Get the plugin version
   * @returns Plugin version string
   */
  getVersion(): string;
}
