<script lang="ts">
  import type { KeywordStyle } from 'src/shared';
  import { KeywordType, getKeywordType } from 'src/shared';
  import { CollectingStatus } from 'src/shared/collecting-status';
  import { MainCombinePriority, AuxiliaryCombinePriority } from 'src/shared/combine-priority';
  import { setIcon } from 'obsidian';
  import { createEventDispatcher } from 'svelte';
  import { settingsStore } from 'src/stores/settings-store';
  import Checkbox from './Checkbox.svelte';
  import { SubKeywordsModal } from './SubKeywordsModal';

  export let keyword: KeywordStyle;
  export let keywordIndex: number;  // Local index within category
  export let categoryName: string;
  export let isFirst: boolean = false;
  export let isLast: boolean = false;

  const dispatch = createEventDispatcher();

  // Check if parent category is a helper category
  $: parentCategory = $settingsStore.categories.find(cat => cat.icon === categoryName);
  $: isHelperCategory = parentCategory?.isHelper === true;

  // Reactive 3-state label and tooltip for collecting status
  $: stateLabel = keyword.collectingStatus === CollectingStatus.SPACED ? '🔄'
    : keyword.collectingStatus === CollectingStatus.PARSED ? '✅'
    : '❌';
  $: stateTooltip = keyword.collectingStatus === CollectingStatus.SPACED
    ? 'Spaced (SRS enabled + parsed)'
    : keyword.collectingStatus === CollectingStatus.PARSED
    ? 'Parsed (collected in records)'
    : 'Ignored (not collected)';

  // Reactive priority label and tooltip - CONDITIONAL based on keywordType
  $: currentType = getKeywordType(keyword);
  $: isMain = currentType === KeywordType.MAIN;

  // Label for type toggle button (only Main/Aux at keyword level)
  $: typeLabel = currentType === KeywordType.MAIN ? 'Main' : 'Aux';
  $: priorityLabel = isMain
    ? (keyword.combinePriority === MainCombinePriority.StyleAndIcon ? '🎨🖼️'
      : keyword.combinePriority === MainCombinePriority.Style ? '🎨'
      : keyword.combinePriority === MainCombinePriority.Icon ? '🖼️'
      : '-')
    : (keyword.combinePriority === AuxiliaryCombinePriority.OverrideIcon ? '⚡' : '📎');

  $: priorityTooltip = isMain
    ? (keyword.combinePriority === MainCombinePriority.StyleAndIcon
      ? 'Both priorities: Use this main keyword\'s styles AND icon when auxiliaries present'
      : keyword.combinePriority === MainCombinePriority.Style
      ? 'Style priority: Use this main keyword\'s colors/classes when auxiliaries present'
      : keyword.combinePriority === MainCombinePriority.Icon
      ? 'Icon priority: Use this main keyword\'s icon when auxiliaries present'
      : 'No priority (auxiliaries can override)')
    : (keyword.combinePriority === AuxiliaryCombinePriority.OverrideIcon
      ? 'Override icon when multiple auxiliaries present'
      : 'Append icon alongside other auxiliaries');

  function handleMoveUp() {
    dispatch('moveup', { categoryName, keywordIndex });
  }

  function handleMoveDown() {
    dispatch('movedown', { categoryName, keywordIndex });
  }

  function toggleState() {
    // Cycle through: ❌ (IGNORED) → ✅ (PARSED) → 🔄 (SPACED) → ❌ (IGNORED)
    if (!keyword.collectingStatus || keyword.collectingStatus === CollectingStatus.IGNORED) {
      keyword.collectingStatus = CollectingStatus.PARSED;
    } else if (keyword.collectingStatus === CollectingStatus.PARSED) {
      keyword.collectingStatus = CollectingStatus.SPACED;
    } else {
      keyword.collectingStatus = CollectingStatus.IGNORED;
    }

    keyword = keyword; // Trigger reactivity
    updateKeyword();
  }

  function togglePriority() {
    if (keyword.mainKeyword === true) {
      // Main keyword: Cycle through - → 🎨 → 🖼️ → 🎨🖼️ → -
      if (!keyword.combinePriority || keyword.combinePriority === MainCombinePriority.None) {
        keyword.combinePriority = MainCombinePriority.Style;
      } else if (keyword.combinePriority === MainCombinePriority.Style) {
        keyword.combinePriority = MainCombinePriority.Icon;
      } else if (keyword.combinePriority === MainCombinePriority.Icon) {
        keyword.combinePriority = MainCombinePriority.StyleAndIcon;
      } else {
        keyword.combinePriority = MainCombinePriority.None;
      }
    } else {
      // Auxiliary keyword: Toggle between 📎 ↔ ⚡
      if (keyword.combinePriority === AuxiliaryCombinePriority.OverrideIcon) {
        keyword.combinePriority = AuxiliaryCombinePriority.AppendIcon;
      } else {
        keyword.combinePriority = AuxiliaryCombinePriority.OverrideIcon;
      }
    }

    keyword = keyword; // Trigger reactivity
    updateKeyword();
  }

  function toggleMainKeyword() {
    // Toggle between: MAIN ↔ AUXILIARY
    const type = getKeywordType(keyword);

    if (type === KeywordType.MAIN) {
      keyword.keywordType = KeywordType.AUXILIARY;
    } else {
      keyword.keywordType = KeywordType.MAIN;
    }

    keyword = keyword; // Trigger reactivity
    updateKeyword();
  }

  function updateKeyword() {
    // This function will trigger reactivity for the parent store
    // Create a new reference to trigger Svelte reactivity
    settingsStore.update((settings) => ({ ...settings }));
  }

  // Sub-keywords count and badge
  $: subKeywordsCount = keyword.subKeywords?.length || 0;
  $: subKeywordsBadge = subKeywordsCount === 0 ? '' : (subKeywordsCount > 9 ? '*' : subKeywordsCount.toString());

  function openSubKeywordsModal() {
    // Find the parent category ID
    const category = $settingsStore.categories.find(cat => cat.icon === categoryName);
    if (!category || !category.id) return;

    // @ts-ignore - app is available globally
    const modal = new SubKeywordsModal(app, keyword, category.id, () => {
      // Trigger reactivity when modal updates
      updateKeyword();
    });
    modal.open();
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
</script>

<div class="keyword-item" class:help-keyword={isHelperCategory}>
  <div class="reorder-controls">
    <button
      class="move-button"
      class:disabled={isFirst}
      disabled={isFirst}
      on:click={handleMoveUp}
      title="Move up"
      aria-label="Move up"
    >▲</button>
    <button
      class="move-button"
      class:disabled={isLast}
      disabled={isLast}
      on:click={handleMoveDown}
      title="Move down"
      aria-label="Move down"
    >▼</button>
  </div>

  {#if !isHelperCategory}
    <button
      class="state-toggle"
      on:click={toggleState}
      title={stateTooltip}
      aria-label="Toggle parsing state"
    >{stateLabel}</button>
    <button
      class="priority-toggle"
      on:click={togglePriority}
      title={priorityTooltip}
      aria-label="Toggle priority for auxiliary keywords"
    >{priorityLabel}</button>
    <button
      class="subkeywords-toggle"
      on:click={openSubKeywordsModal}
      title="Manage sub-keywords"
      aria-label="Manage sub-keywords"
    >
      {#if subKeywordsBadge}
        <span class="subkeywords-badge">{subKeywordsBadge}</span>
      {/if}
      ⚙️
    </button>
  {/if}

  <input type="text" spellcheck="false" bind:value={keyword.keyword} on:change={updateKeyword} placeholder="Keyword" class:help-text={isHelperCategory} />

  {#if !isHelperCategory}
    <input
      type="text"
      spellcheck="false"
      value={keyword.aliases?.join(', ') || ''}
      on:change={(e) => {
        const val = e.currentTarget.value.trim();
        keyword.aliases = val ? val.split(',').map(a => a.trim()).filter(a => a) : [];
        updateKeyword();
      }}
      placeholder="Aliases (comma-separated)"
    />
  {/if}

  <input type="text" spellcheck="false" bind:value={keyword.description} on:change={updateKeyword} placeholder="Description (optional)" class:help-text={isHelperCategory} />

  {#if !isHelperCategory}
    <input type="text" spellcheck="false" bind:value={keyword.generateIcon} on:change={updateKeyword} placeholder="Icon" />
  {/if}

  <button
    class="main-toggle"
    class:main-enabled={currentType === KeywordType.MAIN}
    class:aux-enabled={currentType === KeywordType.AUXILIARY}
    on:click={toggleMainKeyword}
    title={currentType === KeywordType.MAIN ? "Main keyword (has priority over auxiliaries)" : "Auxiliary keyword (can be combined with main keywords)"}
    aria-label="Toggle keyword type"
  >
    {typeLabel}
  </button>

  <input type="text" spellcheck="false" bind:value={keyword.ccssc} on:change={updateKeyword} placeholder="CSS class" class:help-text={isHelperCategory} />

  {#if !isHelperCategory}
    <div class="color-controls">
      <input type="color" bind:value={keyword.color} on:change={updateKeyword} />
      <input type="color" bind:value={keyword.backgroundColor} on:change={updateKeyword} />
      <button class="remove-button" aria-label="Remove keyword" use:useIcon={'minus-circle'} on:click={() => dispatch('remove', keyword)}></button>
    </div>
  {:else}
    <button class="remove-button" aria-label="Remove keyword" use:useIcon={'minus-circle'} on:click={() => dispatch('remove', keyword)}></button>
  {/if}
</div>

<style>
  .keyword-item {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-secondary);
    padding: 0.1rem 0.2rem;
    margin-bottom: 0.15rem;
  }

  .state-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-size: 14px;
    line-height: 1;
    width: 22px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    flex-shrink: 0;
    margin-right: 0.15rem;
    font-weight: bold;
  }

  .state-toggle:hover {
    opacity: 0.7;
  }

  .priority-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    width: 30px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    flex-shrink: 0;
    margin-right: 0.15rem;
    font-weight: normal;
  }

  .priority-toggle:hover {
    opacity: 0.7;
    background: var(--background-modifier-hover);
    border-radius: 2px;
  }

  .subkeywords-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-size: 14px;
    line-height: 1;
    width: 24px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    flex-shrink: 0;
    margin-right: 0.15rem;
    position: relative;
  }

  .subkeywords-toggle:hover {
    opacity: 0.7;
    background: var(--background-modifier-hover);
    border-radius: 2px;
  }

  .subkeywords-badge {
    position: absolute;
    top: -4px;
    right: -2px;
    background: var(--interactive-accent);
    color: white;
    font-size: 9px;
    font-weight: bold;
    line-height: 1;
    min-width: 12px;
    height: 12px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    pointer-events: none;
  }

  .main-toggle {
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
    padding: 2px 6px;
    font-size: 11px;
    line-height: 1;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    flex-shrink: 0;
    margin-right: 0.15rem;
    font-weight: bold;
    border-radius: 3px;
    transition: all 0.15s ease;
  }

  .main-toggle.main-enabled {
    color: #00ff00;
    border-color: #00ff00;
  }

  .main-toggle.aux-enabled {
    color: #ff0000;
    border-color: #ff0000;
  }

  .main-toggle.help-enabled {
    color: #0088ff;
    border-color: #0088ff;
  }

  .main-toggle:hover {
    opacity: 0.7;
    background: var(--background-modifier-hover);
  }

  /* HELP keyword styling */
  .help-keyword {
    width: 48%;
    display: inline-flex;
    margin-right: 2%;
  }

  .help-text {
    color: #0088ff !important;
    font-weight: 500;
  }

  .reorder-controls {
    display: flex;
    flex-direction: row;
    gap: 1px;
    margin-right: 0.15rem;
  }

  .move-button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    font-size: 10px;
    line-height: 1;
    height: 14px;
    width: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .move-button:hover:not(.disabled) {
    color: var(--interactive-accent);
  }

  .move-button.disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .keyword-item > input {
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 2px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.9em;
  }

  /* Keyword input */
  .keyword-item > input[placeholder="Keyword"] {
    width: 60px !important;
    max-width: 60px !important;
    flex-shrink: 0;
  }

  /* Aliases input */
  .keyword-item > input[placeholder="Aliases (comma-separated)"] {
    width: 80px !important;
    max-width: 80px !important;
    flex-shrink: 0;
  }

  /* Description input - flexible but smaller */
  .keyword-item > input[placeholder="Description (optional)"] {
    flex: 1;
    min-width: 70px;
  }

  /* Icon input - wider to fit whole icons */
  .keyword-item > input[placeholder="Icon"] {
    width: 40px !important;
    max-width: 40px !important;
    flex-shrink: 0;
  }

  /* CSS class input - VERY NARROW */
  .keyword-item > input[placeholder="CSS class"] {
    width: 40px !important;
    max-width: 40px !important;
    flex-shrink: 0;
  }

  .color-controls {
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }

  .color-controls input[type="color"] {
    width: 18px;
    height: 14px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 2px;
    padding: 0px;
    cursor: pointer;
  }

  .remove-button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0.1rem;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .remove-button:hover {
    background: var(--background-modifier-hover);
    color: var(--text-error);
  }
</style>
