<script lang="ts">
  import type { KeywordStyle, Category } from 'src/shared';
  import { isCollected, isSpaced } from 'src/shared/collecting-status';
  import KeywordSetting from './KeywordSetting.svelte';
  import ColorHighlightSettings from './ColorHighlightSettings.svelte';
  import type { Writable } from 'svelte/store';
  import {
    addKeyword, removeKeyword, addCategory, removeCategory,
    keywordsStore, settingsStore as store, type PluginSettings, saveStore,
  } from 'src/stores/settings-store';
  import { setIcon, Notice, TFile } from 'obsidian';
  import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
  import { addSRSSettings } from './SRSSettings';

  export let settingsStore: Writable<PluginSettings>;
  export let plugin: HighlightSpaceRepeatPlugin;

  $: categories = $keywordsStore?.categories || [];


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
    categories.forEach(cat => {
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
  let activeTab: 'keywords' | 'vword' | 'generic' | 'srs' | 'colors' = 'keywords';

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
  // Filter out the "Colors" category (auto-generated keywords shown in Colors tab)
  $: categoriesWithFilteredKeywords = categories
    .filter(cat => cat.id !== 'colors-category')
    .map(cat => {
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

  // Statistics - reactive computed values (exclude Colors category)
  $: totalKeywords = categories
    .filter(cat => cat.id !== 'colors-category')
    .reduce((sum, cat) => sum + cat.keywords.length, 0);

  // Parsed/collected to records (exclude Colors category)
  $: isParsedCount = categories
    .filter(cat => cat.id !== 'colors-category')
    .reduce((sum, cat) =>
      sum + cat.keywords.filter(kw => isCollected(kw.collectingStatus)).length, 0);

  // Get first 5 keywords with icons for collected keywords (exclude Colors category)
  $: parsedKeywords = categories
    .filter(cat => cat.id !== 'colors-category')
    .flatMap(cat => cat.keywords)
    .filter(kw => isCollected(kw.collectingStatus) && kw.generateIcon && kw.generateIcon.trim())
    .slice(0, 5);

  // Keyword reference files count
  let foundReferenceFilesCount = 0;
  let totalKeywordsForReference = 0;

  // Scan for keyword reference files
  async function scanForReferenceFiles() {
    const referencePath = $settingsStore.keywordDescriptionsPath;
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
  $: if ($settingsStore.keywordDescriptionsPath !== undefined) {
    scanForReferenceFiles();
  }
  $: if (categories) {
    scanForReferenceFiles();
  }

  function handleAddKeyword(categoryName: string) {
    addKeyword('', categoryName);
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

  // Get all keywords with their category info (exclude Colors category)
  function getAllKeywordsWithCategories(): Array<{ keyword: string; categoryName: string; keywordObj: KeywordStyle }> {
    const result: Array<{ keyword: string; categoryName: string; keywordObj: KeywordStyle }> = [];
    categories
      .filter(cat => cat.id !== 'colors-category')
      .forEach(cat => {
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
    const fileName = $settingsStore.keywordsDashboardFileName;
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
      await saveStore();
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
      await saveStore();
      newGroupName = '';
    }
  }

  async function handleRemoveKeywordGroup(groupName: string) {
    removeKeywordGroup(groupName);
    await saveStore();
  }

  async function handleAddKeywordToGroup(groupName: string) {
    const keyword = selectedKeywordByGroup[groupName];
    if (keyword && keyword !== '') {
      addKeywordToGroup(groupName, keyword);
      await saveStore();
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
    const currentCategories = $keywordsStore?.categories || [];

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
    await saveStore();
  }

  function toggleGroup(groupName: string) {
    if (collapsedGroups.has(groupName)) {
      collapsedGroups.delete(groupName);
    } else {
      collapsedGroups.add(groupName);
    }
    collapsedGroups = collapsedGroups;
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
    class:active={activeTab === 'vword'}
    on:click={() => activeTab = 'vword'}
  >
    🎨 VWord
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

  <button
    class="tab-button"
    class:active={activeTab === 'colors'}
    on:click={() => activeTab = 'colors'}
  >
    🎨 Colors
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
          {#each categories.filter(cat => cat.id !== 'colors-category') as cat}
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
            <button type="button" class="category-header" on:click={() => toggleCategory(category.icon)}>
              <div class="category-title">
                <span class="category-toggle" class:collapsed={collapsedCategories.has(category.icon)}>
                  ▼
                </span>
                <div class="category-edit-container">
                  <input
                    type="text"
                    value={category.icon}
                    on:change={(e) => {
                      settingsStore.update((settings) => {
                        const cat = settings.categories.find(c => c.icon === category.icon);
                        if (cat) cat.icon = e.target.value.trim();
                        return settings;
                      });
                    }}
                    on:click|stopPropagation
                    class="category-icon-input"
                    placeholder="Icon"
                  />
                  <input
                    type="text"
                    value={category.id || ''}
                    on:change={(e) => {
                      settingsStore.update((settings) => {
                        const cat = settings.categories.find(c => c.icon === category.icon);
                        if (cat) cat.id = e.target.value.trim() || undefined;
                        return settings;
                      });
                    }}
                    on:click|stopPropagation
                    class="category-id-input"
                    placeholder="id (optional)"
                  />
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
                </div>
              </div>
              <div class="category-controls">
                <button
                  class="category-remove"
                  aria-label="Remove category"
                  use:useIcon={'trash'}
                  on:click|stopPropagation={() => handleRemoveCategory(category.icon)}
                ></button>
              </div>
            </button>

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
                      <th title="Icon Priority">🖼️</th>
                      <th title="Style Priority">🎨</th>
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
  {:else if activeTab === 'generic'}
    <div>
      <!-- Keywords Dashboard (Generate Keywords Reference File) -->
      <div class="keywords-reference-section">
        <h3>Keywords Dashboard</h3>
        <p class="description">Generate a markdown file with all keywords organized by category under a "# keywords" header.</p>
        <div class="keywords-reference-controls">
          <input
            type="text"
            bind:value={$settingsStore.keywordsDashboardFileName}
            on:change={async () => await saveStore()}
            placeholder="Enter file name (e.g., home page)"
            class="keywords-reference-input"
          />
          <button
            class="keywords-reference-generate-btn"
            on:click={handleGenerateKeywordsReference}
            disabled={!$settingsStore.keywordsDashboardFileName || !$settingsStore.keywordsDashboardFileName.trim()}
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
            bind:value={$settingsStore.keywordDescriptionsPath}
            on:change={async () => {
              await saveStore();
              await scanForReferenceFiles();
            }}
            placeholder="Enter directory path (e.g., foo/bar)"
            class="reference-path-input"
          />
          {#if $settingsStore.keywordDescriptionsPath && $settingsStore.keywordDescriptionsPath.trim()}
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
          bind:value={$settingsStore.badgeExcludedPaths}
          on:change={async () => await saveStore()}
          placeholder="e.g., _journal, templates, archive"
          class="badge-excluded-paths-input"
        />
      </div>

      <!-- Parser Settings -->
      <div class="parser-settings-section">
        <h3>Parser Settings</h3>

        <!-- Exclude Patterns -->
        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Exclude Patterns</div>
            <div class="setting-item-description">Comma-separated paths to exclude when parsing (e.g., "_/, templates/, .trash")</div>
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
            <div class="setting-item-description">Extract keywords from &lt;mark class="keyword"&gt; tags in entry text</div>
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
              bind:value={$settingsStore.vword.color}
              on:change={async () => await saveStore()}
            />
            <span class="color-value">{$settingsStore.vword.color}</span>
          </div>

          <div class="color-picker-item">
            <label for="vword-bg-color">Background Color:</label>
            <input
              type="color"
              id="vword-bg-color"
              bind:value={$settingsStore.vword.backgroundColor}
              on:change={async () => await saveStore()}
            />
            <span class="color-value">{$settingsStore.vword.backgroundColor}</span>
          </div>
        </div>

        <div class="vword-preview">
          <p><strong>Preview:</strong></p>
          <span
            class="vword-preview-text"
            style="color: {$settingsStore.vword.color}; background-color: {$settingsStore.vword.backgroundColor}; padding: 4px 8px; border-radius: 3px;"
          >
            VWord keyword
          </span>
        </div>
      </div>

      <div class="vword-layout-settings">
        <h3>⚙️ Layout Restructuring</h3>
        <p class="description">Control timing for layout restructuring (i-keywords, l-keywords).</p>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Retry Delay (ms)</div>
            <div class="setting-item-description">
              Delay in milliseconds before retrying layout restructuring for slow-rendering lists.
              Increase if some layouts don't apply correctly on page load.
            </div>
          </div>
          <div class="setting-item-control">
            <input
              type="number"
              min="0"
              max="1000"
              step="50"
              bind:value={$settingsStore.layoutRetryDelayMs}
              on:change={async () => await saveStore()}
              placeholder="100"
              class="layout-retry-delay-input"
            />
          </div>
        </div>
      </div>
    </div>
  {:else if activeTab === 'srs'}
    <div bind:this={srsContainer} class="srs-settings-content"></div>
  {:else if activeTab === 'colors'}
    <ColorHighlightSettings {settingsStore} />
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
    /* Reset button styles */
    background: none;
    border: none;
    font: inherit;
    text-align: left;
    width: 100%;

    /* Layout */
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

  .category-header:hover {
    background: var(--background-modifier-hover);
  }

  .category-header:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
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



  .category-edit-container {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex: 1;
  }

  .category-icon-input {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0.2rem 0.3rem;
    font-size: 0.95rem;
    color: var(--text-accent);
    font-weight: 600;
    width: 40px;
    text-align: center;
  }

  .category-id-input {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0.2rem 0.4rem;
    font-size: 0.85rem;
    color: var(--text-normal);
    width: 100px;
    font-family: var(--font-monospace);
  }

  .category-icon-input:focus,
  .category-id-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
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





  /* Parser Settings Section */
  .parser-settings-section {
    margin: 1.5rem 0;
    padding: 1rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
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
