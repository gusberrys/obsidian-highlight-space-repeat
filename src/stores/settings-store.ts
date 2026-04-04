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

export interface PluginSettings {
  categories: Category[];
  parserSettings: ParserSettings;

  // Color highlighting settings (unified with keywords)
  colorHighlightingEnabled: boolean;
  colorEntries: ColorEntry[];
}

export type { Settings };

const DEFAULT_SETTINGS: PluginSettings = {
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
  parserSettings: DEFAULT_PARSER_SETTINGS,

  // Color highlighting settings
  colorHighlightingEnabled: false,
  colorEntries: DEFAULT_COLOR_ENTRIES
};

const DEFAULT_SETTINGS_DATA: Settings = {
  keywordDescriptionsPath: '',
  layoutRetryDelayMs: 100,
};

export const settingsStore = writable<PluginSettings>(DEFAULT_SETTINGS);
export const settingsDataStore = writable<Settings>(DEFAULT_SETTINGS_DATA);
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

  // Wait for settings to load before plugin finishes initialization
  await loadStore();

  // Load VWord settings and inject CSS (needs to complete before plugin fully loads)
  await loadVWordSettings();

  // Load settings data in parallel with plugin initialization
  loadSettingsData();
}

export async function loadStore(): Promise<void> {
  if (!plugin) return;

  const loadedDate = await plugin.loadData();
  const settings = Object.assign({}, DEFAULT_SETTINGS, loadedDate);

  // Ensure parserSettings exists
  let needsAutoSave = false;
  if (!settings.parserSettings) {
    settings.parserSettings = DEFAULT_PARSER_SETTINGS;
    needsAutoSave = true;
  }

  // Ensure color highlighting settings exist
  if (settings.colorHighlightingEnabled === undefined) {
    settings.colorHighlightingEnabled = false;
    needsAutoSave = true;
  }

  // Ensure colorEntries exists
  if (!settings.colorEntries || !Array.isArray(settings.colorEntries)) {
    settings.colorEntries = DEFAULT_COLOR_ENTRIES;
    needsAutoSave = true;
  }

  // AUTO-GENERATE COLOR KEYWORDS: Find or create "Colors" category and inject generated keywords
  let colorsCategory = settings.categories.find(cat => cat.id === 'colors-category');
  if (!colorsCategory) {
    colorsCategory = { icon: 'Colors', id: 'colors-category', keywords: [] };
    settings.categories.push(colorsCategory);
  }

  // Replace color keywords with fresh ones generated from colorEntries
  const colorKeywords = generateColorKeywords(settings.colorEntries);
  colorsCategory.keywords = colorKeywords;

  // Set default collectingStatus and priorities for keywords that don't have them set
  settings.categories.forEach(category => {
    category.keywords.forEach(keyword => {
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

  settingsStore.set(settings);

  // CRITICAL: Also set the static property used by the public API
  if (plugin) {
    (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings = settings;
  }

  // Inject keyword CSS after loading settings
  // Note: VWord CSS will be injected separately by loadVWordSettings()
  // Note: Color keywords are now part of the keyword system (auto-generated from colorEntries)
  injectKeywordCSS(settings.categories);
  injectCodeStylerOverrideCSS();

  // Save settings if defaults were applied
  if (needsAutoSave) {
    await saveStore();
  }
}

export async function saveStore(): Promise<void> {
  if (!plugin) return;

  const currentSettings = get(settingsStore);

  // REGENERATE COLOR KEYWORDS: Update Colors category with fresh keywords from colorEntries
  let colorsCategory = currentSettings.categories.find(cat => cat.id === 'colors-category');
  if (!colorsCategory) {
    colorsCategory = { icon: 'Colors', id: 'colors-category', keywords: [] };
    currentSettings.categories.push(colorsCategory);
  }
  const colorKeywords = generateColorKeywords(currentSettings.colorEntries || []);
  colorsCategory.keywords = colorKeywords;

  // Filter out empty keywords from all categories (but keep auto-generated color keywords)
  currentSettings.categories.forEach(category => {
    if (category.id === 'colors-category') {
      // Don't filter color keywords - they're auto-generated
      return;
    }
    category.keywords = category.keywords.filter((k) => k.keyword && k.keyword.match(/^ *$/) === null);
  });

  await plugin.saveData(currentSettings);

  // CRITICAL: Also update the static property used by the public API
  (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings = currentSettings;

  // Update CSS after saving (inject keyword, VWord, and Code Styler override)
  const vwordSettings = get(vwordSettingsStore);
  injectAllCSS(currentSettings.categories, vwordSettings);

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
  settingsStore.update((settings) => {
    const targetCategoryName = categoryName ?? 'General';

    // Find or create the category
    let targetCategory = settings.categories.find(cat => cat.icon === targetCategoryName);
    if (!targetCategory) {
      targetCategory = { icon: targetCategoryName, keywords: [] };
      settings.categories.push(targetCategory);
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
    return settings;
  });
}

export function removeKeyword(keyword: KeywordStyle): void {
  settingsStore.update((settings) => {
    // Find and remove the keyword from its category
    for (const category of settings.categories) {
      const index = category.keywords.indexOf(keyword);
      if (index > -1) {
        category.keywords.splice(index, 1);
        break;
      }
    }
    return settings;
  });
}

export function addCategory(name: string, categoryClass?: string): void {
  settingsStore.update((settings) => {
    if (!settings.categories.find(cat => cat.icon === name)) {
      settings.categories.push({ icon: name, id: categoryClass, keywords: [] });
    }
    return settings;
  });
}

export function removeCategory(categoryName: string): void {
  settingsStore.update((settings) => {
    const index = settings.categories.findIndex(cat => cat.icon === categoryName);
    if (index > -1) {
      settings.categories.splice(index, 1);
    }
    return settings;
  });
}

// Settings Data functions
export async function loadSettingsData(): Promise<void> {
  if (!plugin) return;

  const loadedData = await plugin.loadSettingsData();
  const settings = Object.assign({}, DEFAULT_SETTINGS_DATA, loadedData);
  settingsDataStore.set(settings);
}

export async function saveSettingsData(): Promise<void> {
  if (!plugin) return;

  const currentSettings = get(settingsDataStore);
  await plugin.saveSettingsData(currentSettings);
}

// VWord Settings functions
export async function loadVWordSettings(): Promise<void> {
  if (!plugin) return;

  const loadedData = await plugin.loadVWordSettings();
  const vwordSettings = Object.assign({}, DEFAULT_VWORD_SETTINGS, loadedData);
  vwordSettingsStore.set(vwordSettings);

  // Inject VWord CSS after loading
  injectVWordCSS(vwordSettings);
}

export async function saveVWordSettings(): Promise<void> {
  if (!plugin) return;

  const currentSettings = get(vwordSettingsStore);
  await plugin.saveVWordSettings(currentSettings);

  // Re-inject all CSS after VWord settings change (keywords + VWord + Code Styler override)
  const keywordSettings = get(settingsStore);
  injectAllCSS(keywordSettings.categories, currentSettings);

  refreshViews();
}
