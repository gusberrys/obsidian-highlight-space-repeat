import type { MarkdownPostProcessor } from 'obsidian';
import { type KeywordStyle } from 'src/shared';
import { settingsStore, vwordSettingsStore } from 'src/stores/settings-store';
import { get } from 'svelte/store';
import { isVWordKeyword, parseVWordKeyword } from 'src/shared/vword';
import { CollectingStatus } from 'src/shared/collecting-status';

let keywordMap: Map<string, KeywordStyle>;

export const readerHighlighter: MarkdownPostProcessor = (el: HTMLElement) => {

  const settings = get(settingsStore);
  const layoutRetryDelay = settings.layoutRetryDelayMs ?? 100;

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

  // DEBUG: Check if helper keywords are loaded (removed excessive logging)

  replaceWithHighlight(el);

  // Delay image layout processing to allow Obsidian to process internal embeds first
  // Use requestAnimationFrame to wait for the next render cycle
  requestAnimationFrame(() => {
    restructureImagesLayout(el);
    restructureListsLayout(el);

    // Lists might render slower, retry after a configurable delay
    setTimeout(() => {
      restructureListsLayout(el);
    }, layoutRetryDelay);
  });
};

/**
 * Extract and match keywords using string-based approach
 * New syntax: "foo bar baz :: text content" or "# foo bar :: header"
 * Returns: [matched keywords, VWord keywords, text content] or undefined
 */
function extractAndMatch(textValue: string): [KeywordStyle[], string[], string] | undefined {
  // 1. Find :: separator - must have space before OR after (to avoid matching :::)
  // Match patterns:
  // - " :: " (normal: keyword :: text)
  // - ":: " (header with text: # keyword :: text)
  // - " ::" at end (normal: keyword ::)
  // - "::" at end (header: # keyword ::)

  let colonIndex = -1;
  let skipLength = 2;

  // Try " :: " first (most common)
  colonIndex = textValue.indexOf(' :: ');
  if (colonIndex !== -1) {
    skipLength = 4;
  } else {
    // Try ":: " (header with text after)
    colonIndex = textValue.indexOf(':: ');
    if (colonIndex !== -1) {
      // Make sure not part of :::
      if (colonIndex > 0 && textValue[colonIndex - 1] === ':') return undefined;
      skipLength = 3;
    } else {
      // Try " ::" at end or "::" at end (headers with no text)
      const endMatch = textValue.match(/\s::$|::$/);
      if (endMatch) {
        colonIndex = textValue.lastIndexOf('::');
        skipLength = 2;
        // Make sure not part of :::
        if (colonIndex > 0 && textValue[colonIndex - 1] === ':') return undefined;
      } else {
        return undefined;
      }
    }
  }

  // 2. Split before/after
  let beforeColon = textValue.substring(0, colonIndex).trim();
  const afterColon = textValue.substring(colonIndex + skipLength).trim();

  // 3. Check for header markers (# ## ###)
  if (beforeColon.startsWith('#')) {
    const firstSpace = beforeColon.indexOf(' ');
    if (firstSpace === -1) return undefined; // Just "#::" with no keywords
    beforeColon = beforeColon.substring(firstSpace + 1).trim();
  }

  // 4. Split keywords by whitespace
  const keywordNames = beforeColon.split(/\s+/).filter(k => k.length > 0);
  if (keywordNames.length === 0) return undefined;

  // 5. Look up each keyword in the map (regular keywords only)
  // VWords are handled separately - they don't affect colors, only layout
  const matchedKeywords: KeywordStyle[] = [];
  const vwordKeywords: string[] = [];

  for (const name of keywordNames) {
    // First, check if it's a regular keyword
    const kwData = keywordMap.get(name.toLowerCase());
    if (kwData) {
      matchedKeywords.push(kwData);
      continue;
    }

    // Then, check if it's a VWord keyword (for layout only)
    if (isVWordKeyword(name)) {
      vwordKeywords.push(name);
    }
  }

  // Allow VWords alone to trigger highlighting (no color, just layout classes)
  if (matchedKeywords.length === 0 && vwordKeywords.length === 0) return undefined;

  return [matchedKeywords, vwordKeywords, afterColon];
}

function replaceWithHighlight(node: Node) {
  // Skip code blocks entirely - don't interfere with execute-code plugin's RUN button
  if (
    node.nodeType === Node.ELEMENT_NODE &&
    (<Element>node).tagName === 'PRE'
  ) {
    return;
  }

  if (
    // skip highlighting nodes
    node.nodeType === Node.ELEMENT_NODE &&
    (<Element>node).classList.contains("kh-highlighted")
  ) {
    return;
  } else if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
    // Skip text nodes that are already inside a kh-highlighted element
    let parent = node.parentElement;
    while (parent) {
      if (parent.classList.contains('kh-highlighted')) {
        return; // Already processed, don't process again
      }
      parent = parent.parentElement;
    }

    const result = extractAndMatch(node.nodeValue);

    if (result) {
      const parent = node.parentNode!;
      const [matchedKeywords, vwordKeywords, textContent] = result;

      // Create highlight node (returns iconWinners and highlight span)
      const { iconWinners, highlight } = getHighlightNode(
        parent as HTMLElement,
        textContent,
        matchedKeywords,
        vwordKeywords
      );

      // Insert ALL icons from keywords with highest icon priority (separated by /)
      const iconsToDisplay = iconWinners
        .filter(kw => kw.generateIcon)
        .map(kw => kw.generateIcon);

      if (iconsToDisplay.length > 0) {
        const iconText = iconsToDisplay.join('/') + ' ';
        parent.insertBefore(document.createTextNode(iconText), node);
      }
      parent.insertBefore(highlight, node);
      node.nodeValue = ""; // original node fully replaced

      parent.childNodes.forEach((child) =>
        replaceWithHighlight(child)
      );
    }

    // end
    return;
  }
  // call recursively
  node.childNodes.forEach((child) => replaceWithHighlight(child));
}

/**
 * Create highlight span with resolved colors and classes
 * Returns iconWinners (all tied for highest priority) and highlight node
 */
function getHighlightNode(
  parent: HTMLElement,
  textContent: string,
  matchedKeywords: KeywordStyle[],
  vwordKeywords: string[]
): { iconWinners: KeywordStyle[]; highlight: Node } {
  const highlight = parent.createSpan();

  // Apply kh-highlighted class (even for VWords-only)
  parent.classList.add('kh-highlighted');

  let colorWinner: KeywordStyle | undefined;
  let iconWinners: KeywordStyle[] = [];

  // Only resolve colors and icons if we have regular keywords
  if (matchedKeywords.length > 0) {
    // Resolve style winner (color)
    // Only keywords with stylePriority !== 'append' compete for colors
    const colorCompetitors = matchedKeywords.filter(kw =>
      kw.stylePriority !== 'append'
    );

    colorWinner = colorCompetitors[0] || matchedKeywords[0];

    // If any keyword has stylePriority === 'priority', first one wins
    const prioritized = colorCompetitors.filter(kw => kw.stylePriority === 'priority');
    if (prioritized.length > 0) {
      colorWinner = prioritized[0];
    }

    // Resolve icon winners (ALL keywords with highest priority)
    // Highest iconPriority wins, ties = show ALL icons
    const maxIconPriority = Math.max(...matchedKeywords.map(kw => kw.iconPriority || 1));
    iconWinners = matchedKeywords.filter(kw => (kw.iconPriority || 1) === maxIconPriority);

    // Apply ONLY the color winner's class for styling
    parent.classList.add(colorWinner.keyword);

    // Apply append keywords as classes (they won't provide colors)
    const appendKeywords = matchedKeywords.filter(kw => kw.stylePriority === 'append');
    appendKeywords.forEach(kw => parent.classList.add(kw.keyword));

    // Add data-keywords attribute with all matched keywords (for record badges)
    const allKeywords = matchedKeywords.map(k => k.keyword);
    parent.setAttribute('data-keywords', allKeywords.join(' '));
  }

  // Apply VWord keywords as classes (for layout control only, not styling)
  for (const vword of vwordKeywords) {
    parent.classList.add(vword);
  }

  highlight.setText(textContent);
  return { iconWinners, highlight };
}

/**
 * Restructure paragraphs with images into two-column layout
 * ONLY applies when an i-keyword (i10-i90) is present
 * Breaking change: No longer auto-restructures all images
 */
function restructureImagesLayout(el: HTMLElement) {
  // Find all highlighted paragraphs
  const highlightedElements = el.querySelectorAll('.kh-highlighted');

  highlightedElements.forEach((highlightedEl) => {
    const paragraph = highlightedEl as HTMLElement;

    // Check if this paragraph has an i-keyword (i10-i90)
    // i-keywords control image column width
    const iKeywordClass = Array.from(paragraph.classList).find(className => {
      return className.match(/^i\d{2}$/); // Matches i10, i15, i20, ..., i90
    });

    // ONLY restructure if i-keyword is present
    if (!iKeywordClass) {
      return; // No i-keyword, skip restructuring
    }

    // Check if this paragraph contains any images
    const images = Array.from(paragraph.querySelectorAll('img'));

    if (images.length === 0) {
      return; // No images, skip restructuring
    }

    // Check if already restructured to avoid double-processing
    if (paragraph.classList.contains('kh-record-with-images')) {
      return;
    }

    // Create two-column wrapper with i-keyword class for CSS targeting
    const wrapper = document.createElement('div');
    wrapper.className = `kh-record-with-images ${iKeywordClass}`;

    // Create text column (left)
    const textColumn = document.createElement('div');
    textColumn.className = 'kh-record-text-column';

    // Create image column (right)
    const imageColumn = document.createElement('div');
    imageColumn.className = 'kh-record-image-column';

    // Helper to check if an image is on its own line (standalone)
    const isStandaloneImage = (node: Node, index: number, allNodes: Node[]): boolean => {
      // Check previous sibling - should be <br>, whitespace, or nothing
      let prevNonWhitespace = null;
      for (let i = index - 1; i >= 0; i--) {
        const prevNode = allNodes[i];
        if (prevNode.nodeType === Node.TEXT_NODE && prevNode.textContent?.trim() === '') {
          continue; // Skip whitespace
        }
        if (prevNode.nodeType === Node.ELEMENT_NODE && (prevNode as HTMLElement).tagName === 'BR') {
          break; // Found <br>, image is on its own line
        }
        prevNonWhitespace = prevNode;
        break;
      }

      // Check next sibling - should be <br>, whitespace, or nothing
      let nextNonWhitespace = null;
      for (let i = index + 1; i < allNodes.length; i++) {
        const nextNode = allNodes[i];
        if (nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent?.trim() === '') {
          continue; // Skip whitespace
        }
        if (nextNode.nodeType === Node.ELEMENT_NODE && (nextNode as HTMLElement).tagName === 'BR') {
          break; // Found <br>, image is on its own line
        }
        nextNonWhitespace = nextNode;
        break;
      }

      // Image is standalone if:
      // - At start of paragraph (no prev non-whitespace) OR preceded by <br>
      // - AND at end of paragraph (no next non-whitespace) OR followed by <br>
      return (prevNonWhitespace === null || (prevNonWhitespace.nodeType === Node.ELEMENT_NODE && (prevNonWhitespace as HTMLElement).tagName === 'BR'))
        && (nextNonWhitespace === null || (nextNonWhitespace.nodeType === Node.ELEMENT_NODE && (nextNonWhitespace as HTMLElement).tagName === 'BR'));
    };

    // Move all child nodes to text column, except inline images
    const childNodes = Array.from(paragraph.childNodes);

    childNodes.forEach((child, index) => {
      if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === 'IMG') {
        // Check if this is an Excalidraw image (keep in text column)
        const img = child as HTMLElement;
        if (img.classList.contains('excalidraw-svg') || img.classList.contains('excalidraw-embedded-img')) {
          textColumn.appendChild(child);
        } else {
          // Check if standalone - keep in text column, otherwise move to image column
          if (isStandaloneImage(child, index, childNodes)) {
            textColumn.appendChild(child);
          } else {
            imageColumn.appendChild(child);
          }
        }
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).classList.contains('internal-embed')) {
        // This is an image embed wrapper, check if it contains an image
        const embeddedImg = (child as HTMLElement).querySelector('img');
        if (embeddedImg) {
          // Check if it's Excalidraw (keep in text column)
          if (embeddedImg.classList.contains('excalidraw-svg') || embeddedImg.classList.contains('excalidraw-embedded-img')) {
            textColumn.appendChild(child);
          } else {
            // Check if standalone - keep in text column, otherwise move to image column
            if (isStandaloneImage(child, index, childNodes)) {
              textColumn.appendChild(child);
            } else {
              imageColumn.appendChild(child);
            }
          }
        } else {
          // Not an image embed, move to text column
          textColumn.appendChild(child);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).classList.contains('excalidraw-svg')) {
        // Excalidraw wrapper div, keep in text column
        textColumn.appendChild(child);
      } else {
        // Regular text node or other element, move to text column
        textColumn.appendChild(child);
      }
    });

    // Only restructure if we actually have content in both columns
    if (textColumn.childNodes.length > 0 && imageColumn.childNodes.length > 0) {
      // Clear the paragraph
      paragraph.innerHTML = '';

      // Add both columns to wrapper
      wrapper.appendChild(textColumn);
      wrapper.appendChild(imageColumn);

      // Add wrapper to paragraph
      paragraph.appendChild(wrapper);

      // Mark as restructured
      paragraph.classList.add('kh-record-with-images');
    }
  });
}

/**
 * Restructure lists with l-keywords into two-column layout
 * ONLY applies when an l-keyword (l10-l90) is present
 * Left column: all items except last
 * Right column: last item
 */
function restructureListsLayout(el: HTMLElement) {
  // Find all highlighted paragraphs
  const highlightedElements = el.querySelectorAll('.kh-highlighted');

  highlightedElements.forEach((highlightedEl) => {
    const paragraph = highlightedEl as HTMLElement;

    // Check if this paragraph has an l-keyword (l10-l90)
    const lKeywordClass = Array.from(paragraph.classList).find(className => {
      return className.match(/^l\d{2}$/); // Matches l10, l15, l20, ..., l90
    });

    // ONLY restructure if l-keyword is present
    if (!lKeywordClass) {
      return; // No l-keyword, skip restructuring
    }

    console.log('[l-keyword] Found paragraph with', lKeywordClass, paragraph);

    // Find the parent paragraph element (.el-p)
    const elP = paragraph.closest('.el-p');
    if (!elP) {
      console.log('[l-keyword] No .el-p parent found');
      return;
    }

    console.log('[l-keyword] Found .el-p parent', elP);

    // Find the next sibling that is a list wrapper (.el-ul or .el-ol)
    let listWrapper = elP.nextElementSibling;
    while (listWrapper && !listWrapper.classList.contains('el-ul') && !listWrapper.classList.contains('el-ol')) {
      listWrapper = listWrapper.nextElementSibling;
    }

    if (!listWrapper) {
      console.log('[l-keyword] No .el-ul or .el-ol sibling found');
      return; // No list found
    }

    console.log('[l-keyword] Found list wrapper', listWrapper);

    // Get the inner ul or ol element
    const list = listWrapper.querySelector('ul, ol') as HTMLUListElement | HTMLOListElement;
    if (!list) {
      console.log('[l-keyword] No inner ul/ol found inside list wrapper');
      return;
    }

    console.log('[l-keyword] Found inner list', list);

    // Check if already restructured to avoid double-processing
    if (listWrapper.classList.contains('kh-l-layout')) {
      console.log('[l-keyword] Already restructured, skipping');
      return;
    }

    // Get all list items
    const listItems = Array.from(list.children) as HTMLLIElement[];
    if (listItems.length < 2) {
      console.log('[l-keyword] Not enough items, need at least 2, found', listItems.length);
      return; // Need at least 2 items
    }

    console.log('[l-keyword] Restructuring', listItems.length, 'items');

    // Create wrapper with l-keyword class for CSS targeting
    const wrapper = document.createElement('div');
    wrapper.className = `kh-l-layout ${lKeywordClass}`;

    // Create left column
    const leftColumn = document.createElement('div');
    leftColumn.className = 'kh-l-left-column';

    // Create right column
    const rightColumn = document.createElement('div');
    rightColumn.className = 'kh-l-right-column';

    // Create new ul/ol for left column (all items except last)
    const leftList = list.cloneNode(false) as HTMLUListElement | HTMLOListElement;
    leftList.innerHTML = ''; // Clear any attributes/content

    // Create new ul/ol for right column (last item only)
    const rightList = list.cloneNode(false) as HTMLUListElement | HTMLOListElement;
    rightList.innerHTML = ''; // Clear any attributes/content

    // Move all items except last to left list
    for (let i = 0; i < listItems.length - 1; i++) {
      leftList.appendChild(listItems[i]);
    }

    // Move last item to right list
    rightList.appendChild(listItems[listItems.length - 1]);

    // Assemble structure
    leftColumn.appendChild(leftList);
    rightColumn.appendChild(rightList);
    wrapper.appendChild(leftColumn);
    wrapper.appendChild(rightColumn);

    // Replace original list with wrapper
    list.parentNode?.replaceChild(wrapper, list);

    // Mark as restructured
    listWrapper.classList.add('kh-l-layout');

    console.log('[l-keyword] ✓ Restructuring complete');
  });
}
