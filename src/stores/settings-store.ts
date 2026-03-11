import { App, MarkdownView } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
import { generateInitialColors } from 'src/settings/generate-initial-colors';
import type { KeywordStyle, Category, Settings, AuxiliaryKeyword, AuxiliaryCategory, CodeBlockLanguage } from 'src/shared';
import { KeywordType } from 'src/shared';
import { CollectingStatus } from 'src/shared/collecting-status';
import { MainCombinePriority } from 'src/shared/combine-priority';
import { injectKeywordCSS } from 'src/shared/dynamic-css';
import { get, writable } from 'svelte/store';
import type { ParserSettings } from 'src/interfaces/ParserSettings';
import { DEFAULT_PARSER_SETTINGS } from 'src/interfaces/ParserSettings';
import type { Subject } from 'src/interfaces/Subject';
import type { Topic } from 'src/interfaces/Topic';
import type { SubjectsData } from 'src/shared/subjects-data';

export interface PluginSettings {
  categories: Category[];
  parserSettings: ParserSettings;
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
          ccssc: 'eqa-text',
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
          ccssc: 'pos',
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
          ccssc: 'devilish-text',
        },
        {
          keyword: 'sto',
          color: '#b98d8d',
          backgroundColor: '#303030',
          description: 'Personal story or memory',
          generateIcon: '',
          ccssc: 'me-text',
        },
      ],
    },
  ],
  parserSettings: DEFAULT_PARSER_SETTINGS
};

const DEFAULT_SETTINGS_DATA: Settings = {
  keywordDescriptionsPath: '',
  pathToSubjects: '',
};

const DEFAULT_AUXILIARY_KEYWORDS: AuxiliaryCategory[] = [
  {
    icon: 'Metadata',
    id: 'metadata-category',
    auxiliaryKeywords: [
      { icon: '👶', keyword: 'baby', description: 'Baby/beginner level', class: 'baby' },
      { icon: '🐍', keyword: 'python', description: 'Python related', class: 'python' },
      { icon: '⚡', keyword: 'fast', description: 'Fast/quick tip', class: 'fast' },
    ]
  },
  {
    icon: 'Layout',
    id: 'layout-category',
    auxiliaryKeywords: [
      { icon: '-', keyword: 'h', description: 'Horizontal list layout (flexible)', class: 'horizontal' },
      { icon: '1-4', keyword: '1-4', description: 'Ratio 20% / 80% for 2 items', class: 'ratio-1-4' },
      { icon: '4-1', keyword: '4-1', description: 'Ratio 80% / 20% for 2 items', class: 'ratio-4-1' },
      { icon: '2-3', keyword: '2-3', description: 'Ratio 40% / 60% for 2 items', class: 'ratio-2-3' },
      { icon: '3-2', keyword: '3-2', description: 'Ratio 60% / 40% for 2 items', class: 'ratio-3-2' },
      { icon: '1-3', keyword: '1-3', description: 'Ratio 25% / 75% for 2 items', class: 'ratio-1-3' },
      { icon: '3-1', keyword: '3-1', description: 'Ratio 75% / 25% for 2 items', class: 'ratio-3-1' },
      { icon: '2-1', keyword: '2-1', description: 'Ratio 66.666% / 33.333% for 2 items', class: 'ratio-2-1' },
      { icon: '1-2', keyword: '1-2', description: 'Ratio 33.333% / 66.666% for 2 items', class: 'ratio-1-2' },
    ]
  }
];

const DEFAULT_CODEBLOCKS: CodeBlockLanguage[] = [
  { id: 'java', icon: '☕' },
  { id: 'python', icon: '🐍' },
  { id: 'javascript', icon: undefined },
  { id: 'typescript', icon: undefined }
];

export const settingsStore = writable<PluginSettings>(DEFAULT_SETTINGS);
export const settingsDataStore = writable<Settings>(DEFAULT_SETTINGS_DATA);
export const auxiliaryKeywordsStore = writable<AuxiliaryCategory[]>(DEFAULT_AUXILIARY_KEYWORDS);
export const codeBlocksStore = writable<CodeBlockLanguage[]>(DEFAULT_CODEBLOCKS);
export const subjectsStore = writable<SubjectsData>({ subjects: [] });

let plugin: HighlightSpaceRepeatPlugin | null = null;
let appInstance: App | null = null;

export async function initStore(pluginInstance: HighlightSpaceRepeatPlugin): Promise<void> {
  plugin = pluginInstance;
  appInstance = plugin.app;

  // Wait for settings to load before plugin finishes initialization
  await loadStore();

  // These can load in parallel with plugin initialization
  loadSettingsData();
  loadAuxiliaryKeywords();
  loadCodeBlocks();
  loadSubjects();

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

  // Migrate old comma-separated keywords to new keyword+aliases structure
  settings.categories.forEach(category => {
    category.keywords.forEach(kw => {
      // Check if keyword contains commas (old format)
      if (kw.keyword.includes(',') && !kw.aliases) {
        const parts = kw.keyword.split(',').map(k => k.trim());
        kw.keyword = parts[0];  // First part becomes the primary keyword
        kw.aliases = parts.slice(1);  // Rest become aliases
        needsMigration = true;
      }
    });
  });

  // Set default collectingStatus, keywordType, and combinePriority for keywords that don't have them set
  settings.categories.forEach(category => {
    category.keywords.forEach(keyword => {
      // Only set if not already defined - default to PARSED for backward compatibility
      if (keyword.collectingStatus === undefined) {
        keyword.collectingStatus = CollectingStatus.PARSED;
      }

      // Migrate mainKeyword to keywordType
      if (keyword.keywordType === undefined) {
        // Check if this category is a helper category
        if (category.isHelper) {
          keyword.keywordType = KeywordType.HELP;
        } else if (keyword.mainKeyword === true) {
          keyword.keywordType = KeywordType.MAIN;
        } else {
          // Default to MAIN (never AUXILIARY)
          keyword.keywordType = KeywordType.MAIN;
        }
      }

      // Keep mainKeyword for backward compatibility but prefer keywordType
      if (keyword.mainKeyword === undefined) {
        keyword.mainKeyword = keyword.keywordType === KeywordType.MAIN;
      }

      // Set default combinePriority for MAIN keywords only
      if (keyword.combinePriority === undefined && keyword.keywordType === KeywordType.MAIN) {
        keyword.combinePriority = MainCombinePriority.None;
      }
    });
  });

  settingsStore.set(settings);

  // CRITICAL: Also set the static property used by the public API
  if (plugin) {
    (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings = settings;
  }

  // Inject CSS after loading settings
  injectKeywordCSS(settings.categories);

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

  // Update CSS after saving
  injectKeywordCSS(currentSettings.categories);

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
    // Determine keywordType based on category's isHelper flag
    const keywordType = targetCategory.isHelper ? KeywordType.HELP : KeywordType.MAIN;
    const mainKeyword = keywordType === KeywordType.MAIN;

    targetCategory.keywords.push({
      keyword: value ?? '',
      color: color,
      backgroundColor: backgroundColor,
      description: '',
      keywordType: keywordType,
      mainKeyword: mainKeyword,  // Backward compatibility
      collectingStatus: CollectingStatus.PARSED,  // Default to parsed
      combinePriority: keywordType === KeywordType.MAIN ? MainCombinePriority.StyleAndIcon : undefined,
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

// Auxiliary Keywords functions
export async function loadAuxiliaryKeywords(): Promise<void> {
  if (!plugin) return;

  const loadedData = await plugin.loadAuxiliaryKeywords();
  const keywords = loadedData || DEFAULT_AUXILIARY_KEYWORDS;

  // Migrate old auxiliary keywords without keyword field
  keywords.forEach(category => {
    category.auxiliaryKeywords.forEach(auxKw => {
      // If keyword field is missing, create it from description or use a fallback
      if (!auxKw.keyword) {
        // Use the description as keyword, or generate one
        auxKw.keyword = auxKw.description?.toLowerCase().replace(/\s+/g, '-') || 'aux';
      }
    });
  });

  auxiliaryKeywordsStore.set(keywords);
}

export async function saveAuxiliaryKeywords(): Promise<void> {
  if (!plugin) return;

  const currentKeywords = get(auxiliaryKeywordsStore);
  await plugin.saveAuxiliaryKeywords(currentKeywords);
}

export function addAuxiliaryKeywordCategory(name: string, categoryClass?: string): void {
  auxiliaryKeywordsStore.update((categories) => {
    if (!categories.find(cat => cat.icon === name)) {
      categories.push({ icon: name, id: categoryClass, auxiliaryKeywords: [] });
    }
    return categories;
  });
}

export function removeAuxiliaryKeywordCategory(categoryName: string): void {
  auxiliaryKeywordsStore.update((categories) => {
    const index = categories.findIndex(cat => cat.icon === categoryName);
    if (index > -1) {
      categories.splice(index, 1);
    }
    return categories;
  });
}

export function addAuxiliaryKeyword(categoryName: string, icon: string = '', keyword: string = '', description: string = '', cssClass: string = ''): void {
  auxiliaryKeywordsStore.update((categories) => {
    const category = categories.find(cat => cat.icon === categoryName);
    if (category) {
      category.auxiliaryKeywords.push({
        icon,
        keyword,
        description,
        class: cssClass
      });
    }
    return categories;
  });
}

export function removeAuxiliaryKeyword(categoryName: string, auxiliaryKeyword: AuxiliaryKeyword): void {
  auxiliaryKeywordsStore.update((categories) => {
    const category = categories.find(cat => cat.icon === categoryName);
    if (category) {
      const index = category.auxiliaryKeywords.indexOf(auxiliaryKeyword);
      if (index > -1) {
        category.auxiliaryKeywords.splice(index, 1);
      }
    }
    return categories;
  });
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

// Subjects and Topics functions
export async function loadSubjects(): Promise<void> {
  if (!plugin) return;

  const loadedData = await plugin.loadSubjects();
  const subjectsData = loadedData || { subjects: [] };

  subjectsStore.set(subjectsData);
}

export async function saveSubjects(): Promise<void> {
  if (!plugin) {
    console.error('[saveSubjects] Plugin not initialized');
    return;
  }

  const currentSubjects = get(subjectsStore);

  // Count topics across all subjects
  let totalTopics = 0;
  currentSubjects.subjects.forEach(s => {
    totalTopics += (s.primaryTopics?.length || 0) + (s.secondaryTopics?.length || 0);
  });

  await plugin.saveSubjects(currentSubjects);

  // Refresh subject selection commands
  await plugin.registerSubjectCommands();
}

// Subjects functions
export function addSubject(name: string): string {
  const newId = `subject-${Date.now()}`;
  subjectsStore.update((data) => {
    data.subjects.push({
      id: newId,
      name: name.trim(),
      enabled: true
    });
    return data;
  });
  saveSubjects();
  return newId;
}

export function removeSubject(subjectId: string): void {
  subjectsStore.update((data) => {
    data.subjects = data.subjects.filter((s: Subject) => s.id !== subjectId);
    // Topics are nested under subjects, so they're automatically removed
    return data;
  });
  saveSubjects();
}

export function updateSubject(subjectId: string, updates: Partial<Subject>): void {
  subjectsStore.update((data) => {
    const subject = data.subjects.find((s: Subject) => s.id === subjectId);
    if (subject) {
      Object.assign(subject, updates);
    }
    return data;
  });
  saveSubjects();
}

// Topics functions - work with nested arrays
export function addTopic(subjectId: string, topic: Topic, isPrimary: boolean): void {
  subjectsStore.update((data) => {
    const subject = data.subjects.find((s: Subject) => s.id === subjectId);
    if (subject) {
      if (isPrimary) {
        if (!subject.primaryTopics) subject.primaryTopics = [];
        subject.primaryTopics.push(topic);
      } else {
        if (!subject.secondaryTopics) subject.secondaryTopics = [];
        subject.secondaryTopics.push(topic);
      }
    }
    return data;
  });
  saveSubjects();
}

export function removeTopic(topicId: string): void {
  subjectsStore.update((data) => {
    // Find and remove topic from whichever subject contains it
    for (const subject of data.subjects) {
      if (subject.primaryTopics) {
        const index = subject.primaryTopics.findIndex(t => t.id === topicId);
        if (index >= 0) {
          subject.primaryTopics.splice(index, 1);
          if (subject.primaryTopics.length === 0) delete subject.primaryTopics;
          return data;
        }
      }
      if (subject.secondaryTopics) {
        const index = subject.secondaryTopics.findIndex(t => t.id === topicId);
        if (index >= 0) {
          subject.secondaryTopics.splice(index, 1);
          if (subject.secondaryTopics.length === 0) delete subject.secondaryTopics;
          return data;
        }
      }
    }
    return data;
  });
  saveSubjects();
}

export function updateTopic(topicId: string, updates: Partial<Topic>): void {
  subjectsStore.update((data) => {
    // Find topic in any subject and update it
    for (const subject of data.subjects) {
      if (subject.primaryTopics) {
        const topic = subject.primaryTopics.find(t => t.id === topicId);
        if (topic) {
          Object.assign(topic, updates);
          return data;
        }
      }
      if (subject.secondaryTopics) {
        const topic = subject.secondaryTopics.find(t => t.id === topicId);
        if (topic) {
          Object.assign(topic, updates);
          return data;
        }
      }
    }
    return data;
  });
  saveSubjects();
}

export function addPrimaryTopic(subjectId: string): void {
  const newTopic: Topic = {
    id: `topic-${Date.now()}`,
    name: '',
    icon: '📌',
    topicTag: '',
    topicKeyword: '',
    topicText: ''
  };
  addTopic(subjectId, newTopic, true);
}

export function addSecondaryTopic(subjectId: string): void {
  const newTopic: Topic = {
    id: `topic-${Date.now()}`,
    name: '',
    icon: '🔗',
    topicTag: '',
    topicKeyword: ''
  };
  addTopic(subjectId, newTopic, false);
}


