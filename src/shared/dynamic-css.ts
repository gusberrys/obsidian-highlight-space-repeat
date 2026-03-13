import type { KeywordStyle, Category } from './keyword-style';
import { getKeywordType, KeywordType } from './keyword-style';

export function generateKeywordCSS(categories: Category[]): string {
  const cssRules: string[] = [];

  // Build a map of keywords for combined keyword lookup
  const keywordMap = new Map<string, KeywordStyle>();
  categories.forEach(category => {
    category.keywords.forEach(keyword => {
      if (keyword.keyword && keyword.keyword.trim()) {
        const keywordNames = keyword.keyword.split(',').map(k => k.trim());
        keywordNames.forEach(kw => {
          if (kw) {
            keywordMap.set(kw, keyword);
          }
        });
      }
    });
  });

  // Generate CSS for each keyword
  categories.forEach(category => {
    category.keywords.forEach(keyword => {
      const classNames: string[] = [];

      // Add ccssc class if it exists
      if (keyword.ccssc && keyword.ccssc.trim()) {
        classNames.push(keyword.ccssc.trim());
      }

      // Add keyword name as class (for marks like <mark class="def">)
      if (keyword.keyword && keyword.keyword.trim()) {
        // Handle comma-separated keywords
        const keywordNames = keyword.keyword.split(',').map(k => k.trim());
        classNames.push(...keywordNames);
      }

      // Generate CSS rules for all class names
      classNames.forEach(className => {
        if (className) {
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
          // ONLY for non-helper keywords (MAIN and AUXILIARY)
          // Helper keywords should not style lists below them
          const keywordType = getKeywordType(keyword);
          const isHelperKeyword = keywordType === KeywordType.HELP || category.isHelper === true;

          if (!isHelperKeyword) {
            cssRules.push(`
div.el-p:has(> .kh-highlighted.${className}) + div.el-ul {
  margin-top: -19px;
}

div.el-p:has(> .kh-highlighted.${className}) + div.el-ul li {
  color: ${color} !important;
  background-color: ${backgroundColor} !important;
}`);
          }
        }
      });
    });
  });

  // Combinable feature removed - no combination CSS rules needed

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