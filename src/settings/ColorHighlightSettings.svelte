<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { PluginSettings } from 'src/stores/settings-store';
  import { saveStore } from 'src/stores/settings-store';
  import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
  import type { ColorEntry } from './ColorSettings';

  export let settingsStore: Writable<PluginSettings>;
  export let plugin: HighlightSpaceRepeatPlugin;

  // Initialize with empty arrays to prevent undefined errors during component lifecycle
  let colorEntries: ColorEntry[] = [];
  let colorHighlightingEnabled: boolean = false;

  // Update from store reactively
  $: if ($settingsStore) {
    colorEntries = $settingsStore.colorEntries || [];
    colorHighlightingEnabled = $settingsStore.colorHighlightingEnabled || false;
  }

  async function saveSettings() {
    await saveStore();
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

  async function addColor() {
    if (!$settingsStore.colorEntries) {
      $settingsStore.colorEntries = [];
    }
    $settingsStore.colorEntries = [...$settingsStore.colorEntries, {
      name: 'new color',
      cc: 'nc',
      gvIcon: '⚫',
      grIcon: '⚪',
      lvIcon: '🖤',
      lrIcon: '🤍',
      backgroundColor: '#000000',
      textColor: '#ffffff'
    }];
    await saveSettings();
  }

  async function removeColor(index: number) {
    if (!$settingsStore.colorEntries) {
      return;
    }
    $settingsStore.colorEntries = $settingsStore.colorEntries.filter((_, i) => i !== index);
    await saveSettings();
  }

  async function updateColor(index: number, field: keyof ColorEntry, value: string) {
    if (!$settingsStore.colorEntries || !$settingsStore.colorEntries[index]) {
      return;
    }
    $settingsStore.colorEntries[index][field] = value as any;
    await saveSettings();
  }
</script>

<div class="color-highlight-settings">
  <h2>Color Highlighting</h2>

  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Enable colour highlights</div>
      <div class="setting-item-description">Toggle color mode (shows color keywords, hides normal keywords)</div>
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
      <div class="setting-item-name">Add new color</div>
      <div class="setting-item-description">Creates 4 keywords (GV, GR, LV, LR) automatically</div>
    </div>
    <div class="setting-item-control">
      <button class="mod-cta" on:click={addColor}>Add Color</button>
    </div>
  </div>

  <div class="color-table-container">
    <table class="color-table">
      <thead>
        <tr>
          <th>Name</th>
          <th title="Color Class (used in code blocks and class names)">CC</th>
          <th title="Global Value Icon">GV Icon</th>
          <th title="Global Reference Icon">GR Icon</th>
          <th title="Local Value Icon">LV Icon</th>
          <th title="Local Reference Icon">LR Icon</th>
          <th>BG Color</th>
          <th>Text Color</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {#each colorEntries as color, index}
          <tr>
            <!-- Name -->
            <td>
              <input
                type="text"
                value={color.name}
                on:change={(e) => updateColor(index, 'name', e.currentTarget.value)}
              />
            </td>

            <!-- CC (Color Class) -->
            <td>
              <input
                type="text"
                style="width: 40px"
                value={color.cc}
                on:change={(e) => updateColor(index, 'cc', e.currentTarget.value)}
              />
            </td>

            <!-- GV Icon -->
            <td>
              <input
                type="text"
                style="width: 50px"
                value={color.gvIcon}
                on:change={(e) => updateColor(index, 'gvIcon', e.currentTarget.value)}
              />
            </td>

            <!-- GR Icon -->
            <td>
              <input
                type="text"
                style="width: 50px"
                value={color.grIcon}
                on:change={(e) => updateColor(index, 'grIcon', e.currentTarget.value)}
              />
            </td>

            <!-- LV Icon -->
            <td>
              <input
                type="text"
                style="width: 50px"
                value={color.lvIcon}
                on:change={(e) => updateColor(index, 'lvIcon', e.currentTarget.value)}
              />
            </td>

            <!-- LR Icon -->
            <td>
              <input
                type="text"
                style="width: 50px"
                value={color.lrIcon}
                on:change={(e) => updateColor(index, 'lrIcon', e.currentTarget.value)}
              />
            </td>

            <!-- BG Color -->
            <td>
              <input
                type="color"
                value={color.backgroundColor}
                on:change={(e) => updateColor(index, 'backgroundColor', e.currentTarget.value)}
              />
            </td>

            <!-- Text Color -->
            <td>
              <input
                type="color"
                value={color.textColor}
                on:change={(e) => updateColor(index, 'textColor', e.currentTarget.value)}
              />
            </td>

            <!-- Remove -->
            <td>
              <button class="mod-warning" on:click={() => removeColor(index)}>Delete</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="info-panel">
    <p><strong>Auto-generated keywords:</strong></p>
    <p>Each color creates 4 keywords using pattern: gv&#123;cc&#125;, gr&#123;cc&#125;, lv&#123;cc&#125;, lr&#123;cc&#125;</p>
    <p>Example: CC "r" → <code>gvr</code>, <code>grr</code>, <code>lvr</code>, <code>lrr</code></p>
  </div>

  <div class="keywords-display">
    <h3>Generated Keywords (stored in "Colors" category)</h3>
    {#each colorEntries as color}
      <div class="color-keyword-group">
        <div class="color-name-header">{color.name}</div>
        <div class="keyword-list">
          <div class="keyword-item">
            <span class="keyword-badge" style="background-color: {color.backgroundColor}; color: {color.textColor};">
              {color.gvIcon} gv{color.cc}
            </span>
            <span class="keyword-desc">global {color.name} value</span>
          </div>
          <div class="keyword-item">
            <span class="keyword-badge" style="background-color: {color.backgroundColor}; color: {color.textColor};">
              {color.grIcon} gr{color.cc}
            </span>
            <span class="keyword-desc">global {color.name} reference</span>
          </div>
          <div class="keyword-item">
            <span class="keyword-badge" style="background-color: {color.backgroundColor}; color: {color.textColor};">
              {color.lvIcon} lv{color.cc}
            </span>
            <span class="keyword-desc">local {color.name} value</span>
          </div>
          <div class="keyword-item">
            <span class="keyword-badge" style="background-color: {color.backgroundColor}; color: {color.textColor};">
              {color.lrIcon} lr{color.cc}
            </span>
            <span class="keyword-desc">local {color.name} reference</span>
          </div>
        </div>
      </div>
    {/each}
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

  .color-table-container {
    margin-top: 1rem;
    overflow-x: auto;
  }

  .color-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }

  .color-table th,
  .color-table td {
    padding: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    text-align: left;
  }

  .color-table th {
    background-color: var(--background-secondary);
    font-weight: 600;
    font-size: 0.85em;
  }

  .color-table input[type="text"] {
    width: 100%;
    padding: 0.25rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: var(--background-primary);
    color: var(--text-normal);
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

  .info-panel {
    margin-top: 1.5rem;
    padding: 1rem;
    background-color: var(--background-secondary);
    border-radius: 4px;
    font-size: 0.9em;
  }

  .info-panel p {
    margin: 0.5rem 0;
  }

  .info-panel code {
    background-color: var(--background-primary);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;
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

  .keywords-display {
    margin-top: 2rem;
    padding: 1rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .keywords-display h3 {
    margin: 0 0 1rem 0;
    font-size: 1.1em;
    font-weight: 600;
  }

  .color-keyword-group {
    margin-bottom: 1.5rem;
  }

  .color-name-header {
    font-weight: 600;
    margin-bottom: 0.5rem;
    text-transform: capitalize;
    font-size: 1em;
    color: var(--text-normal);
  }

  .keyword-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-left: 1rem;
  }

  .keyword-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    background-color: var(--background-secondary);
    border-radius: 4px;
  }

  .keyword-badge {
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.9em;
    font-weight: 600;
    min-width: 80px;
    text-align: center;
  }

  .keyword-desc {
    font-size: 0.9em;
    color: var(--text-muted);
  }
</style>
