import type { KeywordStyle, Category, VWordSettings } from './keyword-style';
import { generateIKeywords, generateHKeywords, calculateHKeywordWidths } from './vword';

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

        // Add ::before pseudo-element for icon if generateIcon exists
        if (keyword.generateIcon && keyword.generateIcon.trim()) {
          cssRules.push(`
mark.${className}::before {
  content: "${keyword.generateIcon}";
}`);
        }

        // Add rule for list items following highlighted paragraphs
        cssRules.push(`
.el-p:has(.kh-highlighted.${className}) + .el-ul > ul,
.el-p:has(.kh-highlighted.${className}) + .el-ol > ol {
  margin-top: 0px;
}

.el-p:has(.kh-highlighted.${className}) + .el-ul > ul > li,
.el-p:has(.kh-highlighted.${className}) + .el-ol > ol > li {
  color: ${color} !important;
  background-color: ${backgroundColor} !important;
}`);
      }
    });
  });

  // Combinable feature removed - no combination CSS rules needed

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
 * Generate all VWord CSS (i-keywords + h-keywords)
 */
export function generateVWordCSS(vwordSettings: VWordSettings): string {
  const iCSS = generateIKeywordCSS(vwordSettings);
  const hCSS = generateHKeywordCSS(vwordSettings);
  return [iCSS, hCSS].join('\n\n');
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
 * Inject all CSS (keywords + VWords)
 */
export function injectAllCSS(categories: Category[], vwordSettings: VWordSettings): void {
  injectKeywordCSS(categories);
  injectVWordCSS(vwordSettings);
}