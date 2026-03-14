import { Editor, EditorSuggest, TFile } from 'obsidian';
import type { App, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from 'obsidian';
import { get } from 'svelte/store';
import { settingsStore } from './stores/settings-store';
import type { KeywordStyle } from './shared';

export class CombinedKeywordSuggest extends EditorSuggest<KeywordStyle> {
  constructor(app: App) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    // Get the current line
    const line = editor.getLine(cursor.line);
    const textBeforeCursor = line.substring(0, cursor.ch);

    // Trigger on ::: (three colons)
    // Look for pattern: [optional text] :::
    const triggerMatch = textBeforeCursor.match(/^(.*?):::$/);

    if (triggerMatch) {
      const beforeTripleColon = triggerMatch[1];

      // Find where to insert the suggestion (replace :::)
      const colonIndex = textBeforeCursor.lastIndexOf(':::');
      if (colonIndex === -1) return null;

      return {
        start: { line: cursor.line, ch: colonIndex },
        end: { line: cursor.line, ch: colonIndex + 3 },
        query: ''
      };
    }

    return null;
  }

  getSuggestions(context: EditorSuggestContext): KeywordStyle[] {
    const settings = get(settingsStore);

    // Get ALL keywords from all categories
    const allKeywords = settings.categories
      .flatMap(cat => cat.keywords);

    const query = context.query.toLowerCase();

    if (!query) {
      return allKeywords;
    }

    // Filter by keyword, description, or icon
    return allKeywords.filter((kw: KeywordStyle) =>
      kw.keyword.toLowerCase().includes(query) ||
      kw.description?.toLowerCase().includes(query) ||
      kw.generateIcon?.includes(query)
    );
  }

  renderSuggestion(keyword: KeywordStyle, el: HTMLElement): void {
    const container = el.createDiv({ cls: 'combined-keyword-suggestion' });

    // Icon
    if (keyword.generateIcon) {
      container.createSpan({
        text: keyword.generateIcon + ' ',
        cls: 'combined-keyword-icon'
      });
    }

    // Keyword name
    container.createSpan({
      text: keyword.keyword,
      cls: 'combined-keyword-name'
    });

    // Description
    if (keyword.description) {
      container.createSpan({
        text: ' - ' + keyword.description,
        cls: 'combined-keyword-description'
      });
    }

    // Add CSS for styling
    if (!document.querySelector('#combined-keyword-suggestion-styles')) {
      const style = document.createElement('style');
      style.id = 'combined-keyword-suggestion-styles';
      style.textContent = `
        .combined-keyword-suggestion {
          padding: 4px 8px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .combined-keyword-icon {
          font-size: 1.2em;
        }
        .combined-keyword-name {
          color: var(--text-accent);
          font-weight: 500;
        }
        .combined-keyword-description {
          color: var(--text-muted);
          font-size: 0.9em;
        }
      `;
      document.head.appendChild(style);
    }
  }

  selectSuggestion(keyword: KeywordStyle, evt: MouseEvent | KeyboardEvent): void {
    if (!this.context) return;

    const editor = this.context.editor;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    // Find ::: trigger
    const colonIndex = line.lastIndexOf(':::');
    if (colonIndex === -1) return;

    const beforeTripleColon = line.substring(0, colonIndex);
    const afterTripleColon = line.substring(colonIndex + 3);

    // Handle header markers
    let headerPart = '';
    let contentPart = beforeTripleColon;

    const headerMatch = beforeTripleColon.match(/^(\s*#+\s*)/);
    if (headerMatch) {
      headerPart = headerMatch[1];
      contentPart = beforeTripleColon.substring(headerMatch[0].length);
    }

    // Build new line: header + keyword :: + content (without :::) + after
    const newLine = `${headerPart}${keyword.keyword} :: ${contentPart.trim()}${afterTripleColon}`.trim();

    // Replace the line
    editor.setLine(cursor.line, newLine);

    // Position cursor after the ::
    const newCursorPos = headerPart.length + keyword.keyword.length + 4; // header + keyword + " :: "
    editor.setCursor({
      line: cursor.line,
      ch: newCursorPos
    });
  }
}
