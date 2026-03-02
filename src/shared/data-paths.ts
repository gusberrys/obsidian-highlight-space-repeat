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
  get AUXILIARY_KEYWORDS() { return `${_pluginDir}/app-data/auxiliary-keywords.json`; },
  get PARSED_FILES() { return `${_pluginDir}/app-data/parsed-files.json`; },
  get SRS_DATA() { return `${_pluginDir}/app-data/srs-data.json`; },
};
