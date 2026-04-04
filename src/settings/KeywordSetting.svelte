<script lang="ts">
  import type { KeywordStyle } from 'src/shared';
  import { CollectingStatus } from 'src/shared/collecting-status';
  import { setIcon } from 'obsidian';
  import { createEventDispatcher } from 'svelte';
  import { settingsStore } from 'src/stores/settings-store';
  import Checkbox from './Checkbox.svelte';

  export let keyword: KeywordStyle;
  export let keywordIndex: number;  // Local index within category

  const dispatch = createEventDispatcher();

  let rowElement: HTMLTableRowElement;

  // Reactive 3-state label and tooltip for collecting status
  $: stateLabel = keyword.collectingStatus === CollectingStatus.SPACED ? '🔄'
    : keyword.collectingStatus === CollectingStatus.PARSED ? '✅'
    : '❌';
  $: stateTooltip = keyword.collectingStatus === CollectingStatus.SPACED
    ? 'Spaced (SRS enabled + parsed)'
    : keyword.collectingStatus === CollectingStatus.PARSED
    ? 'Parsed (collected in records)'
    : 'Ignored (not collected)';

  // Reactive icon priority label and tooltip
  $: iconPriorityLabel = keyword.iconPriority === 3 ? 'III'
    : keyword.iconPriority === 2 ? 'II'
    : 'I';

  $: iconPriorityTooltip = keyword.iconPriority === 3
    ? 'Icon priority III (highest)'
    : keyword.iconPriority === 2
    ? 'Icon priority II'
    : 'Icon priority I (default)';

  // Reactive style priority label and tooltip
  $: stylePriorityLabel = keyword.stylePriority === 'priority' ? '👑'
    : keyword.stylePriority === 'append' ? 'A'
    : '-';

  $: stylePriorityTooltip = keyword.stylePriority === 'priority'
    ? 'Priority: This keyword\'s colors win over normal keywords'
    : keyword.stylePriority === 'append'
    ? 'Append: Add as class, but don\'t provide colors'
    : 'Normal: Compete for colors at default priority';

  function attachDragHandlers(node: HTMLTableRowElement) {
    node.draggable = true;

    node.addEventListener('dragstart', (e: DragEvent) => {
      node.classList.add('kw-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', keywordIndex.toString());
      }
    });

    node.addEventListener('dragend', () => {
      node.classList.remove('kw-dragging');
      document.querySelectorAll('.keyword-row').forEach(r => {
        r.classList.remove('kw-drag-over');
      });
    });

    node.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }

      const draggingRow = document.querySelector('.kw-dragging');
      if (draggingRow && draggingRow !== node) {
        node.classList.add('kw-drag-over');
      }
    });

    node.addEventListener('dragleave', () => {
      node.classList.remove('kw-drag-over');
    });

    node.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      node.classList.remove('kw-drag-over');

      if (!e.dataTransfer) return;

      const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const targetIndex = keywordIndex;

      if (draggedIndex === targetIndex) return;

      dispatch('reorder', { draggedIndex, targetIndex });
    });

    return {
      destroy() {
        // Cleanup if needed
      }
    };
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

  function toggleIconPriority() {
    // Cycle through I → II → III → I
    if (!keyword.iconPriority || keyword.iconPriority === 3) {
      keyword.iconPriority = 1;
    } else {
      keyword.iconPriority = (keyword.iconPriority + 1) as 1 | 2 | 3;
    }

    keyword = keyword; // Trigger reactivity
    updateKeyword();
  }

  function toggleStylePriority() {
    // Cycle through - → 👑 → A → -
    if (!keyword.stylePriority || keyword.stylePriority === 'normal') {
      keyword.stylePriority = 'priority';
    } else if (keyword.stylePriority === 'priority') {
      keyword.stylePriority = 'append';
    } else {
      keyword.stylePriority = 'normal';
    }

    keyword = keyword; // Trigger reactivity
    updateKeyword();
  }

  function updateKeyword() {
    // This function will trigger reactivity for the parent store
    // Create a new reference to trigger Svelte reactivity
    settingsStore.update((settings) => ({ ...settings }));
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

<tr class="keyword-row" bind:this={rowElement} use:attachDragHandlers>
  <td class="td-drag">
    <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
  </td>

  <td class="td-state">
    <button
      class="state-toggle"
      on:click={toggleState}
      title={stateTooltip}
      aria-label="Toggle parsing state"
    >{stateLabel}</button>
  </td>

  <td class="td-icon-priority">
    <button
      class="priority-toggle"
      on:click={toggleIconPriority}
      title={iconPriorityTooltip}
      aria-label="Toggle icon priority"
    >{iconPriorityLabel}</button>
  </td>

  <td class="td-style-priority">
    <button
      class="priority-toggle"
      on:click={toggleStylePriority}
      title={stylePriorityTooltip}
      aria-label="Toggle style priority"
    >{stylePriorityLabel}</button>
  </td>

  <td class="td-keyword">
    <input type="text" spellcheck="false" bind:value={keyword.keyword} on:change={updateKeyword} placeholder="Keyword" class="input-keyword" />
  </td>

  <td class="td-description">
    <input type="text" spellcheck="false" bind:value={keyword.description} on:change={updateKeyword} placeholder="Description" class="input-description" />
  </td>

  <td class="td-icon">
    <input type="text" spellcheck="false" bind:value={keyword.generateIcon} on:change={updateKeyword} placeholder="Icon" class="input-icon" />
  </td>

  <td class="td-colors">
    <div class="color-controls">
      <input type="color" bind:value={keyword.color} on:change={updateKeyword} title="Text color" />
      <input type="color" bind:value={keyword.backgroundColor} on:change={updateKeyword} title="Background color" />
      <button class="remove-button" aria-label="Remove keyword" use:useIcon={'minus-circle'} on:click={() => dispatch('remove', keyword)}></button>
    </div>
  </td>
</tr>

<style>
  .keyword-row {
    background: var(--background-secondary);
    cursor: grab;
    transition: all 0.2s;
  }

  .keyword-row:active {
    cursor: grabbing;
  }

  .keyword-row:hover {
    background: var(--background-modifier-hover);
  }




  .keyword-row td {
    padding: 0.3rem 0.2rem;
    vertical-align: middle;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .state-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem;
    font-size: 14px;
    line-height: 1;
    width: 100%;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    font-weight: bold;
    border-radius: 2px;
    transition: all 0.2s;
  }

  .state-toggle:hover {
    background: var(--background-modifier-hover);
  }

  .priority-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem;
    font-size: 12px;
    line-height: 1;
    width: 100%;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    font-weight: normal;
    border-radius: 2px;
    transition: all 0.2s;
  }

  .priority-toggle:hover {
    background: var(--background-modifier-hover);
  }

  .td-drag {
    text-align: center;
    padding: 0.3rem 0.2rem;
    cursor: grab;
  }

  .drag-handle {
    display: inline-block;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
    user-select: none;
    letter-spacing: -2px;
  }

  .drag-handle:hover {
    color: var(--interactive-accent);
  }

  .keyword-row:active .drag-handle {
    cursor: grabbing;
  }

  .td-state,
  .td-icon-priority,
  .td-style-priority {
    text-align: center;
  }

  td input {
    width: 100%;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 2px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
    box-sizing: border-box;
  }

  td input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .td-colors {
    padding: 0.2rem !important;
  }

  .color-controls {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    justify-content: center;
  }

  .color-controls input[type="color"] {
    width: 20px;
    height: 20px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 2px;
    padding: 1px;
    cursor: pointer;
  }

  .color-controls input[type="color"]:hover {
    border-color: var(--interactive-accent);
  }

  .remove-button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0.15rem;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .remove-button:hover {
    background: var(--background-modifier-error);
    color: var(--text-error);
  }
</style>
