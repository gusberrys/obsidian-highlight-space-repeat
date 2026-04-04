import type { KeywordStyle, Category } from './keyword-style';
import { generateIKeywords, generateHKeywords, generateLKeywords, calculateHKeywordWidths, type VWordSettings } from './vword';
import type { ColourPair } from '../settings/ColorSettings';

export function generateKeywordCSS(categories: Category[]): string {
  const cssRules: string[] = [];

  // Build a map of keywords for combined keyword lookup
  const keywordMap = new Map<string, KeywordStyle>();
  categories.forEach(category => {
    category.keywords.forEach(keyword => {
      if (keyword.keyword && keyword.keyword.trim()) {
        keywordMap.set(keyword.keyword, keyword);
      }
    });
  });

  // Generate CSS for each keyword
  categories.forEach(category => {
    category.keywords.forEach(keyword => {
      // Use keyword name as class (for marks like <mark class="def">)
      if (keyword.keyword && keyword.keyword.trim()) {
        const className = keyword.keyword;
        // Treat pure black (#000000 or #000) as transparent
        const color = (keyword.color === '#000000' || keyword.color === '#000') ? 'transparent' : keyword.color;
        const backgroundColor = (keyword.backgroundColor === '#000000' || keyword.backgroundColor === '#000') ? 'transparent' : keyword.backgroundColor;

        // Only generate color CSS if NOT append
        if (keyword.stylePriority !== 'append') {
          cssRules.push(`
.${className} {
  color: ${color} !important;
  background-color: ${backgroundColor} !important;
}

mark.${className} {
  color: ${color} !important;
  background-color: ${backgroundColor} !important;
}

span.${className} {
  color: ${color} !important;
  background-color: ${backgroundColor} !important;
}`);

          // Add rule for list items following highlighted paragraphs
          // DISABLED: Feature turned off for now
          // cssRules.push(`
// .el-p:has(.kh-highlighted.${className}) + .el-ul > ul,
// .el-p:has(.kh-highlighted.${className}) + .el-ol > ol {
//   margin-top: 0px;
// }
//
// .el-p:has(.kh-highlighted.${className}) + .el-ul > ul > li,
// .el-p:has(.kh-highlighted.${className}) + .el-ol > ol > li {
//   color: ${color};
//   background-color: ${backgroundColor};
// }`);
        }

        // Add ::before pseudo-element for icon if generateIcon exists (always, regardless of stylePriority)
        if (keyword.generateIcon && keyword.generateIcon.trim()) {
          cssRules.push(`
mark.${className}::before {
  content: "${keyword.generateIcon}";
}`);
        }
      }
    });
  });

  // Combinable feature removed - no combination CSS rules needed

  // When color highlighting is enabled, disable ALL keyword styling (including custom CSS snippets)
  // This makes colors stand out without visual noise from keywords
  categories.forEach(category => {
    category.keywords.forEach(keyword => {
      if (keyword.keyword && keyword.keyword.trim()) {
        const className = keyword.keyword;
        cssRules.push(`
/* Reset all visual properties for keyword classes when color mode is active */
/* High specificity to override custom CSS snippets */
body.cc-enabled .${className},
body.cc-enabled mark.${className},
body.cc-enabled span.${className},
body.cc-enabled div.view-content.record-view-content mark.${className},
body.cc-enabled div.database-plugin__tbody mark.${className},
body.cc-enabled .markdown-preview-section mark.${className},
body.cc-enabled .el-p .${className} {
  /* Reset colors and backgrounds */
  color: inherit !important;
  background-color: transparent !important;
  background-image: none !important;
  background: transparent !important;
  background-size: auto !important;
  background-position: 0 0 !important;

  /* Reset decorative borders but keep header underlines */
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
  border-radius: 0 !important;
  /* border-bottom preserved for header underlines */

  /* Reset animations */
  animation: none !important;

  /* Preserves: font-size, font-weight, text-decoration, border-bottom, margin, padding */

  /* Reset decoration break */
  -webkit-box-decoration-break: unset !important;
  box-decoration-break: unset !important;

  /* Reset visual effects */
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  filter: none !important;
}

/* Reset all pseudo-elements */
body.cc-enabled mark.${className}::before,
body.cc-enabled mark.${className}::after,
body.cc-enabled .${className}::before,
body.cc-enabled .${className}::after {
  content: "" !important;
  background: none !important;
  background-image: none !important;
  padding: 0 !important;
  margin: 0 !important;
  animation: none !important;
}`);
      }
    });
  });

  return cssRules.join('\n');
}

/**
 * Generate CSS for VWord i-keywords (image column control)
 * i10 to i90, step 5 - controls image column width percentage
 */
export function generateIKeywordCSS(vwordSettings: VWordSettings): string {
  const cssRules: string[] = [];
  const iKeywords = generateIKeywords();

  const color = vwordSettings.color;
  const backgroundColor = vwordSettings.backgroundColor;

  iKeywords.forEach(keyword => {
    const percentage = parseInt(keyword.substring(1), 10); // Remove 'i' prefix
    const textPercentage = 100 - percentage;

    // NO color styling for VWords - they're layout-only!
    // Colors come from the regular keywords (like 'def')

    // Image layout styling - controls the two-column split
    // Must override max-width from default styles
    cssRules.push(`
.kh-record-with-images.${keyword} .kh-record-text-column {
  width: ${textPercentage}%;
}

.kh-record-with-images.${keyword} .kh-record-image-column {
  width: ${percentage}%;
  max-width: ${percentage}%;
}`);
  });

  return cssRules.join('\n');
}

/**
 * Generate CSS for VWord l-keywords (last-item grid layout)
 * l10 to l90, step 5 - controls 2-column grid where last item spans right column
 */
export function generateLKeywordCSS(vwordSettings: VWordSettings): string {
  const cssRules: string[] = [];
  const lKeywords = generateLKeywords();

  lKeywords.forEach(keyword => {
    const percentage = parseInt(keyword.substring(1), 10); // Remove 'l' prefix
    const leftPercentage = 100 - percentage;

    // Reading view - restructured layout with wrapper divs
    const readingRules: string[] = [];

    // Flex container for the wrapper
    readingRules.push(`
.kh-l-layout.${keyword} {
  display: flex;
  align-items: flex-start;
}`);

    // Left column (items except last)
    readingRules.push(`
.kh-l-layout.${keyword} .kh-l-left-column {
  flex: 0 0 ${leftPercentage}%;
}

.kh-l-layout.${keyword} .kh-l-left-column ul,
.kh-l-layout.${keyword} .kh-l-left-column ol {
  margin: 0;
}`);

    // Right column (last item)
    readingRules.push(`
.kh-l-layout.${keyword} .kh-l-right-column {
  flex: 0 0 ${percentage}%;
}

.kh-l-layout.${keyword} .kh-l-right-column ul,
.kh-l-layout.${keyword} .kh-l-right-column ol {
  margin: 0;
  list-style: none;
  padding-left: 0;
}

.kh-l-layout.${keyword} .kh-l-right-column .list-bullet {
  display: none;
}`);

    cssRules.push(readingRules.join('\n'));

    // Records view - TODO: implement restructuring in KHEntry.ts
    // For now, just stack items normally
    const recordsRules: string[] = [];

    recordsRules.push(`
.kh-entry.${keyword} .kh-sub-items,
.kh-entry-compact.${keyword} .kh-sub-items,
.kh-entry-full.${keyword} .kh-sub-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}`);

    cssRules.push(recordsRules.join('\n'));
  });

  return cssRules.join('\n');
}

/**
 * Generate CSS for VWord h-keywords (horizontal list item ratio control)
 * 2-5 elements, sum 2-7 - controls horizontal list layout
 */
export function generateHKeywordCSS(vwordSettings: VWordSettings): string {
  const cssRules: string[] = [];
  const hKeywords = generateHKeywords();

  const color = vwordSettings.color;
  const backgroundColor = vwordSettings.backgroundColor;

  hKeywords.forEach(keyword => {
    // NO color styling for VWords - they're layout-only!
    // Colors come from the regular keywords (like 'def')

    // Parse the weights for flex ratios
    const value = keyword.substring(1); // Remove 'h' prefix
    const widths = calculateHKeywordWidths(value);

    // Generate list item styling (match working r-keyword pattern)
    const listRules: string[] = [];

    // Make the list horizontal - target inner ul/ol
    listRules.push(`
.el-p:has(.kh-highlighted.${keyword}) + .el-ul > ul,
.el-p:has(.kh-highlighted.${keyword}) + .el-ol > ol {
  display: flex;
  flex-direction: row;
  gap: 8px;
  margin-top: 0px;
  list-style: none;
}`);

    // Apply flex ratios to each list item (using weights, not percentages)
    const digits = value.split('').map(d => parseInt(d, 10));
    digits.forEach((flexValue, index) => {
      listRules.push(`
.el-p:has(.kh-highlighted.${keyword}) + .el-ul > ul > li:nth-child(${index + 1}) { flex: ${flexValue}; }
.el-p:has(.kh-highlighted.${keyword}) + .el-ol > ol > li:nth-child(${index + 1}) { flex: ${flexValue}; }`);
    });

    cssRules.push(listRules.join('\n'));

    // Generate CSS for records view (KHEntry rendering)
    // Records use .kh-sub-items container with .kh-sub-item children
    const recordsRules: string[] = [];

    recordsRules.push(`
.kh-entry.${keyword} .kh-sub-items,
.kh-entry-compact.${keyword} .kh-sub-items,
.kh-entry-full.${keyword} .kh-sub-items {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

.kh-entry.${keyword} .kh-sub-item,
.kh-entry-compact.${keyword} .kh-sub-item,
.kh-entry-full.${keyword} .kh-sub-item {
  flex-shrink: 0;
}`);

    // Apply width to each sub-item
    widths.forEach((width, index) => {
      recordsRules.push(`
.kh-entry.${keyword} .kh-sub-item:nth-child(${index + 1}),
.kh-entry-compact.${keyword} .kh-sub-item:nth-child(${index + 1}),
.kh-entry-full.${keyword} .kh-sub-item:nth-child(${index + 1}) {
  width: ${width.toFixed(2)}%;
}`);
    });

    cssRules.push(recordsRules.join('\n'));
  });

  return cssRules.join('\n');
}

/**
 * Generate all VWord CSS (i-keywords + h-keywords + l-keywords)
 */
export function generateVWordCSS(vwordSettings: VWordSettings): string {
  const iCSS = generateIKeywordCSS(vwordSettings);
  const hCSS = generateHKeywordCSS(vwordSettings);
  const lCSS = generateLKeywordCSS(vwordSettings);
  return [iCSS, hCSS, lCSS].join('\n\n');
}

/**
 * Calculate brightness of a color (0-255)
 * Used to determine if text should be white or black
 */
function calculateBrightness(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Generate CSS for color highlighting (mark tags with color classes)
 * All rules are scoped to body.cc-enabled for toggle support
 */
export function generateColorHighlightCSS(colourPairs: ColourPair[]): string {
  const cssRules: string[] = [];

  colourPairs.forEach(colour => {
    const textColor = calculateBrightness(colour.localColour) > 155 ? 'black' : 'white';

    // Old cc class (deprecated but kept for compatibility)
    cssRules.push(`
body.cc-enabled .markdown-preview-view mark.cc.${colour.localName},
body.cc-enabled .markdown-rendered mark.cc.${colour.localName},
body.cc-enabled mark.cc.${colour.localName} {
  background-color: ${colour.localColour} !important;
  color: ${textColor} !important;
  border-radius: 0 !important;
  padding: 0 !important;
}`);

    // New cl class (local reference) with book emoji
    cssRules.push(`
body.cc-enabled .markdown-preview-view mark.cl.${colour.localName},
body.cc-enabled .markdown-rendered mark.cl.${colour.localName},
body.cc-enabled mark.cl.${colour.localName} {
  background-color: ${colour.localColour} !important;
  color: ${textColor} !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

body.cc-enabled .markdown-preview-view mark.cl.${colour.localName}::before,
body.cc-enabled .markdown-rendered mark.cl.${colour.localName}::before,
body.cc-enabled mark.cl.${colour.localName}::before {
  content: "${colour.localReference} ";
  background-color: var(--background-primary);
  padding: 2px 4px;
  margin-right: 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
}`);

    // New cg class (global reference) with circle emoji
    cssRules.push(`
body.cc-enabled .markdown-preview-view mark.cg.${colour.localName},
body.cc-enabled .markdown-rendered mark.cg.${colour.localName},
body.cc-enabled mark.cg.${colour.localName} {
  background-color: ${colour.localColour} !important;
  color: ${textColor} !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

body.cc-enabled .markdown-preview-view mark.cg.${colour.localName}::before,
body.cc-enabled .markdown-rendered mark.cg.${colour.localName}::before,
body.cc-enabled mark.cg.${colour.localName}::before {
  content: "${colour.globalReference} ";
  background-color: var(--background-primary);
  padding: 2px 4px;
  margin-right: 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
}`);

    // Global Reference Class
    if (colour.globalReferenceClass && colour.globalReferenceClass.trim()) {
      cssRules.push(`
body.cc-enabled .kh-highlighted.${colour.globalReferenceClass},
body.cc-enabled .${colour.globalReferenceClass},
body.cc-enabled mark.${colour.globalReferenceClass},
body.cc-enabled li.kh-highlighted.${colour.globalReferenceClass},
body.cc-enabled ul li.${colour.globalReferenceClass} {
  background-color: ${colour.localColour} !important;
  color: ${textColor} !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

body.cc-enabled h1.${colour.globalReferenceClass},
body.cc-enabled h2.${colour.globalReferenceClass} {
  position: relative;
}

body.cc-enabled h1.${colour.globalReferenceClass}::after,
body.cc-enabled h2.${colour.globalReferenceClass}::after {
  content: "${colour.globalReference}";
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7em;
  background-color: var(--background-primary);
  padding: 2px 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
  pointer-events: none;
}

body.cc-enabled .kh-highlighted.${colour.globalReferenceClass}:not(h1):not(h2)::before,
body.cc-enabled .${colour.globalReferenceClass}:not(h1):not(h2)::before,
body.cc-enabled mark.${colour.globalReferenceClass}::before,
body.cc-enabled li.kh-highlighted.${colour.globalReferenceClass}::before,
body.cc-enabled ul li.${colour.globalReferenceClass}::before {
  content: "${colour.globalReference} ";
  background-color: var(--background-primary);
  padding: 2px 4px;
  margin-right: 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
}`);
    }

    // Global Value Class
    if (colour.globalValueClass && colour.globalValueClass.trim()) {
      cssRules.push(`
body.cc-enabled .kh-highlighted.${colour.globalValueClass},
body.cc-enabled .${colour.globalValueClass},
body.cc-enabled mark.${colour.globalValueClass},
body.cc-enabled li.kh-highlighted.${colour.globalValueClass},
body.cc-enabled ul li.${colour.globalValueClass} {
  background-color: ${colour.localColour} !important;
  color: ${textColor} !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

body.cc-enabled h1.${colour.globalValueClass},
body.cc-enabled h2.${colour.globalValueClass} {
  position: relative;
}

body.cc-enabled h1.${colour.globalValueClass}::after,
body.cc-enabled h2.${colour.globalValueClass}::after {
  content: "${colour.globalValue}";
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7em;
  background-color: var(--background-primary);
  padding: 2px 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
  pointer-events: none;
}

body.cc-enabled .kh-highlighted.${colour.globalValueClass}:not(h1):not(h2)::before,
body.cc-enabled .${colour.globalValueClass}:not(h1):not(h2)::before,
body.cc-enabled mark.${colour.globalValueClass}::before,
body.cc-enabled li.kh-highlighted.${colour.globalValueClass}::before,
body.cc-enabled ul li.${colour.globalValueClass}::before {
  content: "${colour.globalValue} ";
  background-color: var(--background-primary);
  padding: 2px 4px;
  margin-right: 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
}`);
    }

    // Local Reference Class
    if (colour.localReferenceClass && colour.localReferenceClass.trim()) {
      cssRules.push(`
body.cc-enabled .kh-highlighted.${colour.localReferenceClass},
body.cc-enabled .${colour.localReferenceClass},
body.cc-enabled mark.${colour.localReferenceClass},
body.cc-enabled li.kh-highlighted.${colour.localReferenceClass},
body.cc-enabled ul li.${colour.localReferenceClass} {
  background-color: ${colour.localColour} !important;
  color: ${textColor} !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

body.cc-enabled h1.${colour.localReferenceClass},
body.cc-enabled h2.${colour.localReferenceClass} {
  position: relative;
}

body.cc-enabled h1.${colour.localReferenceClass}::after,
body.cc-enabled h2.${colour.localReferenceClass}::after {
  content: "${colour.localReference}";
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7em;
  background-color: var(--background-primary);
  padding: 2px 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
  pointer-events: none;
}

body.cc-enabled .kh-highlighted.${colour.localReferenceClass}:not(h1):not(h2)::before,
body.cc-enabled .${colour.localReferenceClass}:not(h1):not(h2)::before,
body.cc-enabled mark.${colour.localReferenceClass}::before,
body.cc-enabled li.kh-highlighted.${colour.localReferenceClass}::before,
body.cc-enabled ul li.${colour.localReferenceClass}::before {
  content: "${colour.localReference} ";
  background-color: var(--background-primary);
  padding: 2px 4px;
  margin-right: 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
}`);
    }

    // Local Value Class
    if (colour.localValueClass && colour.localValueClass.trim()) {
      cssRules.push(`
body.cc-enabled .kh-highlighted.${colour.localValueClass},
body.cc-enabled .${colour.localValueClass},
body.cc-enabled mark.${colour.localValueClass},
body.cc-enabled li.kh-highlighted.${colour.localValueClass},
body.cc-enabled ul li.${colour.localValueClass} {
  background-color: ${colour.localColour} !important;
  color: ${textColor} !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

body.cc-enabled h1.${colour.localValueClass},
body.cc-enabled h2.${colour.localValueClass} {
  position: relative;
}

body.cc-enabled h1.${colour.localValueClass}::after,
body.cc-enabled h2.${colour.localValueClass}::after {
  content: "${colour.localValue}";
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7em;
  background-color: var(--background-primary);
  padding: 2px 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
  pointer-events: none;
}

body.cc-enabled .kh-highlighted.${colour.localValueClass}:not(h1):not(h2)::before,
body.cc-enabled .${colour.localValueClass}:not(h1):not(h2)::before,
body.cc-enabled mark.${colour.localValueClass}::before,
body.cc-enabled li.kh-highlighted.${colour.localValueClass}::before,
body.cc-enabled ul li.${colour.localValueClass}::before {
  content: "${colour.localValue} ";
  background-color: var(--background-primary);
  padding: 2px 4px;
  margin-right: 4px;
  border-radius: 3px;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
}`);
    }
  });

  return cssRules.join('\n');
}

export function injectKeywordCSS(categories: Category[]): void {
  // Remove existing keyword CSS
  const existingStyle = document.getElementById('highlight-space-repeat-dynamic-css');
  if (existingStyle) {
    existingStyle.remove();
  }

  // Generate and inject new CSS
  const css = generateKeywordCSS(categories);
  if (css.trim()) {
    const style = document.createElement('style');
    style.id = 'highlight-space-repeat-dynamic-css';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

/**
 * Inject VWord CSS into the document
 */
export function injectVWordCSS(vwordSettings: VWordSettings): void {
  // Remove existing VWord CSS
  const existingStyle = document.getElementById('highlight-space-repeat-vword-css');
  if (existingStyle) {
    existingStyle.remove();
  }

  // Generate and inject new CSS
  const css = generateVWordCSS(vwordSettings);
  if (css.trim()) {
    const style = document.createElement('style');
    style.id = 'highlight-space-repeat-vword-css';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

/**
 * Inject color highlighting CSS into the document
 */
export function injectColorHighlightCSS(colourPairs: ColourPair[]): void {
  // Remove existing color CSS
  const existingStyle = document.getElementById('color-highlight-css');
  if (existingStyle) {
    existingStyle.remove();
  }

  // Generate and inject new CSS
  const css = generateColorHighlightCSS(colourPairs);
  if (css.trim()) {
    const style = document.createElement('style');
    style.id = 'color-highlight-css';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

/**
 * Inject all CSS (keywords + VWords + colors)
 */
export function injectAllCSS(categories: Category[], vwordSettings: VWordSettings, colourPairs: ColourPair[]): void {
  injectKeywordCSS(categories);
  injectVWordCSS(vwordSettings);
  injectColorHighlightCSS(colourPairs);
}
