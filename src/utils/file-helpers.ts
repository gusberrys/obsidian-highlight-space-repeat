/**
 * Extract filename from file path
 */
export function getFileNameFromPath(filePath: string): string {
	const parts = filePath.split('/');
	return parts[parts.length - 1] || filePath;
}
