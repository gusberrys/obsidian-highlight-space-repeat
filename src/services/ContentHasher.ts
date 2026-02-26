/**
 * Content hashing utilities for SRS fuzzy matching
 * Generates stable hashes from record content
 */
export class ContentHasher {
	/**
	 * Generate stable MD5 hash from content using simple hash algorithm
	 * - Trims whitespace
	 * - Normalizes line endings
	 * - Case-sensitive (code is case-sensitive)
	 *
	 * @param text The content to hash
	 * @returns Hash string (32 characters)
	 */
	static hashContent(text: string): string {
		// Normalize content for stable hashing
		const normalized = text
			.trim()
			.replace(/\r\n/g, '\n')  // Normalize line endings
			.replace(/\s+$/gm, '');  // Remove trailing spaces from lines

		// Simple hash function (djb2 variant)
		let hash = 5381;
		for (let i = 0; i < normalized.length; i++) {
			const char = normalized.charCodeAt(i);
			hash = ((hash << 5) + hash) + char; // hash * 33 + char
		}

		// Convert to hex string (32 chars for compatibility)
		const hashStr = Math.abs(hash).toString(16).padStart(8, '0');
		return hashStr + hashStr + hashStr + hashStr; // Repeat to make 32 chars
	}

	/**
	 * Generate preview (first 100 chars) for debugging
	 *
	 * @param text The content to preview
	 * @returns First 100 characters (trimmed)
	 */
	static getPreview(text: string): string {
		const trimmed = text.trim();
		if (trimmed.length <= 100) {
			return trimmed;
		}
		return trimmed.substring(0, 100) + '...';
	}

	/**
	 * Calculate similarity between two strings using Levenshtein distance
	 * Returns percentage similarity (0-100)
	 *
	 * @param a First string
	 * @param b Second string
	 * @returns Similarity percentage (0-100)
	 */
	static calculateSimilarity(a: string, b: string): number {
		const distance = this.levenshteinDistance(a, b);
		const maxLength = Math.max(a.length, b.length);

		if (maxLength === 0) return 100;

		const similarity = ((maxLength - distance) / maxLength) * 100;
		return Math.round(similarity);
	}

	/**
	 * Calculate Levenshtein distance between two strings
	 * (minimum number of single-character edits required to change one string into the other)
	 *
	 * @param a First string
	 * @param b Second string
	 * @returns Edit distance
	 */
	private static levenshteinDistance(a: string, b: string): number {
		const matrix: number[][] = [];

		// Initialize first column
		for (let i = 0; i <= b.length; i++) {
			matrix[i] = [i];
		}

		// Initialize first row
		for (let j = 0; j <= a.length; j++) {
			matrix[0][j] = j;
		}

		// Fill in the rest of the matrix
		for (let i = 1; i <= b.length; i++) {
			for (let j = 1; j <= a.length; j++) {
				if (b.charAt(i - 1) === a.charAt(j - 1)) {
					matrix[i][j] = matrix[i - 1][j - 1];
				} else {
					matrix[i][j] = Math.min(
						matrix[i - 1][j - 1] + 1, // substitution
						matrix[i][j - 1] + 1,     // insertion
						matrix[i - 1][j] + 1      // deletion
					);
				}
			}
		}

		return matrix[b.length][a.length];
	}

	/**
	 * Check if two content hashes represent similar content (fuzzy match)
	 * Used as a fast pre-check before full similarity calculation
	 *
	 * @param hash1 First content hash
	 * @param hash2 Second content hash
	 * @returns true if hashes are identical
	 */
	static areHashesEqual(hash1: string, hash2: string): boolean {
		return hash1 === hash2;
	}
}
