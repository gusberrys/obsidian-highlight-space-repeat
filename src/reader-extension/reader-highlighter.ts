import type { MarkdownPostProcessor } from 'obsidian';
import { type KeywordStyle } from 'src/shared';
import { KeywordType, getKeywordType } from 'src/shared/keyword-style';
import { MainCombinePriority, AuxiliaryCombinePriority } from 'src/shared/combine-priority';
import { settingsStore } from 'src/stores/settings-store';
import { get } from 'svelte/store';

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

  // DEBUG: Check if helper keywords are loaded
  console.log('[Reader] Keyword map size:', keywordMap.size);
  console.log('[Reader] Has r14:', keywordMap.has('r14'));
  console.log('[Reader] Has h:', keywordMap.has('h'));
  if (keywordMap.has('r14')) {
    console.log('[Reader] r14 keyword:', keywordMap.get('r14'));
  }

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

      // Use first MAIN keyword as primary (for now - later we can validate only one MAIN)
      const primaryKeyword = mainKeywords[0] || auxiliaryKeywords[0];

      // Resolve icon based on priority
      const iconToDisplay = resolveIcon(primaryKeyword, mainKeywords, auxiliaryKeywords);

      // Create highlight node with resolved colors
      const highlight = getHighlightNode(
        parent as HTMLElement,
        textContent,
        primaryKeyword,
        mainKeywords,
        auxiliaryKeywords,
        matchedKeywords
      );

      parent.insertBefore(document.createTextNode("" + iconToDisplay + " "), node);
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
 * Resolve which icon to display based on keyword priorities
 */
function resolveIcon(
  primaryKeyword: KeywordStyle,
  mainKeywords: KeywordStyle[],
  auxiliaryKeywords: KeywordStyle[]
): string | undefined {
  // If no auxiliary keywords, use primary's icon
  if (auxiliaryKeywords.length === 0) {
    return primaryKeyword.generateIcon;
  }

  // Check if primary (first main) has icon priority
  const firstMain = mainKeywords[0];
  if (firstMain) {
    const hasIconPriority =
      firstMain.combinePriority === MainCombinePriority.Icon ||
      firstMain.combinePriority === MainCombinePriority.StyleAndIcon;

    if (hasIconPriority) {
      return firstMain.generateIcon;
    }
  }

  // Always append all auxiliary icons (show both icons when auxiliary on auxiliary)
  // Style is already determined by first auxiliary in getHighlightNode
  return auxiliaryKeywords.map(aux => aux.generateIcon).filter(icon => icon).join('');
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
  let finalColor = primaryKeyword.color;
  let finalBackgroundColor = primaryKeyword.backgroundColor;

  const firstMain = mainKeywords[0];
  if (firstMain && auxiliaryKeywords.length > 0) {
    const hasStylePriority =
      firstMain.combinePriority === MainCombinePriority.Style ||
      firstMain.combinePriority === MainCombinePriority.StyleAndIcon;

    if (hasStylePriority) {
      // Use main's colors
      finalColor = firstMain.color;
      finalBackgroundColor = firstMain.backgroundColor;
    } else if (auxiliaryKeywords.length > 0) {
      // Use first auxiliary's colors
      const firstAux = auxiliaryKeywords[0];
      if (firstAux.color) finalColor = firstAux.color;
      if (firstAux.backgroundColor) finalBackgroundColor = firstAux.backgroundColor;
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
  console.log('[ImageLayout] restructureImagesLayout called, el:', el);

  // Find all highlighted paragraphs
  const highlightedElements = el.querySelectorAll('.kh-highlighted');
  console.log('[ImageLayout] Found highlighted elements:', highlightedElements.length);

  highlightedElements.forEach((highlightedEl) => {
    const paragraph = highlightedEl as HTMLElement;
    console.log('[ImageLayout] Processing paragraph:', paragraph.className);

    // Check if this paragraph contains any images
    const images = Array.from(paragraph.querySelectorAll('img'));
    console.log('[ImageLayout] Found images:', images.length);

    if (images.length === 0) {
      console.log('[ImageLayout] No images, skipping');
      return; // No images, skip restructuring
    }

    // Check if already restructured to avoid double-processing
    if (paragraph.classList.contains('kh-record-with-images')) {
      console.log('[ImageLayout] Already restructured, skipping');
      return;
    }

    console.log('[ImageLayout] Creating two-column layout');

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
    console.log('[ImageLayout] Processing child nodes:', childNodes.length);

    childNodes.forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === 'IMG') {
        console.log('[ImageLayout] Found direct IMG element');
        // This is an image, move to image column
        imageColumn.appendChild(child);
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).classList.contains('internal-embed')) {
        console.log('[ImageLayout] Found internal-embed element');
        // This is an image embed wrapper, check if it contains an image
        const embeddedImg = (child as HTMLElement).querySelector('img');
        if (embeddedImg) {
          console.log('[ImageLayout] internal-embed contains image, moving to image column');
          // Move to image column
          imageColumn.appendChild(child);
        } else {
          console.log('[ImageLayout] internal-embed does not contain image, moving to text column');
          // Not an image embed, move to text column
          textColumn.appendChild(child);
        }
      } else {
        // Regular text node or other element, move to text column
        textColumn.appendChild(child);
      }
    });

    console.log('[ImageLayout] Text column children:', textColumn.childNodes.length);
    console.log('[ImageLayout] Image column children:', imageColumn.childNodes.length);

    // Only restructure if we actually have content in both columns
    if (textColumn.childNodes.length > 0 && imageColumn.childNodes.length > 0) {
      console.log('[ImageLayout] Applying restructure');

      // Clear the paragraph
      paragraph.innerHTML = '';

      // Add both columns to wrapper
      wrapper.appendChild(textColumn);
      wrapper.appendChild(imageColumn);

      // Add wrapper to paragraph
      paragraph.appendChild(wrapper);

      // Mark as restructured
      paragraph.classList.add('kh-record-with-images');

      console.log('[ImageLayout] Restructure complete');
    } else {
      console.log('[ImageLayout] Not enough content in both columns, skipping restructure');
    }
  });

  console.log('[ImageLayout] restructureImagesLayout complete');
}
