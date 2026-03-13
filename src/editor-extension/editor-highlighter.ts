import { RegExpCursor } from '@codemirror/search';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, type PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { highlightMark } from 'src/editor-extension';
import type { KeywordStyle } from 'src/shared';
import { settingsStore, vwordSettingsStore } from 'src/stores/settings-store';
import { get } from 'svelte/store';
import { isVWordKeyword } from 'src/shared/vword';

type NewDecoration = { from: number; to: number; decoration: Decoration };

let keywordMap: Map<string, KeywordStyle> = new Map();

export class EditorHighlighter implements PluginValue {
  decorations: DecorationSet;
  unsubscribe: () => void;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);

    const settings = get(settingsStore);

    // Build keyword map from all categories
    keywordMap = new Map(
      settings.categories
        .flatMap(category =>
          category.keywords.flatMap((k: KeywordStyle) =>
            k.keyword
              ? k.keyword
                .split(",")                   // split by comma
                .map(s => s.trim())           // trim whitespace
                .filter(s => s.length > 0)    // ignore empty parts
                .map(s => ({ ...k, keyword: s })) // clone with individual keyword
              : []
          )
        )
        .map((k: KeywordStyle) => [k.keyword.toLowerCase(), k])
    );

    this.unsubscribe = settingsStore.subscribe(() => {
      setTimeout(() => {
        try {
          if (view.state) {
            this.decorations = this.buildDecorations(view);
            view.requestMeasure();
          }
        } catch (e) {
          this.unsubscribe();
        }
      }, 0);
    });
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  destroy(): void {
    this.unsubscribe();
  }

  buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const newDecorations: NewDecoration[] = [];

    newDecorations.push(...this.buildDecorationsForKeyword(view))
    newDecorations.forEach((d) => builder.add(d.from, d.to, d.decoration));

    return builder.finish();
  }

  buildDecorationsForKeyword(view: EditorView): NewDecoration[] {
    const newDecorations: NewDecoration[] = [];

    // Match keyword lines: start of line, optional whitespace, optional list markers, optional headers (#), keywords, then ::
    // This will NOT match URLs like http:// or :: in the middle of text
    // Matches: "def ::", "  imp foo ::", "# bar baz ::", "- foo ::", "* bar ::", "1. baz ::", etc.
    const cursorR = new RegExpCursor(
      view.state.doc,
      `^\\s*(?:[-*+]|\\d+\\.)?\\s*(#{0,6}\\s*)?[\\w\\s]+::`,
      {},
      0,
      view.state.doc.length
    );

    while (!cursorR.done) {
      const from = cursorR.value.from;
      const to = cursorR.value.to;

      const matchText = view.state.doc.sliceString(from, to); // e.g. "foo bar ::"

      // Extract keywords with their positions
      const keywordPositions = this.extractKeywordsWithPositions(matchText, from);

      // Create individual decorations for each keyword
      for (const { keyword, keywordFrom, keywordTo } of keywordPositions) {
        newDecorations.push({
          from: keywordFrom,
          to: keywordTo,
          decoration: highlightMark(keyword),
        });
      }

      cursorR.next();
    }
    return newDecorations;
  }

  /**
   * Extract keywords with their positions in the document
   * Returns array of {keyword, keywordFrom, keywordTo}
   */
  extractKeywordsWithPositions(
    text: string,
    baseOffset: number
  ): Array<{ keyword: KeywordStyle; keywordFrom: number; keywordTo: number }> {
    const result: Array<{ keyword: KeywordStyle; keywordFrom: number; keywordTo: number }> = [];

    // 1. Find :: separator
    const colonIndex = text.indexOf('::');
    if (colonIndex === -1) return result;

    // 2. Get text before :: (ONLY search keywords on LEFT side)
    const beforeColon = text.substring(0, colonIndex);

    // 3. Find where keywords start (after header markers)
    let keywordsStartOffset = 0;
    const trimmedBefore = beforeColon.trim();

    if (trimmedBefore.startsWith('#')) {
      const firstSpace = trimmedBefore.indexOf(' ');
      if (firstSpace === -1) return result;

      // Find the actual position in the original text where keywords start
      keywordsStartOffset = beforeColon.indexOf(trimmedBefore) + firstSpace + 1;
    }

    // 4. Get the keywords portion
    const keywordsPortion = beforeColon.substring(keywordsStartOffset);

    // 5. Find each keyword and its position
    let currentPos = 0;
    const keywordNames = keywordsPortion.split(/(\s+)/); // Split but keep whitespace

    for (const part of keywordNames) {
      if (part.trim().length > 0) {
        const trimmedPart = part.trim();

        // First, check if it's a regular keyword
        let kwData = keywordMap.get(trimmedPart.toLowerCase());

        // If not a regular keyword, check if it's a VWord
        if (!kwData && isVWordKeyword(trimmedPart)) {
          const vwordSettings = get(vwordSettingsStore);
          // Create synthetic KeywordStyle for VWord highlighting
          kwData = {
            keyword: trimmedPart,
            color: vwordSettings.color,
            backgroundColor: vwordSettings.backgroundColor,
          };
        }

        if (kwData) {
          const keywordFrom = baseOffset + keywordsStartOffset + currentPos;
          const keywordTo = keywordFrom + part.length;
          result.push({
            keyword: kwData,
            keywordFrom,
            keywordTo,
          });
        }
      }
      currentPos += part.length;
    }

    return result;
  }

}

export const editorHighlighter = ViewPlugin.fromClass(EditorHighlighter, {
  decorations: (value: EditorHighlighter) => value.decorations,
});
