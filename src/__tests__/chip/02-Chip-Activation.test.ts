/// <reference types="jest" />
import { ChipService } from '../../services/ChipService';
import { DEFAULT_CATEGORIES, DEFAULT_KEYWORD_CONFIGS, KEYWORDS, CATEGORY_IDS, CODE_LANGS } from '../helpers/testConstants';

/**
 * CHIP ACTIVATION TESTS
 *
 * Tests that chips have correct active state based on unchecked flag (_)
 */

describe('Chip Activation', () => {

	describe('Default Activation (No _ Prefix)', () => {
		test('keyword chip is active by default', () => {
			const chips = ChipService.createChipsFromFilter(`.${KEYWORDS.DEF}`, [], DEFAULT_KEYWORD_CONFIGS);

			expect(chips[0].active).toBe(true);
		});

		test('category chip is active by default', () => {
			const chips = ChipService.createChipsFromFilter(`:${CATEGORY_IDS.BOO}`, DEFAULT_CATEGORIES, []);

			expect(chips[0].active).toBe(true);
		});

		test('language chip is active by default', () => {
			const chips = ChipService.createChipsFromFilter(`\`${CODE_LANGS.JAVA}`, [], []);

			expect(chips[0].active).toBe(true);
		});
	});

	describe('Unchecked Flag (_ Prefix)', () => {
		test('_.keyword creates inactive chip', () => {
			const chips = ChipService.createChipsFromFilter(`_.${KEYWORDS.DEF}`, [], DEFAULT_KEYWORD_CONFIGS);

			expect(chips).toHaveLength(1);
			expect(chips[0]).toMatchObject({
				type: 'keyword',
				value: KEYWORDS.DEF,
				active: false
			});
		});

		test('_:category creates inactive chip', () => {
			const chips = ChipService.createChipsFromFilter(`_:${CATEGORY_IDS.BOO}`, DEFAULT_CATEGORIES, []);

			expect(chips).toHaveLength(1);
			expect(chips[0]).toMatchObject({
				type: 'category',
				value: CATEGORY_IDS.BOO,
				active: false
			});
		});

		test('_`language creates inactive chip', () => {
			const chips = ChipService.createChipsFromFilter(`_\`${CODE_LANGS.JAVA}`, [], []);

			expect(chips).toHaveLength(1);
			expect(chips[0]).toMatchObject({
				type: 'language',
				value: CODE_LANGS.JAVA,
				active: false
			});
		});
	});

	describe('Mixed Activation States', () => {
		test('mixed checked and unchecked keywords', () => {
			const chips = ChipService.createChipsFromFilter(
				`.${KEYWORDS.DEF} _.${KEYWORDS.TRU} .${KEYWORDS.GOA}`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips).toHaveLength(3);
			expect(chips[0]).toMatchObject({ value: KEYWORDS.DEF, active: true });
			expect(chips[1]).toMatchObject({ value: KEYWORDS.TRU, active: false });
			expect(chips[2]).toMatchObject({ value: KEYWORDS.GOA, active: true });
		});

		test('mixed checked and unchecked categories', () => {
			const chips = ChipService.createChipsFromFilter(
				`:${CATEGORY_IDS.BOO} _:${CATEGORY_IDS.GOA}`,
				DEFAULT_CATEGORIES,
				[]
			);

			expect(chips).toHaveLength(2);
			expect(chips[0]).toMatchObject({ value: CATEGORY_IDS.BOO, active: true });
			expect(chips[1]).toMatchObject({ value: CATEGORY_IDS.GOA, active: false });
		});

		test('mixed checked and unchecked languages', () => {
			const chips = ChipService.createChipsFromFilter(
				`\`${CODE_LANGS.JAVA} _\`${CODE_LANGS.PYTHON}`,
				[],
				[]
			);

			expect(chips).toHaveLength(2);
			expect(chips[0]).toMatchObject({ value: CODE_LANGS.JAVA, active: true });
			expect(chips[1]).toMatchObject({ value: CODE_LANGS.PYTHON, active: false });
		});

		test('mixed types with mixed activation', () => {
			const chips = ChipService.createChipsFromFilter(
				`.${KEYWORDS.DEF} _:${CATEGORY_IDS.BOO} \`${CODE_LANGS.JAVA}`,
				DEFAULT_CATEGORIES,
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips).toHaveLength(3);

			const keywordChip = chips.find(c => c.type === 'keyword');
			const categoryChip = chips.find(c => c.type === 'category');
			const languageChip = chips.find(c => c.type === 'language');

			expect(keywordChip?.active).toBe(true);
			expect(categoryChip?.active).toBe(false);
			expect(languageChip?.active).toBe(true);
		});
	});

	describe('Activation with S: W: Syntax', () => {
		test('unchecked flag works with S: prefix', () => {
			const chips = ChipService.createChipsFromFilter(
				`S: _.${KEYWORDS.DEF}`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips[0].active).toBe(false);
		});

		test('unchecked flag works with W: clause', () => {
			const chips = ChipService.createChipsFromFilter(
				`_.${KEYWORDS.DEF} W: #tag`,
				[],
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips[0].active).toBe(false);
		});

		test('full expression with mixed activation', () => {
			const chips = ChipService.createChipsFromFilter(
				`S: .${KEYWORDS.DEF} _:${CATEGORY_IDS.BOO} _\`${CODE_LANGS.JAVA} W: #strimzi`,
				DEFAULT_CATEGORIES,
				DEFAULT_KEYWORD_CONFIGS
			);

			expect(chips).toHaveLength(3);
			expect(chips.filter(c => c.active === true)).toHaveLength(1);
			expect(chips.filter(c => c.active === false)).toHaveLength(2);
		});
	});

	describe('Chip ID Generation', () => {
		test('generates unique ID for keyword chip', () => {
			const chips = ChipService.createChipsFromFilter(`.${KEYWORDS.DEF}`, [], DEFAULT_KEYWORD_CONFIGS);

			expect(ChipService.getChipId(chips[0])).toBe(`keyword-include-${KEYWORDS.DEF}`);
		});

		test('generates unique ID for category chip', () => {
			const chips = ChipService.createChipsFromFilter(`:${CATEGORY_IDS.BOO}`, DEFAULT_CATEGORIES, []);

			expect(ChipService.getChipId(chips[0])).toBe(`category-include-${CATEGORY_IDS.BOO}`);
		});

		test('generates unique ID for language chip', () => {
			const chips = ChipService.createChipsFromFilter(`\`${CODE_LANGS.JAVA}`, [], []);

			expect(ChipService.getChipId(chips[0])).toBe(`language-include-${CODE_LANGS.JAVA}`);
		});

		test('inactive chip has same ID as active chip', () => {
			const activeChips = ChipService.createChipsFromFilter(`.${KEYWORDS.DEF}`, [], DEFAULT_KEYWORD_CONFIGS);
			const inactiveChips = ChipService.createChipsFromFilter(`_.${KEYWORDS.DEF}`, [], DEFAULT_KEYWORD_CONFIGS);

			// ID is based on type-mode-value, not active state
			expect(ChipService.getChipId(activeChips[0])).toBe(ChipService.getChipId(inactiveChips[0]));
		});
	});
});
