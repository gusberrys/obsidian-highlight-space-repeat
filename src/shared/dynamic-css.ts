import type { KeywordStyle, Category } from './keyword-style';
import { generateIKeywords, generateHKeywords, generateLKeywords, calculateHKeywordWidths, type VWordSettings } from './vword';

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
        // Treat pure black (#000000 or #000) as transparent ONLY for normal keywords
        // Color keywords should keep their black color
        const color = (!keyword.isColorKeyword && (keyword.color === '#000000' || keyword.color === '#000')) ? 'transparent' : keyword.color;
        const backgroundColor = (!keyword.isColorKeyword && (keyword.backgroundColor === '#000000' || keyword.backgroundColor === '#000')) ? 'transparent' : keyword.backgroundColor;

        // Only generate color CSS if NOT append
        if (keyword.stylePriority !== 'append') {
          // Color keywords: only generate CSS for color mode ON (body.cc-enabled)
          // Normal keywords: generate base CSS (always visible)
          const scope = keyword.isColorKeyword ? 'body.cc-enabled ' : '';

          cssRules.push(`
${scope}.${className} {
  color: ${color} !important;
  background-color: ${backgroundColor} !important;
}

${scope}mark.${className} {
  color: ${color} !important;
  background-color: ${backgroundColor} !important;
}

${scope}span.${className} {
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

        // Add ::before pseudo-element for icon
        if (keyword.isColorKeyword && keyword.colorIcon && keyword.colorIcon.trim()) {
          // Color keywords: icon only shown when color mode is ON
          // Headers (h1, h2) get icon in ::after on the right
          // Everything else gets icon in ::before on the left
          cssRules.push(`
body.cc-enabled h1.${className},
body.cc-enabled h2.${className} {
  position: relative;
}

body.cc-enabled h1.${className}::after,
body.cc-enabled h2.${className}::after {
  content: "${keyword.colorIcon}";
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

body.cc-enabled .kh-highlighted.${className}:not(h1):not(h2)::before,
body.cc-enabled mark.${className}::before {
  content: "${keyword.colorIcon} ";
}`);
        } else if (keyword.generateIcon && keyword.generateIcon.trim()) {
          // Normal keywords: icon added via JavaScript in reader-highlighter
          // CSS version for mark tags only
          cssRules.push(`
mark.${className}::before {
  content: "${keyword.generateIcon}";
}`);
        }
      }
    });
  });

  // Combinable feature removed - no combination CSS rules needed

  // No visibility rules needed - color keywords only have CSS when body.cc-enabled
  // Normal keywords always have their CSS, color keywords override via body.cc-enabled scope

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
 * Generate CSS to control Code Styler plugin highlights
 * Hide them by default, show only when color mode is ON
 */
export function generateCodeStylerOverrideCSS(): string {
  return `
/* Hide Code Styler highlights by default (when color mode is OFF) */
body:not(.cc-enabled) [class^="code-styler-line-highlighted"],
body:not(.cc-enabled) [class*=" code-styler-line-highlighted"] {
  --gradient-background-colour: transparent !important;
}

/* When color mode is ON, Code Styler's own CSS applies normally */
/* No override needed - body.cc-enabled allows Code Styler colors to show */
`.trim();
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
 * Inject Code Styler override CSS into the document
 */
export function injectCodeStylerOverrideCSS(): void {
  // Remove existing Code Styler override CSS
  const existingStyle = document.getElementById('code-styler-override-css');
  if (existingStyle) {
    existingStyle.remove();
  }

  // Generate and inject new CSS
  const css = generateCodeStylerOverrideCSS();
  if (css.trim()) {
    const style = document.createElement('style');
    style.id = 'code-styler-override-css';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

/**
 * Inject all CSS (keywords + VWords + Code Styler override)
 */
export function injectAllCSS(categories: Category[], vwordSettings: VWordSettings): void {
  injectKeywordCSS(categories);
  injectVWordCSS(vwordSettings);
  injectCodeStylerOverrideCSS();
}
