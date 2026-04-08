/// <reference types="jest" />
import { ChipService } from '../../services/ChipService';
import { DEFAULT_CATEGORIES, DEFAULT_KEYWORD_CONFIGS, KEYWORDS, CATEGORY_IDS, CODE_LANGS } from '../helpers/testConstants';

/**
 * CHIP CREATION TESTS
 *
 * Tests that chips are properly created from filter SELECT clauses
 */

describe('Chip Creation', () => {

	describe('Single Item Creation', () => {
		test('.keyword creates keyword chip', () => {
			const chips = ChipService.createChipsFromFilter(`.${KEYWORDS.DEF}`, [], DEFAULT_KEYWORD_CONFIGS);

			expect(chips).toHaveLength(1);
			expect(chips[0]).toMatchObject({
				type: 'keyword',
				value: KEYWORDS.DEF,
				mode: 'include',
				label: KEYWORDS.DEF,
				icon: '📖',
				active: true
			});
		});

		test(':category creates category chip', () => {
			const chips = ChipService.createChipsFromFilter(`:${CATEGORY_IDS.BOO}`, DEFAULT_CATEGORIES, []);

			expect(chips).toHaveLength(1);
			expect(chips[0]).toMatchObject({
				type: 'category',
				value: CATEGORY_IDS.BOO,
				mode: 'include',
				label: CATEGORY_IDS.BOO,
				icon: '♣️',
				active: true
			});
		});

		test('`language creates language chip', () => {
			const chips = ChipService.createChipsFromFilter(`\`${CODE_LANGS.JAVA}`, [], []);

			expect(chips).toHaveLength(1);
			expect(chips[0]).toMatchObject({
				type: 'language',
				value: CODE_LANGS.JAVA,
				mode: 'include',
				label: CODE_LANGS.JAVA,
				icon: '💻',
				active: true
			});
		});
	});

	describe('Multiple Items Creation', () => {
		test('multiple keywords create multiple chips', () => {
			const chips = ChipService.createChipsFromFilter(
				`.${KEYWORDS.DEF} .${KEYWORDS.TRU} .${KEYWORDS.GOA}`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips).toHaveLength(3);
			expect(chips[0].value).toBe(KEYWORDS.DEF);
			expect(chips[1].value).toBe(KEYWORDS.TRU);
			expect(chips[2].value).toBe(KEYWORDS.GOA);
			expect(chips.every(c => c.type === 'keyword')).toBe(true);
		});

		test('multiple categories create multiple chips', () => {
			const chips = ChipService.createChipsFromFilter(
				`:${CATEGORY_IDS.BOO} :${CATEGORY_IDS.GOA}`,
				DEFAULT_CATEGORIES,
				[]
			);

			expect(chips).toHaveLength(2);
			expect(chips[0]).toMatchObject({
				type: 'category',
				value: CATEGORY_IDS.BOO,
				icon: '♣️'
			});
			expect(chips[1]).toMatchObject({
				type: 'category',
				value: CATEGORY_IDS.GOA,
				icon: '🏆'
			});
		});

		test('mixed types create correct chips', () => {
			const chips = ChipService.createChipsFromFilter(
				`.${KEYWORDS.DEF} :${CATEGORY_IDS.BOO} \`${CODE_LANGS.JAVA}`,
				DEFAULT_CATEGORIES,
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips).toHaveLength(3);

			const keywordChip = chips.find(c => c.type === 'keyword');
			const categoryChip = chips.find(c => c.type === 'category');
			const languageChip = chips.find(c => c.type === 'language');

			expect(keywordChip).toMatchObject({
				type: 'keyword',
				value: KEYWORDS.DEF,
				icon: '📖'
			});
			expect(categoryChip).toMatchObject({
				type: 'category',
				value: CATEGORY_IDS.BOO,
				icon: '♣️'
			});
			expect(languageChip).toMatchObject({
				type: 'language',
				value: CODE_LANGS.JAVA,
				icon: '💻'
			});
		});
	});

	describe('S: W: Expression Handling', () => {
		test('S: prefix is optional', () => {
			const withS = ChipService.createChipsFromFilter(
				`S: .${KEYWORDS.DEF}`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);
			const withoutS = ChipService.createChipsFromFilter(
				`.${KEYWORDS.DEF}`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(withS).toEqual(withoutS);
		});

		test('WHERE clause is ignored', () => {
			const chipsWithWhere = ChipService.createChipsFromFilter(
				`.${KEYWORDS.DEF} W: #strimzi`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);
			const chipsWithoutWhere = ChipService.createChipsFromFilter(
				`.${KEYWORDS.DEF}`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chipsWithWhere).toEqual(chipsWithoutWhere);
		});

		test('full S: W: expression creates correct chips', () => {
			const chips = ChipService.createChipsFromFilter(
				`S: .${KEYWORDS.DEF} :${CATEGORY_IDS.BOO} \`${CODE_LANGS.JAVA} W: #strimzi`,
				DEFAULT_CATEGORIES,
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips).toHaveLength(3);
			expect(chips.filter(c => c.type === 'keyword')).toHaveLength(1);
			expect(chips.filter(c => c.type === 'category')).toHaveLength(1);
			expect(chips.filter(c => c.type === 'language')).toHaveLength(1);
		});
	});

	describe('Edge Cases', () => {
		test('empty expression returns empty array', () => {
			expect(ChipService.createChipsFromFilter('', [], [])).toEqual([]);
		});

		test('WHERE only returns empty array', () => {
			expect(ChipService.createChipsFromFilter('W: #tag', [], [])).toEqual([]);
		});

		test('keyword without config uses defaults', () => {
			const chips = ChipService.createChipsFromFilter('.unknown', [], []);

			expect(chips).toHaveLength(1);
			expect(chips[0]).toMatchObject({
				type: 'keyword',
				value: 'unknown',
				icon: '🏷️',
				active: true
			});
		});

		test('nonexistent category returns empty array', () => {
			const chips = ChipService.createChipsFromFilter(':nonexistent', [], []);
			expect(chips).toEqual([]);
		});
	});
});
