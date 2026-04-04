import { App, MarkdownView } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
import type { KeywordStyle, Category, Settings, VWordSettings } from 'src/shared';
import { DEFAULT_VWORD_SETTINGS } from 'src/shared';
import { CollectingStatus } from 'src/shared/collecting-status';
import { injectKeywordCSS, injectVWordCSS, injectAllCSS, injectCodeStylerOverrideCSS } from 'src/shared/dynamic-css';
import { get, writable } from 'svelte/store';
import type { ParserSettings } from 'src/interfaces/ParserSettings';
import { DEFAULT_PARSER_SETTINGS } from 'src/interfaces/ParserSettings';
import type { ColorEntry } from 'src/settings/ColorSettings';
import { DEFAULT_COLOR_ENTRIES } from 'src/settings/ColorSettings';

/**
 * Generate random pastel background and contrasting text color
 */
function generateRandomColors(): { backgroundColor: string; textColor: string } {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 60 + Math.floor(Math.random() * 10);
  const lightness = 75 + Math.floor(Math.random() * 10);

  const backgroundColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  const textColor = lightness > 60 ? '#000000' : '#ffffff';

  return { backgroundColor, textColor };
}

/**
 * Keywords data - stored in app-data/keywords.json
 */
export interface KeywordsData {
  categories: Category[];
}

/**
 * Color highlights data - stored in app-data/color-highlights.json
 */
export interface ColorHighlightsData {
  colorEntries: ColorEntry[];
}

/**
 * Plugin settings - stored in data.json (Obsidian standard)
 */
export interface PluginSettings extends Settings {
  parserSettings: ParserSettings;
  colorHighlightingEnabled: boolean;
  vword: VWordSettings;
}

/**
 * Merged settings view (for backward compatibility with static API)
 * Combines keywords, color highlights, and settings
 */
export interface MergedSettings {
  categories: Category[];
  parserSettings: ParserSettings;
  colorHighlightingEnabled: boolean;
  colorEntries: ColorEntry[];
}

export type { Settings };

const DEFAULT_KEYWORDS: KeywordsData = {
  categories: [
    {
      icon: 'Logic',
      id: 'logic-category',
      keywords: [
        {
          keyword: 'eqa',
          color: '#ffffff',
          backgroundColor: '#2f0995',
          description: 'Equal to, equivalence',
          generateIcon: '🟰',
        },
        {
          keyword: 'tru',
          color: '#ffffff',
          backgroundColor: '#590ca7',
          description: 'True statement or fact',
          generateIcon: '📜',
        },
      ],
    },
    {
      icon: 'Evaluation',
      id: 'evaluation-category',
      keywords: [
        {
          keyword: 'pos',
          color: '#ffffff',
          backgroundColor: '#0c730e',
          description: 'Positive aspect or benefit',
          generateIcon: '(+)',
        },
        {
          keyword: 'neg',
          color: '#ffffff',
          backgroundColor: '#841042',
          description: 'Negative aspect or drawback',
          generateIcon: '(-)',
        },
      ],
    },
  ],
};

const DEFAULT_COLOR_HIGHLIGHTS: ColorHighlightsData = {
  colorEntries: DEFAULT_COLOR_ENTRIES
};

const DEFAULT_SETTINGS: PluginSettings = {
  keywordDescriptionsPath: '',
  layoutRetryDelayMs: 100,
  parserSettings: DEFAULT_PARSER_SETTINGS,
  colorHighlightingEnabled: false,
  vword: DEFAULT_VWORD_SETTINGS
};

export const keywordsStore = writable<KeywordsData>(DEFAULT_KEYWORDS);
export const colorHighlightsStore = writable<ColorHighlightsData>(DEFAULT_COLOR_HIGHLIGHTS);
export const settingsStore = writable<PluginSettings>(DEFAULT_SETTINGS);

// Legacy exports for backward compatibility (will be removed later)
export const settingsDataStore = settingsStore;
export const vwordSettingsStore = writable<VWordSettings>(DEFAULT_VWORD_SETTINGS);

let plugin: HighlightSpaceRepeatPlugin | null = null;
let appInstance: App | null = null;


/**
 * Generate 4 keywords (gv, gr, lv, lr) for each color entry
 * These keywords are auto-generated and only show when color mode is ON
 */
function generateColorKeywords(colorEntries: ColorEntry[]): KeywordStyle[] {
  const keywords: KeywordStyle[] = [];

  if (!colorEntries || !Array.isArray(colorEntries)) {
    return keywords;
  }

  colorEntries.forEach(color => {
    // Global Value (e.g., gvr for red)
    // NOTE: No generateIcon - icons added via CSS ::before instead
    keywords.push({
      keyword: `gv${color.cc}`,
      color: color.textColor,
      backgroundColor: color.backgroundColor,
      description: `global ${color.name} value ${color.gvIcon}`,
      collectingStatus: CollectingStatus.PARSED,
      isColorKeyword: true,
      sourceColorCC: color.cc,
      colorIcon: color.gvIcon,  // Store icon for CSS generation
      iconPriority: 1,
      stylePriority: 'normal'
    });

    // Global Reference (e.g., grr for red)
    keywords.push({
      keyword: `gr${color.cc}`,
      color: color.textColor,
      backgroundColor: color.backgroundColor,
      description: `global ${color.name} reference ${color.grIcon}`,
      collectingStatus: CollectingStatus.PARSED,
      isColorKeyword: true,
      sourceColorCC: color.cc,
      colorIcon: color.grIcon,  // Store icon for CSS generation
      iconPriority: 1,
      stylePriority: 'normal'
    });

    // Local Value (e.g., lvr for red)
    keywords.push({
      keyword: `lv${color.cc}`,
      color: color.textColor,
      backgroundColor: color.backgroundColor,
      description: `local ${color.name} value ${color.lvIcon}`,
      collectingStatus: CollectingStatus.PARSED,
      isColorKeyword: true,
      sourceColorCC: color.cc,
      colorIcon: color.lvIcon,  // Store icon for CSS generation
      iconPriority: 1,
      stylePriority: 'normal'
    });

    // Local Reference (e.g., lrr for red)
    keywords.push({
      keyword: `lr${color.cc}`,
      color: color.textColor,
      backgroundColor: color.backgroundColor,
      description: `local ${color.name} reference ${color.lrIcon}`,
      collectingStatus: CollectingStatus.PARSED,
      isColorKeyword: true,
      sourceColorCC: color.cc,
      colorIcon: color.lrIcon,  // Store icon for CSS generation
      iconPriority: 1,
      stylePriority: 'normal'
    });
  });

  return keywords;
}

export async function initStore(pluginInstance: HighlightSpaceRepeatPlugin): Promise<void> {
  plugin = pluginInstance;
  appInstance = plugin.app;

  // Load all data files
  await loadStore();
}

export async function loadStore(): Promise<void> {
  if (!plugin) return;

  // Load keywords
  const keywordsData = await plugin.loadKeywords();
  const keywords = Object.assign({}, DEFAULT_KEYWORDS, keywordsData);

  // Load color highlights
  const colorHighlightsData = await plugin.loadColorHighlights();
  const colorHighlights = Object.assign({}, DEFAULT_COLOR_HIGHLIGHTS, colorHighlightsData);

  // Load settings (using Obsidian's built-in loadData for data.json)
  const settingsData = await plugin.loadData();
  const settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);

  // AUTO-GENERATE COLOR KEYWORDS: Find or create "Colors" category and inject generated keywords
  let colorsCategory = keywords.categories.find((cat: Category) => cat.id === 'colors-category');
  if (!colorsCategory) {
    colorsCategory = { icon: 'Colors', id: 'colors-category', keywords: [] };
    keywords.categories.push(colorsCategory);
  }

  // Replace color keywords with fresh ones generated from colorEntries
  const colorKeywords = generateColorKeywords(colorHighlights.colorEntries);
  colorsCategory.keywords = colorKeywords;

  // Set default collectingStatus and priorities for keywords that don't have them set
  keywords.categories.forEach((category: Category) => {
    category.keywords.forEach((keyword: KeywordStyle) => {
      // Set defaults if not defined
      if (keyword.collectingStatus === undefined) {
        keyword.collectingStatus = CollectingStatus.PARSED;
      }

      // Set default priorities
      if (keyword.iconPriority === undefined) {
        keyword.iconPriority = 1;
      }
      if (keyword.stylePriority === undefined) {
        keyword.stylePriority = 'normal';
      }
    });
  });

  // Update stores
  keywordsStore.set(keywords);
  colorHighlightsStore.set(colorHighlights);
  settingsStore.set(settings);
  vwordSettingsStore.set(settings.vword);

  // CRITICAL: Also set the static property used by the public API (merged view for compatibility)
  if (plugin) {
    const mergedSettings: MergedSettings = {
      categories: keywords.categories,
      parserSettings: settings.parserSettings,
      colorHighlightingEnabled: settings.colorHighlightingEnabled,
      colorEntries: colorHighlights.colorEntries
    };
    (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings = mergedSettings as any;
  }

  // Inject CSS
  injectAllCSS(keywords.categories, settings.vword);
}

export async function saveStore(): Promise<void> {
  if (!plugin) return;

  const keywords = get(keywordsStore);
  const colorHighlights = get(colorHighlightsStore);
  const settings = get(settingsStore);

  // REGENERATE COLOR KEYWORDS: Update Colors category with fresh keywords from colorEntries
  let colorsCategory = keywords.categories.find(cat => cat.id === 'colors-category');
  if (!colorsCategory) {
    colorsCategory = { icon: 'Colors', id: 'colors-category', keywords: [] };
    keywords.categories.push(colorsCategory);
  }
  const colorKeywords = generateColorKeywords(colorHighlights.colorEntries);
  colorsCategory.keywords = colorKeywords;

  // Filter out empty keywords from all categories (but keep auto-generated color keywords)
  keywords.categories.forEach(category => {
    if (category.id === 'colors-category') {
      // Don't filter color keywords - they're auto-generated
      return;
    }
    category.keywords = category.keywords.filter((k) => k.keyword && k.keyword.match(/^ *$/) === null);
  });

  // Save keywords WITHOUT colors-category (it's auto-generated from color-highlights.json)
  const keywordsToSave = {
    categories: keywords.categories.filter(cat => cat.id !== 'colors-category')
  };
  await plugin.saveKeywords(keywordsToSave);
  await plugin.saveColorHighlights(colorHighlights);
  await plugin.saveData(settings);  // Use Obsidian's built-in method for data.json

  // CRITICAL: Also update the static property used by the public API (merged view)
  const mergedSettings: MergedSettings = {
    categories: keywords.categories,
    parserSettings: settings.parserSettings,
    colorHighlightingEnabled: settings.colorHighlightingEnabled,
    colorEntries: colorHighlights.colorEntries
  };
  (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings = mergedSettings as any;

  // Update CSS after saving
  injectAllCSS(keywords.categories, settings.vword);

  refreshViews();
}

function refreshViews(): void {
  if (!appInstance) return;

  const markdownView = appInstance.workspace.getActiveViewOfType(MarkdownView);
  markdownView?.previewMode.rerender(true);

  // refresh editor mode
  // @ts-expect-error, not typed
  const editorView = markdownView?.editor.cm as EditorView;
  if (editorView) {
    editorView.setState(editorView.state);
  }
}

export function addKeyword(value?: string, categoryName?: string): void {
  keywordsStore.update((keywords) => {
    const targetCategoryName = categoryName ?? 'General';

    // Find or create the category
    let targetCategory = keywords.categories.find(cat => cat.icon === targetCategoryName);
    if (!targetCategory) {
      targetCategory = { icon: targetCategoryName, keywords: [] };
      keywords.categories.push(targetCategory);
    }

    // Get colors from last keyword in category, or generate new ones if empty
    let color: string;
    let backgroundColor: string;

    if (targetCategory.keywords.length > 0) {
      const lastKeyword = targetCategory.keywords[targetCategory.keywords.length - 1];
      color = lastKeyword.color;
      backgroundColor = lastKeyword.backgroundColor;
    } else {
      const colors = generateRandomColors();
      color = colors.textColor;
      backgroundColor = colors.backgroundColor;
    }

    // Add the keyword to the category
    targetCategory.keywords.push({
      keyword: value ?? '',
      color: color,
      backgroundColor: backgroundColor,
      description: '',
      collectingStatus: CollectingStatus.PARSED,  // Default to parsed
      iconPriority: 1,  // Default icon priority
      stylePriority: 'normal',  // Default style priority
    });
    return keywords;
  });
}

export function removeKeyword(keyword: KeywordStyle): void {
  keywordsStore.update((keywords) => {
    // Find and remove the keyword from its category
    for (const category of keywords.categories) {
      const index = category.keywords.indexOf(keyword);
      if (index > -1) {
        category.keywords.splice(index, 1);
        break;
      }
    }
    return keywords;
  });
}

export function addCategory(name: string, categoryClass?: string): void {
  keywordsStore.update((keywords) => {
    if (!keywords.categories.find(cat => cat.icon === name)) {
      keywords.categories.push({ icon: name, id: categoryClass, keywords: [] });
    }
    return keywords;
  });
}

export function removeCategory(categoryName: string): void {
  keywordsStore.update((keywords) => {
    const index = keywords.categories.findIndex(cat => cat.icon === categoryName);
    if (index > -1) {
      keywords.categories.splice(index, 1);
    }
    return keywords;
  });
}

