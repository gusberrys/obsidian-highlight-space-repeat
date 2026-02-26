import HighlightSpaceRepeatPlugin from 'main';
import { App, PluginSettingTab } from 'obsidian';
import SettingTabComponent from './SettingTab.svelte';
import { saveStore, settingsStore, saveSettingsData } from 'src/stores/settings-store';
import { addSRSSettings } from './SRSSettings';

export class SettingTab extends PluginSettingTab {
  plugin: HighlightSpaceRepeatPlugin;
  component?: SettingTabComponent;

  constructor(app: App, plugin: HighlightSpaceRepeatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    this.component = new SettingTabComponent({
      target: containerEl,
      props: {
        settingsStore,
        plugin: this.plugin,
      },
    });

    // Add SRS settings section after Svelte component
    const srsContainer = containerEl.createDiv({ cls: 'srs-settings-container' });
    addSRSSettings(srsContainer, this.plugin);
  }

  async hide(): Promise<void> {
    await saveStore();
    await saveSettingsData();
  }
}
