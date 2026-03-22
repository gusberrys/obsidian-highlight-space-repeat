import { App, type Command, SuggestModal } from 'obsidian';
import { get } from 'svelte/store';
import { settingsStore } from 'src/stores/settings-store';
import type { KeywordStyle } from 'src/shared';

type KeywordWithCategory = KeywordStyle & { categoryName: string };

class KeywordSuggestModal extends SuggestModal<KeywordWithCategory> {
  private onChoose: (keyword: KeywordStyle) => void;

  constructor(app: App, onChoose: (keyword: KeywordStyle) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  getSuggestions(query: string): KeywordWithCategory[] {
    const settings = get(settingsStore);
    const allKeywords: KeywordWithCategory[] = [];

    // Add individual keywords
    settings.categories.forEach(category => {
      category.keywords.forEach(keyword => {
        allKeywords.push({
          ...keyword,
          categoryName: category.icon
        });
      });
    });

    // No more combinations - combinable feature removed

    if (!query) {
      return allKeywords;
    }

    const lowerQuery = query.toLowerCase();
    return allKeywords.filter(keyword => {
      const matchKeyword = keyword.keyword.toLowerCase().includes(lowerQuery);
      const matchDescription = keyword.description?.toLowerCase().includes(lowerQuery) || false;
      const matchCategory = keyword.categoryName.toLowerCase().includes(lowerQuery);
      const matchIcon = keyword.generateIcon?.toLowerCase().includes(lowerQuery) || false;

      return matchKeyword || matchDescription || matchCategory || matchIcon;
    });
  }

  renderSuggestion(keywordWithCategory: KeywordWithCategory, el: HTMLElement) {
    const container = el.createDiv({ cls: 'keyword-suggestion' });

    const mainLine = container.createDiv({ cls: 'keyword-suggestion-main' });

    // Icon and keyword
    const keywordPart = mainLine.createSpan({ cls: 'keyword-suggestion-keyword' });
    if (keywordWithCategory.generateIcon) {
      keywordPart.createSpan({ text: keywordWithCategory.generateIcon + ' ' });
    }
    keywordPart.createSpan({ text: keywordWithCategory.keyword, cls: 'keyword-text' });

    // Category
    mainLine.createSpan({
      text: `: ${keywordWithCategory.description}`,
      cls: 'keyword-suggestion-category'
    });

    // Description
    // if (keywordWithCategory.description) {
    //   container.createDiv({
    //     text: `${keywordWithCategory.categoryName}`,
    //     cls: 'keyword-suggestion-description'
    //   });
    // }

    // Add CSS for styling
    if (!document.querySelector('#keyword-suggestion-styles')) {
      const style = document.createElement('style');
      style.id = 'keyword-suggestion-styles';
      style.textContent = `
        .keyword-suggestion {
          padding: 4px 0;
        }
        .keyword-suggestion-main {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .keyword-suggestion-keyword {
          font-weight: 600;
          color: var(--text-accent);
        }
        .keyword-suggestion-category {
          font-size: 0.85em;
          color: var(--text-muted);
          font-style: italic;
        }
        .keyword-suggestion-description {
          font-size: 0.8em;
          color: var(--text-faint);
          margin-top: 1px;
          padding-left: 2px;
        }
      `;
      document.head.appendChild(style);
    }
  }

  onChooseSuggestion(keywordWithCategory: KeywordWithCategory) {
    this.onChoose(keywordWithCategory);
  }
}

export const createInsertKeywordCommand: (app: App) => Command = (app: App) => ({
  id: 'kh-insert-keyword-with-line',
  name: 'Insert keyword with current line content',
  editorCallback: (editor) => {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const selection = editor.getSelection();

    new KeywordSuggestModal(app, (keyword: KeywordStyle) => {
      const className = keyword.keyword;

      if (selection && selection.trim()) {
        // If there's a selection, surround it with keyword (icon displays via CSS ::before)
        const newSelection = `<mark class="${className}"> ${selection} </mark>`;
        editor.replaceSelection(newSelection);
      } else {
        // No selection - use existing logic
        let newContent: string;

        // Combinable feature removed - just insert the keyword
        // Always insert keyword at the current position
        if (false) {
          // This block is never reached - kept for code structure
          newContent = line;
        } else if (/^xtab/.test(line)) {
          // For xtab lines: insert only the icon
          newContent = line + " " + (keyword.generateIcon || '');
        } else if (/^\s*#/.test(line)) {
          // For headers: insert keyword with :: after the header marker
          const headerMatch = line.match(/^(\s*#+\s*)(.*)/);
          if (headerMatch) {
            const headerPart = headerMatch[1]; // "# " or "## " etc
            const contentPart = headerMatch[2]; // rest of the line
            newContent = `${headerPart}${keyword.keyword} :: ${contentPart}`;
          } else {
            // Fallback if regex doesn't match
            newContent = `${keyword.keyword} :: ${line}`;
          }
        } else if (/^\s*$/.test(line)) {
          // For empty lines: insert keyword with ::
          newContent = `${keyword.keyword} ::`;
        } else {
          // For other lines: insert mark at cursor position
          const cursorPos = cursor.ch;
          const beforeCursor = line.substring(0, cursorPos);
          const afterCursor = line.substring(cursorPos);

          newContent = beforeCursor + `<mark class="${className}">` + afterCursor;
        }

        editor.setLine(cursor.line, newContent);

        // Position cursor at the end of the line
        editor.setCursor({
          line: cursor.line,
          ch: newContent.length
        });
      }
    }).open();
  },
});