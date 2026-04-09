/**
 * Public API for the Highlight Space Repeat plugin.
 * Other plugins can access this via:
 *
 * const api = app.plugins.plugins['obsidian-highlight-space-repeat']?.api;
 * if (api) {
 *   const records = api.getParsedRecords();
 * }
 */

import type { KeywordStyle, Category } from './shared';
import type { ParsedFile, FlatEntry } from './interfaces/ParsedFile';
import type { CompiledFilter } from './interfaces/FilterInterfaces';
import type { ActiveChip } from './interfaces/ActiveChip';
import type { Subject } from './interfaces/Subject';
import { get } from 'svelte/store';
import { keywordsStore } from './stores/settings-store';
import { subjectsStore } from './stores/subject-store';
import { FilterParser } from './services/FilterParser';

/**
 * Record count result from filter evaluation
 */
export interface RecordCount {
  recordCount: number;
}

/**
 * Public API implementation for the Highlight Space Repeat plugin.
 * Provides access to parsed records, filtering, and keyword management.
 */
export class HighlightSpaceRepeatAPI {
  private recordsChangeCallbacks: Set<() => void> = new Set();

  constructor(private plugin: any) {}

  // ==================== Keyword Access ====================

  /**
   * Get all keyword definitions with their styles (colors, icons, etc.)
   * @returns Array of keyword style objects
   */
  getAllKeywordStyles(): KeywordStyle[] {
    const keywords = get(keywordsStore);
    return keywords.categories.flatMap((cat: Category) => cat.keywords);
  }

  /**
   * Get a specific keyword's style by keyword name
   * @param keyword - The keyword to look up
   * @returns KeywordStyle or undefined if not found
   */
  getKeywordStyle(keyword: string): KeywordStyle | undefined {
    const keywords = get(keywordsStore);
    for (const category of keywords.categories) {
      const found = category.keywords.find((k: KeywordStyle) => k.keyword === keyword);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Get all categories (groups of keywords)
   * @returns Array of categories
   */
  getCategories(): Category[] {
    const keywords = get(keywordsStore);
    return keywords.categories;
  }

  /**
   * Check if a keyword is defined in the settings
   * @param keyword - The keyword to check
   * @returns true if keyword exists
   */
  hasKeyword(keyword: string): boolean {
    return this.getKeywordStyle(keyword) !== undefined;
  }

  /**
   * Get the plugin version
   * @returns Plugin version string
   */
  getVersion(): string {
    return this.plugin.manifest.version;
  }

  // ==================== Data Access ====================

  /**
   * Get all parsed records from the vault
   * @returns Array of parsed files with entries
   */
  getParsedRecords(): ParsedFile[] {
    return this.plugin.parsedRecords || [];
  }

  /**
   * Trigger a rescan of all files in the vault
   * @returns Promise that resolves when rescan is complete
   */
  async triggerRescan(): Promise<void> {
    await this.plugin.triggerScan();
  }

  // ==================== Filter Compilation & Evaluation ====================

  /**
   * Compile a filter expression into an executable filter
   * @param expression - Filter expression string (e.g., ".def #kafka")
   * @param variables - Optional variable substitutions (e.g., {keyword: "def", tag: "kafka"})
   * @returns Compiled filter ready for evaluation
   */
  compileFilter(expression: string, variables?: Record<string, string>): CompiledFilter {
    let expandedExpression = expression;

    // Expand variables if provided (using FilterParser's static method)
    if (variables) {
      expandedExpression = FilterParser.expandVariables(expression, variables as any);
    }

    return FilterParser.compile(expandedExpression);
  }

  /**
   * Evaluate a compiled filter against a single entry
   * @param filter - Compiled filter
   * @param entry - Entry to test
   * @returns true if entry matches the filter
   */
  evaluateFilter(filter: CompiledFilter, entry: FlatEntry): boolean {
    const keywords = get(keywordsStore);
    return FilterParser.evaluateFlatEntry(filter.ast, entry, keywords.categories, filter.modifiers);
  }

  /**
   * Count records matching a filter across all parsed files
   * @param filter - Compiled filter
   * @param records - Optional array of files to search (defaults to all parsed records)
   * @returns Count of matching files, headers, and records
   */
  countRecords(filter: CompiledFilter, records?: ParsedFile[]): RecordCount {
    const filesToSearch = records || this.getParsedRecords();
    const keywords = get(keywordsStore);

    let recordCount = 0;

    for (const file of filesToSearch) {
      for (const entry of file.entries) {
        if (FilterParser.evaluateFlatEntry(filter.ast, entry, keywords.categories, filter.modifiers)) {
          recordCount++;
        }
      }
    }

    return { recordCount };
  }

  // ==================== Chip Management ====================

  /**
   * Create chips from a filter expression
   * @param expression - Filter expression to parse
   * @returns Array of active chips
   */
  createChipsFromFilter(expression: string): ActiveChip[] {
    // TODO: Implement chip creation from filter expression
    // This will parse the expression and extract keywords, tags, languages, etc.
    // For now, return empty array
    return [];
  }

  /**
   * Activate a chip in the UI
   * @param chip - Chip to activate
   */
  activateChip(chip: ActiveChip): void {
    // TODO: Implement chip activation
    // This will add the chip to the active chips list and trigger filtering
  }

  /**
   * Deactivate a chip by ID
   * @param chipId - ID of chip to deactivate
   */
  deactivateChip(chipId: string): void {
    // TODO: Implement chip deactivation
  }

  /**
   * Get all currently active chips
   * @returns Array of active chips
   */
  getActiveChips(): ActiveChip[] {
    // TODO: Implement getting active chips
    return [];
  }

  /**
   * Display filtered records in Plugin A's UI
   * @param expression - Filter expression to apply
   * @param type - Filter type: 'F' (Files), 'H' (Headers), 'R' (Records), 'D' (Dashboard)
   * @param sourceView - Optional identifier for the source view (e.g., "matrix-cell")
   */
  async displayFilteredRecords(expression: string, type?: 'F' | 'H' | 'R' | 'D', sourceView?: string): Promise<void> {
    // Activate/open the records view
    await this.plugin.activateRecordsView();

    // Get the records view instance
    const { workspace } = this.plugin.app;
    const leaves = workspace.getLeavesOfType('records-view');

    if (leaves.length > 0) {
      const recordsView = leaves[0].view as any;
      if (recordsView && recordsView.setFilterExpression) {
        // Set the filter expression on the view with the specified type
        recordsView.setFilterExpression(expression, type);
      }
    }
  }

  // ==================== Subjects API ====================

  /**
   * Get all subjects
   * @returns Array of all subjects
   */
  getSubjects(): Subject[] {
    const subjects = get(subjectsStore);
    return subjects.subjects || [];
  }

  /**
   * Get a specific subject by ID
   * @param id - Subject ID to look up
   * @returns Subject or undefined if not found
   */
  getSubject(id: string): Subject | undefined {
    const subjects = get(subjectsStore);
    return subjects.subjects.find(s => s.id === id);
  }

  // ==================== Event Subscriptions ====================

  /**
   * Subscribe to records change events (triggered after rescan)
   * @param callback - Function to call when records change
   * @returns Unsubscribe function
   */
  onRecordsChanged(callback: () => void): () => void {
    this.recordsChangeCallbacks.add(callback);
    return () => this.recordsChangeCallbacks.delete(callback);
  }

  /**
   * Internal: Notify subscribers that records have changed
   * Called by plugin after rescan completes
   */
  notifyRecordsChanged(): void {
    this.recordsChangeCallbacks.forEach(cb => cb());
  }
}
