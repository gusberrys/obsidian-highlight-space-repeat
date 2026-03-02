import type { ParsedFile, FlatEntry } from '../interfaces/ParsedFile';
import type { Category } from '../shared/keyword-style';
import { FilterParser } from '../services/FilterParser';
import type { CompiledFilter } from '../interfaces/FilterInterfaces';

/**
 * Helper to process all entries in a file with a filter
 * Returns entries that match the filter
 */
export function filterFileEntries(
	file: ParsedFile,
	filter: CompiledFilter,
	categories?: Category[]
): FlatEntry[] {
	// Use file.entries directly - already flattened with h1/h2/h3 embedded
	return file.entries.filter(entry =>
		FilterParser.evaluateFlatEntry(filter.ast, entry, categories || [], filter.modifiers)
	);
}

/**
 * Helper to check if ANY entry in a file matches a filter
 */
export function fileHasMatch(
	file: ParsedFile,
	filter: CompiledFilter,
	categories?: Category[]
): boolean {
	// Use file.entries directly - already flattened with h1/h2/h3 embedded
	return file.entries.some(entry =>
		FilterParser.evaluateFlatEntry(filter.ast, entry, categories || [], filter.modifiers)
	);
}
