import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { settingsStore } from 'src/stores/settings-store';
import { get } from 'svelte/store';
import type { KeywordStyle, Category } from 'src/shared';

/**
 * Get all keywords from settings as a flat array
 */
function getAllKeywords(): KeywordStyle[] {
  const settings = get(settingsStore);
  const allKeywords: KeywordStyle[] = [];

  settings.categories.forEach(category => {
    category.keywords.forEach((k: KeywordStyle) => {
      if (k.keyword) {
        allKeywords.push(k);
      }
    });
  });

  return allKeywords;
}

/**
 * Find recognized keywords in the line before cursor (before ::)
 */
function findRecognizedKeywords(lineBefore: string): KeywordStyle[] {
  const allKeywords = getAllKeywords();
  const recognized: KeywordStyle[] = [];

  // Get the part before :: (if present)
  const beforeDoubleColon = lineBefore.split('::')[0];

  // Check for each keyword if it appears in the line
  for (const keyword of allKeywords) {
    // Match keyword as whole word (surrounded by spaces, start/end of line, or punctuation)
    const regex = new RegExp(`\\b${keyword.keyword}\\b`, 'i');
    if (regex.test(beforeDoubleColon)) {
      recognized.push(keyword);
    }
  }

  return recognized;
}

/**
 * Get smart-prioritized subkeyword suggestions based on keywords already present in the line
 * Priority:
 * 1. subKeywords of already-present keywords that haven't been used yet (from last to first)
 * 2. All unused keywords if no subKeywords found
 */
function getSmartSubkeywordSuggestions(lineBefore: string): KeywordStyle[] {
  const settings = get(settingsStore);
  const allKeywords = getAllKeywords();
  const presentKeywords = findRecognizedKeywords(lineBefore);

  if (presentKeywords.length === 0) {
    // No keywords present - suggest all keywords
    return allKeywords;
  }

  const suggestions: KeywordStyle[] = [];
  const alreadyUsedKeywords = new Set(presentKeywords.map(k => k.keyword.toLowerCase()));

  // Strategy: For each present keyword (from last to first), add its unused subKeywords
  // This prioritizes subKeywords of the most recently added keyword
  for (let i = presentKeywords.length - 1; i >= 0; i--) {
    const presentKeyword = presentKeywords[i];

    if (presentKeyword.subKeywords && presentKeyword.subKeywords.length > 0) {
      for (const subKeywordId of presentKeyword.subKeywords) {
        if (subKeywordId.startsWith(':')) {
          // It's a category - add all keywords from that category
          const categoryId = subKeywordId.substring(1);
          const category = settings.categories.find((c: Category) => c.id === categoryId);
          if (category) {
            category.keywords.forEach((k: KeywordStyle) => {
              if (k.keyword && !alreadyUsedKeywords.has(k.keyword.toLowerCase())) {
                // Check if not already in suggestions
                if (!suggestions.find(s => s.keyword.toLowerCase() === k.keyword.toLowerCase())) {
                  suggestions.push(k);
                }
              }
            });
          }
        } else {
          // It's a keyword - add it if not used
          if (!alreadyUsedKeywords.has(subKeywordId.toLowerCase())) {
            const keyword = allKeywords.find(k => k.keyword.toLowerCase() === subKeywordId.toLowerCase());
            if (keyword) {
              // Check if not already in suggestions
              if (!suggestions.find(s => s.keyword.toLowerCase() === keyword.keyword.toLowerCase())) {
                suggestions.push(keyword);
              }
            }
          }
        }
      }
    }
  }

  // If no subKeywords found, suggest all unused keywords
  if (suggestions.length === 0) {
    return allKeywords.filter(k => !alreadyUsedKeywords.has(k.keyword.toLowerCase()));
  }

  return suggestions;
}

/**
 * Check if the line ends with two spaces immediately after a recognized keyword
 * Returns the keyword if found, null otherwise
 */
function getKeywordBeforeTwoSpaces(lineBefore: string): KeywordStyle | null {
  // Check if line ends with two spaces
  if (!lineBefore.match(/\s\s$/)) {
    return null;
  }

  // Remove the two spaces to get text before them
  const textBeforeSpaces = lineBefore.slice(0, -2);

  // Get the last word (word immediately before the two spaces)
  // Match word characters at the end of the string
  const lastWordMatch = textBeforeSpaces.match(/\b(\w+)$/);
  if (!lastWordMatch) {
    return null;
  }

  const lastWord = lastWordMatch[1];

  // Check if this word is a recognized keyword
  const allKeywords = getAllKeywords();
  for (const keyword of allKeywords) {
    if (keyword.keyword.toLowerCase() === lastWord.toLowerCase()) {
      return keyword;
    }
  }

  return null;
}

/**
 * CodeMirror autocomplete extension for keywords
 * Triggers when user types:
 * 1. ::: (three colons) - shows all keywords
 * 2. xxx - shows smart suggestions (removes xxx)
 * 3. // (two slashes) - shows smart suggestions (removes //)
 * 4. Two spaces after a recognized keyword - shows smart suggestions
 */
function keywordCompletions(context: CompletionContext): CompletionResult | null {
  // Get text before cursor
  const lineBefore = context.state.doc.lineAt(context.pos).text.slice(0, context.pos - context.state.doc.lineAt(context.pos).from);

  // Check if cursor is AFTER :: (we're past the keywords section)
  // If :: appears before the cursor, don't allow adding more keywords
  const lineAfterCursor = context.state.doc.lineAt(context.pos).text.slice(context.pos - context.state.doc.lineAt(context.pos).from);
  if (lineAfterCursor.trim().startsWith('::')) {
    // Cursor is before ::, allow autocomplete
  } else if (lineBefore.includes('::')) {
    // Cursor is after ::, block autocomplete
    return null;
  }

  // TRIGGER 1: ::: (three colons) - show all keywords
  const tripleColonMatch = lineBefore.match(/[^:]:::$/);
  const justTripleColon = lineBefore === ':::';
  const triggeredByTripleColon = tripleColonMatch || justTripleColon;

  // TRIGGER 2: xxx - show smart suggestions (remove xxx)
  const xxxMatch = lineBefore.match(/[^x]xxx$/) || lineBefore === 'xxx';
  const triggeredByXXX = !!xxxMatch;

  // TRIGGER 3: Two spaces immediately after a recognized keyword
  const keywordBeforeSpaces = getKeywordBeforeTwoSpaces(lineBefore);
  const triggeredByTwoSpaces = keywordBeforeSpaces !== null;

  // TRIGGER 4: // (two slashes) - show smart suggestions (remove //)
  const slashMatch = lineBefore.match(/[^/]\/\/$/);
  const justSlash = lineBefore === '//';
  const triggeredBySlash = slashMatch || justSlash;

  if (!triggeredByTripleColon && !triggeredByXXX && !triggeredByTwoSpaces && !triggeredBySlash) {
    return null;
  }

  // Determine which keywords to suggest
  let keywordsToSuggest: KeywordStyle[] = [];

  // For xxx, //, and two spaces triggers, use smart suggestions
  if (triggeredByXXX || triggeredBySlash || triggeredByTwoSpaces) {
    // Use smart prioritization based on already-present keywords
    let lineForSuggestions: string;
    if (triggeredByXXX) {
      lineForSuggestions = lineBefore.slice(0, -3); // Remove 'xxx'
    } else if (triggeredBySlash) {
      lineForSuggestions = lineBefore.slice(0, -2); // Remove '//'
    } else {
      lineForSuggestions = lineBefore.slice(0, -2); // Remove two spaces
    }
    keywordsToSuggest = getSmartSubkeywordSuggestions(lineForSuggestions);
  } else {
    // Triggered by ::: - show all keywords
    keywordsToSuggest = getAllKeywords();
  }

  // Remove duplicates by keyword name
  const uniqueKeywords = keywordsToSuggest.filter((k, index, self) =>
    index === self.findIndex(t => t.keyword.toLowerCase() === k.keyword.toLowerCase())
  );

  // Create completion options
  const options = uniqueKeywords.map(k => ({
    label: k.keyword,
    type: 'keyword',
    info: k.generateIcon || '',
    apply: (view: any, completion: any, from: number, to: number) => {
      if (triggeredByTripleColon) {
        // Replace ::: with keyword ::
        const replaceFrom = from - 3; // Go back 3 chars to remove :::
        view.dispatch({
          changes: { from: replaceFrom, to, insert: `${k.keyword} :: ` }
        });
      } else if (triggeredByXXX) {
        // Replace xxx with keyword + space
        const replaceFrom = from - 3; // Go back 3 chars to remove xxx
        view.dispatch({
          changes: { from: replaceFrom, to, insert: `${k.keyword} ` }
        });
      } else if (triggeredBySlash) {
        // Remove // and insert keyword like "Insert sub-keyword" command
        const replaceFrom = from - 2; // Go back 2 chars to remove //

        // Get the full line
        const line = view.state.doc.lineAt(from).text;
        const lineStart = view.state.doc.lineAt(from).from;

        // Find if :: exists in the line
        const doubleColonIndex = line.indexOf('::');

        if (doubleColonIndex !== -1) {
          // :: exists - insert keyword before it
          const doubleColonPos = lineStart + doubleColonIndex;

          // Find position before :: (skip trailing spaces)
          let insertPos = doubleColonPos - 1;
          while (insertPos >= lineStart && view.state.doc.sliceString(insertPos, insertPos + 1) === ' ') {
            insertPos--;
          }
          insertPos++; // Position after last non-space char

          // Check if we need space before keyword
          const charBefore = insertPos > lineStart ? view.state.doc.sliceString(insertPos - 1, insertPos) : '';
          const needsSpaceBefore = charBefore !== '' && charBefore !== ' ';
          const prefix = needsSpaceBefore ? ' ' : '';

          // Remove // and insert keyword before ::
          view.dispatch({
            changes: [
              { from: replaceFrom, to }, // Remove //
              { from: insertPos, to: insertPos, insert: `${prefix}${k.keyword} ` }
            ]
          });
        } else {
          // No :: - replace // with keyword and add ::
          view.dispatch({
            changes: { from: replaceFrom, to, insert: `${k.keyword} :: ` }
          });
        }
      } else if (triggeredByTwoSpaces) {
        // Replace two spaces with keyword + space
        const replaceFrom = from - 2; // Go back 2 chars to remove two spaces
        view.dispatch({
          changes: { from: replaceFrom, to, insert: `${k.keyword} ` }
        });
      }
    }
  }));

  return {
    from: context.pos,
    options,
    filter: false
  };
}

/**
 * Autocomplete extension that triggers on:
 * 1. ::: (three colons) - shows all keywords
 * 2. xxx - shows smart-prioritized subkeywords based on already-present keywords (removes xxx)
 * 3. // (two slashes) - shows smart-prioritized subkeywords based on already-present keywords (removes //)
 * 4. Two spaces after a recognized keyword (before ::) - shows smart-prioritized subkeywords
 *
 * Smart prioritization:
 * - Prioritizes subKeywords of already-present keywords that haven't been used yet
 * - Goes from last keyword to first, showing their unused subKeywords
 * - If keyword "a" has subKeywords ["b", "c"] and "b" has subKeywords ["g"],
 *   typing "a b xxx" will suggest [g, c] with g first (belongs to b which is present but unused)
 */
export const keywordAutocomplete = autocompletion({
  override: [keywordCompletions],
  activateOnTyping: true,
  maxRenderedOptions: 20,
  defaultKeymap: true
});
