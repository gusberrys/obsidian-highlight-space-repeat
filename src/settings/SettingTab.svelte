<script lang="ts">
  import type { KeywordStyle, Category } from 'src/shared';
  import { isCollected, isSpaced } from 'src/shared/collecting-status';
  import KeywordSetting from './KeywordSetting.svelte';
  import type { Writable } from 'svelte/store';
  import {
    addKeyword, removeKeyword, addCategory, removeCategory,
    settingsStore as store, type PluginSettings, saveStore,
    settingsDataStore, saveSettingsData,
    codeBlocksStore, saveCodeBlocks,
    vwordSettingsStore, saveVWordSettings,
    updateCategoryClass,
    subjectsStore,
    addSubject, removeSubject, updateSubject,
    addTopic, removeTopic, updateTopic, addPrimaryTopic, addSecondaryTopic,
  } from 'src/stores/settings-store';
  import { setIcon, Notice, TFile } from 'obsidian';
  import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
  import { RecordParser } from 'src/services/RecordParser';
  import { FilterParser } from 'src/services/FilterParser';
  import type { ParserScanResult } from 'src/interfaces/ParserSettings';
  import type { ParsedRecord } from 'src/interfaces/ParsedRecord';
  import { SubjectModal } from './SubjectModal';
  import { DATA_PATHS } from 'src/shared/data-paths';
  import { addSRSSettings } from './SRSSettings';

  export let settingsStore: Writable<PluginSettings>;
  export let plugin: HighlightSpaceRepeatPlugin;

  // File scanner state
  let isScanning = false;
  let scanResult: ParserScanResult | null = null;
  let showExcludedFiles = false;

  // Filter testing state
  let filterExpression = '';
  let filterResult: {
    totalRecords: number;
    keywordBreakdown: Record<string, number>;
    previewRecords: Array<{
      keyword: string;
      text: string;
      filePath: string;
      lineNumber?: number;
      subItems?: Array<{
        text: string;
        keywords?: string[];
      }>;
    }>;
  } | null = null;
  let isTestingFilter = false;

  $: categories = $settingsStore.categories;


  // Get all available keywords from categories
  $: availableKeywords = categories.flatMap(cat =>
    cat.keywords.map(kw => ({
      keyword: kw.keyword,
      icon: kw.generateIcon,
      color: kw.color,
      backgroundColor: kw.backgroundColor
    }))
  );

  // Create a map for keyword styles lookup
  $: keywordStylesMap = (() => {
    const map = new Map();
    $settingsStore.categories.forEach(cat => {
      cat.keywords.forEach(kw => {
        if (kw.keyword) {
          map.set(kw.keyword, kw);
        }
      });
    });
    return map;
  })();

  // eslint-disable-next-line no-undef
  let ref: HTMLElement;
  let newCategoryName = '';
  let newGroupName = '';
  let selectedKeywordByGroup: { [key: string]: string } = {};
  let keywordSearchByGroup: { [key: string]: string } = {};
  let showDropdownForGroup: { [key: string]: boolean } = {};
  let collapsedCategories: Set<string> = new Set();
  let collapsedGroups: Set<string> = new Set();

  // Tab state
  let activeTab: 'keywords' | 'cBlocks' | 'vword' | 'parser' | 'subjects' | 'generic' | 'filters' | 'srs' = 'keywords';

  // SRS container reference
  let srsContainer: HTMLElement;

  // Mount SRS settings when SRS tab is active
  $: if (activeTab === 'srs' && srsContainer) {
    srsContainer.empty();
    addSRSSettings(srsContainer, plugin);
  }

  // Initialize collapsed categories with all category names when component loads
  $: if (categories.length > 0 && collapsedCategories.size === 0) {
    collapsedCategories = new Set(categories.map(cat => cat.icon));
  }
  let editingCategoryName: string | null = null;
  let editedCategoryName = '';
  let editedCategoryId = '';

  let editingGroupName: string | null = null;
  let editedGroupName = '';

  // Keyword mover state
  let selectedKeywordToMove = '';
  let selectedTargetCategory = '';

  // Highlight toggle states - radio behavior (only one can be selected)
  let highlightMode: 'parsed' | 'none' = 'parsed';

  // Keyword search filter
  let keywordSearchFilter = '';

  // Function to check if a keyword matches the search filter
  function keywordMatchesFilter(keyword: KeywordStyle): boolean {
    if (!keywordSearchFilter.trim()) return true;

    const searchLower = keywordSearchFilter.toLowerCase();
    const matchKeyword = keyword.keyword.toLowerCase().includes(searchLower);
    const matchDescription = keyword.description?.toLowerCase().includes(searchLower) || false;
    const matchIcon = keyword.generateIcon?.toLowerCase().includes(searchLower) || false;

    return matchKeyword || matchDescription || matchIcon;
  }

  // Get filtered keywords for a category
  function getFilteredKeywords(category: Category): KeywordStyle[] {
    return category.keywords.filter(kw => keywordMatchesFilter(kw));
  }

  // Reactive filtered categories with their filtered keywords
  // Explicitly reference keywordSearchFilter to track changes
  $: categoriesWithFilteredKeywords = categories.map(cat => {
    // Access keywordSearchFilter here to ensure Svelte tracks it
    const searchFilter = keywordSearchFilter;
    return {
      category: cat,
      filteredKeywords: cat.keywords.filter(kw => {
        if (!searchFilter.trim()) return true;
        const searchLower = searchFilter.toLowerCase();
        const matchKeyword = kw.keyword.toLowerCase().includes(searchLower);
        const matchDescription = kw.description?.toLowerCase().includes(searchLower) || false;
        const matchIcon = kw.generateIcon?.toLowerCase().includes(searchLower) || false;
        return matchKeyword || matchDescription || matchIcon;
      })
    };
  });

  // Statistics - reactive computed values
  $: totalKeywords = categories.reduce((sum, cat) => sum + cat.keywords.length, 0);

  // Parsed/collected to records
  $: isParsedCount = categories.reduce((sum, cat) =>
    sum + cat.keywords.filter(kw => isCollected(kw.collectingStatus)).length, 0);

  // Get first 5 keywords with icons for collected keywords
  $: parsedKeywords = categories
    .flatMap(cat => cat.keywords)
    .filter(kw => isCollected(kw.collectingStatus) && kw.generateIcon && kw.generateIcon.trim())
    .slice(0, 5);

  // Keyword reference files count
  let foundReferenceFilesCount = 0;
  let totalKeywordsForReference = 0;

  // Scan for keyword reference files
  async function scanForReferenceFiles() {
    const referencePath = $settingsDataStore.keywordDescriptionsPath;
    if (!referencePath || !referencePath.trim()) {
      foundReferenceFilesCount = 0;
      totalKeywordsForReference = 0;
      return;
    }

    // Get all unique keywords from categories
    const allKeywords = categories
      .flatMap(cat => cat.keywords)
      .map(kw => kw.keyword)
      .filter(k => k);

    const uniqueKeywords = [...new Set(allKeywords)];
    totalKeywordsForReference = uniqueKeywords.length;

    // Count how many reference files exist
    let foundCount = 0;
    for (const keyword of uniqueKeywords) {
      const filePath = referencePath.endsWith('/')
        ? `${referencePath}${keyword}.md`
        : `${referencePath}/${keyword}.md`;

      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (file) {
        foundCount++;
      }
    }

    foundReferenceFilesCount = foundCount;
  }

  // Reactive: scan for reference files when path or categories change
  $: if ($settingsDataStore.keywordDescriptionsPath !== undefined) {
    scanForReferenceFiles();
  }
  $: if (categories) {
    scanForReferenceFiles();
  }

  function handleAddKeyword(categoryName: string) {
    addKeyword('', categoryName, ref);
  }

  function handleRemoveKeyword(keyword: KeywordStyle) {
    removeKeyword(keyword);
  }

  function handleKeywordReorder(categoryName: string, draggedIndex: number, targetIndex: number) {
    if (draggedIndex === targetIndex) return;

    settingsStore.update(settings => {
      const category = settings.categories.find(cat => cat.icon === categoryName);
      if (!category) return settings;

      const draggedKeyword = category.keywords[draggedIndex];

      // Remove from old position
      category.keywords.splice(draggedIndex, 1);

      // Insert at new position
      category.keywords.splice(targetIndex, 0, draggedKeyword);

      // Create new array reference to trigger reactivity
      category.keywords = [...category.keywords];

      return settings;
    });
  }

  // Get all keywords with their category info
  function getAllKeywordsWithCategories(): Array<{ keyword: string; categoryName: string; keywordObj: KeywordStyle }> {
    const result: Array<{ keyword: string; categoryName: string; keywordObj: KeywordStyle }> = [];
    categories.forEach(cat => {
      cat.keywords.forEach(kw => {
        result.push({
          keyword: kw.keyword,
          categoryName: cat.icon,
          keywordObj: kw
        });
      });
    });
    return result;
  }

  function handleMoveKeyword() {
    if (!selectedKeywordToMove || !selectedTargetCategory) return;

    settingsStore.update(settings => {
      // Find the keyword and its current category
      let fromCategory: Category | undefined;
      let keywordIndex = -1;
      let keywordToMove: KeywordStyle | undefined;

      for (const cat of settings.categories) {
        const idx = cat.keywords.findIndex(kw => kw.keyword === selectedKeywordToMove);
        if (idx > -1) {
          fromCategory = cat;
          keywordIndex = idx;
          keywordToMove = cat.keywords[idx];
          break;
        }
      }

      if (!fromCategory || !keywordToMove || keywordIndex === -1) return settings;

      const toCategory = settings.categories.find(cat => cat.icon === selectedTargetCategory);
      if (!toCategory || fromCategory === toCategory) return settings;

      // Remove keyword from source category
      fromCategory.keywords.splice(keywordIndex, 1);

      // Add to destination category
      toCategory.keywords.push(keywordToMove);

      // Trigger reactivity
      fromCategory.keywords = [...fromCategory.keywords];
      toCategory.keywords = [...toCategory.keywords];

      // Reset selections
      selectedKeywordToMove = '';
      selectedTargetCategory = '';

      return settings;
    });
  }

  async function handleGenerateKeywordsReference() {
    const fileName = $settingsDataStore.keywordsDashboardFileName;
    if (!fileName || !fileName.trim()) {
      return;
    }

    // Ensure .md extension
    const filePath = fileName.endsWith('.md') ? fileName : `${fileName}.md`;

    // Build markdown content
    let content = '# keywords\n\n';

    // Iterate through each category
    categories.forEach(category => {
      // First-level list item for category in bold
      content += `- **${category.icon}**:\n`;

      // Second-level list for each keyword in category (indented with 4 spaces)
      category.keywords.forEach(keyword => {
        if (keyword.keyword && keyword.keyword.trim()) {
          // Get all keyword names (comma-separated)
          const keywordName = keyword.keyword;

          // Build mark example
          const markExample = `<mark class="${keywordName}"> ${keywordName} </mark>`;

          // Add the line: keyword :: name  <mark>example</mark>
          content += `    - ${keywordName} :: ${keywordName}  ${markExample}\n`;
        }
      });

      content += '\n';
    });

    // Write the file using Obsidian's vault API
    try {
      const file = plugin.app.vault.getAbstractFileByPath(filePath);

      if (file instanceof TFile) {
        // File exists, modify it
        const existingContent = await plugin.app.vault.read(file);

        // Find the "keywords" header and replace everything after it
        const headerMatch = existingContent.match(/^#+ keywords$/im);

        if (headerMatch && headerMatch.index !== undefined) {
          // Replace from header onwards
          const beforeHeader = existingContent.substring(0, headerMatch.index);
          await plugin.app.vault.modify(file, beforeHeader + content);
        } else {
          // Header not found, append to file
          await plugin.app.vault.modify(file, existingContent + '\n\n' + content);
        }
      } else {
        // File doesn't exist, create it
        await plugin.app.vault.create(filePath, content);
      }

      // Show success notification
      new Notice('Keywords reference file generated successfully!');
    } catch (error) {
      console.error('Error generating keywords reference file:', error);
      new Notice('Error generating keywords reference file. Check console for details.');
    }
  }

  function handleAddCategory() {
    if (newCategoryName.trim()) {
      addCategory(newCategoryName.trim());
      newCategoryName = '';
    }
  }

  function handleRemoveCategory(categoryName: string) {
    removeCategory(categoryName);
  }

  function toggleCategory(categoryName: string) {
    if (collapsedCategories.has(categoryName)) {
      collapsedCategories.delete(categoryName);
    } else {
      collapsedCategories.add(categoryName);
    }
    collapsedCategories = collapsedCategories;
  }

  function startEditingCategory(categoryName: string) {
    const category = categories.find(cat => cat.icon === categoryName);
    editingCategoryName = categoryName;
    editedCategoryName = categoryName;
    editedCategoryId = category?.id || '';
  }

  function saveEditedCategory() {
    if (editingCategoryName) {
      const currentCategory = categories.find(cat => cat.icon === editingCategoryName);
      const hasChanges = (editedCategoryName.trim() !== editingCategoryName) ||
                        (editedCategoryId.trim() !== (currentCategory?.id || ''));

      if (hasChanges && editedCategoryName.trim()) {
        settingsStore.update((settings) => {
          const category = settings.categories.find(cat => cat.icon === editingCategoryName);
          if (category) {
            category.icon = editedCategoryName.trim();
            category.id = editedCategoryId.trim() || undefined;
          }
          return settings;
        });
      }
    }
    editingCategoryName = null;
    editedCategoryName = '';
    editedCategoryId = '';
  }

  function cancelEditingCategory() {
    editingCategoryName = null;
    editedCategoryName = '';
    editedCategoryId = '';
  }

  // Keyword Group handlers
  function startEditingGroup(groupName: string) {
    editingGroupName = groupName;
    editedGroupName = groupName;
  }

  async function saveEditedGroup() {
    if (editingGroupName && editedGroupName.trim() && editedGroupName.trim() !== editingGroupName) {
      settingsDataStore.update((settings) => {
        const group = settings.keywordGroups.find(g => g.name === editingGroupName);
        if (group) {
          group.name = editedGroupName.trim();
        }
        return settings;
      });
      await saveSettingsData();
    }
    editingGroupName = null;
    editedGroupName = '';
  }

  function cancelEditingGroup() {
    editingGroupName = null;
    editedGroupName = '';
  }

  async function handleAddKeywordGroup() {
    if (newGroupName.trim()) {
      addKeywordGroup(newGroupName.trim());
      await saveSettingsData();
      newGroupName = '';
    }
  }

  async function handleRemoveKeywordGroup(groupName: string) {
    removeKeywordGroup(groupName);
    await saveSettingsData();
  }

  async function handleAddKeywordToGroup(groupName: string) {
    const keyword = selectedKeywordByGroup[groupName];
    if (keyword && keyword !== '') {
      addKeywordToGroup(groupName, keyword);
      await saveSettingsData();
      selectedKeywordByGroup[groupName] = '';
      keywordSearchByGroup[groupName] = '';
      showDropdownForGroup[groupName] = false;
    }
  }

  function selectKeywordForGroup(groupName: string, keyword: string) {
    selectedKeywordByGroup[groupName] = keyword;
    keywordSearchByGroup[groupName] = keyword;
    showDropdownForGroup[groupName] = false;
  }

  function handleKeywordSearchInput(groupName: string) {
    showDropdownForGroup[groupName] = true;
    selectedKeywordByGroup[groupName] = '';
  }

  function handleKeywordSearchBlur(groupName: string) {
    // Delay to allow click on dropdown item
    setTimeout(() => {
      showDropdownForGroup[groupName] = false;
    }, 200);
  }

  // Get all unique keywords (expand comma-separated ones) + combined keywords (per category)
  function getAllUniqueKeywords(): string[] {
    const keywords = new Set<string>();
    const currentCategories = $settingsStore.categories;

    // For each category, generate individual keywords AND combinations within that category
    currentCategories.forEach(cat => {
      const combinableInCategory: string[] = [];
      const uncombinableInCategory: string[] = [];

      // Collect keywords from this category only
      cat.keywords.forEach(kwDef => {
        if (kwDef.keyword) {
          keywords.add(kwDef.keyword);
        }
      });

      // Combinable feature removed - no combination generation
    });

    return Array.from(keywords).sort();
  }

  // Get available keywords for a group (not already in the group)
  function getAvailableKeywordsForGroup(groupName: string): string[] {
    const group = keywordGroups.find(g => g.name === groupName);
    const groupKeywords = group ? new Set(group.keywords) : new Set();
    return getAllUniqueKeywords().filter(kw => !groupKeywords.has(kw));
  }

  // Filter keywords based on search
  function getFilteredKeywordsForGroup(groupName: string): string[] {
    const available = getAvailableKeywordsForGroup(groupName);
    const search = keywordSearchByGroup[groupName]?.toLowerCase() || '';
    if (!search) return available; // Show all when no search
    return available.filter(kw => kw.toLowerCase().includes(search));
  }

  // Get keyword style for display
  function getKeywordStyle(keyword: string) {
    // Try exact match first
    let style = keywordStylesMap.get(keyword);

    // If not found and it's a combined keyword (e.g., "goa :: def"), merge styles
    if (!style && keyword.includes(' :: ')) {
      const parts = keyword.split(' :: ').map(p => p.trim()).filter(p => p);

      if (parts.length === 2) {
        const firstKeyword = parts[0];
        const secondKeyword = parts[1];

        const firstStyle = keywordStylesMap.get(firstKeyword);
        const secondStyle = keywordStylesMap.get(secondKeyword);

        // Priority-based combination logic
        if (firstStyle && secondStyle) {
          const hasStylesPriority = firstStyle.hasStylesPriority ?? false;
          const hasIconPriority = firstStyle.hasIconPriority ?? false;

          // If first keyword has no priorities set (both false), use second keyword for everything
          if (!hasStylesPriority && !hasIconPriority) {
            style = secondStyle;
          }
          // If both priorities are set, use first keyword for everything
          else if (hasStylesPriority && hasIconPriority) {
            style = firstStyle;
          }
          // If only styles priority is set, use first keyword's styles and second's icon
          else if (hasStylesPriority && !hasIconPriority) {
            style = {
              ...firstStyle,
              generateIcon: secondStyle.generateIcon || firstStyle.generateIcon
            };
          }
          // If only icon priority is set, use second keyword's styles and first's icon
          else if (!hasStylesPriority && hasIconPriority) {
            style = {
              ...secondStyle,
              generateIcon: firstStyle.generateIcon || secondStyle.generateIcon
            };
          }
        } else if (firstStyle) {
          // Only first style available - use it
          style = firstStyle;
        } else if (secondStyle) {
          // Only second style available - use it
          style = secondStyle;
        }
      }
    }

    return style;
  }

  async function handleRemoveKeywordFromGroup(groupName: string, keyword: string) {
    removeKeywordFromGroup(groupName, keyword);
    await saveSettingsData();
  }

  function toggleGroup(groupName: string) {
    if (collapsedGroups.has(groupName)) {
      collapsedGroups.delete(groupName);
    } else {
      collapsedGroups.add(groupName);
    }
    collapsedGroups = collapsedGroups;
  }

  // Subjects handlers - Modal-based
  function openNewSubjectModal() {
    const modal = new SubjectModal(plugin.app, plugin, null, async (subject) => {
      // Subject and topics are already saved by the modal
      // Just trigger a re-render by updating the store reference
      settingsStore.set($settingsStore);
    });
    modal.open();
  }

  function openEditSubjectModal(index: number) {
    const subject = $subjectsStore.subjects![index];
    const modal = new SubjectModal(plugin.app, plugin, subject, async (updatedSubject) => {
      // Subject and topics are already saved by the modal
      // Just trigger a re-render by updating the store reference
      settingsStore.set($settingsStore);
    });
    modal.open();
  }

  async function handleDeleteSubject(index: number) {
    const subject = $subjectsStore.subjects![index];

    // Remove subject
    $subjectsStore.subjects!.splice(index, 1);

    // Remove all topics for this subject
    if ($subjectsStore.topics) {
      $subjectsStore.topics = $subjectsStore.topics.filter(t => t.subjectId !== subject.id);
    }

    await saveStore();
  }

  function getKeywordIndex(categoryIndex: number, keywordIndex: number): number {
    let totalIndex = 0;
    for (let i = 0; i < categoryIndex; i++) {
      totalIndex += categories[i].keywords.length;
    }
    return totalIndex + keywordIndex + 1;
  }

  // eslint-disable-next-line no-undef
  function useIcon(node: HTMLElement, icon: string) {
    setIcon(node, icon);
    return {
      update(icon: string) {
        setIcon(node, icon);
      },
    };
  }

  // Get all tags from vault
  function getAllTags(): string[] {
    if (!plugin?.app?.vault || !plugin?.app?.metadataCache) {
      return [];
    }

    try {
      const allFiles = plugin.app.vault.getMarkdownFiles();
      const tagsSet = new Set<string>();

      for (const file of allFiles) {
        const cache = plugin.app.metadataCache.getFileCache(file);

        // Get tags from body
        if (cache?.tags) {
          cache.tags.forEach(t => {
            const tag = t.tag.startsWith('#') ? t.tag : `#${t.tag}`;
            tagsSet.add(tag);
          });
        }

        // Get tags from frontmatter
        if (cache?.frontmatter?.tags) {
          const frontmatterTags = Array.isArray(cache.frontmatter.tags)
            ? cache.frontmatter.tags
            : [cache.frontmatter.tags];
          frontmatterTags.forEach((tag: string) => {
            const tagWithHash = tag.startsWith('#') ? tag : `#${tag}`;
            tagsSet.add(tagWithHash);
          });
        }
      }

      return Array.from(tagsSet).sort();
    } catch (error) {
      console.error('Error getting all tags:', error);
      return [];
    }
  }

  // Count files with a specific tag
  function getTagCount(tag: string): number {
    if (!plugin?.app?.vault || !plugin?.app?.metadataCache) {
      return 0;
    }

    try {
      const allFiles = plugin.app.vault.getMarkdownFiles();
      let count = 0;

      for (const file of allFiles) {
        const cache = plugin.app.metadataCache.getFileCache(file);
        if (cache?.tags) {
          // Tags in cache include the # prefix
          const tagWithHash = tag.startsWith('#') ? tag : `#${tag}`;
          if (cache.tags.some(t => t.tag === tagWithHash)) {
            count++;
          }
        }

        // Also check frontmatter tags
        if (cache?.frontmatter?.tags) {
          const frontmatterTags = Array.isArray(cache.frontmatter.tags)
            ? cache.frontmatter.tags
            : [cache.frontmatter.tags];
          const tagWithoutHash = tag.startsWith('#') ? tag.slice(1) : tag;
          if (frontmatterTags.includes(tagWithoutHash) || frontmatterTags.includes(`#${tagWithoutHash}`)) {
            count++;
          }
        }
      }

      return count;
    } catch (error) {
      console.error('Error getting tag count:', error);
      return 0;
    }
  }

  // File scanner functions
  export async function handleScanFiles() {
    if (isScanning) return;

    isScanning = true;
    scanResult = null;

    try {
      const startTime = Date.now();
      const recordParser = new RecordParser(plugin.app, $store.parserSettings);

      // Get keywords that should be parsed (PARSED or SPACED status)
      const keywordsToparse: string[] = [];

      for (const category of $store.categories) {
        for (const keyword of category.keywords) {
          if (isCollected(keyword.collectingStatus)) {
            keywordsToparse.push(keyword.keyword);
          }
        }
      }

      const excludePatterns = $store.parserSettings?.excludePatterns || ['_/'];

      // Get all markdown files
      const allFiles = plugin.app.vault.getMarkdownFiles();

      // Filter and track statistics
      const includedFiles: TFile[] = [];
      const excludedFilePaths: string[] = [];
      let totalFiles = allFiles.length;
      let excludedFiles = 0;

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

        if (shouldExclude) {
          excludedFiles++;
          if (excludedFilePaths.length < 100) {
            excludedFilePaths.push(file.path);
          }
        } else {
          includedFiles.push(file);
        }
      }

      // Parse each file and count keyword occurrences
      const keywordCounts: Record<string, number> = {};
      const parsedRecords: ParsedRecord[] = [];

      // Initialize counts
      for (const keyword of keywordsToparse) {
        keywordCounts[keyword] = 0;
      }

      for (const file of includedFiles) {
        try {
          const parsedRecord = await recordParser.parseFile(file, keywordsToparse);
          parsedRecords.push(parsedRecord);

          // Count keywords in flat entries
          function countInEntries(entries: any[]) {
            for (const entry of entries) {
              // Count keywords from header context
              if (entry.h1?.keywords) {
                for (const kw of entry.h1.keywords) {
                  keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
                }
              }
              if (entry.h2?.keywords) {
                for (const kw of entry.h2.keywords) {
                  keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
                }
              }
              if (entry.h3?.keywords) {
                for (const kw of entry.h3.keywords) {
                  keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
                }
              }

              // Count in entry keywords
              if (entry.keywords) {
                for (const kw of entry.keywords) {
                  keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
                }
              }

              // Count in sub-items
              if (entry.subItems) {
                for (const subItem of entry.subItems) {
                  if (subItem.keywords) {
                    for (const kw of subItem.keywords) {
                      keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
                    }
                  }
                }
              }
            }
          }

          countInEntries(parsedRecord.entries);
        } catch (error) {
          console.error(`Error parsing file ${file.path}:`, error);
        }
      }

      // Store parsed records in plugin RAM cache
      plugin.parsedRecords = parsedRecords;
      console.log('[SettingTab] Stored', parsedRecords.length, 'files in RAM cache');

      // SRS data is now stored directly in markdown files as HTML comments
      // No need to create database cards - RecordParser extracts SRS comments during parsing

      // Build result
      scanResult = {
        totalFiles,
        includedFiles: includedFiles.length,
        excludedFiles,
        excludedFilePaths,
        includedFilePaths: includedFiles.slice(0, 100).map(f => f.path),
        scanDuration: Date.now() - startTime,
        scannedPath: '/',
        excludePatterns,
        keywordCounts
      };

      new Notice(`Scan complete! Parsed ${includedFiles.length} files. Created ${srsCardsCreated} SRS cards.`);
    } catch (error) {
      console.error('Error scanning files:', error);
      new Notice('Error scanning files');
    } finally {
      isScanning = false;
    }
  }

  function toggleExcludedFiles() {
    showExcludedFiles = !showExcludedFiles;
  }

  async function handleTestFilter() {
    if (!filterExpression.trim()) return;

    isTestingFilter = true;
    filterResult = null;

    try {
      // Get parsed records from plugin RAM cache
      if (plugin.parsedRecords.length === 0) {
        new Notice('No parsed records found. Please run "Scan Now" in the Parser tab first.');
        return;
      }

      const parsedRecords: ParsedRecord[] = plugin.parsedRecords;

      // Split filter expression on W: to separate SELECT and WHERE parts
      const hasWhere = filterExpression.includes('W:');
      let selectPart = '';
      let wherePart = '';

      if (hasWhere) {
        const parts = filterExpression.split(/W:/);
        selectPart = parts[0].trim();
        wherePart = parts[1]?.trim() || '';
      } else {
        // No WHERE clause - entire expression is SELECT part
        selectPart = filterExpression.trim();
      }

      // Compile SELECT part (what to show)
      const selectCompiled = FilterParser.compile(selectPart);
      if (!selectCompiled.ast) {
        new Notice('Invalid SELECT expression');
        return;
      }

      // Compile WHERE part (which files) if present
      let whereCompiled: any = null;
      if (wherePart) {
        whereCompiled = FilterParser.compile(wherePart);
        if (!whereCompiled.ast) {
          new Notice('Invalid WHERE expression');
          return;
        }
      }

      // Apply filter to all records
      let totalRecords = 0;
      const keywordBreakdown: Record<string, number> = {};
      const previewRecords: Array<{
        keyword: string;
        text: string;
        filePath: string;
        lineNumber?: number;
        subItems?: Array<{
          text: string;
          keywords?: string[];
        }>;
      }> = [];

      for (const record of parsedRecords) {
        // Process flat entries - WHERE and SELECT both evaluated per-entry
        for (const entry of record.entries) {
          if (entry.type !== 'keyword') continue;

          // Extract languages from this entry's subItems
          const subItemLanguages: string[] = [];
          if (entry.subItems) {
            for (const subItem of entry.subItems) {
              if (subItem.codeBlockLanguage) {
                subItemLanguages.push(subItem.codeBlockLanguage);
              }
            }
          }

          // Collect header keywords and tags from h1/h2/h3
          const headerKeywords: string[] = [];
          const headerTags: string[] = [];
          if (entry.h1) {
            headerKeywords.push(...(entry.h1.keywords || []));
            headerTags.push(...(entry.h1.tags || []));
          }
          if (entry.h2) {
            headerKeywords.push(...(entry.h2.keywords || []));
            headerTags.push(...(entry.h2.tags || []));
          }
          if (entry.h3) {
            headerKeywords.push(...(entry.h3.keywords || []));
            headerTags.push(...(entry.h3.tags || []));
          }

          // Build context with entry's keywords + file's tags/path
          // This context is used for BOTH WHERE and SELECT evaluation
          const context = {
            filePath: record.filePath,
            tags: record.tags || [],
            keywords: entry.keywords || [],
            headerKeywords: headerKeywords,
            headerTags: headerTags,
            code: entry.text || '',
            language: undefined,
            languages: subItemLanguages
          };

          // First evaluate WHERE clause (if present)
          // WHERE filters which entries to consider
          if (whereCompiled) {
            if (!FilterParser.evaluate(whereCompiled.ast, context, whereCompiled.modifiers)) {
              continue; // Entry doesn't pass WHERE clause, skip it
            }
          }

          // Entry passed WHERE (or no WHERE), now evaluate SELECT filter
          if (FilterParser.evaluate(selectCompiled.ast, context, selectCompiled.modifiers)) {
            totalRecords++;

            // Count keywords
            for (const kw of entry.keywords || []) {
              keywordBreakdown[kw] = (keywordBreakdown[kw] || 0) + 1;
            }

            // Add to preview (first 10) with subItems
            if (previewRecords.length < 10) {
              previewRecords.push({
                keyword: entry.keywords?.join(', ') || '',
                text: entry.text || '',
                filePath: record.filePath,
                lineNumber: entry.lineNumber,
                subItems: entry.subItems
              });
            }
          }
        }
      }

      // Set results
      filterResult = {
        totalRecords,
        keywordBreakdown,
        previewRecords
      };

      new Notice(`Filter matched ${totalRecords} records`);
    } catch (error) {
      console.error('Error testing filter:', error);
      new Notice('Error testing filter');
    } finally {
      isTestingFilter = false;
    }
  }
</script>

<div class="tab-navigation">
  <button
    class="tab-button"
    class:active={activeTab === 'keywords'}
    on:click={() => activeTab = 'keywords'}
  >
    🔑 Key
  </button>
  <button
    class="tab-button"
    class:active={activeTab === 'cBlocks'}
    on:click={() => activeTab = 'cBlocks'}
  >
    💻 cBlocks
  </button>
  <button
    class="tab-button"
    class:active={activeTab === 'vword'}
    on:click={() => activeTab = 'vword'}
  >
    🎨 VWord
  </button>
  <button
    class="tab-button"
    class:active={activeTab === 'parser'}
    on:click={() => activeTab = 'parser'}
  >
    🔍 Parse
  </button>
  <button
    class="tab-button"
    class:active={activeTab === 'subjects'}
    on:click={() => activeTab = 'subjects'}
  >
    📚 Subjects
  </button>
  <button
    class="tab-button"
    class:active={activeTab === 'filters'}
    on:click={() => activeTab = 'filters'}
  >
    🔎 Filters
  </button>
  <button
    class="tab-button"
    class:active={activeTab === 'generic'}
    on:click={() => activeTab = 'generic'}
  >
    ⚙️ Generic
  </button>

  <button
    class="tab-button"
    class:active={activeTab === 'srs'}
    on:click={() => activeTab = 'srs'}
  >
    🔄 SRS
  </button>
</div>

<div class="tab-content">
  {#if activeTab === 'keywords'}
    <div bind:this={ref}>
      <!-- Search Filter -->
      <div class="keyword-search-filter-section">
        <input
          type="text"
          bind:value={keywordSearchFilter}
          placeholder="Search keywords, descriptions, icons, CSS classes..."
          class="keyword-search-filter-input"
        />
        {#if keywordSearchFilter.trim()}
          <button
            class="keyword-search-clear-btn"
            on:click={() => keywordSearchFilter = ''}
            aria-label="Clear search"
          >×</button>
        {/if}
      </div>

      <!-- Statistics Dashboard -->
      <div class="stats-dashboard">
        <div class="stat-row stat-is-parsed">
          <input
            type="radio"
            id="highlight-is-parsed"
            value="parsed"
            bind:group={highlightMode}
            class="stat-radio"
          />
          <label for="highlight-is-parsed" class="stat-label">
            {isParsedCount}/{totalKeywords} parsed ✅
            {#if parsedKeywords.length > 0}
              <span class="stat-icons">
                {#each parsedKeywords as kw}
                  <span class="stat-icon">{kw.generateIcon}</span>
                {/each}
                ...
              </span>
            {/if}
          </label>
        </div>
      </div>

      <!-- Keyword Mover Section -->
      <div class="keyword-mover-section">
        <span class="keyword-mover-label">Move:</span>
        <select bind:value={selectedKeywordToMove} class="keyword-mover-select">
          <option value="">Keyword...</option>
          {#each getAllKeywordsWithCategories() as kwInfo}
            <option value={kwInfo.keyword}>
              {kwInfo.keyword} ({kwInfo.categoryName})
            </option>
          {/each}
        </select>
        <span class="keyword-mover-arrow">→</span>
        <select bind:value={selectedTargetCategory} class="keyword-mover-select">
          <option value="">Category...</option>
          {#each categories as cat}
            <option value={cat.icon}>{cat.icon}</option>
          {/each}
        </select>
        <button
          on:click={handleMoveKeyword}
          disabled={!selectedKeywordToMove || !selectedTargetCategory}
          class="keyword-mover-btn"
        >
          Move
        </button>
      </div>

      {#each categoriesWithFilteredKeywords as { category, filteredKeywords }, categoryIndex}
        {#if filteredKeywords.length > 0 || !keywordSearchFilter.trim()}
          <div class="category-section">
            <div class="category-header" on:click={() => toggleCategory(category.icon)}>
              <div class="category-title">
                <span class="category-toggle" class:collapsed={collapsedCategories.has(category.icon)}>
                  ▼
                </span>
                {#if editingCategoryName === category.icon}
                  <div class="category-edit-container">
                    <div class="category-edit-field">
                      <label class="category-edit-label">Icon:</label>
                      <input
                        type="text"
                        bind:value={editedCategoryName}
                        on:blur={saveEditedCategory}
                        on:keydown={(e) => {
                          if (e.key === 'Enter') saveEditedCategory();
                          if (e.key === 'Escape') cancelEditingCategory();
                        }}
                        on:click|stopPropagation
                        class="category-name-input"
                        placeholder="Category icon"
                      />
                    </div>
                    <div class="category-edit-field">
                      <label class="category-edit-label">ID:</label>
                      <input
                        type="text"
                        bind:value={editedCategoryId}
                        on:blur={saveEditedCategory}
                        on:keydown={(e) => {
                          if (e.key === 'Enter') saveEditedCategory();
                          if (e.key === 'Escape') cancelEditingCategory();
                        }}
                        on:click|stopPropagation
                        class="category-id-input"
                        placeholder="category-id (optional)"
                      />
                    </div>
                  </div>
                {:else}
                  <h3 on:dblclick|stopPropagation={() => startEditingCategory(category.icon)}>
                    {category.icon}
                    {#if category.id}
                      <span class="category-id-badge">:{category.id}</span>
                    {/if}
                    <span class="keyword-count">({filteredKeywords.length}{#if keywordSearchFilter.trim()}/{category.keywords.length}{/if})</span>
                    <span class="category-icons">
                      {#each filteredKeywords as kw}
                        {#if kw.generateIcon && kw.generateIcon.trim()}
                          <span
                            class="category-icon-item"
                            class:is-parsed={isCollected(kw.collectingStatus) && highlightMode === 'parsed'}
                          >
                            {kw.generateIcon}
                          </span>
                        {/if}
                      {/each}
                    </span>
                  </h3>
                {/if}
              </div>
              <div class="category-controls">
                <button
                  class="category-remove"
                  aria-label="Remove category"
                  use:useIcon={'trash'}
                  on:click|stopPropagation={() => handleRemoveCategory(category.icon)}
                ></button>
              </div>
            </div>

            {#if !collapsedCategories.has(category.icon)}
              <div class="category-content">
                <table class="keywords-table">
                  <colgroup>
                    <col style="width: 25px;" /> <!-- Drag -->
                    <col style="width: 25px;" /> <!-- State -->
                    <col style="width: 35px;" /> <!-- Priority -->
                    <col style="width: 30px;" /> <!-- Subkeywords -->
                    <col style="width: 70px;" /> <!-- Keyword -->
                    <col style="width: auto;" /> <!-- Description -->
                    <col style="width: 45px;" /> <!-- Icon -->
                    <col style="width: 80px;" /> <!-- Colors + Remove -->
                  </colgroup>
                  <thead>
                    <tr>
                      <th class="th-add">
                        <button
                          class="add-keyword-header-btn"
                          on:click={() => handleAddKeyword(category.icon)}
                          title="Add keyword to {category.icon}"
                        >
                          +
                        </button>
                      </th>
                      <th title="Collecting Status">S</th>
                      <th title="Combine Priority">P</th>
                      <th title="Sub-keywords">⚙️</th>
                      <th>Keyword</th>
                      <th>Description</th>
                      <th>Icon</th>
                      <th>Colors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each category.keywords as keyword, keywordIndex}
                      {#if keywordMatchesFilter(keyword)}
                        <KeywordSetting
                          {keywordIndex}
                          categoryName={category.icon}
                          {keyword}
                          on:remove={() => handleRemoveKeyword(keyword)}
                          on:reorder={(e) => handleKeywordReorder(category.icon, e.detail.draggedIndex, e.detail.targetIndex)}
                        />
                      {/if}
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {/if}
      {/each}

      <div class="add-category-section">
        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Add New Category</div>
            <div class="setting-item-description">Create a new category to organize your keywords</div>
          </div>
          <div class="setting-item-control">
            <div class="add-category-inputs">
              <input type="text" bind:value={newCategoryName} placeholder="Category name" />
            </div>
            <button on:click={handleAddCategory}>Add Category</button>
          </div>
        </div>
      </div>
    </div>
  {:else if activeTab === 'subjects'}
    <div class="kb-subjects-tab">
      <h2>Subjects</h2>

      <p class="kb-description">
        Create subjects with filter expressions to organize and filter your knowledge base.
      </p>

      <!-- Path to Subjects Files -->
      <div class="subjects-path-section">
        <h3>Subjects Files Path</h3>
        <p class="description">Specify a directory path where subject .md files are stored. Each subject will link to {'{'}path{'}'}/{'{'}subjectName{'}'}.md</p>
        <input
          type="text"
          bind:value={$settingsDataStore.pathToSubjects}
          on:change={async () => await saveSettingsData()}
          placeholder="Enter directory path (e.g., /kb)"
          class="subjects-path-input"
        />
      </div>

      <!-- List of existing subjects -->
      <div class="kb-filter-list">
        {#if !$subjectsStore.subjects || $subjectsStore.subjects.length === 0}
          <p class="kb-empty-message">No subjects yet. Click "Add Subject" to create one.</p>
        {:else}
          {#each $subjectsStore.subjects as subject, index}
            <div class="kb-filter-item">
              <!-- Single compact row with everything -->
              <div class="kb-filter-header">
                <span class="kb-filter-icon" style={subject.color ? `color: ${subject.color}` : ''}>
                  {subject.icon || '🎯'}
                </span>
                <span class="kb-filter-name">{subject.name}</span>

                {#if subject.mainTag}
                  <span class="kb-filter-maintag">
                    <code>{subject.mainTag}</code>
                  </span>
                {/if}

                {#if subject.dashOnlyFilterExp}
                  <span class="kb-filter-expression-inline" style="background-color: rgba(0, 0, 139, 0.7); color: white; padding: 2px 6px; border-radius: 3px; margin-right: 4px;">
                    <code style="color: white;">Dash: {subject.dashOnlyFilterExp}</code>
                  </span>
                {/if}
                {#if subject.matrixOnlyFilterExp}
                  <span class="kb-filter-expression-inline" style="background-color: rgba(255, 0, 0, 0.6); color: white; padding: 2px 6px; border-radius: 3px;">
                    <code style="color: white;">Matrix: {subject.matrixOnlyFilterExp}</code>
                  </span>
                {/if}
                {#if !subject.dashOnlyFilterExp && !subject.matrixOnlyFilterExp && subject.expression}
                  <span class="kb-filter-expression-inline" style="opacity: 0.6;">
                    <code>Legacy: {subject.expression}</code>
                  </span>
                {/if}

                <button
                  class="kb-filter-btn-inline"
                  on:click={() => openEditSubjectModal(index)}
                >
                  Edit
                </button>
                <button
                  class="kb-filter-btn-inline kb-filter-btn-danger"
                  on:click={() => handleDeleteSubject(index)}
                >
                  Delete
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Add Subject button -->
      <div class="kb-add-subject-section">
        <button
          class="kb-add-subject-btn"
          on:click={openNewSubjectModal}
        >
          Add Subject
        </button>
      </div>
    </div>
  {:else if activeTab === 'generic'}
    <div>
      <!-- Keywords Dashboard (Generate Keywords Reference File) -->
      <div class="keywords-reference-section">
        <h3>Keywords Dashboard</h3>
        <p class="description">Generate a markdown file with all keywords organized by category under a "# keywords" header.</p>
        <div class="keywords-reference-controls">
          <input
            type="text"
            bind:value={$settingsDataStore.keywordsDashboardFileName}
            on:change={async () => await saveSettingsData()}
            placeholder="Enter file name (e.g., home page)"
            class="keywords-reference-input"
          />
          <button
            class="keywords-reference-generate-btn"
            on:click={handleGenerateKeywordsReference}
            disabled={!$settingsDataStore.keywordsDashboardFileName || !$settingsDataStore.keywordsDashboardFileName.trim()}
          >
            🔄 Generate/Regenerate
          </button>
        </div>
      </div>

      <!-- Keyword Usage (Reference Files Path) -->
      <div class="keyword-reference-section">
        <h3>Keyword Usage</h3>
        <p class="description">Specify a directory path where keywords will automatically look for their reference .md files.</p>
        <div class="reference-path-input-wrapper">
          <input
            type="text"
            bind:value={$settingsDataStore.keywordDescriptionsPath}
            on:change={async () => {
              await saveSettingsData();
              await scanForReferenceFiles();
            }}
            placeholder="Enter directory path (e.g., foo/bar)"
            class="reference-path-input"
          />
          {#if $settingsDataStore.keywordDescriptionsPath && $settingsDataStore.keywordDescriptionsPath.trim()}
            <span class="reference-files-count">
              Found: {foundReferenceFilesCount}/{totalKeywordsForReference} files
            </span>
          {/if}
        </div>
      </div>

      <!-- Badge Excluded Paths -->
      <div class="badge-excluded-paths-section">
        <h3>Badge Excluded Paths</h3>
        <p class="description">Comma-separated list of file/folder paths where record badges should NOT be shown in reading view.</p>
        <input
          type="text"
          bind:value={$settingsDataStore.badgeExcludedPaths}
          on:change={async () => await saveSettingsData()}
          placeholder="e.g., _journal, templates, archive"
          class="badge-excluded-paths-input"
        />
      </div>
    </div>
  {:else if activeTab === 'cBlocks'}
    <div class="code-blocks-section">
      {#if $codeBlocksStore && $codeBlocksStore.length > 0}
        <div class="code-blocks-grid">
          {#each $codeBlocksStore as codeBlock, index}
            <div class="code-block-item">
              <div class="code-block-header">
                <input
                  type="text"
                  bind:value={codeBlock.icon}
                  on:change={async () => await saveCodeBlocks()}
                  placeholder="Icon"
                  class="code-block-icon-input-header"
                  maxlength="5"
                />
                <input
                  type="text"
                  bind:value={codeBlock.id}
                  on:change={async () => await saveCodeBlocks()}
                  placeholder="ID (e.g., java, python)"
                  class="code-block-id-input-header"
                />
                <button
                  class="code-block-remove-btn"
                  aria-label="Remove"
                  on:click={async () => {
                    codeBlocksStore.update(codeBlocks => codeBlocks.filter((_, i) => i !== index));
                    await saveCodeBlocks();
                  }}
                  use:useIcon={'trash'}
                />
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="add-code-block-section">
        <input
          type="text"
          bind:value={keywordSearchByGroup['__codeBlocks__']}
          placeholder="Code block ID (e.g., java, python, rust)"
          class="code-block-add-input"
          on:keypress={(e) => {
            if (e.key === 'Enter') {
              const id = keywordSearchByGroup['__codeBlocks__']?.trim();
              if (id && !$codeBlocksStore.some(cb => cb.id === id)) {
                codeBlocksStore.update(codeBlocks => {
                  codeBlocks.push({ id, icon: undefined });
                  return codeBlocks;
                });
                saveCodeBlocks();
                keywordSearchByGroup['__codeBlocks__'] = '';
              }
            }
          }}
        />
        <button
          on:click={async () => {
            const id = keywordSearchByGroup['__codeBlocks__']?.trim();
            if (id && !$codeBlocksStore.some(cb => cb.id === id)) {
              codeBlocksStore.update(codeBlocks => {
                codeBlocks.push({ id, icon: undefined });
                return codeBlocks;
              });
              await saveCodeBlocks();
              keywordSearchByGroup['__codeBlocks__'] = '';
            }
          }}
          disabled={!keywordSearchByGroup['__codeBlocks__']?.trim()}
        >
          Add Code Block
        </button>
        <button
          class="auto-parse-btn"
          on:click={async () => {
            // TODO: Auto-parse code blocks from vault
            console.log('Auto-parse code blocks');
          }}
        >
          🔄 Auto-Parse from Vault
        </button>
      </div>
    </div>
  {:else if activeTab === 'vword'}
    <div class="vword-settings-section">
      <h2>VWord (Visual Keywords)</h2>
      <p class="description">
        VWord keywords are special pattern-based keywords for controlling visual layout.
        They are automatically recognized and don't need to be added individually.
      </p>

      <div class="vword-explanation">
        <h3>📐 Available VWord Keywords</h3>

        <div class="vword-type">
          <h4>i-keywords (Image Column Control)</h4>
          <p><strong>Pattern:</strong> <code>i10</code>, <code>i15</code>, <code>i20</code>, ..., <code>i90</code> (17 total)</p>
          <p><strong>Purpose:</strong> Controls image column width percentage in reading view.</p>
          <p><strong>Example:</strong> <code>def i67 :: My content</code> → Image takes 67% width, text takes 33%</p>
          <p><strong>Note:</strong> Images will ONLY split into two columns when an i-keyword is present.</p>
        </div>

        <div class="vword-type">
          <h4>h-keywords (Horizontal List Layouts)</h4>
          <p><strong>Pattern:</strong> <code>h</code> + 2-5 digits (112 total combinations)</p>
          <p><strong>Purpose:</strong> Controls horizontal list layout with custom width ratios.</p>
          <p><strong>Examples:</strong></p>
          <ul>
            <li><code>h442</code> → 3 items with 40%/40%/20% widths (weights: 4+4+2=10)</li>
            <li><code>h123</code> → 3 items with 16.66%/33.33%/50% widths (weights: 1+2+3=6)</li>
            <li><code>h1234</code> → 4 items with custom ratios</li>
          </ul>
          <p><strong>Rules:</strong> 2-5 elements, sum of weights must be 2-7</p>
        </div>
      </div>

      <div class="vword-color-settings">
        <h3>🎨 VWord Styling</h3>
        <p>All VWord keywords share the same color and background color:</p>

        <div class="color-pickers">
          <div class="color-picker-item">
            <label for="vword-color">Text Color:</label>
            <input
              type="color"
              id="vword-color"
              bind:value={$vwordSettingsStore.color}
              on:change={async () => await saveVWordSettings()}
            />
            <span class="color-value">{$vwordSettingsStore.color}</span>
          </div>

          <div class="color-picker-item">
            <label for="vword-bg-color">Background Color:</label>
            <input
              type="color"
              id="vword-bg-color"
              bind:value={$vwordSettingsStore.backgroundColor}
              on:change={async () => await saveVWordSettings()}
            />
            <span class="color-value">{$vwordSettingsStore.backgroundColor}</span>
          </div>
        </div>

        <div class="vword-preview">
          <p><strong>Preview:</strong></p>
          <span
            class="vword-preview-text"
            style="color: {$vwordSettingsStore.color}; background-color: {$vwordSettingsStore.backgroundColor}; padding: 4px 8px; border-radius: 3px;"
          >
            VWord keyword
          </span>
        </div>
      </div>
    </div>
  {:else if activeTab === 'parser'}
    <div class="parser-settings-section">
      <h2>Parser Settings</h2>
      <p class="description">Configure which files to include when parsing your vault.</p>

      <!-- Exclude Patterns -->
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Exclude Patterns</div>
          <div class="setting-item-description">Comma-separated paths to exclude (e.g., "_/, templates/, .trash")</div>
        </div>
        <div class="setting-item-control">
          <input
            type="text"
            value={$store.parserSettings?.excludePatterns?.join(', ') || '_/'}
            on:change={async (e) => {
              const value = e.currentTarget.value;
              const patterns = value.split(',').map(p => p.trim()).filter(p => p.length > 0);
              settingsStore.update(s => ({
                ...s,
                parserSettings: {
                  ...s.parserSettings,
                  excludePatterns: patterns.length > 0 ? patterns : ['_/']
                }
              }));
              await saveStore();
            }}
            placeholder="_/, templates/"
            class="parser-input"
          />
        </div>
      </div>

      <!-- Parse Inlines Toggle -->
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Parse Inline Keywords</div>
          <div class="setting-item-description">Extract keywords from &lt;mark class="keyword"&gt; tags in entry text (e.g., "foo :: bar &lt;mark class="baz"&gt;text&lt;/mark&gt;" will include "baz" as a keyword)</div>
        </div>
        <div class="setting-item-control">
          <input
            type="checkbox"
            checked={$store.parserSettings?.parseInlines || false}
            on:change={async (e) => {
              const checked = e.currentTarget.checked;
              settingsStore.update(s => ({
                ...s,
                parserSettings: {
                  ...s.parserSettings,
                  parseInlines: checked
                }
              }));
              await saveStore();
            }}
          />
        </div>
      </div>

      <!-- Scan Button -->
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Scan Files</div>
          <div class="setting-item-description">Click to scan the vault and see how many files will be included/excluded</div>
        </div>
        <div class="setting-item-control">
          <button
            class="parser-scan-btn"
            on:click={handleScanFiles}
            disabled={isScanning}
          >
            {isScanning ? '🔍 Scanning...' : 'Scan Now'}
          </button>
        </div>
      </div>

      <!-- Scan Results -->
      {#if scanResult}
        <div class="parser-scan-results">
          <h2>📊 Scan Results</h2>

          <!-- Stats Cards -->
          <div class="scan-stats">
            <div class="stat-card stat-total">
              <div class="stat-label">📁 Total Files</div>
              <div class="stat-value">{scanResult.totalFiles}</div>
            </div>
            <div class="stat-card stat-excluded">
              <div class="stat-label">🚫 Excluded</div>
              <div class="stat-value">{scanResult.excludedFiles}</div>
            </div>
            <div class="stat-card stat-time">
              <div class="stat-label">⏱️ Scan Time</div>
              <div class="stat-value">{scanResult.scanDuration}ms</div>
            </div>
          </div>

          <!-- Keyword Counts Table -->
          {#if scanResult.keywordCounts && Object.keys(scanResult.keywordCounts).length > 0}
            <div class="keyword-counts-section">
              <h3>📝 Keyword Counts</h3>
              <table class="keyword-counts-table">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {#each Object.entries(scanResult.keywordCounts).sort((a, b) => b[1] - a[1]) as [keyword, count]}
                    <tr>
                      <td class="keyword-cell">{keyword}</td>
                      <td class="count-cell">{count}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <!-- Details -->
          <div class="scan-details">
            {#if scanResult.excludePatterns.length > 0}
              <p class="scan-info">Exclude patterns: {scanResult.excludePatterns.join(', ')}</p>
            {/if}

            <!-- Percentage -->
            {#if scanResult.totalFiles > 0}
              {@const percentage = Math.round((scanResult.excludedFiles / scanResult.totalFiles) * 100)}
              <div class="percentage-bar">
                <div class="percentage-fill" style="width: {percentage}%"></div>
              </div>
              <p class="percentage-text">{percentage}% of files excluded</p>
            {/if}

            <!-- Excluded Files -->
            {#if scanResult.excludedFilePaths.length > 0}
              <div class="file-list-section">
                <div class="file-list-header" on:click={toggleExcludedFiles}>
                  <h3>Excluded Files (showing {scanResult.excludedFilePaths.length} of {scanResult.excludedFiles})</h3>
                  <span class="file-list-toggle">{showExcludedFiles ? '▲' : '▼'}</span>
                </div>
                {#if showExcludedFiles}
                  <div class="file-list">
                    {#each scanResult.excludedFilePaths as filePath}
                      <div class="file-item file-excluded">{filePath}</div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else if activeTab === 'filters'}
    <div class="filters-content">
      <h2>Filter Tester</h2>
      <p class="description">Test filter expressions to see matching records from parsed data.</p>

      <!-- Filter Expression Input -->
      <div class="filter-input-section">
        <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
          <label>Filter Expression:</label>
          <input
            type="text"
            bind:value={filterExpression}
            placeholder="e.g., .foo, #tag, /path, `java, .foo.bar"
            class="filter-expression-input"
          />

          <!-- Filter Modifier Toggle Buttons -->
          <div class="filter-toggle-group">
            <!-- Header Filtering Toggle -->
            <button
              class="filter-toggle"
              class:filter-toggle-active={filterExpression.includes('\\h')}
              data-command="H"
              title="Toggle Header Filtering: Match keywords in headers (\h modifier)"
              on:click={() => {
                if (filterExpression.includes('\\h')) {
                  filterExpression = filterExpression.replace(/\\h/g, '').trim();
                } else {
                  filterExpression = (filterExpression + ' \\h').trim();
                }
                if (filterExpression.trim()) handleTestFilter();
              }}
            >
              𒐺
            </button>

            <!-- Trim Subelement Toggle -->
            <button
              class="filter-toggle"
              class:filter-toggle-active={filterExpression.includes('\\s')}
              data-command="S"
              title="Toggle Trim Subelement: Filter sub-items to show only matching keywords (\s modifier)"
              on:click={() => {
                if (filterExpression.includes('\\s')) {
                  filterExpression = filterExpression.replace(/\\s/g, '').trim();
                } else {
                  filterExpression = (filterExpression + ' \\s').trim();
                }
                if (filterExpression.trim()) handleTestFilter();
              }}
            >
              💇
            </button>

            <!-- Top Level Only Toggle -->
            <button
              class="filter-toggle"
              class:filter-toggle-active={filterExpression.includes('\\t')}
              data-command="T"
              title="Toggle Top Level Only: Show only records where keyword is top-level (\t modifier)"
              on:click={() => {
                if (filterExpression.includes('\\t')) {
                  filterExpression = filterExpression.replace(/\\t/g, '').trim();
                } else {
                  filterExpression = (filterExpression + ' \\t').trim();
                }
                if (filterExpression.trim()) handleTestFilter();
              }}
            >
              👑
            </button>
          </div>
        </div>

        <button
          on:click={handleTestFilter}
          disabled={!filterExpression.trim() || isTestingFilter}
          class="test-filter-btn"
        >
          {isTestingFilter ? 'Testing...' : 'Test Filter'}
        </button>
      </div>

      <!-- Filter Results -->
      {#if filterResult}
        <div class="filter-results">
          <h3>Results</h3>

          <!-- Total Count -->
          <div class="filter-stats">
            <div class="stat-card">
              <div class="stat-label">Total Matching Records</div>
              <div class="stat-value">{filterResult.totalRecords}</div>
            </div>
          </div>

          <!-- Keyword Breakdown -->
          {#if Object.keys(filterResult.keywordBreakdown).length > 0}
            <div class="keyword-breakdown-section">
              <h4>Keyword Breakdown</h4>
              <table class="keyword-breakdown-table">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {#each Object.entries(filterResult.keywordBreakdown).sort((a, b) => b[1] - a[1]) as [keyword, count]}
                    <tr>
                      <td class="keyword-cell">{keyword}</td>
                      <td class="count-cell">{count}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <!-- Preview Records -->
          {#if filterResult.previewRecords.length > 0}
            <div class="preview-records-section">
              <h4>Preview (first 10 records)</h4>
              <div class="preview-records-list">
                {#each filterResult.previewRecords as record}
                  <div class="preview-record-item">
                    <div class="record-keyword">{record.keyword}</div>
                    <div class="record-text">{record.text}</div>
                    {#if record.subItems && record.subItems.length > 0}
                      <div class="record-subitems">
                        {#each record.subItems as subItem}
                          <div class="record-subitem">
                            {#if subItem.keywords && subItem.keywords.length > 0}
                              <span class="subitem-keywords">{subItem.keywords.join(', ')}:</span>
                            {/if}
                            <span class="subitem-text">{subItem.text}</span>
                          </div>
                        {/each}
                      </div>
                    {/if}
                    <div class="record-meta">
                      <span class="record-file">{record.filePath}</span>
                      {#if record.lineNumber}
                        <span class="record-line">Line {record.lineNumber}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if activeTab === 'srs'}
    <div bind:this={srsContainer} class="srs-settings-content"></div>
  {/if}
</div>

<style>
  /* Keyword Search Filter */
  .keyword-search-filter-section {
    position: relative;
    margin-bottom: 1rem;
  }

  .keyword-search-filter-input {
    width: 100%;
    padding: 0.6rem 2.5rem 0.6rem 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.95em;
  }

  .keyword-search-filter-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2);
  }

  .keyword-search-filter-input::placeholder {
    color: var(--text-muted);
  }

  .keyword-search-clear-btn {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1.5rem;
    line-height: 1;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    transition: all 0.2s;
  }

  .keyword-search-clear-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  /* Statistics Dashboard */
  .stats-dashboard {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .stat-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .stat-row.stat-is-parsed {
    background-color: rgba(40, 167, 69, 0.15);
  }

  .stat-radio {
    cursor: pointer;
    width: 16px;
    height: 16px;
  }

  .stat-label {
    cursor: pointer;
    font-size: 0.95em;
    font-weight: 500;
    color: var(--text-normal);
    user-select: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .stat-icons {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.9em;
  }

  .stat-icon {
    display: inline-block;
  }

  /* Keyword Mover Section */
  .keyword-mover-section {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
    padding: 0.3rem 0.5rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
  }

  .keyword-mover-label {
    font-size: 0.85em;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .keyword-mover-select {
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
    cursor: pointer;
    max-width: 150px;
  }

  .keyword-mover-select:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .keyword-mover-arrow {
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .keyword-mover-btn {
    padding: 0.25rem 0.6rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.85em;
    white-space: nowrap;
  }

  .keyword-mover-btn:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .keyword-mover-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Keywords Reference File Generator Section */
  .keywords-reference-section {
    margin: 1rem 0;
    padding: 0.75rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .keywords-reference-section h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1em;
    color: var(--text-normal);
  }

  .keywords-reference-section .description {
    margin: 0 0 0.75rem 0;
    font-size: 0.9em;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .keywords-reference-controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .keywords-reference-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .keywords-reference-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2);
  }

  .keywords-reference-input::placeholder {
    color: var(--text-muted);
  }

  .keywords-reference-generate-btn {
    padding: 0.5rem 1rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
    transition: background-color 0.2s;
  }

  .keywords-reference-generate-btn:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .keywords-reference-generate-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Keyword Reference Section */
  .keyword-reference-section {
    margin: 1rem 0;
    padding: 0.75rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .keyword-reference-section h3 {
    margin: 0 0 0.3rem 0;
    color: var(--text-accent);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .keyword-reference-section .description {
    margin: 0 0 0.5rem 0;
    font-size: 0.85em;
    color: var(--text-muted);
  }

  .reference-path-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .reference-path-input {
    flex: 1;
    max-width: 400px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
    font-family: var(--font-monospace);
  }

  .reference-path-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .reference-files-count {
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-accent);
    white-space: nowrap;
    padding: 0.3rem 0.6rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
  }

  .category-section {
    margin-bottom: 0.3rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0.3rem 0.4rem;
  }

  .category-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0;
    padding-bottom: 0.2rem;
    border-bottom: 1px solid var(--background-modifier-border);
    cursor: pointer;
    user-select: none;
    overflow: hidden;
  }

  .category-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .category-toggle {
    font-size: 0.8rem;
    transition: transform 0.2s ease;
    color: var(--text-muted);
  }

  .category-toggle.collapsed {
    transform: rotate(-90deg);
  }

  .category-header h3 {
    margin: 0;
    color: var(--text-accent);
    cursor: pointer;
    font-size: 1rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }

  .category-header h3:hover {
    color: var(--text-accent-hover);
  }

  .category-edit-container {
    display: flex;
    flex-direction: row;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--background-secondary);
    border-radius: 4px;
  }

  .category-edit-field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .category-edit-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    min-width: 40px;
  }

  .category-name-input,
  .category-id-input {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-size: 0.95rem;
    color: var(--text-normal);
    flex: 1;
  }

  .category-name-input {
    font-weight: 600;
    color: var(--text-accent);
  }

  .category-name-input:focus,
  .category-id-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .category-id-badge {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--background-modifier-border);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    margin-left: 0.4rem;
    font-family: var(--font-monospace);
  }

  .category-helper-badge {
    font-size: 0.7rem;
    font-weight: 600;
    color: #ffffff;
    background: #0088ff;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    margin-left: 0.4rem;
    text-transform: uppercase;
  }

  .category-helper-checkbox {
    cursor: pointer;
    width: 16px;
    height: 16px;
  }

  .category-content {
    animation: slideDown 0.2s ease;
    padding-top: 0.3rem;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      max-height: 0;
    }
    to {
      opacity: 1;
      max-height: 1000px;
    }
  }

  .keyword-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: normal;
    margin-left: 0.25rem;
  }

  .category-icons {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: normal;
    margin-left: 0.25rem;
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 2px;
    align-items: center;
    line-height: 1.2;
    overflow: hidden;
    flex-shrink: 1;
    min-width: 0;
  }

  .category-icon-item {
    display: inline-block;
    padding: 1px 3px;
    border-radius: 3px;
    transition: background-color 0.2s;
  }

  .category-icon-item.is-parsed {
    background-color: rgba(40, 167, 69, 0.3);
  }

  .category-remove {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 22px;
  }

  .category-remove:hover {
    background: var(--color-red-hover);
  }

  .add-category-section {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .category-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }


  .add-category-inputs {
    display: flex;
    gap: 0.5rem;
    flex: 1;
  }

  .add-category-inputs input {
    flex: 1;
  }

  /* Tab Navigation */
  .tab-navigation {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.5rem;
    border-bottom: 2px solid var(--background-modifier-border);
    padding-bottom: 0;
  }

  .tab-button {
    background: transparent;
    border: none;
    padding: 0.1rem 0.5rem;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: all 0.2s ease;
  }

  .tab-button:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .tab-button.active {
    color: var(--text-accent);
    border-bottom-color: var(--interactive-accent);
  }

  .tab-content {
    animation: fadeIn 0.3s ease;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Info Tab */
  .info-content {
    max-width: 800px;
    line-height: 1.6;
  }

  .info-content h2 {
    margin-top: 0;
    margin-bottom: 1rem;
    color: var(--text-accent);
    font-size: 1.5rem;
  }

  .info-content h3 {
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: var(--text-normal);
    font-size: 1.2rem;
  }

  .info-content section {
    margin-bottom: 1.5rem;
  }

  .info-content p {
    margin: 0.5rem 0;
    color: var(--text-normal);
  }

  .info-content ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .info-content li {
    margin: 0.5rem 0;
    color: var(--text-normal);
  }

  .info-content strong {
    color: var(--text-accent);
  }

  /* Groups Tab */
  .groups-content {
    max-width: 900px;
  }

  .groups-content h2 {
    margin-top: 0;
    margin-bottom: 0.35rem;
    color: var(--text-accent);
    font-size: 1.3rem;
  }

  .groups-content .description {
    color: var(--text-muted);
    margin-bottom: 1rem;
    font-size: 0.9em;
  }

  .group-section {
    margin-bottom: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 0.75rem;
    background: var(--background-primary);
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--background-modifier-border);
    cursor: pointer;
    user-select: none;
  }

  .group-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
  }

  .group-toggle {
    font-size: 0.8rem;
    transition: transform 0.2s ease;
    color: var(--text-muted);
  }

  .group-toggle.collapsed {
    transform: rotate(-90deg);
  }

  .group-header h3 {
    margin: 0;
    color: var(--text-accent);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .group-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .group-remove {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 22px;
  }

  .group-remove:hover {
    background: var(--color-red-hover);
  }

  .group-content {
    animation: slideDown 0.2s ease;
  }

  .keywords-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .keyword-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    transition: all 0.2s;
  }

  .keyword-chip:hover {
    background: var(--background-modifier-hover);
  }

  .keyword-chip-icon {
    font-size: 1em;
    line-height: 1;
    display: inline-flex;
    align-items: center;
  }

  .keyword-text {
    color: var(--text-normal);
    font-family: var(--font-monospace);
    font-size: 0.9em;
  }

  .remove-keyword-chip-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    transition: all 0.2s;
  }

  .remove-keyword-chip-btn:hover {
    background: var(--background-modifier-error);
    color: white;
  }

  .add-keyword-to-group {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
  }

  .keyword-search-container {
    flex: 1;
    position: relative;
  }

  .keyword-search-input {
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .keyword-search-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .keyword-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 2px;
    max-height: 200px;
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    z-index: 1000;
  }

  .keyword-dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 0.9em;
  }

  .keyword-dropdown-item:hover {
    background: var(--background-modifier-hover);
  }

  .keyword-dropdown-item.no-results {
    color: var(--text-muted);
    cursor: default;
    font-style: italic;
  }

  .keyword-dropdown-item.no-results:hover {
    background: transparent;
  }

  .keyword-dropdown-icon {
    font-size: 1em;
    line-height: 1;
  }

  .add-keyword-to-group button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .add-keyword-to-group button:hover {
    background: var(--interactive-accent-hover);
  }

  .add-keyword-to-group button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-keyword-to-group button:disabled:hover {
    background: var(--interactive-accent);
  }

  .add-group-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .add-group-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .add-group-form {
    display: flex;
    gap: 0.5rem;
  }

  .add-group-form input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .add-group-form button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
  }

  .add-group-form button:hover {
    background: var(--interactive-accent-hover);
  }

  .parsing-settings-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .parsing-settings-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .sub-item-keywords-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .sub-item-keyword-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    transition: all 0.2s;
  }

  .sub-item-keyword-chip:hover {
    background: var(--background-modifier-hover);
  }

  .add-sub-item-keyword {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  /* Code Block Languages Section */
  .code-blocks-section {
    margin: 1.5rem 0;
    padding: 1rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .code-blocks-section .description {
    margin: 0 0 1rem 0;
    font-size: 0.9em;
    color: var(--text-muted);
  }

  /* 2-column grid layout */
  .code-blocks-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .code-block-item {
    padding: 0.75rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .code-block-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .code-block-icon-input-header {
    width: 60px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 1.1em;
    text-align: center;
  }

  .code-block-icon-input-header:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .code-block-id-input-header {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
    font-weight: 500;
  }

  .code-block-id-input-header:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .code-block-remove-btn {
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
    border: none;
    padding: 0.4rem;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .code-block-remove-btn:hover {
    background: var(--background-modifier-error-hover);
  }

  .add-code-block-section {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    align-items: center;
  }

  .code-block-add-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .code-block-add-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .add-code-block-section button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .add-code-block-section button:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .add-code-block-section button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .auto-parse-btn {
    background: var(--background-modifier-success) !important;
  }

  .auto-parse-btn:hover:not(:disabled) {
    background: var(--background-modifier-success-hover) !important;
  }

  /* Parser Settings Section */
  .parser-settings-section {
    margin: 1.5rem 0;
    padding: 1rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .parser-settings-section h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1em;
    color: var(--text-accent);
  }

  .parser-settings-section .description {
    margin: 0 0 1.5rem 0;
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .parser-input {
    width: 100%;
    max-width: 400px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .parser-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .parser-input-number {
    width: 100px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .parser-input-number:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .parser-checkbox {
    width: 20px;
    height: 20px;
    cursor: pointer;
  }

  .parser-scan-btn {
    padding: 0.5rem 1rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.9em;
    font-weight: 600;
  }

  .parser-scan-btn:hover {
    background: var(--interactive-accent-hover);
  }

  .parser-scan-results {
    margin-top: 1.5rem;
    padding: 1rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .parser-scan-results h2 {
    margin: 0 0 1rem 0;
    font-size: 1.2em;
    color: var(--text-accent);
  }

  .scan-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    padding: 1rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    text-align: center;
  }

  .stat-label {
    font-size: 0.85em;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .stat-value {
    font-size: 1.5em;
    font-weight: 600;
    color: var(--text-normal);
  }

  .keyword-counts-section {
    margin: 1.5rem 0;
    padding: 1rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .keyword-counts-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1em;
    color: var(--text-normal);
    font-weight: 600;
  }

  .keyword-counts-table {
    width: 100%;
    border-collapse: collapse;
  }

  .keyword-counts-table thead {
    background: var(--background-secondary);
  }

  .keyword-counts-table th {
    padding: 0.75rem 1rem;
    text-align: left;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 2px solid var(--background-modifier-border);
  }

  .keyword-counts-table td {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .keyword-counts-table tbody tr:last-child td {
    border-bottom: none;
  }

  .keyword-counts-table tbody tr:hover {
    background: var(--background-modifier-hover);
  }

  .keyword-cell {
    font-family: var(--font-monospace);
    font-weight: 500;
    color: var(--text-normal);
  }

  .count-cell {
    text-align: right;
    font-weight: 600;
    color: var(--text-accent);
  }

  .scan-details {
    margin-top: 1rem;
  }

  .scan-info {
    font-size: 0.9em;
    color: var(--text-muted);
    margin: 0.5rem 0;
  }

  .percentage-bar {
    height: 20px;
    background: var(--background-modifier-border);
    border-radius: 10px;
    overflow: hidden;
    margin: 1rem 0 0.5rem 0;
  }

  .percentage-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .percentage-text {
    font-size: 0.9em;
    color: var(--text-normal);
    margin: 0.5rem 0 1rem 0;
    font-weight: 500;
  }

  .file-list-section {
    margin-top: 1rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .file-list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--background-primary);
    cursor: pointer;
    user-select: none;
  }

  .file-list-header:hover {
    background: var(--background-modifier-hover);
  }

  .file-list-header h3 {
    margin: 0;
    font-size: 0.95em;
    font-weight: 500;
    color: var(--text-normal);
  }

  .file-list-toggle {
    font-size: 0.8em;
    color: var(--text-muted);
  }

  .file-list {
    max-height: 300px;
    overflow-y: auto;
    background: var(--background-primary);
  }

  .file-item {
    padding: 0.5rem 1rem;
    font-size: 0.85em;
    font-family: var(--font-monospace);
    border-top: 1px solid var(--background-modifier-border);
  }

  .file-item.file-excluded {
    color: var(--text-muted);
  }

  /* Family Tab */
  .family-content {
    max-width: 100%;
  }

  .family-item-compact {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    margin-bottom: 0.3rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
  }

  .family-name-input-compact {
    flex: 0 0 150px;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
    font-weight: 600;
  }

  .family-name-input-compact:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .family-filter-container {
    position: relative;
    flex: 1;
    min-width: 120px;
  }

  .family-filter-input {
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
  }

  .family-filter-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .family-count-badge {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    padding: 0.1rem 0.4rem;
    border-radius: 10px;
    font-size: 0.75em;
    font-weight: 600;
    pointer-events: none;
  }

  .family-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 2px;
    max-height: 200px;
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    z-index: 1000;
  }

  .family-dropdown-item {
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 0.85em;
  }

  .family-dropdown-item:hover {
    background: var(--background-modifier-hover);
  }

  .family-filter-input.has-value {
    border-color: var(--interactive-accent);
    background: var(--background-secondary);
    font-weight: 500;
  }

  .family-dropdown-item.selected {
    background: rgba(var(--interactive-accent-rgb), 0.15);
    color: var(--interactive-accent);
    font-weight: 600;
  }

  .family-dropdown-clear {
    color: var(--text-error);
    border-top: 1px solid var(--background-modifier-border);
    font-style: italic;
  }

  .family-dropdown-clear:hover {
    background: var(--background-modifier-error);
    color: white;
  }

  .family-remove-btn-compact {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 3px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .family-remove-btn-compact:hover {
    background: var(--background-modifier-error);
    color: white;
  }

  .add-family-section {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding: 0.4rem 0.5rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
  }

  .add-family-section input {
    flex: 0 0 150px;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
  }

  .add-family-section button {
    padding: 0.35rem 0.6rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.85em;
    white-space: nowrap;
  }

  .add-family-section button:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .add-family-section button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Subjects Tab */
  .subjects-content {
    max-width: 900px;
  }

  .subjects-content h2 {
    margin-top: 0;
    margin-bottom: 0.35rem;
    color: var(--text-accent);
    font-size: 1.3rem;
  }

  .subjects-list {
    margin-bottom: 1.5rem;
  }

  .subject-section {
    margin-bottom: 1rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 0.75rem;
    background: var(--background-primary);
  }

  .subject-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .subject-header h3 {
    margin: 0;
    color: var(--text-accent);
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
  }

  .subject-header h3:hover {
    color: var(--text-accent-hover);
  }

  .subject-name-input {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-accent);
    min-width: 200px;
  }

  .subject-name-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .subject-remove {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 22px;
  }

  .subject-remove:hover {
    background: var(--color-red-hover);
  }

  .subject-operator-section {
    margin: 1rem 0;
    padding: 0.75rem;
    background: var(--background-secondary);
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
  }

  .operator-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-normal);
    margin-bottom: 0.5rem;
  }

  .operator-select {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
  }

  .operator-select:hover {
    background: var(--background-modifier-hover);
  }

  .operator-expression {
    font-size: 0.85rem;
    color: var(--text-muted);
    padding: 0.5rem;
    background: var(--background-primary);
    border-radius: 4px;
    font-family: var(--font-monospace);
  }

  .operator-expression code {
    color: var(--text-normal);
    background: transparent;
  }

  /* Compact Subject Styles */
  .subject-section-compact {
    margin-bottom: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 0.6rem;
    background: var(--background-primary);
  }

  .subject-header-compact {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .subject-name-compact {
    margin: 0;
    color: var(--text-accent);
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    flex: 1;
  }

  .subject-name-compact:hover {
    color: var(--text-accent-hover);
  }

  .subject-name-input-compact {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0.2rem 0.4rem;
    font-size: 0.95rem;
    font-weight: 500;
    flex: 1;
  }

  .subject-main-tag-input {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0.2rem 0.4rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    min-width: 120px;
    max-width: 150px;
    color: var(--text-accent);
    min-width: 150px;
    flex: 1;
  }

  .subject-name-input-compact:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .operator-select-compact {
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
    font-size: 0.85em;
  }

  .operator-select-compact:hover {
    background: var(--background-modifier-hover);
  }

  .subject-remove-compact {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.4rem;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 22px;
  }

  .subject-remove-compact:hover {
    background: var(--color-red-hover);
  }

  /* Plan Expression Styles */
  .subject-plan-container {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.8rem;
    padding: 0.6rem;
    background: var(--background-secondary);
    border-radius: 4px;
  }

  .plan-label {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .plan-input {
    padding: 0.5rem;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9rem;
    font-family: var(--font-monospace);
    transition: all 0.2s;
  }

  .plan-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .plan-input.plan-valid {
    background: rgba(39, 174, 96, 0.1);
    border-color: var(--color-green);
  }

  .plan-input.plan-invalid {
    background: rgba(231, 76, 60, 0.1);
    border-color: var(--color-red);
  }

  .plan-error {
    font-size: 0.8rem;
    color: var(--color-red);
    font-style: italic;
  }

  /* Combination Styles (for multiple tag/keyword combinations within subjects) */
  .combination-item {
    margin-bottom: 0.5rem;
  }

  .combination-or-label {
    text-align: center;
    font-size: 0.75em;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0.3rem 0;
    padding: 0.2rem 0;
  }

  .combination-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    flex-wrap: wrap;
  }

  .combination-section {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .section-mini-label {
    font-size: 0.8em;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .inline-input-mini {
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.8em;
    width: 90px;
  }

  .inline-input-mini:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .inline-add-btn-mini {
    padding: 0.25rem 0.5rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.85em;
    font-weight: 600;
    transition: all 0.2s;
    line-height: 1;
  }

  .inline-add-btn-mini:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .inline-add-btn-mini:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chips-inline-mini {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
  }

  .chip-mini {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.4rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    font-size: 0.75em;
    transition: all 0.2s;
  }

  .chip-mini:hover {
    background: var(--background-modifier-hover);
  }

  .tag-chip-mini {
    border-color: var(--interactive-accent);
    background: rgba(var(--interactive-accent-rgb), 0.1);
  }

  .keyword-chip-mini {
    border-color: var(--background-modifier-border);
  }

  .chip-remove-mini {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: all 0.2s;
  }

  .chip-remove-mini:hover {
    background: var(--background-modifier-error);
    color: white;
  }

  .operator-select-mini {
    padding: 0.25rem 0.4rem;
    border-radius: 3px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
    font-size: 0.8em;
    font-weight: 600;
  }

  .operator-select-mini:hover {
    background: var(--background-modifier-hover);
  }

  .keyword-input-wrapper-mini {
    position: relative;
    flex: 0 0 auto;
  }

  .remove-combination-btn {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.3rem;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    font-size: 16px;
    line-height: 1;
    transition: all 0.2s;
  }

  .remove-combination-btn:hover {
    background: var(--color-red-hover);
  }

  .add-combination-btn {
    padding: 0.4rem 0.7rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    font-weight: 600;
    margin-top: 0.5rem;
    transition: all 0.2s;
  }

  .add-combination-btn:hover {
    background: var(--interactive-accent-hover);
  }

  .subject-row-compact {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
    flex-wrap: wrap;
  }

  .subject-row-compact:last-child {
    margin-bottom: 0;
  }

  .row-label {
    font-size: 0.85em;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
    min-width: 70px;
  }

  .inline-input {
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
    width: 120px;
  }

  .inline-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .inline-add-btn {
    padding: 0.3rem 0.6rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.9em;
    font-weight: 600;
    transition: all 0.2s;
  }

  .inline-add-btn:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .inline-add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chips-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
  }

  .chip-compact {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.5rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    font-size: 0.8em;
    transition: all 0.2s;
  }

  .chip-compact:hover {
    background: var(--background-modifier-hover);
  }

  .tag-chip-compact {
    border-color: var(--interactive-accent);
  }

  .keyword-chip-compact {
    border-color: var(--background-modifier-border);
  }

  .chip-icon {
    font-size: 1em;
    line-height: 1;
  }

  .chip-remove {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    line-height: 1;
    transition: all 0.2s;
  }

  .chip-remove:hover {
    background: var(--background-modifier-error);
    color: white;
  }

  .keyword-input-wrapper-compact {
    position: relative;
    flex: 0 0 auto;
  }

  .keyword-dropdown-compact {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 2px;
    min-width: 200px;
    max-height: 180px;
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    z-index: 1000;
  }

  .keyword-dropdown-item-compact {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 0.85em;
  }

  .keyword-dropdown-item-compact:hover {
    background: var(--background-modifier-hover);
  }

  .keyword-dropdown-empty-compact {
    padding: 0.5rem;
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.85em;
  }

  .subject-subsection {
    margin-bottom: 0.75rem;
  }

  .subject-subsection:last-child {
    margin-bottom: 0;
  }

  .subject-subsection h4 {
    margin: 0 0 0.5rem 0;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tags-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    background: var(--background-secondary);
    border: 1px solid var(--interactive-accent);
    border-radius: 12px;
    transition: all 0.2s;
  }

  .tag-chip:hover {
    background: var(--background-modifier-hover);
  }

  .tag-text {
    color: var(--text-accent);
    font-family: var(--font-monospace);
    font-size: 0.9em;
  }

  .remove-chip-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    transition: all 0.2s;
  }

  .remove-chip-btn:hover {
    background: var(--background-modifier-error);
    color: white;
  }

  .add-tag-form {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .add-tag-form input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .add-tag-form input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .add-tag-form button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .add-tag-form button:hover {
    background: var(--interactive-accent-hover);
  }

  .add-tag-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-tag-form button:disabled:hover {
    background: var(--interactive-accent);
  }

  .add-keyword-form {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .add-keyword-form button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .add-keyword-form button:hover {
    background: var(--interactive-accent-hover);
  }

  .add-keyword-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-keyword-form button:disabled:hover {
    background: var(--interactive-accent);
  }

  .add-subject-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .add-subject-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .add-subject-form {
    display: flex;
    gap: 0.5rem;
  }

  .add-subject-form input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .add-subject-form input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .add-subject-form button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
  }

  .add-subject-form button:hover {
    background: var(--interactive-accent-hover);
  }

  .add-subject-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-subject-form button:disabled:hover {
    background: var(--interactive-accent);
  }

  /* Topics */
  .topic-item {
    margin-bottom: 0.6rem;
    padding: 0.6rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .topic-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .topic-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-normal);
  }

  .topic-remove-btn {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.4rem;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 22px;
  }

  .topic-remove-btn:hover {
    background: var(--color-red-hover);
  }

  .topic-properties {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .topic-props-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .topic-prop-group {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .topic-prop-group label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .topic-checkbox-group {
    margin-left: auto;
  }

  .topic-checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
  }

  .topic-checkbox-group input[type="checkbox"] {
    cursor: pointer;
  }

  .topic-icon-input {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 1.1em;
    width: 60px;
    text-align: center;
  }

  .topic-icon-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .topic-color-input {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85rem;
    font-family: var(--font-monospace);
    width: 100px;
  }

  .topic-color-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .topic-plan-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .topic-plan-group label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .add-topic-section {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--background-modifier-border);
  }

  .topic-name-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
  }

  .topic-name-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .add-topic-btn {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    white-space: nowrap;
    font-weight: 600;
  }

  .add-topic-btn:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .add-topic-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Compact Topic Layout */
  .topic-item-compact {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    flex-wrap: wrap;
  }

  .topic-name-compact {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-normal);
    min-width: 100px;
    flex-shrink: 0;
  }

  .topic-icon-input-compact {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 1.1em;
    width: 50px;
    text-align: center;
  }

  .topic-icon-input-compact:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .topic-color-input-compact {
    width: 50px;
    height: 32px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    cursor: pointer;
    background: var(--background-primary);
  }

  .topic-color-input-compact::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  .topic-color-input-compact::-webkit-color-swatch {
    border-radius: 2px;
    border: none;
  }

  .topic-checkbox-label-compact {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }

  .topic-checkbox-label-compact input[type="checkbox"] {
    cursor: pointer;
  }

  .topic-plan-input-compact {
    flex: 1;
    min-width: 200px;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85rem;
    font-family: var(--font-monospace);
  }

  .topic-plan-input-compact:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .topic-remove-btn-compact {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.4rem;
    border-radius: 3px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }

  .topic-remove-btn-compact:hover {
    background: var(--color-red-hover);
  }

  .topic-error-compact {
    flex-basis: 100%;
    font-size: 0.75rem;
    color: var(--text-error);
    margin-top: -0.25rem;
    padding-left: 0.5rem;
  }

  /* Auto-activate keyword filters section */
  .topic-auto-keywords-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
    margin-left: 1.5rem;
    padding: 0.5rem;
    background: var(--background-secondary);
    border-radius: 4px;
    border-left: 3px solid var(--interactive-accent);
  }

  .topic-auto-input {
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.8rem;
    font-family: var(--font-text);
  }

  .topic-auto-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2);
  }

  .topic-auto-input::placeholder {
    color: var(--text-faint);
    font-style: italic;
  }

  /* Favourite Keywords */
  .favourite-keywords-section {
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .favourite-keywords-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .favourite-keywords-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .favourite-keyword-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: 2px solid var(--interactive-accent-hover);
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .favourite-keyword-chip:hover {
    background: var(--interactive-accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  .favourite-keyword-chip .remove-icon {
    font-size: 1.2em;
    line-height: 1;
    font-weight: bold;
  }

  .favourite-keyword-icon {
    font-size: 1.1em;
    line-height: 1;
    flex-shrink: 0;
  }

  .add-favourite-keyword {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .favourite-keyword-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
  }

  .favourite-keyword-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .add-favourite-keyword-btn {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    white-space: nowrap;
    font-weight: 600;
  }

  .add-favourite-keyword-btn:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .add-favourite-keyword-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Global Topics */
  .global-topics-section {
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  /* Global Topics Import (in SubjectModal) */
  .kb-global-topics-import-container {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--background-secondary);
    border-radius: 6px;
  }

  .kb-global-topic-checkbox-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    transition: all 0.2s;
  }

  .kb-global-topic-checkbox-row:hover {
    background: var(--background-modifier-hover);
    border-color: var(--interactive-accent);
  }

  .kb-global-topic-checkbox-row input[type="checkbox"] {
    cursor: pointer;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .kb-global-topic-checkbox-row input[type="checkbox"]:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .kb-global-topic-checkbox-row label {
    display: flex;
    align-items: center;
    font-size: 0.9em;
    color: var(--text-normal);
    white-space: nowrap;
  }

  .kb-global-topic-icon {
    font-size: 1.1em;
    margin-right: 0.2rem;
  }

  .kb-global-topic-name {
    font-weight: 600;
    color: var(--text-accent);
  }

  .kb-global-topic-details {
    display: none;
  }

  .kb-imported-badge {
    display: none;
  }

  .global-topics-section h2 {
    margin-top: 0;
    margin-bottom: 0.35rem;
    color: var(--text-accent);
    font-size: 1.3rem;
  }

  .global-topics-list {
    margin-bottom: 1rem;
  }

  .no-global-topics {
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
    padding: 1.5rem;
    background: var(--background-secondary);
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .add-global-topic-section {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .syntax-help {
    margin: 1rem 0;
    padding: 0.75rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .syntax-help h4 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .syntax-help ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .syntax-help li {
    margin: 0.3rem 0;
    font-size: 0.85rem;
    color: var(--text-normal);
  }

  .syntax-help code {
    background: var(--background-primary);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--font-monospace);
    font-size: 0.9em;
    color: var(--text-accent);
  }

  .syntax-example {
    margin: 0.5rem 0 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .syntax-example code {
    background: var(--background-primary);
    padding: 4px 8px;
    border-radius: 3px;
    font-family: var(--font-monospace);
    color: var(--text-normal);
  }

  /* Pairs Tab (deprecated) */
  .pairs-content {
    max-width: 900px;
  }

  .pairs-content h2 {
    margin-top: 0;
    margin-bottom: 0.35rem;
    color: var(--text-accent);
    font-size: 1.3rem;
  }

  .pairs-list {
    margin-bottom: 1.5rem;
  }

  .pair-section {
    margin-bottom: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 0.75rem;
    background: var(--background-primary);
  }

  .pair-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .pair-header h3 {
    margin: 0;
    color: var(--text-accent);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .pair-remove {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 22px;
  }

  .pair-remove:hover {
    background: var(--color-red-hover);
  }

  .add-pair-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .add-pair-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .add-pair-form {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .pair-tag-input {
    flex: 0 0 200px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .pair-tag-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .add-pair-form .keyword-search-container {
    flex: 1;
  }

  .add-pair-form button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .add-pair-form button:hover {
    background: var(--interactive-accent-hover);
  }

  .add-pair-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-pair-form button:disabled:hover {
    background: var(--interactive-accent);
  }

  /* Filters Tab */
  .filters-content {
    max-width: 900px;
  }

  .filters-content h2 {
    margin-top: 0;
    margin-bottom: 0.35rem;
    color: var(--text-accent);
    font-size: 1.3rem;
  }

  .filters-list {
    margin-bottom: 1.5rem;
  }

  .filter-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-primary);
    transition: all 0.2s;
  }

  .filter-item:hover {
    background: var(--background-modifier-hover);
  }

  .filter-text {
    font-family: var(--font-monospace);
    color: var(--text-normal);
    font-size: 0.95em;
    flex: 1;
  }

  .filter-remove {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 22px;
  }

  .filter-remove:hover {
    background: var(--color-red-hover);
  }

  .no-filters {
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
    padding: 2rem;
    background: var(--background-secondary);
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }

  .add-filter-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .add-filter-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .add-filter-form {
    display: flex;
    gap: 0.5rem;
  }

  .add-filter-form input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  .add-filter-form input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .add-filter-form button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .add-filter-form button:hover {
    background: var(--interactive-accent-hover);
  }

  .add-filter-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-filter-form button:disabled:hover {
    background: var(--interactive-accent);
  }

  .favourite-tags-section {
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .favourite-tags-section h2 {
    margin-top: 0;
    margin-bottom: 0.35rem;
    color: var(--text-accent);
    font-size: 1.3rem;
  }

  /* Daily Progress Tab */
  .daily-progress-settings-content {
    max-width: 900px;
  }

  .daily-progress-settings-content h2 {
    margin-top: 0;
    margin-bottom: 0.35rem;
    color: var(--text-accent);
    font-size: 1.3rem;
  }

  .time-input {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
    font-family: var(--font-monospace);
  }

  .time-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }


  /* Goal Keywords */
  .goal-keywords-section {
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .goal-keywords-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .goal-keywords-header h3 {
    margin: 0;
    color: var(--text-normal);
    font-size: 1rem;
    font-weight: 500;
  }

  .goal-keywords-header .keyword-search-container {
    position: relative;
    flex: 0 0 auto;
  }

  .keyword-search-input-inline {
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
    width: 180px;
  }

  .keyword-search-input-inline:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .goal-keywords-inline-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .goal-keyword-chip {
    display: inline-flex;
    align-items: center;
    position: relative;
    border-radius: 4px;
    overflow: hidden;
    transition: all 0.2s;
  }

  .goal-keyword-chip:hover .goal-keyword-remove-x {
    opacity: 1;
    pointer-events: auto;
  }

  .goal-keyword-content {
    padding: 0.4rem 0.8rem;
    font-weight: 600;
    font-size: 0.9em;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    transition: padding-right 0.2s;
  }

  .goal-keyword-chip:hover .goal-keyword-content {
    padding-right: 2rem;
  }

  .goal-keyword-content-missing {
    padding: 0.4rem 0.8rem;
    font-size: 0.9em;
    background: var(--background-modifier-error);
    color: var(--text-error);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    transition: padding-right 0.2s;
  }

  .goal-keyword-chip:hover .goal-keyword-content-missing {
    padding-right: 2rem;
  }

  .goal-keyword-icon {
    font-size: 1.1em;
    line-height: 1;
  }

  .goal-keyword-remove-x {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    background: var(--color-red);
    color: white;
    border: none;
    cursor: pointer;
    font-size: 16px;
    font-weight: bold;
    padding: 0 0.5rem;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .goal-keyword-remove-x:hover {
    background: var(--color-red-hover);
  }

  .no-goal-keywords {
    color: var(--text-muted);
    font-style: italic;
    padding: 1rem;
    background: var(--background-secondary);
    border-radius: 4px;
    margin-top: 0.75rem;
    font-size: 0.9em;
  }

  /* Keywords Table */
  .keywords-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0.5rem;
    font-size: 0.9em;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    overflow: hidden;
  }

  .keywords-table thead {
    background: var(--background-primary-alt);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .keywords-table th {
    padding: 0.5rem 0.3rem;
    text-align: center;
    font-weight: 600;
    font-size: 0.8em;
    border-bottom: 2px solid var(--background-modifier-border);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .keywords-table th:first-child {
    text-align: center;
  }

  .keywords-table tbody tr {
    transition: background-color 0.1s;
  }

  .th-add {
    padding: 0 !important;
  }

  .add-keyword-header-btn {
    width: 100%;
    height: 100%;
    background: #28a745;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 18px;
    font-weight: bold;
    padding: 0.4rem;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-keyword-header-btn:hover {
    background: #218838;
    transform: scale(1.1);
  }

  .add-keyword-header-btn:active {
    transform: scale(0.95);
  }

  /* Spaced Rep Settings */
  .spaced-rep-settings-content {
    padding: 1rem;
  }

  .delimiter-input {
    padding: 6px 10px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    color: var(--text-normal);
    font-family: var(--font-monospace);
    font-size: 0.95em;
    width: 120px;
  }

  .delimiter-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .preview-section {
    margin-top: 2rem;
    padding: 1rem;
    background: var(--background-secondary);
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
  }

  .preview-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-accent);
    font-size: 1rem;
  }

  .example-box {
    margin: 1rem 0;
    padding: 0.75rem;
    background: var(--background-primary);
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
  }

  .example-title {
    font-size: 0.85em;
    color: var(--text-muted);
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .example-content {
    font-family: var(--font-text);
    color: var(--text-normal);
    line-height: 1.6;
  }

  .hidden-placeholder {
    font-family: var(--font-monospace);
    color: var(--text-muted);
    background: var(--background-modifier-border);
    padding: 2px 8px;
    border-radius: 3px;
  }

  /* Favourite Date Ranges */
  .favourite-date-ranges-section {
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .favourite-date-ranges-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 1rem;
    font-weight: 500;
  }

  .date-ranges-list {
    margin-bottom: 1.5rem;
  }

  .date-range-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-primary);
    transition: all 0.2s;
  }

  .date-range-item:hover {
    background: var(--background-modifier-hover);
  }

  .date-range-icon {
    font-size: 1.5em;
    line-height: 1;
    flex-shrink: 0;
  }

  .date-range-dates {
    font-family: var(--font-monospace);
    color: var(--text-normal);
    font-size: 0.95em;
    flex: 1;
  }

  .date-range-remove {
    background: var(--color-red);
    color: white;
    border: none;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 22px;
  }

  .date-range-remove:hover {
    background: var(--color-red-hover);
  }

  .no-date-ranges {
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
    padding: 2rem;
    background: var(--background-secondary);
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }

  .add-date-range-section {
    margin-top: 1rem;
  }

  .add-date-range-section h3 {
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
    font-size: 0.95rem;
    font-weight: 500;
  }

  .add-date-range-form {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .date-range-icon-input {
    width: 60px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 1.2em;
    text-align: center;
  }

  .date-range-icon-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .date-range-date-input {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
    font-family: var(--font-monospace);
  }

  .date-range-date-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .date-range-arrow {
    color: var(--text-muted);
    font-size: 1.2em;
  }

  .add-date-range-form button {
    padding: 0.4rem 0.8rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .add-date-range-form button:hover {
    background: var(--interactive-accent-hover);
  }

  .add-date-range-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-date-range-form button:disabled:hover {
    background: var(--interactive-accent);
  }

  /* Filters Tab Styles */
  .filters-content {
    padding: 1rem;
  }

  .filters-content h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5em;
    color: var(--text-normal);
  }

  .filters-content .description {
    margin: 0 0 1.5rem 0;
    color: var(--text-muted);
    font-size: 0.95em;
  }

  .filter-input-section {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
    margin-bottom: 2rem;
  }

  .filter-input-section label {
    font-weight: 600;
    color: var(--text-normal);
    margin-bottom: 0.5rem;
    display: block;
  }

  .filter-expression-input {
    flex: 1;
    padding: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-family: var(--font-monospace);
    font-size: 0.95em;
  }

  .test-filter-btn {
    padding: 0.75rem 1.5rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    white-space: nowrap;
  }

  .test-filter-btn:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .test-filter-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .filter-results {
    margin-top: 2rem;
  }

  .filter-results h3 {
    margin: 0 0 1rem 0;
    font-size: 1.3em;
    color: var(--text-normal);
  }

  .filter-results h4 {
    margin: 1.5rem 0 0.75rem 0;
    font-size: 1.1em;
    color: var(--text-normal);
    font-weight: 600;
  }

  .filter-stats {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    flex: 1;
    padding: 1rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .stat-label {
    font-size: 0.9em;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .stat-value {
    font-size: 2em;
    font-weight: 700;
    color: var(--text-accent);
  }

  .keyword-breakdown-section {
    margin-top: 1.5rem;
    padding: 1rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .keyword-breakdown-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0.5rem;
  }

  .keyword-breakdown-table thead {
    background: var(--background-secondary);
  }

  .keyword-breakdown-table th {
    padding: 0.75rem 1rem;
    text-align: left;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 2px solid var(--background-modifier-border);
  }

  .keyword-breakdown-table td {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .keyword-breakdown-table tbody tr:last-child td {
    border-bottom: none;
  }

  .keyword-breakdown-table tbody tr:hover {
    background: var(--background-modifier-hover);
  }

  .preview-records-section {
    margin-top: 1.5rem;
  }

  .preview-records-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 0.5rem;
  }

  .preview-record-item {
    padding: 1rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }

  .preview-record-item:hover {
    border-color: var(--interactive-accent);
  }

  .record-keyword {
    font-family: var(--font-monospace);
    font-weight: 600;
    color: var(--text-accent);
    margin-bottom: 0.5rem;
  }

  .record-text {
    color: var(--text-normal);
    margin-bottom: 0.5rem;
    line-height: 1.5;
  }

  .record-subitems {
    margin-left: 1.5rem;
    margin-bottom: 0.5rem;
    padding-left: 0.75rem;
    border-left: 2px solid var(--background-modifier-border);
  }

  .record-subitem {
    padding: 0.25rem 0;
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .subitem-keywords {
    font-weight: 600;
    color: var(--text-accent);
    font-family: var(--font-monospace);
    margin-right: 0.5rem;
  }

  .subitem-text {
    color: var(--text-normal);
  }

  .record-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.85em;
    color: var(--text-muted);
  }

  .record-file {
    font-family: var(--font-monospace);
  }

  .record-line {
    font-weight: 500;
  }

  /* KB-style Subjects & Topics */
  .kb-subjects-content {
    padding: 0.5rem;
  }

  .kb-subject-selector {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    align-items: center;
  }

  .kb-subject-selector select {
    flex: 1;
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .kb-subject-selector input {
    flex: 1;
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .kb-subject-selector button {
    padding: 8px 16px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
  }

  .kb-subject-selector button:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .kb-subject-selector button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .kb-delete-btn {
    background: var(--background-modifier-error) !important;
  }

  .kb-subject-details {
    margin-top: 10px;
  }

  .kb-modal-row {
    display: flex;
    gap: 15px;
    margin-bottom: 15px;
  }

  .kb-modal-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 15px;
  }

  .kb-modal-field label {
    font-weight: 600;
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .kb-modal-field input {
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .kb-modal-field-half {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .kb-modal-field-half label {
    font-weight: 600;
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .kb-modal-field-half input {
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  /* Topics */
  .kb-topic-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 20px 0 10px 0;
  }

  .kb-section-title {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }

  .kb-add-topic-inline-btn {
    padding: 6px 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    font-weight: 600;
  }

  .kb-add-topic-inline-btn:hover {
    background: var(--interactive-accent-hover);
  }

  .kb-topics-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .kb-topic-card {
    padding: 2px 2px 0 2px;
    background-color: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 6px;
  }

  .kb-topic-field-name {
    flex: 0 0 100px;
    max-width: 100px;
    min-width: 0;
    margin-right: 8px;
  }

  .kb-topic-field-name input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
  }

  .kb-topic-field-name-primary {
    flex: 0 0 70px;
    max-width: 70px;
    margin-right: 8px;
  }

  .kb-topic-field-name-primary input {
    width: 70px !important;
    max-width: 70px;
    padding: 4px 6px;
    font-size: 0.85em;
  }

  .kb-topic-field-icon {
    flex: 0 0 45px;
    max-width: 45px;
    margin-right: 8px;
  }

  .kb-topic-field-icon input {
    width: 45px;
    padding: 6px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
    text-align: center;
  }

  .kb-topic-field-icon-primary {
    flex: 0 0 35px;
    max-width: 35px;
    margin-right: 8px;
  }

  .kb-topic-field-icon-primary input {
    width: 35px !important;
    max-width: 35px;
    padding: 2px 4px;
    font-size: 0.85em;
    text-align: center;
  }

  .kb-topic-field-compact {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex: 0 0 auto;
    margin-right: 8px;
  }

  .kb-topic-field-compact label {
    display: block;
    margin-bottom: 0;
    margin-right: 6px;
    font-weight: 600;
    font-size: 0.85em;
    color: var(--text-normal);
    min-width: 35px;
  }

  .kb-topic-field-compact input {
    width: 60px;
    padding: 6px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background-color: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
  }

  .kb-topic-field-expr {
    flex: 1;
    min-width: 0;
    margin-right: 8px;
  }

  .kb-topic-field-expr input {
    width: 100% !important;
    max-width: none;
    padding: 6px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
  }

  .kb-topic-delete-btn {
    flex: 0 0 auto;
    padding: 6px 8px;
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1em;
  }

  .kb-topic-delete-btn:hover {
    opacity: 0.8;
  }

  .kb-empty-hint {
    color: var(--text-muted);
    font-style: italic;
    padding: 1rem;
    text-align: center;
    font-size: 0.9em;
  }

  .kb-hint-box {
    margin-top: 1rem;
    padding: 0.75rem;
    background: var(--background-primary-alt);
    border-left: 3px solid var(--interactive-accent);
    border-radius: 4px;
    font-size: 0.9em;
  }

  .kb-hint-box strong {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--text-normal);
  }

  .kb-hint-box code {
    background: var(--background-primary);
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    font-family: var(--font-monospace);
    font-size: 0.9em;
    color: var(--text-accent);
  }

  /* Subjects Tab - List View */
  .kb-subjects-tab {
    padding: 1rem;
  }

  .kb-subjects-tab h2 {
    margin-top: 0;
    margin-bottom: 0.5rem;
    color: var(--text-accent);
    font-size: 1.5em;
  }

  .kb-description {
    color: var(--text-muted);
    margin-bottom: 1.5rem;
    font-size: 0.95em;
  }

  .kb-filter-list {
    margin-bottom: 1.5rem;
  }

  .kb-filter-item {
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    transition: all 0.2s;
  }

  .kb-filter-item:hover {
    background: var(--background-modifier-hover);
  }

  .kb-filter-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .kb-filter-icon {
    font-size: 1.2em;
    flex-shrink: 0;
  }

  .kb-filter-name {
    font-size: 1em;
    font-weight: 600;
    color: var(--text-normal);
    min-width: 120px;
    flex-shrink: 0;
  }

  .kb-filter-maintag {
    font-size: 0.85em;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .kb-filter-maintag code {
    background: var(--background-secondary);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-family: var(--font-monospace);
    color: var(--text-accent);
  }

  .kb-filter-expression-inline {
    flex: 1;
    font-size: 0.85em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kb-filter-expression-inline code {
    font-family: var(--font-monospace);
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .kb-filter-btn-inline {
    padding: 0.35rem 0.75rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.85em;
    transition: background 0.2s;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .kb-filter-btn-inline:hover {
    background: var(--interactive-accent-hover);
  }

  .kb-filter-btn-inline.kb-filter-btn-danger {
    background: var(--background-modifier-error);
  }

  .kb-filter-btn-inline.kb-filter-btn-danger:hover {
    background: var(--background-modifier-error-hover);
  }

  .kb-empty-message {
    text-align: center;
    padding: 2rem;
    color: var(--text-muted);
    font-style: italic;
    background: var(--background-secondary);
    border-radius: 6px;
  }

  .kb-add-subject-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--background-modifier-border);
  }

  .kb-add-subject-btn {
    padding: 0.75rem 1.5rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1em;
    font-weight: 600;
    transition: background 0.2s;
  }

  .kb-add-subject-btn:hover {
    background: var(--interactive-accent-hover);
  }

  /* Subject Modal Styles */
  .kb-subject-modal {
    padding: 1rem;
  }

  .kb-subject-modal h2 {
    margin-top: 0;
    margin-bottom: 1.5rem;
    color: var(--text-accent);
  }

  .kb-topic-section {
    margin-bottom: 1.5rem;
  }

  .kb-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .kb-modal-btn {
    padding: 0.5rem 1rem;
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    transition: all 0.2s;
  }

  .kb-modal-btn:hover {
    background: var(--background-modifier-hover);
  }

  .kb-modal-btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .kb-modal-btn-primary:hover {
    background: var(--interactive-accent-hover);
  }

  /* VWord Settings */
  .vword-settings-section {
    padding: 1rem;
  }

  .vword-settings-section h2 {
    margin-bottom: 0.5rem;
  }

  .vword-settings-section .description {
    color: var(--text-muted);
    margin-bottom: 1.5rem;
  }

  .vword-explanation {
    background: var(--background-secondary);
    padding: 1rem;
    border-radius: 6px;
    margin-bottom: 2rem;
  }

  .vword-explanation h3 {
    margin-top: 0;
    margin-bottom: 1rem;
  }

  .vword-type {
    margin-bottom: 1.5rem;
  }

  .vword-type h4 {
    margin-bottom: 0.5rem;
    color: var(--text-accent);
  }

  .vword-type p {
    margin: 0.3rem 0;
  }

  .vword-type code {
    background: var(--background-primary);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--font-monospace);
  }

  .vword-type ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .vword-type li {
    margin: 0.3rem 0;
  }

  .vword-color-settings {
    background: var(--background-secondary);
    padding: 1rem;
    border-radius: 6px;
  }

  .vword-color-settings h3 {
    margin-top: 0;
    margin-bottom: 0.5rem;
  }

  .vword-color-settings > p {
    color: var(--text-muted);
    margin-bottom: 1rem;
  }

  .color-pickers {
    display: flex;
    gap: 2rem;
    margin-bottom: 1.5rem;
  }

  .color-picker-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .color-picker-item label {
    font-weight: 500;
  }

  .color-picker-item input[type="color"] {
    width: 50px;
    height: 35px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
  }

  .color-value {
    font-family: var(--font-monospace);
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .vword-preview {
    padding-top: 1rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .vword-preview p {
    margin-bottom: 0.5rem;
  }

  .vword-preview-text {
    display: inline-block;
    font-family: var(--font-monospace);
  }

</style>
