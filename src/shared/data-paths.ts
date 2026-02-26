/**
 * Constants for application data file paths
 * All data files are stored in the app-data folder within the plugin directory
 */

const APP_DATA_DIR = 'app-data';
const BASE_PATH = '.obsidian/plugins/obsidian-highlight-space-repeat/app-data';

export const DATA_PATHS = {
  DIR: APP_DATA_DIR,
  BASE: BASE_PATH,
  KEYWORD: BASE_PATH + '/keyword.json',
  SETTINGS: BASE_PATH + '/settings.json',
  SUBJECTS: BASE_PATH + '/subjects.json',
  CODEBLOCKS: BASE_PATH + '/codeblocks.json',
  PARSED_RECORDS: BASE_PATH + '/parsed-records.json',
} as const;
