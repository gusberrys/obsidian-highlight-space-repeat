import { Plugin, Modal, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { editorHighlighter, recordBadgeGutter } from 'src/editor-extension';
import { SettingTab } from 'src/settings/setting-tab';
import { readerHighlighter, addRecordBadgesToReadingView, addGoalStatusBadges } from './reader-extension';
import { createInsertKeywordCommand, createInsertSubKeywordCommand } from './commands';
import { initStore, saveStore, type PluginSettings, type Settings } from './stores/settings-store';
import { DATA_PATHS, type CodeBlockLanguage, type SubjectsData, type VWordSettings } from './shared';
import type { HighlightSpaceRepeatAPI } from './public-api';
import { CombinedKeywordSuggest } from './combined-keyword-suggest';
import { SubKeywordSuggest } from './subkeyword-suggest';
import { KHMatrixWidget, KH_MATRIX_VIEW_TYPE } from './widgets/KHMatrixWidget';
import { PinnedView, PINNED_VIEW_TYPE } from './widgets/PinnedView';
import { SRSReviewView, SRS_REVIEW_VIEW_TYPE } from './widgets/SRSReviewView';
import { SubjectDashboardView, SUBJECT_DASHBOARD_VIEW_TYPE } from './widgets/SubjectDashboardView';
import { SRSManager } from './services/SRSManager';
import { renderSubjectDashboard } from './reader/subject-dashboard';

export class HighlightSpaceRepeatPlugin extends Plugin {
  static settings: PluginSettings;
  static currentSubject: any = null; // Global selected subject for matrix/commands/ribbon

  // Track registered subject selection command IDs for cleanup
  private subjectCommandIds: string[] = [];

  // SRS (Spaced Repetition System) manager
  public srsManager!: SRSManager;

  // Parsed records cache (in RAM only)
  public parsedRecords: any[] = [];

  /**
   * Public API for external plugins to access highlight space repeat functionality
   * Access via: app.plugins.plugins['obsidian-highlight-space-repeat'].api
   */
  public get api(): HighlightSpaceRepeatAPI {
    // console.log('[Keyword Highlighter API] API getter called');
    // console.log('[Keyword Highlighter API] Settings available:', !!HighlightSpaceRepeatPlugin.settings);
    // console.log('[Keyword Highlighter API] Categories count:', HighlightSpaceRepeatPlugin.settings?.categories?.length || 0);

    return {
      getAllKeywordStyles: () => {
        const categories = HighlightSpaceRepeatPlugin.settings?.categories || [];
        // console.log('[API] getAllKeywordStyles - returning', categories.flatMap(cat => cat.keywords || []).length, 'keyword styles');
        return categories.flatMap(cat => cat.keywords || []);
      },

      getKeywordStyle: (keyword: string) => {
        const categories = HighlightSpaceRepeatPlugin.settings?.categories || [];
        for (const category of categories) {
          const found = category.keywords?.find(kw => kw.keyword === keyword);
          if (found) return found;
        }
        return undefined;
      },

      getCategories: () => {
        const categories = HighlightSpaceRepeatPlugin.settings?.categories || [];
        // console.log('[API] getCategories - returning', categories.length, 'categories');
        if (categories.length > 0) {
          // console.log('[API] First category:', categories[0].icon);
        }
        return categories;
      },

      hasKeyword: (keyword: string) => {
        const categories = HighlightSpaceRepeatPlugin.settings?.categories || [];
        return categories.some(cat =>
          cat.keywords?.some(kw => kw.keyword === keyword)
        );
      },

      getVersion: () => {
        return this.manifest.version;
      }
    };
  }

  /**
   * Unregister all existing subject selection commands
   */
  private unregisterSubjectCommands(): void {
    // Note: Obsidian doesn't provide a direct way to unregister commands
    // Commands are stored in app.commands.commands and app.commands.editorCommands
    // We'll track IDs and clear them from the internal maps
    for (const commandId of this.subjectCommandIds) {
      // @ts-ignore - accessing internal API
      if (this.app.commands?.commands?.[commandId]) {
        // @ts-ignore
        delete this.app.commands.commands[commandId];
      }
      // @ts-ignore
      if (this.app.commands?.editorCommands?.[commandId]) {
        // @ts-ignore
        delete this.app.commands.editorCommands[commandId];
      }
    }
    this.subjectCommandIds = [];
  }

  /**
   * Register commands for selecting each subject in the matrix view
   * Creates commands like "Select Subject: Work", "Select Subject: Personal", etc.
   * This is public so it can be called when subjects are updated
   */
  async registerSubjectCommands(): Promise<void> {
    // Unregister existing commands first
    this.unregisterSubjectCommands();

    // Load subjects
    const subjectsData = await this.loadSubjects();
    if (!subjectsData || !subjectsData.subjects || subjectsData.subjects.length === 0) {
      console.log('[Keyword Highlighter] No subjects found for command registration');
      return;
    }

    // Register a command for each subject
    for (const subject of subjectsData.subjects) {
      const commandId = `select-subject-${subject.id}`;
      const commandName = `Select Subject: ${subject.icon || '📁'} ${subject.name}`;

      this.addCommand({
        id: commandId,
        name: commandName,
        callback: async () => {
          // Get or create matrix view
          const leaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);

          if (leaves.length > 0) {
            // Matrix view exists, set the subject
            const matrixView = leaves[0].view as KHMatrixWidget;
            if (matrixView && 'selectSubject' in matrixView) {
              (matrixView as any).selectSubject(subject.id);
            }
            // Reveal the view
            this.app.workspace.revealLeaf(leaves[0]);
          } else {
            // Matrix view doesn't exist, open it first then select subject
            await this.activateMatrixView();

            // Wait a bit for the view to fully load
            setTimeout(() => {
              const newLeaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);
              if (newLeaves.length > 0) {
                const matrixView = newLeaves[0].view as KHMatrixWidget;
                if (matrixView && 'selectSubject' in matrixView) {
                  (matrixView as any).selectSubject(subject.id);
                }
              }
            }, 100);
          }
        }
      });

      // Track this command ID
      this.subjectCommandIds.push(commandId);
    }

    console.log(`[Keyword Highlighter] Registered ${this.subjectCommandIds.length} subject selection commands`);
  }

  async onload(): Promise<void> {
    console.log('[Keyword Highlighter] Starting plugin load...');

    // Initialize data paths FIRST
    const { initDataPaths } = require('./shared/data-paths');
    initDataPaths(this.manifest.dir || '.obsidian/plugins/obsidian-highlight-space-repeat');

    // CRITICAL: Wait for settings to load before continuing
    await initStore(this);
    console.log('[Keyword Highlighter] Settings loaded, categories:', HighlightSpaceRepeatPlugin.settings?.categories?.length || 0);

    // Initialize SRS (Spaced Repetition System)
    console.log('[Keyword Highlighter] Initializing SRS...');
    this.srsManager = new SRSManager(this.app);
    await this.srsManager.load();
    console.log('[Keyword Highlighter] SRS initialized');

    // Register subject selection commands
    await this.registerSubjectCommands();

    this.registerEditorExtension(editorHighlighter);
    this.registerEditorExtension(recordBadgeGutter(this));
    this.registerMarkdownPostProcessor(readerHighlighter);
    this.registerMarkdownPostProcessor((el, ctx) => addRecordBadgesToReadingView(el, ctx, this));
    this.registerMarkdownPostProcessor((el, ctx) => addGoalStatusBadges(el, ctx, this, this.app));
    this.registerMarkdownPostProcessor((el, ctx) => renderSubjectDashboard(el, ctx, this));

    // Register combined keyword suggest (triggers on :::)
    this.registerEditorSuggest(new CombinedKeywordSuggest(this.app));

    // Register subkeyword suggest (triggers on //)
    this.registerEditorSuggest(new SubKeywordSuggest(this.app));

    // Register KH Matrix Widget
    this.registerView(
      KH_MATRIX_VIEW_TYPE,
      (leaf) => new KHMatrixWidget(leaf, this)
    );

    // Register Pinned View
    this.registerView(
      PINNED_VIEW_TYPE,
      (leaf) => new PinnedView(leaf, this)
    );

    // Register SRS Review View
    this.registerView(
      SRS_REVIEW_VIEW_TYPE,
      (leaf) => new SRSReviewView(leaf, this)
    );

    // Register Subject Dashboard View
    this.registerView(
      SUBJECT_DASHBOARD_VIEW_TYPE,
      (leaf) => new SubjectDashboardView(leaf, this)
    );

    this.addCommand(createInsertKeywordCommand(this.app));
    this.addCommand(createInsertSubKeywordCommand(this.app));

    // Add command to open KH Matrix Widget
    this.addCommand({
      id: 'open-kh-matrix',
      name: 'Open Topic Matrix',
      callback: () => {
        this.activateMatrixView();
      }
    });

    // Add command to toggle F/H/R expressions display in matrix
    this.addCommand({
      id: 'toggle-matrix-expressions',
      name: 'Toggle Matrix Filter Expressions',
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);
        if (leaves.length > 0) {
          const matrixView = leaves[0].view as KHMatrixWidget;
          if (matrixView && 'toggleExpressions' in matrixView) {
            (matrixView as any).toggleExpressions();
          }
        }
      }
    });

    // Add command to open Dashboard
    // Add command to open Pinned View
    this.addCommand({
      id: 'open-kh-pinned',
      name: 'Open Pinned Items',
      callback: () => {
        this.activatePinnedView();
      }
    });

    // Add command to open Subject Dashboard
    this.addCommand({
      id: 'open-subject-dashboard',
      name: 'Open Subject Dashboard',
      callback: () => {
        this.activateSubjectDashboardView();
      }
    });

    // Add command to toggle collapse/expand all in Subject Dashboard
    this.addCommand({
      id: 'dashboard-toggle-collapse-all',
      name: 'Dashboard: Toggle Collapse/Expand All',
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType(SUBJECT_DASHBOARD_VIEW_TYPE);
        if (leaves.length > 0) {
          const dashboardView = leaves[0].view as SubjectDashboardView;
          if (dashboardView && 'toggleAllFiles' in dashboardView) {
            dashboardView.toggleAllFiles();
          }
        }
      }
    });

    // Add command to start SRS review
    this.addCommand({
      id: 'srs-review-due',
      name: 'SRS: Review Due Entries',
      callback: async () => {
        const dueEntries = this.srsManager.getDueEntries(this.parsedRecords);
        await this.activateSRSReviewView(dueEntries);
      }
    });

    // Add command to review all entries
    this.addCommand({
      id: 'srs-review-all',
      name: 'SRS: Review All Entries',
      callback: async () => {
        const allEntries = this.srsManager.getAllSRSEntries(this.parsedRecords);
        await this.activateSRSReviewView(allEntries);
      }
    });

    // Add command to review current file
    this.addCommand({
      id: 'srs-review-current-file',
      name: 'SRS: Review Current File',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active file');
          return;
        }

        // Get all SRS entries for this file
        const allEntries = this.srsManager.getAllSRSEntries(this.parsedRecords);
        const allFileEntries = allEntries.filter(({ file }) => file.filePath === activeFile.path);

        if (allFileEntries.length === 0) {
          new Notice('No SRS entries found in this file.');
          return;
        }

        // Filter for due entries only
        const dueEntries = this.srsManager.getDueEntries(this.parsedRecords);
        const dueFileEntries = dueEntries.filter(({ file }) => file.filePath === activeFile.path);

        if (dueFileEntries.length === 0) {
          new Notice(`No entries due in this file. Total entries: ${allFileEntries.length}`);
          return;
        }

        // Start review session with due entries only
        await this.activateSRSReviewView(dueFileEntries);
      }
    });

    // Add command to rescan knowledge base
    this.addCommand({
      id: 'rescan-knowledge-base',
      name: 'Knowledge Base Rescan',
      callback: async () => {
        new Notice('Rescanning knowledge base...');
        await this.triggerScan();
        new Notice('Knowledge base rescan complete!');
      }
    });

    // Add command to edit current subject
    this.addCommand({
      id: 'edit-current-subject',
      name: 'Edit Current Subject',
      callback: () => {
        if (!HighlightSpaceRepeatPlugin.currentSubject) {
          new Notice('No subject selected. Open matrix view and select a subject first.');
          return;
        }

        // Find matrix view to call openSubjectEditor
        const leaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);
        if (leaves.length > 0) {
          const matrixView = leaves[0].view as KHMatrixWidget;
          if (matrixView && 'openSubjectEditor' in matrixView) {
            (matrixView as any).openSubjectEditor();
          }
        } else {
          new Notice('Matrix view not open. Open it first to edit subjects.');
        }
      }
    });

    // Add command to start SRS review of filtered records
    this.addCommand({
      id: 'srs-review-filtered',
      name: 'SRS: Review Filtered Records',
      callback: async () => {
        // Find matrix view to call startSRSReview
        const leaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);
        if (leaves.length > 0) {
          const matrixView = leaves[0].view as KHMatrixWidget;
          if (matrixView && 'startSRSReview' in matrixView) {
            await (matrixView as any).startSRSReview();
          }
        } else {
          new Notice('Matrix view not open. Open it first to use filtered SRS review.');
        }
      }
    });

    // Add ribbon icon for knowledge base rescan
    this.addRibbonIcon('refresh-cw', 'Knowledge Base Rescan', async () => {
      new Notice('Rescanning knowledge base...');
      await this.triggerScan();
      new Notice('Knowledge base rescan complete!');
    });

    // Add ribbon icon for SRS review of current file
    this.addRibbonIcon('graduation-cap', 'SRS: Review Current File', async () => {
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) {
        new Notice('No active file');
        return;
      }

      // Get all SRS entries for this file
      const allEntries = this.srsManager.getAllSRSEntries(this.parsedRecords);
      const allFileEntries = allEntries.filter(({ file }) => file.filePath === activeFile.path);

      if (allFileEntries.length === 0) {
        new Notice('No SRS entries found in this file.');
        return;
      }

      // Filter for due entries only
      const dueEntries = this.srsManager.getDueEntries(this.parsedRecords);
      const dueFileEntries = dueEntries.filter(({ file }) => file.filePath === activeFile.path);

      if (dueFileEntries.length === 0) {
        new Notice(`No entries due in this file. Total entries: ${allFileEntries.length}`);
        return;
      }

      // Start review session with due entries only
      await this.activateSRSReviewView(dueFileEntries);
    });

    // Add ribbon icon for editing current subject
    this.addRibbonIcon('settings', 'Edit Current Subject', () => {
      if (!HighlightSpaceRepeatPlugin.currentSubject) {
        new Notice('No subject selected. Open matrix view and select a subject first.');
        return;
      }

      // Find matrix view to call openSubjectEditor
      const leaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);
      if (leaves.length > 0) {
        const matrixView = leaves[0].view as KHMatrixWidget;
        if (matrixView && 'openSubjectEditor' in matrixView) {
          (matrixView as any).openSubjectEditor();
        }
      } else {
        new Notice('Matrix view not open. Open it first to edit subjects.');
      }
    });

    // Add ribbon icon for SRS review of filtered records
    this.addRibbonIcon('brain', 'SRS: Review Filtered Records', async () => {
      // Find matrix view to call startSRSReview
      const leaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);
      if (leaves.length > 0) {
        const matrixView = leaves[0].view as KHMatrixWidget;
        if (matrixView && 'startSRSReview' in matrixView) {
          await (matrixView as any).startSRSReview();
        }
      } else {
        new Notice('Matrix view not open. Open it first to use filtered SRS review.');
      }
    });

    const settingTab = new SettingTab(this.app, this);
    this.addSettingTab(settingTab);
    this.setSettingTab(settingTab);

    // Listen for file opens to auto-show records for reference files
    this.registerEvent(
      this.app.workspace.on('file-open', async (file) => {
        if (file) {
          await this.handleReferenceFileOpen(file);
        }
      })
    );
  }

  async activateMatrixView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new view in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: KH_MATRIX_VIEW_TYPE,
          active: true,
        });
      }
    }

    // Reveal the leaf
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activatePinnedView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(PINNED_VIEW_TYPE);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new view in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: PINNED_VIEW_TYPE,
          active: true,
        });
      }
    }

    // Reveal the leaf
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateSubjectDashboardView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(SUBJECT_DASHBOARD_VIEW_TYPE);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new view in main workspace area
      leaf = workspace.getLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: SUBJECT_DASHBOARD_VIEW_TYPE,
          active: true,
        });
      }
    }

    // Reveal the leaf
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateSRSReviewView(entries: Array<{ entry: any; file: any }>) {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(SRS_REVIEW_VIEW_TYPE);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new view in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: SRS_REVIEW_VIEW_TYPE,
          active: true,
        });
      }
    }

    // Reveal the leaf
    if (leaf) {
      workspace.revealLeaf(leaf);

      // Start the session
      const view = leaf.view as SRSReviewView;
      if (view && view.startSession) {
        await view.startSession(entries);
      }
    }
  }

  async onunload(): Promise<void> {
    // Clean up subject selection commands
    this.unregisterSubjectCommands();

    // Save SRS data
    if (this.srsManager) {
      await this.srsManager.save();
      console.log('[Keyword Highlighter] SRS data saved');
    }
  }

  private showErrorModal(message: string) {
    const errorModal = new Modal(this.app);
    errorModal.contentEl.createEl('h2', { text: 'Error' });
    errorModal.contentEl.createEl('p', { text: message });
    errorModal.open();
  }

  async saveSettings(): Promise<void> {
    await saveStore();
  }

  /**
   * Trigger file scan from settings tab
   * This exposes the existing scan functionality to other components
   */
  private settingTab?: SettingTab;

  setSettingTab(tab: SettingTab) {
    this.settingTab = tab;
  }

  async triggerScan(): Promise<void> {
    // If settings tab component is available, use it
    if (this.settingTab && this.settingTab.component && (this.settingTab.component as any).handleScanFiles) {
      await (this.settingTab.component as any).handleScanFiles();

      // Refresh views if open
      this.refreshPinnedView();
      this.refreshSubjectDashboard();
      await this.refreshMatrixWidget();
      return;
    }

    // Otherwise, perform scan directly
    const { RecordParser } = await import('./services/RecordParser');
    const { get } = await import('svelte/store');
    const { settingsStore } = await import('./stores/settings-store');

    const settings = get(settingsStore);
    const recordParser = new RecordParser(this.app, settings.parserSettings);

    // Get keywords that should be parsed (PARSED or SPACED status)
    const keywordsToParse: string[] = [];

    for (const category of settings.categories) {
      for (const keyword of category.keywords) {
        if (keyword.collectingStatus === 'PARSED' || keyword.collectingStatus === 'SPACED') {
          keywordsToParse.push(keyword.keyword);
        }
      }
    }

    const excludePatterns = settings.parserSettings?.excludePatterns || ['_/'];

    // Get all markdown files
    const allFiles = this.app.vault.getMarkdownFiles();

    // Filter files based on exclusion patterns
    const includedFiles: any[] = [];

    for (const file of allFiles) {
      let shouldExclude = false;

      // Check exclusion patterns
      for (const pattern of excludePatterns) {
        const normalizedPattern = pattern.replace(/\\/g, '/').replace(/\/+$/, '');
        const normalizedPath = file.path.replace(/\\/g, '/');

        if (normalizedPath.startsWith(normalizedPattern + '/') || normalizedPath === normalizedPattern) {
          shouldExclude = true;
          break;
        }
      }

      if (!shouldExclude) {
        includedFiles.push(file);
      }
    }

    // Parse files and store in RAM
    this.parsedRecords = [];
    for (const file of includedFiles) {
      const parsed = await recordParser.parseFile(file, keywordsToParse);
      this.parsedRecords.push(parsed);
    }

    // Refresh views if open
    this.refreshPinnedView();
    this.refreshSubjectDashboard();
    this.refreshMatrixWidget();
  }

  /**
   * Refresh Pinned View if it's currently open
   */
  private refreshPinnedView(): void {
    const leaves = this.app.workspace.getLeavesOfType(PINNED_VIEW_TYPE);
    if (leaves.length > 0) {
      const pinnedView = leaves[0].view as PinnedView;
      if (pinnedView && 'render' in pinnedView && typeof (pinnedView as any).render === 'function') {
        (pinnedView as any).render();
        console.log('[Knowledge Base Rescan] Refreshed Pinned View');
      }
    }
  }


  /**
   * Refresh Subject Dashboard View if it's currently open
   */
  private refreshSubjectDashboard(): void {
    const leaves = this.app.workspace.getLeavesOfType(SUBJECT_DASHBOARD_VIEW_TYPE);
    if (leaves.length > 0) {
      const dashboardView = leaves[0].view as SubjectDashboardView;
      if (dashboardView && 'render' in dashboardView && typeof (dashboardView as any).render === 'function') {
        (dashboardView as any).render();
        console.log('[Knowledge Base Rescan] Refreshed Subject Dashboard View');
      }
    }
  }

  /**
   * Refresh Matrix Widget if it's currently open
   */
  private async refreshMatrixWidget(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(KH_MATRIX_VIEW_TYPE);
    if (leaves.length > 0) {
      const matrixWidget = leaves[0].view as KHMatrixWidget;
      if (matrixWidget && 'recalculateMatrixCounts' in matrixWidget && typeof (matrixWidget as any).recalculateMatrixCounts === 'function') {
        await (matrixWidget as any).recalculateMatrixCounts();
        console.log('[Knowledge Base Rescan] Refreshed Matrix Widget counts');
      }
    }
  }

  // Override loadData to use keyword.json
  async loadData(): Promise<PluginSettings | null> {
    try {
      const data = await this.app.vault.adapter.read(DATA_PATHS.KEYWORD);
      return JSON.parse(data);
    } catch (error) {
      // File doesn't exist or can't be read, return null
      return null;
    }
  }

  // Override saveData to use keyword.json
  async saveData(data: PluginSettings): Promise<void> {
    await this.app.vault.adapter.write(DATA_PATHS.KEYWORD, JSON.stringify(data, null, 2));
  }

  // Load settings from settings.json
  async loadSettingsData(): Promise<Settings | null> {
    try {
      const data = await this.app.vault.adapter.read(DATA_PATHS.SETTINGS);
      return JSON.parse(data);
    } catch (error) {
      // File doesn't exist or can't be read, return null
      return null;
    }
  }

  // Save settings to settings.json
  async saveSettingsData(data: Settings): Promise<void> {
    await this.app.vault.adapter.write(DATA_PATHS.SETTINGS, JSON.stringify(data, null, 2));
  }

  // Load code blocks from codeblocks.json
  async loadCodeBlocks(): Promise<CodeBlockLanguage[] | null> {
    try {
      const data = await this.app.vault.adapter.read(DATA_PATHS.CODEBLOCKS);
      return JSON.parse(data);
    } catch (error) {
      console.log('[Plugin] No codeblocks file found, using defaults');
      return null;
    }
  }

  // Save code blocks to codeblocks.json
  async saveCodeBlocks(data: CodeBlockLanguage[]): Promise<void> {
    await this.app.vault.adapter.write(DATA_PATHS.CODEBLOCKS, JSON.stringify(data, null, 2));
  }

  // Load VWord settings from vword-settings.json
  async loadVWordSettings(): Promise<VWordSettings | null> {
    try {
      const data = await this.app.vault.adapter.read(DATA_PATHS.VWORD_SETTINGS);
      return JSON.parse(data);
    } catch (error) {
      console.log('[Plugin] No VWord settings file found, using defaults');
      return null;
    }
  }

  // Save VWord settings to vword-settings.json
  async saveVWordSettings(data: VWordSettings): Promise<void> {
    await this.app.vault.adapter.write(DATA_PATHS.VWORD_SETTINGS, JSON.stringify(data, null, 2));
  }

  // Load subjects and topics from subjects.json
  async loadSubjects(): Promise<SubjectsData | null> {
    try {
      const data = await this.app.vault.adapter.read(DATA_PATHS.SUBJECTS);
      return JSON.parse(data);
    } catch (error) {
      console.log('[Plugin] No subjects file found or error reading:', error);
      return null;
    }
  }

  // Save subjects and topics to subjects.json
  async saveSubjects(data: SubjectsData): Promise<void> {
    // Count topics from nested structure
    let topicsCount = 0;
    data.subjects.forEach(s => {
      topicsCount += (s.primaryTopics?.length || 0) + (s.secondaryTopics?.length || 0);
    });

    console.log('[Plugin.saveSubjects] Writing to file:', DATA_PATHS.SUBJECTS, {
      subjectsCount: data.subjects.length,
      topicsCount
    });
    await this.app.vault.adapter.write(DATA_PATHS.SUBJECTS, JSON.stringify(data, null, 2));
    console.log('[Plugin.saveSubjects] Write completed successfully');
  }

  // Handle opening reference files - auto-show records for that keyword
  async handleReferenceFileOpen(_file: any): Promise<void> {
    // Note: Grid view has been removed from the plugin
    // This method is kept for backward compatibility but no longer does anything
    return;
  }

}
