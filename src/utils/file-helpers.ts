/**
 * Extract filename from file path
 */
export function getFileNameFromPath(filePath: string): string {
	if (!filePath) {
		return '';
	}
	const parts = filePath.split('/');
	return parts[parts.length - 1] || filePath;
}
