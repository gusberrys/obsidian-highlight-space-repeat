import { App, MarkdownView } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
import { generateInitialColors } from 'src/settings/generate-initial-colors';
import type { KeywordStyle, Category, Settings, CodeBlockLanguage, VWordSettings } from 'src/shared';
import { DEFAULT_VWORD_SETTINGS } from 'src/shared';
import { CollectingStatus } from 'src/shared/collecting-status';
import { injectKeywordCSS, injectVWordCSS, injectAllCSS, injectColorHighlightCSS, injectCodeStylerOverrideCSS } from 'src/shared/dynamic-css';
import { get, writable } from 'svelte/store';
import type { ParserSettings } from 'src/interfaces/ParserSettings';
import { DEFAULT_PARSER_SETTINGS } from 'src/interfaces/ParserSettings';
import type { ColourPair } from 'src/settings/ColorSettings';
import { DEFAULT_COLOR_SETTINGS } from 'src/settings/ColorSettings';
// Subject, Topic, SubjectsData imports removed - now managed by Subject Matrix plugin

export interface PluginSettings {
  categories: Category[];
  parserSettings: ParserSettings;

  // Color highlighting settings
  colorHighlightingEnabled: boolean;
  colourPairs: ColourPair[];
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
        {
          keyword: 'fal',
          color: '#ffffff',
          backgroundColor: '#7f5374',
          description: 'False statement or incorrect',
          generateIcon: '🧻',
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
    {
      icon: 'Status',
      id: 'status-category',
      keywords: [
        {
          keyword: 'war',
          color: '#000000',
          backgroundColor: '#ad4f10',
          description: 'Warning or caution required',
          generateIcon: '⚠️',
        },
        {
          keyword: 'ste',
          color: '#f3f9fb',
          backgroundColor: '#595959',
          description: 'Step or procedure',
          generateIcon: '🦶🏻',
        },
      ],
    },
    {
      icon: 'Personal',
      id: 'personal-category',
      keywords: [
        {
          keyword: 'dev',
          color: '#ffd700',
          backgroundColor: '#000000',
          description: 'Development or devilish note',
          generateIcon: '',
        },
        {
          keyword: 'sto',
          color: '#b98d8d',
          backgroundColor: '#303030',
          description: 'Personal story or memory',
          generateIcon: '',
        },
      ],
    },
  ],
  parserSettings: DEFAULT_PARSER_SETTINGS,

  // Color highlighting settings
  colorHighlightingEnabled: false,
  colourPairs: DEFAULT_COLOR_SETTINGS
};

const DEFAULT_SETTINGS_DATA: Settings = {
  keywordDescriptionsPath: '',
  pathToSubjects: '',
  layoutRetryDelayMs: 100,
};

const DEFAULT_CODEBLOCKS: CodeBlockLanguage[] = [
  { id: 'java', icon: '☕' },
  { id: 'python', icon: '🐍' },
  { id: 'javascript', icon: undefined },
  { id: 'typescript', icon: undefined }
];

export const settingsStore = writable<PluginSettings>(DEFAULT_SETTINGS);
export const settingsDataStore = writable<Settings>(DEFAULT_SETTINGS_DATA);
export const codeBlocksStore = writable<CodeBlockLanguage[]>(DEFAULT_CODEBLOCKS);
export const vwordSettingsStore = writable<VWordSettings>(DEFAULT_VWORD_SETTINGS);
// subjectsStore removed - now managed by Subject Matrix plugin

let plugin: HighlightSpaceRepeatPlugin | null = null;
let appInstance: App | null = null;

export async function initStore(pluginInstance: HighlightSpaceRepeatPlugin): Promise<void> {
  plugin = pluginInstance;
  appInstance = plugin.app;

  // Wait for settings to load before plugin finishes initialization
  await loadStore();

  // Load VWord settings and inject CSS (needs to complete before plugin fully loads)
  await loadVWordSettings();

  // These can load in parallel with plugin initialization
  loadSettingsData();
  loadCodeBlocks();

}

export async function loadStore(): Promise<void> {
  if (!plugin) return;

  const loadedDate = await plugin.loadData();
  const settings = Object.assign({}, DEFAULT_SETTINGS, loadedDate);

  // Ensure parserSettings exists (migration for existing settings files)
  let needsMigration = false;
  if (!settings.parserSettings) {
    settings.parserSettings = DEFAULT_PARSER_SETTINGS;
    needsMigration = true;
  }

  // Ensure color highlighting settings exist (migration for existing settings files)
  if (settings.colorHighlightingEnabled === undefined) {
    settings.colorHighlightingEnabled = false;
    needsMigration = true;
  }
  if (!settings.colourPairs) {
    settings.colourPairs = DEFAULT_COLOR_SETTINGS;
    needsMigration = true;
  }

  // Migrate empty class names to proper defaults (for colors that were migrated with empty strings)
  settings.colourPairs.forEach((colour, index) => {
    const defaultColour = DEFAULT_COLOR_SETTINGS.find(d => d.localName === colour.localName);
    if (defaultColour) {
      // Fill in empty class names with defaults
      if (!colour.globalReferenceClass || colour.globalReferenceClass.trim() === '') {
        colour.globalReferenceClass = defaultColour.globalReferenceClass;
        needsMigration = true;
      }
      if (!colour.globalValueClass || colour.globalValueClass.trim() === '') {
        colour.globalValueClass = defaultColour.globalValueClass;
        needsMigration = true;
      }
      if (!colour.localReferenceClass || colour.localReferenceClass.trim() === '') {
        colour.localReferenceClass = defaultColour.localReferenceClass;
        needsMigration = true;
      }
      if (!colour.localValueClass || colour.localValueClass.trim() === '') {
        colour.localValueClass = defaultColour.localValueClass;
        needsMigration = true;
      }
      // Also update emojis and colors if they differ from defaults
      if (colour.globalReference !== defaultColour.globalReference) {
        colour.globalReference = defaultColour.globalReference;
        needsMigration = true;
      }
      if (colour.globalValue !== defaultColour.globalValue) {
        colour.globalValue = defaultColour.globalValue;
        needsMigration = true;
      }
      if (colour.localReference !== defaultColour.localReference) {
        colour.localReference = defaultColour.localReference;
        needsMigration = true;
      }
      if (colour.localValue !== defaultColour.localValue) {
        colour.localValue = defaultColour.localValue;
        needsMigration = true;
      }
      if (colour.localColour !== defaultColour.localColour) {
        colour.localColour = defaultColour.localColour;
        needsMigration = true;
      }
    }
  });

  // Set default collectingStatus and priorities for keywords that don't have them set
  settings.categories.forEach(category => {
    category.keywords.forEach(keyword => {
      // Only set if not already defined - default to PARSED for backward compatibility
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
  // Note: Color CSS injected here for initial load
  injectKeywordCSS(settings.categories);
  injectColorHighlightCSS(settings.colourPairs);
  injectCodeStylerOverrideCSS();

  // Save migrated settings back to file if migration occurred
  if (needsMigration) {
    await saveStore();
  }
}

export async function saveStore(): Promise<void> {
  if (!plugin) return;

  const currentSettings = get(settingsStore);

  // Filter out empty keywords from all categories
  currentSettings.categories.forEach(category => {
    category.keywords = category.keywords.filter((k) => k.keyword && k.keyword.match(/^ *$/) === null);
  });

  await plugin.saveData(currentSettings);

  // CRITICAL: Also update the static property used by the public API
  (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings = currentSettings;

  // Update CSS after saving (inject keyword, VWord, and color CSS)
  const vwordSettings = get(vwordSettingsStore);
  injectAllCSS(currentSettings.categories, vwordSettings, currentSettings.colourPairs);

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

export function addKeyword(value?: string, categoryName?: string, container?: HTMLElement): void {
  if (!container) {
    container = document.body;
  }

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
      const [foregroundColor, bgColor] = generateInitialColors(container);
      color = foregroundColor.toHex();
      backgroundColor = bgColor.toHex();
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

export function updateCategoryClass(categoryName: string, newClass: string): void {
  settingsStore.update((settings) => {
    const category = settings.categories.find(cat => cat.icon === categoryName);
    if (category) {
      category.id = newClass;
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

// Code Blocks functions
export async function loadCodeBlocks(): Promise<void> {
  if (!plugin) return;

  const loadedData = await plugin.loadCodeBlocks();
  const codeBlocks = loadedData || DEFAULT_CODEBLOCKS;
  codeBlocksStore.set(codeBlocks);
}

export async function saveCodeBlocks(): Promise<void> {
  if (!plugin) return;

  const currentCodeBlocks = get(codeBlocksStore);
  await plugin.saveCodeBlocks(currentCodeBlocks);
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

  // Re-inject all CSS after VWord settings change (keywords + VWord + colors)
  const keywordSettings = get(settingsStore);
  injectAllCSS(keywordSettings.categories, currentSettings, keywordSettings.colourPairs);

  refreshViews();
}

// Subject management functions removed - now in Subject Matrix plugin's subject-store.ts
