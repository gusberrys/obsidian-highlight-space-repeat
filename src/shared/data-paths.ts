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
  get SUBJECTS() { return `${_pluginDir}/app-data/subjects.json`; },
  get CODEBLOCKS() { return `${_pluginDir}/app-data/codeblocks.json`; },
  get VWORD_SETTINGS() { return `${_pluginDir}/app-data/vword-settings.json`; },
  // PARSED_FILES removed - parsed records now stored in RAM only (plugin.parsedRecords)
  // SRS_DATA removed - SRS data now stored as HTML comments in markdown files
};
