import { App, MarkdownView } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
import { generateInitialColors } from 'src/settings/generate-initial-colors';
import type { KeywordStyle, Category, Settings, AuxiliaryKeyword, AuxiliaryCategory, CodeBlockLanguage } from 'src/shared';
import { KeywordType } from 'src/shared';
import { CollectingStatus } from 'src/shared/collecting-status';
import { MainCombinePriority, AuxiliaryCombinePriority } from 'src/shared/combine-priority';
import { injectKeywordCSS } from 'src/shared/dynamic-css';
import { get, writable } from 'svelte/store';
import type { ParserSettings } from 'src/interfaces/ParserSettings';
import { DEFAULT_PARSER_SETTINGS } from 'src/interfaces/ParserSettings';
import type { Subject } from 'src/interfaces/Subject';
import type { Topic } from 'src/interfaces/Topic';
import type { SubjectsData, GlobalTopic } from 'src/shared/subjects-data';

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
export const subjectsStore = writable<SubjectsData>({ subjects: [], topics: [], globalTopics: [] });

let plugin: HighlightSpaceRepeatPlugin | null = null;
let appInstance: App | null = null;

export async function initStore(pluginInstance: HighlightSpaceRepeatPlugin): Promise<void> {
  console.log('[Settings Store] Initializing store...');
  plugin = pluginInstance;
  appInstance = plugin.app;

  // Wait for settings to load before plugin finishes initialization
  await loadStore();
  console.log('[Settings Store] Main settings loaded');

  // These can load in parallel with plugin initialization
  loadSettingsData();
  loadAuxiliaryKeywords();
  loadCodeBlocks();
  loadSubjects();

  console.log('[Settings Store] Store initialization complete');
}

export async function loadStore(): Promise<void> {
  if (!plugin) return;

  console.log('[Settings Store] Loading settings from keyword.json...');
  const loadedDate = await plugin.loadData();
  console.log('[Settings Store] Loaded data:', !!loadedDate);
  const settings = Object.assign({}, DEFAULT_SETTINGS, loadedDate);
  console.log('[Settings Store] Settings categories count:', settings.categories?.length || 0);

  // Ensure parserSettings exists (migration for existing settings files)
  let needsMigration = false;
  if (!settings.parserSettings) {
    console.log('[Settings Store] Migrating: Adding parserSettings');
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
        if (keyword.mainKeyword === true) {
          keyword.keywordType = KeywordType.MAIN;
        } else if (keyword.mainKeyword === false) {
          keyword.keywordType = KeywordType.AUXILIARY;
        } else {
          // Default to AUXILIARY for backward compatibility
          keyword.keywordType = KeywordType.AUXILIARY;
        }
      }

      // Keep mainKeyword for backward compatibility but prefer keywordType
      if (keyword.mainKeyword === undefined) {
        keyword.mainKeyword = keyword.keywordType === KeywordType.MAIN;
      }

      // Set default combinePriority based on keywordType
      if (keyword.combinePriority === undefined) {
        keyword.combinePriority = keyword.keywordType === KeywordType.MAIN
          ? MainCombinePriority.None
          : AuxiliaryCombinePriority.AppendIcon;
      }
    });
  });

  settingsStore.set(settings);

  // CRITICAL: Also set the static property used by the public API
  if (plugin) {
    (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings = settings;
    console.log('[Settings Store] Set static HighlightSpaceRepeatPlugin.settings');
    console.log('[Settings Store] Static settings categories:', (plugin.constructor as typeof HighlightSpaceRepeatPlugin).settings?.categories?.length || 0);
  }

  // Inject CSS after loading settings
  injectKeywordCSS(settings.categories);
  console.log('[Settings Store] Settings loaded successfully');

  // Save migrated settings back to file if migration occurred
  if (needsMigration) {
    console.log('[Settings Store] Saving migrated settings to keyword.json...');
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
  console.log('[Settings Store] Updated static settings after save');

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
    targetCategory.keywords.push({
      keyword: value ?? '',
      color: color,
      backgroundColor: backgroundColor,
      description: '',
      keywordType: KeywordType.AUXILIARY,  // Default to auxiliary keyword
      mainKeyword: false,  // Backward compatibility
      combinePriority: AuxiliaryCombinePriority.AppendIcon,  // Default priority for auxiliary
      collectingStatus: CollectingStatus.PARSED,  // Default to parsed
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
  const subjectsData = loadedData || { subjects: [], topics: [] };
  subjectsStore.set(subjectsData);
}

export async function saveSubjects(): Promise<void> {
  if (!plugin) {
    console.error('[saveSubjects] Plugin not initialized');
    return;
  }

  const currentSubjects = get(subjectsStore);
  console.log('[saveSubjects] Saving subjects data:', {
    subjectsCount: currentSubjects.subjects.length,
    topicsCount: currentSubjects.topics.length
  });
  await plugin.saveSubjects(currentSubjects);
  console.log('[saveSubjects] Save completed');

  // Refresh subject selection commands
  await plugin.registerSubjectCommands();
  console.log('[saveSubjects] Subject commands refreshed');
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
    // Also remove topics for this subject
    data.topics = data.topics.filter((t: Topic) => t.subjectId !== subjectId);
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

// Topics functions
export function addTopic(topic: Topic): void {
  subjectsStore.update((data) => {
    data.topics.push(topic);
    return data;
  });
  saveSubjects();
}

export function removeTopic(topicId: string): void {
  subjectsStore.update((data) => {
    data.topics = data.topics.filter((t: Topic) => t.id !== topicId);
    return data;
  });
  saveSubjects();
}

export function updateTopic(topicId: string, updates: Partial<Topic>): void {
  subjectsStore.update((data) => {
    const topic = data.topics.find((t: Topic) => t.id === topicId);
    if (topic) {
      Object.assign(topic, updates);
    }
    return data;
  });
  saveSubjects();
}

export function addPrimaryTopic(subjectId: string): void {
  const newTopic: Topic = {
    id: `topic-${Date.now()}`,
    name: '',
    type: 'primary',
    subjectId: subjectId,
    icon: '📌',
    topicTag: '',
    topicKeyword: '',
    topicText: '',
    filterExpression: '',
    keywords: [],
    order: Date.now(),
    showFileRecords: true,
    showHeaderRecords: true,
    showRecordRecords: true
  };
  addTopic(newTopic);
}

export function addSecondaryTopic(subjectId: string): void {
  const newTopic: Topic = {
    id: `topic-${Date.now()}`,
    name: '',
    type: 'secondary',
    subjectId: subjectId,
    icon: '🔗',
    topicTag: '',
    topicKeyword: '',
    filterExpression: '',
    keywords: [],
    order: Date.now(),
    showFileRecords: true,
    showHeaderRecords: true,
    showRecordRecords: true
  };
  addTopic(newTopic);
}

// Global Topics functions
export function addGlobalTopic(): string {
  const newId = `global-topic-${Date.now()}`;
  subjectsStore.update((data) => {
    if (!data.globalTopics) {
      data.globalTopics = [];
    }
    data.globalTopics.push({
      id: newId,
      name: '',
      icon: '🔗',
      topicTag: '',
      topicKeyword: '',
      topicText: '',
      filterExpression: '',
      showFileRecords: true,
      showHeaderRecords: true,
      showRecordRecords: true
    });
    return data;
  });
  saveSubjects();
  return newId;
}

export function removeGlobalTopic(topicId: string): void {
  subjectsStore.update((data) => {
    if (data.globalTopics) {
      data.globalTopics = data.globalTopics.filter((t: GlobalTopic) => t.id !== topicId);
    }
    return data;
  });
  saveSubjects();
}

export function updateGlobalTopic(topicId: string, updates: Partial<GlobalTopic>): void {
  subjectsStore.update((data) => {
    if (data.globalTopics) {
      const topic = data.globalTopics.find((t: GlobalTopic) => t.id === topicId);
      if (topic) {
        Object.assign(topic, updates);
      }
    }
    return data;
  });
  saveSubjects();
}

/**
 * Import a global topic into a subject as a secondary topic
 * Creates a copy of the global topic with the subject's ID
 */
export function importGlobalTopic(globalTopicId: string, subjectId: string): string {
  const globalTopicsData = get(subjectsStore).globalTopics || [];
  const globalTopic = globalTopicsData.find((t: GlobalTopic) => t.id === globalTopicId);

  if (!globalTopic) {
    console.warn(`Global topic ${globalTopicId} not found`);
    return '';
  }

  // Create a new topic based on the global topic
  const newTopic: Topic = {
    id: `topic-${Date.now()}`,
    name: globalTopic.name,
    type: 'secondary',
    subjectId: subjectId,
    icon: globalTopic.icon || '🔗',
    topicTag: globalTopic.topicTag || '',
    topicKeyword: globalTopic.topicKeyword || '',
    topicText: globalTopic.topicText,
    filterExpression: globalTopic.filterExpression || '',
    keywords: [],
    order: Date.now(),
    showFileRecords: globalTopic.showFileRecords ?? true,
    showHeaderRecords: globalTopic.showHeaderRecords ?? true,
    showRecordRecords: globalTopic.showRecordRecords ?? true
  };

  addTopic(newTopic);
  return newTopic.id;
}

