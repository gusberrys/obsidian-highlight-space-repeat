import { Plugin, Modal, WorkspaceLeaf, Notice, TFile, MarkdownView } from 'obsidian';
import { editorHighlighter, recordBadgeGutter } from 'src/editor-extension';
import { SettingTab } from 'src/settings/setting-tab';
import { readerHighlighter, addRecordBadgesToReadingView, addGoalStatusBadges } from './reader-extension';
import { createInsertKeywordCommand, insertColorCommand } from './commands';
import { initStore, saveStore, settingsStore, type PluginSettings, type Settings, type MergedSettings } from './stores/settings-store';
import { get } from 'svelte/store';
import { PATHS, type VWordSettings } from './shared';
import { HighlightSpaceRepeatAPI } from './public-api';
import { SRSReviewView, SRS_REVIEW_VIEW_TYPE } from './widgets/SRSReviewView';
import { RecordsViewWidget, RECORDS_VIEW_TYPE } from './widgets/RecordsViewWidget';
import { SRSManager } from './services/SRSManager';

export class HighlightSpaceRepeatPlugin extends Plugin {
  static settings: MergedSettings;

  // SRS (Spaced Repetition System) manager
  public srsManager!: SRSManager;

  // Parsed records cache (in RAM only)
  public parsedRecords: any[] = [];

  // Public API instance
  private _api!: HighlightSpaceRepeatAPI;

  // Simple data adapter wrapper
  private adapter = {
    read: async (path: string): Promise<string> => {
      return await this.app.vault.adapter.read(`${this.manifest.dir}/${path}`);
    },
    write: async (path: string, data: string): Promise<void> => {
      await this.app.vault.adapter.write(`${this.manifest.dir}/${path}`, data);
    }
  };

  /**
   * Public API for external plugins to access highlight space repeat functionality
   * Access via: app.plugins.plugins['obsidian-highlight-space-repeat'].api
   */
  public get api(): HighlightSpaceRepeatAPI {
    return this._api;
  }


  async onload(): Promise<void> {
    // CRITICAL: Wait for settings to load before continuing
    await initStore(this);

    // Apply color highlighting enabled state
    const settings = get(settingsStore);
    if (settings.colorHighlightingEnabled) {
      document.body.addClass('cc-enabled');
    }

    // Initialize public API
    this._api = new HighlightSpaceRepeatAPI(this);

    // Initialize SRS (Spaced Repetition System)
    this.srsManager = new SRSManager(this.app);
    await this.srsManager.load();

    this.registerEditorExtension(editorHighlighter);
    this.registerEditorExtension(recordBadgeGutter(this));
    this.registerMarkdownPostProcessor(readerHighlighter);
    this.registerMarkdownPostProcessor((el, ctx) => addRecordBadgesToReadingView(el, ctx, this));
    this.registerMarkdownPostProcessor((el, ctx) => addGoalStatusBadges(el, ctx, this, this.app));


    // Register SRS Review View
    this.registerView(
      SRS_REVIEW_VIEW_TYPE,
      (leaf) => new SRSReviewView(leaf, this)
    );

    // Register Records View Widget
    this.registerView(
      RECORDS_VIEW_TYPE,
      (leaf) => new RecordsViewWidget(leaf, this)
    );

    // Add command to insert keyword
    this.addCommand(createInsertKeywordCommand(this.app));

    // Color highlighting commands
    this.addCommand({
      id: 'insert-color',
      name: 'Insert colour',
      editorCallback: insertColorCommand(this)
    });

    this.addCommand({
      id: 'toggle-color-highlights',
      name: 'Toggle colour highlights',
      callback: () => {
        const settings = get(settingsStore);
        settings.colorHighlightingEnabled = !settings.colorHighlightingEnabled;
        settingsStore.set(settings);

        // Toggle body class - CSS handles the rest
        if (settings.colorHighlightingEnabled) {
          document.body.addClass('cc-enabled');
        } else {
          document.body.removeClass('cc-enabled');
        }

        new Notice(settings.colorHighlightingEnabled ? '✅ Colour highlights enabled' : '❌ Colour highlights disabled');
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

    // Add command to open Records View
    this.addCommand({
      id: 'open-records-view',
      name: 'Open Records View',
      callback: async () => {
        await this.activateRecordsView();
      }
    });

    // Add command to reload/refresh current file
    this.addCommand({
      id: 'reload-current-file',
      name: 'Reload Current File',
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.file) {
          const file = view.file;
          const allFiles = this.app.vault.getMarkdownFiles();
          const otherFile = allFiles.find(f => f.path !== file.path);

          const leaf = view.leaf;
          if (leaf && otherFile) {
            await leaf.openFile(otherFile);
            setTimeout(async () => {
              await leaf.openFile(file);
              new Notice('File reloaded');
            }, 100);
          } else if (leaf) {
            leaf.detach();
            await this.app.workspace.getLeaf(true).openFile(file);
            new Notice('File reloaded');
          }
        } else {
          new Notice('No active markdown file to reload');
        }
      }
    });

    // Add debug command to parse current file and show entries
    this.addCommand({
      id: 'debug-parse-current-file',
      name: 'Debug: Parse Current File',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active file');
          return;
        }

        const { RecordParser } = await import('./services/RecordParser');
        const { get } = await import('svelte/store');
        const { keywordsStore, settingsStore } = await import('./stores/settings-store');

        const keywords = get(keywordsStore);
        const settings = get(settingsStore);
        const recordParser = new RecordParser(this.app, settings.parserSettings);

        // Get keywords that should be parsed
        const keywordsToParse: string[] = [];
        for (const category of keywords.categories) {
          for (const keyword of category.keywords) {
            if (keyword.collectingStatus === 'PARSED' || keyword.collectingStatus === 'SPACED') {
              keywordsToParse.push(keyword.keyword);
            }
          }
        }

        // Parse the file
        const parsed = await recordParser.parseFile(activeFile, keywordsToParse);

        // Get flat entries
        const flatEntries = parsed.entries;

        // Log to console with nice formatting
        console.log('=== PARSED FILE DEBUG ===');
        console.log('File:', activeFile.path);
        console.log('Total entries:', flatEntries.length);
        console.log('\n--- FLAT ENTRIES ---');
        flatEntries.forEach((entry, index) => {
          console.log(`\n[${index}] Line ${entry.lineNumber}:`);
          console.log('  Type:', entry.type);
          console.log('  Keywords:', entry.keywords);
          console.log('  Inline Keywords:', entry.inlineKeywords);
          console.log('  Inline Code Langs:', entry.inlineCodeLanguages);
          console.log('  Text:', entry.text.substring(0, 100) + (entry.text.length > 100 ? '...' : ''));
          if (entry.subItems && entry.subItems.length > 0) {
            console.log('  Sub-items:', entry.subItems.length);
            entry.subItems.forEach((subItem, subIndex) => {
              console.log(`    [${subIndex}]`, {
                keywords: subItem.keywords,
                inlineKeywords: subItem.inlineKeywords,
                inlineCodeLanguages: subItem.inlineCodeLanguages,
                content: subItem.content.substring(0, 50) + (subItem.content.length > 50 ? '...' : '')
              });
            });
          }
        });

        new Notice(`Parsed ${flatEntries.length} entries. Check console (Ctrl+Shift+I)`);
      }
    });


    // Add ribbon icon for knowledge base rescan
    this.addRibbonIcon('refresh-cw', 'Knowledge Base Rescan', async () => {
      new Notice('Rescanning knowledge base...');
      await this.triggerScan();
      new Notice('Knowledge base rescan complete!');
    });

    // Add ribbon icon for Records View
    this.addRibbonIcon('list-filter', 'Open Records View', async () => {
      await this.activateRecordsView();
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

    // Color highlighting toggle ribbon
    this.addRibbonIcon('palette', 'Toggle colour highlights', () => {
      const settings = get(settingsStore);
      settings.colorHighlightingEnabled = !settings.colorHighlightingEnabled;
      settingsStore.set(settings);

      // Toggle body class
      if (settings.colorHighlightingEnabled) {
        document.body.addClass('cc-enabled');
      } else {
        document.body.removeClass('cc-enabled');
      }

      // Refresh view to apply changes immediately
      const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      markdownView?.previewMode.rerender(true);

      new Notice(settings.colorHighlightingEnabled ? '✅ Colour highlights enabled' : '❌ Colour highlights disabled');
    });

    // SRS: Review Filtered Records - Will be added back when RecordsViewWidget is created

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

  async activateRecordsView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(RECORDS_VIEW_TYPE);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new view in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: RECORDS_VIEW_TYPE,
          active: true,
        });
      }
    }

    // Reveal the leaf
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async onunload(): Promise<void> {
    // Save SRS data
    if (this.srsManager) {
      await this.srsManager.save();
    }

    // Remove color highlighting class
    document.body.removeClass('cc-enabled');
  }

  private showErrorModal(message: string) {
    const errorModal = new Modal(this.app);
    errorModal.contentEl.createEl('h2', { text: 'Error' });
    errorModal.contentEl.createEl('p', { text: message });
    errorModal.open();
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
      return;
    }

    // Otherwise, perform scan directly
    const { RecordParser } = await import('./services/RecordParser');
    const { get } = await import('svelte/store');
    const { keywordsStore, settingsStore } = await import('./stores/settings-store');

    const keywords = get(keywordsStore);
    const settings = get(settingsStore);
    const recordParser = new RecordParser(this.app, settings.parserSettings);

    // Get keywords that should be parsed (PARSED or SPACED status)
    const keywordsToParse: string[] = [];

    for (const category of keywords.categories) {
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

    // Notify API subscribers that records have changed (matrix/pinned refresh removed)
    if (this._api) {
      this._api.notifyRecordsChanged();
    }
  }


  // Load keywords from app-data/keywords.json
  async loadKeywords(): Promise<any> {
    try {
      const data = await this.adapter.read(PATHS.KEYWORDS);
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  // Save keywords to app-data/keywords.json
  async saveKeywords(data: any): Promise<void> {
    await this.adapter.write(PATHS.KEYWORDS, JSON.stringify(data, null, 2));
  }

  // Load color highlights from app-data/color-highlights.json
  async loadColorHighlights(): Promise<any> {
    try {
      const data = await this.adapter.read(PATHS.COLOR_HIGHLIGHTS);
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  // Save color highlights to app-data/color-highlights.json
  async saveColorHighlights(data: any): Promise<void> {
    await this.adapter.write(PATHS.COLOR_HIGHLIGHTS, JSON.stringify(data, null, 2));
  }

  // Public API method (no-op, grid view removed)
  async handleReferenceFileOpen(_file: any): Promise<void> {
    return;
  }

}
