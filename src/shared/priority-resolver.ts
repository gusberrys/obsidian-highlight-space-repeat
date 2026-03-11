import type { KeywordStyle } from '../shared/keyword-style';
import { MainCombinePriority } from '../shared/combine-priority';

/**
 * Centralized icon resolution using standardized priority rules
 * Priority Rules:
 * 1. Different priorities → highest priority wins
 * 2. Same priority → LAST one wins (most specific)
 * 3. No Icon/StyleAndIcon priority → last keyword with icon
 * @param keywords Array of KeywordStyle objects to resolve icons from
 * @returns Icon string or undefined
 */
export function resolveIcon(keywords: KeywordStyle[]): string | undefined {
  if (keywords.length === 0) return undefined;

  // Filter keywords with Icon or StyleAndIcon priority
  const keywordsWithIconPriority = keywords.filter(kw =>
    kw.combinePriority === MainCombinePriority.Icon ||
    kw.combinePriority === MainCombinePriority.StyleAndIcon
  );

  if (keywordsWithIconPriority.length > 0) {
    // Map priority enum values to numbers for comparison
    const getPriorityValue = (priority: MainCombinePriority) => {
      if (priority === MainCombinePriority.StyleAndIcon) return 3;
      if (priority === MainCombinePriority.Icon) return 1;
      return 0;
    };

    // Find the highest priority value
    const maxPriority = Math.max(...keywordsWithIconPriority.map(kw => getPriorityValue(kw.combinePriority)));

    // Filter to only those with the highest priority
    const highestPriorityKeywords = keywordsWithIconPriority.filter(kw =>
      getPriorityValue(kw.combinePriority) === maxPriority
    );

    // Take LAST with highest priority (most specific)
    if (highestPriorityKeywords.length > 0) {
      const winner = highestPriorityKeywords[highestPriorityKeywords.length - 1];
      if (winner?.generateIcon) return winner.generateIcon;
    }
  }

  // Fallback: find last keyword that has an icon (most specific)
  for (let i = keywords.length - 1; i >= 0; i--) {
    if (keywords[i].generateIcon) {
      return keywords[i].generateIcon;
    }
  }

  return undefined;
}

/**
 * Resolve keyword NAMES that should provide icons (for widget mark elements)
 * Used when creating <mark class="kh-icon keywordname"> elements (icons shown via CSS ::before)
 * Uses same standardized priority rules as resolveIcon (LAST with highest priority)
 * @param keywords Array of KeywordStyle objects
 * @returns Array with single keyword name (the winner)
 */
export function resolveIconKeywordNames(keywords: KeywordStyle[]): string[] {
  if (keywords.length === 0) return [];

  // Filter keywords with Icon or StyleAndIcon priority
  const keywordsWithIconPriority = keywords.filter(kw =>
    kw.combinePriority === MainCombinePriority.Icon ||
    kw.combinePriority === MainCombinePriority.StyleAndIcon
  );

  if (keywordsWithIconPriority.length > 0) {
    // Map priority enum values to numbers for comparison
    const getPriorityValue = (priority: MainCombinePriority) => {
      if (priority === MainCombinePriority.StyleAndIcon) return 3;
      if (priority === MainCombinePriority.Icon) return 1;
      return 0;
    };

    // Find the highest priority value
    const maxPriority = Math.max(...keywordsWithIconPriority.map(kw => getPriorityValue(kw.combinePriority)));

    // Filter to only those with the highest priority
    const highestPriorityKeywords = keywordsWithIconPriority.filter(kw =>
      getPriorityValue(kw.combinePriority) === maxPriority
    );

    // Take LAST with highest priority (most specific)
    if (highestPriorityKeywords.length > 0) {
      return [highestPriorityKeywords[highestPriorityKeywords.length - 1].keyword];
    }
  }

  // Fallback: find last keyword that has an icon (most specific)
  for (let i = keywords.length - 1; i >= 0; i--) {
    if (keywords[i] && keywords[i].generateIcon) {
      return [keywords[i].keyword];
    }
  }

  // Ultimate fallback: use last keyword
  const lastKeyword = keywords[keywords.length - 1];
  return lastKeyword ? [lastKeyword.keyword] : [];
}
