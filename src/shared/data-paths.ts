/**
 * Data paths - MUST call initDataPaths() first with plugin directory
 */
let _pluginDir = '';

export function initDataPaths(pluginDir: string): void {
  _pluginDir = pluginDir;
}

export const DATA_PATHS = {
  get DIR() { return `${_pluginDir}/app-data`; },
  get KEYWORD() { return `${_pluginDir}/app-data/keyword.json`; },
  get SETTINGS() { return `${_pluginDir}/app-data/settings.json`; },
  get VWORD_SETTINGS() { return `${_pluginDir}/app-data/vword-settings.json`; },
};
