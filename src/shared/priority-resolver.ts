import type { KeywordStyle } from '../shared/keyword-style';
import { MainCombinePriority } from '../shared/combine-priority';

/**
 * Centralized icon resolution - concatenates all keywords with Icon/StyleAndIcon priority
 * @param keywords Array of KeywordStyle objects to resolve icons from
 * @returns Concatenated icon string or undefined
 */
export function resolveIcon(keywords: KeywordStyle[]): string | undefined {
  if (keywords.length === 0) return undefined;

  // Collect all keywords with Icon or StyleAndIcon priority
  const iconsWithPriority = keywords
    .filter(kw =>
      kw.combinePriority === MainCombinePriority.Icon ||
      kw.combinePriority === MainCombinePriority.StyleAndIcon
    )
    .map(kw => kw.generateIcon)
    .filter(icon => icon);

  // If we have keywords with icon priority, concatenate their icons
  if (iconsWithPriority.length > 0) {
    return iconsWithPriority.join('');
  }

  // Otherwise use first keyword's icon
  return keywords[0]?.generateIcon;
}

/**
 * Resolve keyword NAMES that should provide icons (for widget mark elements)
 * Used when creating <mark class="kh-icon keywordname"> elements (icons shown via CSS ::before)
 * @param keywords Array of KeywordStyle objects
 * @returns Array of keyword names that have icon priority
 */
export function resolveIconKeywordNames(keywords: KeywordStyle[]): string[] {
  if (keywords.length === 0) return [];

  // Collect all keywords with Icon or StyleAndIcon priority
  const keywordsWithIconPriority = keywords.filter(kw =>
    kw.combinePriority === MainCombinePriority.Icon ||
    kw.combinePriority === MainCombinePriority.StyleAndIcon
  );

  // If we have keywords with icon priority, return their names
  if (keywordsWithIconPriority.length > 0) {
    return keywordsWithIconPriority.map(kw => kw.keyword);
  }

  // Otherwise use first keyword
  return [keywords[0].keyword];
}
