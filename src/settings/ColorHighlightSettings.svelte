<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { PluginSettings } from 'src/stores/settings-store';
  import { saveStore } from 'src/stores/settings-store';
  import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
  import type { ColourPair } from './ColorSettings';
  import { injectColorHighlightCSS } from 'src/shared/dynamic-css';

  export let settingsStore: Writable<PluginSettings>;
  export let plugin: HighlightSpaceRepeatPlugin;

  $: colourPairs = $settingsStore.colourPairs;
  $: colorHighlightingEnabled = $settingsStore.colorHighlightingEnabled;

  async function saveSettings() {
    await saveStore();
    // Reinject CSS after changes
    injectColorHighlightCSS($settingsStore.colourPairs);
  }

  async function toggleColorHighlighting() {
    $settingsStore.colorHighlightingEnabled = !$settingsStore.colorHighlightingEnabled;
    await saveSettings();

    // Toggle body class
    if ($settingsStore.colorHighlightingEnabled) {
      document.body.addClass('cc-enabled');
    } else {
      document.body.removeClass('cc-enabled');
    }
  }

  async function addColour() {
    $settingsStore.colourPairs = [...$settingsStore.colourPairs, {
      colourName: 'new colour',
      globalReference: '⚫',
      globalReferenceClass: '',
      globalValue: '⬛',
      globalValueClass: '',
      localReference: '📕',
      localReferenceClass: '',
      localValue: '❤️',
      localValueClass: '',
      localColour: '#000000',
      localName: 'new'
    }];
    await saveSettings();
  }

  async function removeColour(index: number) {
    $settingsStore.colourPairs = $settingsStore.colourPairs.filter((_, i) => i !== index);
    await saveSettings();
  }

  async function updateColour(index: number, field: keyof ColourPair, value: string) {
    $settingsStore.colourPairs[index][field] = value as any;
    await saveSettings();
  }
</script>

<div class="color-highlight-settings">
  <h2>Color Highlighting</h2>

  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Enable colour highlights</div>
      <div class="setting-item-description">Toggle all colour highlights on/off</div>
    </div>
    <div class="setting-item-control">
      <input
        type="checkbox"
        checked={colorHighlightingEnabled}
        on:change={toggleColorHighlighting}
      />
    </div>
  </div>

  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Add new colour</div>
      <div class="setting-item-description">Add a new colour pair</div>
    </div>
    <div class="setting-item-control">
      <button class="mod-cta" on:click={addColour}>Add Colour</button>
    </div>
  </div>

  <div class="colour-table-container">
    <table class="colour-pairs-table">
      <thead>
        <tr>
          <th>Colour Name</th>
          <th title="Global Reference">G.R. 🔵</th>
          <th title="Global Reference Class">G.R. Class</th>
          <th title="Global Value">G.V. 🟦</th>
          <th title="Global Value Class">G.V. Class</th>
          <th title="Local Reference">L.R. 📘</th>
          <th title="Local Reference Class">L.R. Class</th>
          <th title="Local Value">L.V. 💙</th>
          <th title="Local Value Class">L.V. Class</th>
          <th>Hex</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {#each colourPairs as colour, index}
          <tr>
            <!-- Colour Name -->
            <td>
              <input
                type="text"
                value={colour.colourName}
                on:change={(e) => updateColour(index, 'colourName', e.currentTarget.value)}
              />
            </td>

            <!-- Global Reference -->
            <td>
              <input
                type="text"
                value={colour.globalReference}
                on:change={(e) => updateColour(index, 'globalReference', e.currentTarget.value)}
              />
            </td>

            <!-- Global Reference Class -->
            <td>
              <input
                type="text"
                style="width: 60px"
                placeholder="class"
                value={colour.globalReferenceClass || ''}
                on:change={(e) => updateColour(index, 'globalReferenceClass', e.currentTarget.value)}
              />
            </td>

            <!-- Global Value -->
            <td>
              <input
                type="text"
                value={colour.globalValue}
                on:change={(e) => updateColour(index, 'globalValue', e.currentTarget.value)}
              />
            </td>

            <!-- Global Value Class -->
            <td>
              <input
                type="text"
                style="width: 60px"
                placeholder="class"
                value={colour.globalValueClass || ''}
                on:change={(e) => updateColour(index, 'globalValueClass', e.currentTarget.value)}
              />
            </td>

            <!-- Local Reference -->
            <td>
              <input
                type="text"
                value={colour.localReference}
                on:change={(e) => updateColour(index, 'localReference', e.currentTarget.value)}
              />
            </td>

            <!-- Local Reference Class -->
            <td>
              <input
                type="text"
                style="width: 60px"
                placeholder="class"
                value={colour.localReferenceClass || ''}
                on:change={(e) => updateColour(index, 'localReferenceClass', e.currentTarget.value)}
              />
            </td>

            <!-- Local Value -->
            <td>
              <input
                type="text"
                value={colour.localValue}
                on:change={(e) => updateColour(index, 'localValue', e.currentTarget.value)}
              />
            </td>

            <!-- Local Value Class -->
            <td>
              <input
                type="text"
                style="width: 60px"
                placeholder="e.g. ly"
                value={colour.localValueClass || ''}
                on:change={(e) => updateColour(index, 'localValueClass', e.currentTarget.value)}
              />
            </td>

            <!-- Local Colour (Hex with color picker) -->
            <td>
              <div class="color-picker-wrapper">
                <input
                  type="color"
                  value={colour.localColour}
                  on:change={(e) => updateColour(index, 'localColour', e.currentTarget.value)}
                />
                <input
                  type="text"
                  style="width: 70px"
                  value={colour.localColour}
                  on:change={(e) => updateColour(index, 'localColour', e.currentTarget.value)}
                />
              </div>
            </td>

            <!-- Remove button -->
            <td>
              <button class="mod-warning" on:click={() => removeColour(index)}>Remove</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .color-highlight-settings {
    padding: 1rem;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .setting-item-info {
    flex: 1;
  }

  .setting-item-name {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .setting-item-description {
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .setting-item-control {
    flex-shrink: 0;
  }

  .colour-table-container {
    margin-top: 1rem;
    overflow-x: auto;
  }

  .colour-pairs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }

  .colour-pairs-table th,
  .colour-pairs-table td {
    padding: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    text-align: left;
  }

  .colour-pairs-table th {
    background-color: var(--background-secondary);
    font-weight: 600;
    font-size: 0.85em;
  }

  .colour-pairs-table input[type="text"] {
    width: 100%;
    padding: 0.25rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .colour-pairs-table input[type="checkbox"] {
    cursor: pointer;
  }

  .color-picker-wrapper {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .color-picker-wrapper input[type="color"] {
    width: 40px;
    height: 30px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    cursor: pointer;
  }

  button {
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--interactive-normal);
    color: var(--text-normal);
    cursor: pointer;
  }

  button:hover {
    background: var(--interactive-hover);
  }

  button.mod-cta {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  button.mod-warning {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  button.mod-warning:hover {
    opacity: 0.9;
  }
</style>
