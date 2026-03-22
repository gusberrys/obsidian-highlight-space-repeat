import { FilterParser } from './FilterParser';
import type { ActiveChip } from '../interfaces/ActiveChip';
import type { Category, KeywordStyle } from '../shared/keyword-style';

/**
 * Service for creating ActiveChips from filter SELECT clauses
 */
export class ChipService {
	/**
	 * Create ActiveChips from mainDashboardFilter SELECT clause
	 *
	 * Example: "S: .def :boo `java W: #strimzi"
	 * - Splits into SELECT and WHERE
	 * - Parses SELECT items (.def, :boo, `java)
	 * - Creates chips (ONE chip per item, categories do NOT expand)
	 * - Handles unchecked flag (_:boo creates chip with active: false)
	 *
	 * @param filterExpression - Full filter expression with optional S: and W: clauses
	 * @param categories - Categories for finding category metadata (icon, etc.)
	 * @param keywordStyles - Keyword styles for icons/colors (from categories)
	 * @returns Array of ActiveChip objects
	 */
	static createChipsFromFilter(
		filterExpression: string,
		categories: Category[],
		keywordStyles: KeywordStyle[]
	): ActiveChip[] {
		const chips: ActiveChip[] = [];

		// Split expression into SELECT and WHERE
		const { select, where } = FilterParser.splitExpression(filterExpression);

		// If no SELECT clause, return empty array
		if (!select || select.trim() === '') {
			return chips;
		}

		// Parse SELECT items
		const selectItems = FilterParser.parseSelectItems(select);

		// Convert each SelectItem to ActiveChip(s)
		for (const item of selectItems) {
			switch (item.type) {
				case 'keyword': {
					// Create single keyword chip
					const keywordStyle = keywordStyles.find(kw =>
						kw.keyword.toLowerCase() === item.value.toLowerCase()
					);

					chips.push({
						type: 'keyword',
						value: item.value,
						mode: 'include',
						label: item.value,
						icon: keywordStyle?.generateIcon || '🏷️',
						backgroundColor: keywordStyle?.backgroundColor,
						color: keywordStyle?.color,
						active: !item.unchecked // Unchecked flag sets active: false
					});
					break;
				}

				case 'category': {
					// Create single category chip (does NOT expand to keywords)
					const category = categories.find(cat =>
						cat.id?.toLowerCase() === item.value.toLowerCase()
					);

					if (category) {
						chips.push({
							type: 'category',
							value: item.value,
							mode: 'include',
							label: item.value,
							icon: category.icon || '🏷️',
							active: !item.unchecked // Unchecked flag sets active: false
						});
					}
					break;
				}

				case 'language': {
					// Create single language chip
					chips.push({
						type: 'language',
						value: item.value,
						mode: 'include',
						label: item.value,
						icon: '💻',
						active: !item.unchecked // Unchecked flag sets active: false
					});
					break;
				}
			}
		}

		return chips;
	}

	/**
	 * Get unique chip ID for Map storage
	 */
	static getChipId(chip: ActiveChip): string {
		return `${chip.type}-${chip.mode}-${chip.value}`;
	}
}
