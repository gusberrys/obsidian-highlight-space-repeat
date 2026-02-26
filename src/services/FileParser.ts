import { App, TFile, TFolder } from 'obsidian';
import type { ParserConfig, ParserScanResult } from '../interfaces/ParserSettings';

/**
 * Service for parsing and scanning vault files
 */
export class FileParser {
	constructor(private app: App) {}

	/**
	 * Scan a path and return statistics about files
	 * @param config Parser configuration
	 * @returns Scan result with file statistics
	 */
	async scanPath(config: ParserConfig): Promise<ParserScanResult> {
		const startTime = Date.now();
		const result: ParserScanResult = {
			totalFiles: 0,
			includedFiles: 0,
			excludedFiles: 0,
			excludedFilePaths: [],
			includedFilePaths: [],
			scanDuration: 0,
			scannedPath: config.scanPath || '/',
			excludePatterns: config.excludePatterns || []
		};

		try {
			// Get the folder to scan
			const folder = config.scanPath
				? this.app.vault.getAbstractFileByPath(config.scanPath)
				: this.app.vault.getRoot();

			if (!folder) {
				console.warn(`Path not found: ${config.scanPath}`);
				return result;
			}

			// Get all files recursively
			const allFiles = this.app.vault.getMarkdownFiles();

			// Filter files based on the scan path
			const filesInPath = allFiles.filter(file => {
				if (config.scanPath) {
					return file.path.startsWith(config.scanPath);
				}
				return true;
			});

			// Process each file
			for (const file of filesInPath) {
				result.totalFiles++;

				// Check if file should be excluded
				const shouldExclude = this.shouldExcludeFile(file, config);

				if (shouldExclude) {
					result.excludedFiles++;
					// Add to excluded list (limit to first 100)
					if (result.excludedFilePaths.length < 100) {
						result.excludedFilePaths.push(file.path);
					}
				} else {
					result.includedFiles++;
					// Add to included list (limit to first 100)
					if (result.includedFilePaths.length < 100) {
						result.includedFilePaths.push(file.path);
					}
				}
			}

			result.scanDuration = Date.now() - startTime;
			return result;
		} catch (error) {
			console.error('Error scanning path:', error);
			result.scanDuration = Date.now() - startTime;
			return result;
		}
	}

	/**
	 * Check if a file should be excluded based on patterns
	 * @param file The file to check
	 * @param config Parser configuration
	 * @returns true if file should be excluded
	 */
	private shouldExcludeFile(file: TFile, config: ParserConfig): boolean {
		// Check file extension
		if (config.fileExtensions && config.fileExtensions.length > 0) {
			const hasValidExtension = config.fileExtensions.some((ext: string) =>
				file.extension === ext.replace('.', '')
			);
			if (!hasValidExtension) {
				return true;
			}
		}

		// Check exclude patterns
		if (config.excludePatterns && config.excludePatterns.length > 0) {
			for (const pattern of config.excludePatterns) {
				if (this.matchesPattern(file.path, pattern)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Check if a path matches a pattern
	 * @param path File path
	 * @param pattern Pattern to match (supports wildcards)
	 * @returns true if path matches pattern
	 */
	private matchesPattern(path: string, pattern: string): boolean {
		// Simple pattern matching - you can enhance this with more complex patterns
		// For now, just check if the path starts with the pattern
		const normalizedPattern = pattern.replace(/\\/g, '/').replace(/\/+$/, '');
		const normalizedPath = path.replace(/\\/g, '/');

		// Check if path starts with pattern
		if (normalizedPath.startsWith(normalizedPattern + '/') || normalizedPath === normalizedPattern) {
			return true;
		}

		// Check if any parent folder matches the pattern
		const pathParts = normalizedPath.split('/');
		for (let i = 0; i < pathParts.length; i++) {
			const parentPath = pathParts.slice(0, i + 1).join('/');
			if (parentPath === normalizedPattern || parentPath.endsWith('/' + normalizedPattern)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Get a list of all folders in the vault
	 * @returns Array of folder paths
	 */
	getAllFolders(): string[] {
		const folders: string[] = ['/']; // Root folder
		const allFiles = this.app.vault.getAllLoadedFiles();

		for (const file of allFiles) {
			if (file instanceof TFolder) {
				folders.push(file.path);
			}
		}

		return folders.sort();
	}

	/**
	 * Format bytes to human-readable size
	 * @param bytes Number of bytes
	 * @returns Formatted string
	 */
	formatBytes(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	}
}
