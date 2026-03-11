import type { MarkdownPostProcessor } from 'obsidian';
import { type KeywordStyle } from 'src/shared';
import { KeywordType, getKeywordType } from 'src/shared/keyword-style';
import { MainCombinePriority } from 'src/shared/combine-priority';
import { settingsStore } from 'src/stores/settings-store';
import { get } from 'svelte/store';
import { resolveIcon } from 'src/shared/priority-resolver';

let keywordMap: Map<string, KeywordStyle>;

export const readerHighlighter: MarkdownPostProcessor = (el: HTMLElement) => {

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

  // DEBUG: Check if helper keywords are loaded (removed excessive logging)

  replaceWithHighlight(el);

  // Delay image layout processing to allow Obsidian to process internal embeds first
  // Use requestAnimationFrame to wait for the next render cycle
  requestAnimationFrame(() => {
    restructureImagesLayout(el);
  });
};

/**
 * Extract and match keywords using string-based approach
 * New syntax: "foo bar baz :: text content" or "# foo bar :: header"
 */
function extractAndMatch(textValue: string): [KeywordStyle[], string] | undefined {
  // 1. Find :: separator (fastest)
  const colonIndex = textValue.indexOf('::');
  if (colonIndex === -1) return undefined;

  // 2. Split before/after
  let beforeColon = textValue.substring(0, colonIndex).trim();
  const afterColon = textValue.substring(colonIndex + 2).trim();

  // 3. Check for header markers (# ## ###)
  if (beforeColon.startsWith('#')) {
    const firstSpace = beforeColon.indexOf(' ');
    if (firstSpace === -1) return undefined; // Just "#::" with no keywords
    beforeColon = beforeColon.substring(firstSpace + 1).trim();
  }

  // 4. Split keywords by whitespace
  const keywordNames = beforeColon.split(/\s+/).filter(k => k.length > 0);
  if (keywordNames.length === 0) return undefined;

  // 5. Look up each keyword in the map
  const matchedKeywords: KeywordStyle[] = [];
  for (const name of keywordNames) {
    const kwData = keywordMap.get(name.toLowerCase());
    if (kwData) {
      matchedKeywords.push(kwData);
    }
  }

  // Must have at least one matched keyword
  if (matchedKeywords.length === 0) return undefined;

  return [matchedKeywords, afterColon];
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

    const result = extractAndMatch(node.nodeValue);

    if (result) {
      const parent = node.parentNode!;
      const [matchedKeywords, textContent] = result;

      // Separate MAIN vs AUXILIARY keywords based on their keywordType
      const mainKeywords = matchedKeywords.filter(k => getKeywordType(k) === KeywordType.MAIN);
      const auxiliaryKeywords = matchedKeywords.filter(k => getKeywordType(k) === KeywordType.AUXILIARY);

      // Use first MAIN keyword as primary, fallback to first auxiliary, ultimate fallback to first matched
      const primaryKeyword = mainKeywords[0] || auxiliaryKeywords[0] || matchedKeywords[0];

      // Resolve icon based on priority (centralized)
      const iconToDisplay = resolveIcon(matchedKeywords);

      // Create highlight node with resolved colors
      const highlight = getHighlightNode(
        parent as HTMLElement,
        textContent,
        primaryKeyword,
        mainKeywords,
        auxiliaryKeywords,
        matchedKeywords
      );

      // Only insert icon if it exists
      if (iconToDisplay) {
        parent.insertBefore(document.createTextNode(iconToDisplay + " "), node);
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
 */
function getHighlightNode(
  parent: HTMLElement,
  textContent: string,
  primaryKeyword: KeywordStyle,
  mainKeywords: KeywordStyle[],
  auxiliaryKeywords: KeywordStyle[],
  matchedKeywords: KeywordStyle[]
): Node {
  const highlight = parent.createSpan();

  // Resolve colors based on priority
  // Standard priority rules:
  // 1. Different priorities → highest priority wins
  // 2. Same priority → FIRST one wins (most generic)
  // 3. No Style/StyleAndIcon priority → first keyword wins

  // Safety check: if primaryKeyword is undefined, use first matched keyword
  const fallbackKeyword = primaryKeyword || matchedKeywords[0];
  if (!fallbackKeyword) {
    // No keywords at all - shouldn't happen, but return empty node
    const emptyNode = parent.createSpan();
    emptyNode.setText(textContent);
    return emptyNode;
  }

  const keywordsWithStylePriority = matchedKeywords.filter(kw =>
    kw.combinePriority === MainCombinePriority.Style ||
    kw.combinePriority === MainCombinePriority.StyleAndIcon
  );

  // Start with fallback keyword colors (with defaults if undefined)
  let finalColor = fallbackKeyword.color || '#000000';
  let finalBackgroundColor = fallbackKeyword.backgroundColor || '#ffffff';

  if (keywordsWithStylePriority.length > 0) {
    // Map priority enum values to numbers for comparison
    const getPriorityValue = (priority: MainCombinePriority) => {
      if (priority === MainCombinePriority.StyleAndIcon) return 3;
      if (priority === MainCombinePriority.Style) return 2;
      return 0;
    };

    // Find the highest priority value
    const maxPriority = Math.max(...keywordsWithStylePriority.map(kw => getPriorityValue(kw.combinePriority)));

    // Filter to only those with the highest priority
    const highestPriorityKeywords = keywordsWithStylePriority.filter(kw =>
      getPriorityValue(kw.combinePriority) === maxPriority
    );

    // Take FIRST with highest priority (most generic)
    if (highestPriorityKeywords.length > 0) {
      const winner = highestPriorityKeywords[0];
      if (winner.color) finalColor = winner.color;
      if (winner.backgroundColor) finalBackgroundColor = winner.backgroundColor;
    }
  }

  // Apply final colors to parent paragraph
  parent.style.setProperty("--kh-c", finalColor);
  parent.style.setProperty("color", finalColor, "important");
  parent.style.setProperty("--kh-bgc", finalBackgroundColor);
  parent.style.setProperty("background-color", finalBackgroundColor, "important");

  // Apply kh-highlighted class
  parent.classList.add('kh-highlighted');

  // Apply ALL matched keywords' classes (MAIN, AUXILIARY, and HELP)
  for (const kw of matchedKeywords) {
    const cssClass = kw.ccssc && kw.ccssc.trim() !== "" ? kw.ccssc.trim() : kw.keyword;
    parent.classList.add(cssClass);
  }

  // Add data-keywords attribute with all matched keywords (for record badges)
  const allKeywords = [...mainKeywords, ...auxiliaryKeywords].map(k => k.keyword);
  parent.setAttribute('data-keywords', allKeywords.join(' '));

  highlight.setText(textContent);
  return highlight;
}

/**
 * Restructure paragraphs with images into two-column layout
 * Detects highlighted paragraphs that contain images and reorganizes them
 */
function restructureImagesLayout(el: HTMLElement) {
  // Find all highlighted paragraphs
  const highlightedElements = el.querySelectorAll('.kh-highlighted');

  highlightedElements.forEach((highlightedEl) => {
    const paragraph = highlightedEl as HTMLElement;

    // Check if this paragraph contains any images
    const images = Array.from(paragraph.querySelectorAll('img'));

    if (images.length === 0) {
      return; // No images, skip restructuring
    }

    // Check if already restructured to avoid double-processing
    if (paragraph.classList.contains('kh-record-with-images')) {
      return;
    }

    // Create two-column wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'kh-record-with-images';

    // Create text column (left)
    const textColumn = document.createElement('div');
    textColumn.className = 'kh-record-text-column';

    // Create image column (right)
    const imageColumn = document.createElement('div');
    imageColumn.className = 'kh-record-image-column';

    // Move all child nodes to text column, except images
    const childNodes = Array.from(paragraph.childNodes);

    childNodes.forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === 'IMG') {
        // This is an image, move to image column
        imageColumn.appendChild(child);
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).classList.contains('internal-embed')) {
        // This is an image embed wrapper, check if it contains an image
        const embeddedImg = (child as HTMLElement).querySelector('img');
        if (embeddedImg) {
          // Move to image column
          imageColumn.appendChild(child);
        } else {
          // Not an image embed, move to text column
          textColumn.appendChild(child);
        }
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
