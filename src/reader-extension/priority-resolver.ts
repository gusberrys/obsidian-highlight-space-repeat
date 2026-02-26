import type { KeywordStyle } from '../shared/keyword-style';
import type { AuxiliaryKeyword } from '../shared/keyword-style';
import { MainCombinePriority, AuxiliaryCombinePriority } from '../shared/combine-priority';

/**
 * Determines which icon to display based on main keyword priority and auxiliary keywords
 */
export function resolveIcon(
  mainKeyword: KeywordStyle,
  auxiliaryKeywords: AuxiliaryKeyword[]
): string | undefined {
  // If no auxiliary keywords, use main's icon
  if (auxiliaryKeywords.length === 0) {
    return mainKeyword.generateIcon;
  }

  // Check if main keyword has icon priority
  const hasIconPriority = mainKeyword.mainKeyword &&
    (mainKeyword.combinePriority === MainCombinePriority.Icon ||
     mainKeyword.combinePriority === MainCombinePriority.StyleAndIcon);

  if (hasIconPriority) {
    // Main has icon priority - use main's icon
    return mainKeyword.generateIcon;
  }

  // Check if any auxiliary has OverrideIcon priority
  const overrideAux = [...auxiliaryKeywords].reverse().find(aux =>
    aux.icon && (aux as any).combinePriority === AuxiliaryCombinePriority.OverrideIcon
  );

  if (overrideAux) {
    // Use the last auxiliary with OverrideIcon
    return overrideAux.icon;
  }

  // Otherwise, append all auxiliary icons
  return auxiliaryKeywords.map(aux => aux.icon).join('');
}

/**
 * Determines which colors to use based on main keyword priority and auxiliary keywords
 */
export function resolveColors(
  mainKeyword: KeywordStyle,
  auxiliaryKeywords: AuxiliaryKeyword[]
): { color: string; backgroundColor: string } {
  // Default to main keyword's colors
  let finalColor = mainKeyword.color;
  let finalBackgroundColor = mainKeyword.backgroundColor;

  // If no auxiliary keywords, use main's colors
  if (auxiliaryKeywords.length === 0) {
    return { color: finalColor, backgroundColor: finalBackgroundColor };
  }

  // Check if main keyword has style priority
  const hasStylePriority = mainKeyword.mainKeyword &&
    (mainKeyword.combinePriority === MainCombinePriority.Style ||
     mainKeyword.combinePriority === MainCombinePriority.StyleAndIcon);

  if (hasStylePriority) {
    // Main has style priority - use main's colors
    return { color: finalColor, backgroundColor: finalBackgroundColor };
  }

  // Use first auxiliary keyword's colors
  const firstAux = auxiliaryKeywords[0];
  if (firstAux.color) finalColor = firstAux.color;
  if (firstAux.backgroundColor) finalBackgroundColor = firstAux.backgroundColor;

  return { color: finalColor, backgroundColor: finalBackgroundColor };
}

/**
 * Get all CSS classes to apply (main + all auxiliaries)
 */
export function resolveClasses(
  mainKeyword: KeywordStyle,
  auxiliaryKeywords: AuxiliaryKeyword[]
): string[] {
  const classes: string[] = [];

  // Add main keyword class
  if (mainKeyword.ccssc) {
    classes.push(mainKeyword.ccssc);
  }

  // Add all auxiliary keyword classes
  for (const aux of auxiliaryKeywords) {
    if ((aux as any).class) {
      classes.push((aux as any).class);
    }
  }

  return classes;
}
