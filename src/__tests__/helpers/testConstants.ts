import type { Category, KeywordStyle } from '../../shared/keyword-style';
import { CollectingStatus } from '../../shared/collecting-status';

/**
 * Test Constants
 *
 * Mock categories and settings that mirror production configuration
 */

// Helper to create keyword with defaults
const createKeyword = (keyword: string, icon: string = '', aliases: string[] = []): KeywordStyle => ({
	keyword,
	color: '#000000',
	backgroundColor: '#ffffff',
	collectingStatus: CollectingStatus.PARSED,
	generateIcon: icon || undefined,
	aliases: aliases.length > 0 ? aliases : undefined
});

// Category IDs
export const CATEGORY_IDS = {
	ID: 'id-c',
	BOO: 'boo-c',
	GOA: 'goa-c',
	FUN: 'fun-c',
	CODE_BLOCKS: 'code-blocks'
} as const;

// Keyword names
export const KEYWORDS = {
	// id-c category
	DEF: 'def',
	ID: 'id',
	// boo-c category
	TRU: 'tru',
	FAL: 'fal',
	BIO: 'bio',
	DNA: 'dna', // alias for bio
	// goa-c category
	GOA: 'goa',
	SUC: 'suc',
	FAI: 'fai',
	// fun-c category
	F: 'f',
	CRE: 'cre',
	REA: 'rea',
	UPD: 'upd',
	DEL: 'del'
} as const;

// Code block language IDs
export const CODE_LANGS = {
	JAVA: 'java',
	PYTHON: 'python',
	RUST: 'rust'
} as const;

// File tags
export const TAGS = {
	JAVA: 'java',
	PYTHON: 'python',
	CONCURRENCY: 'concurrency',
	OOP: 'oop',
	MVN: 'mvn',
	IT: 'it'
} as const;

// Default test categories
export const DEFAULT_CATEGORIES: Category[] = [
	{
		icon: '📖',
		id: CATEGORY_IDS.ID,
		keywords: [
			createKeyword(KEYWORDS.DEF, '📖'),
			createKeyword(KEYWORDS.ID, '🆔'),
		]
	},
	{
		icon: '♣️',
		id: CATEGORY_IDS.BOO,
		keywords: [
			createKeyword(KEYWORDS.TRU, '📜'),
			createKeyword(KEYWORDS.FAL, '🧻'),
			createKeyword(KEYWORDS.BIO, '🧬')
		]
	},
	{
		icon: '🏆',
		id: CATEGORY_IDS.GOA,
		keywords: [
			createKeyword(KEYWORDS.GOA, '🏆'),
			createKeyword(KEYWORDS.SUC, '✅'),
			createKeyword(KEYWORDS.FAI, '❌'),
		]
	},
	{
		icon: '𝑓 fun',
		id: CATEGORY_IDS.FUN,
		keywords: [
			createKeyword(KEYWORDS.F, '𝑓'),
			createKeyword(KEYWORDS.CRE, '🏭'),
			createKeyword(KEYWORDS.REA, '🍁'),
			createKeyword(KEYWORDS.UPD, '📉'),
			createKeyword(KEYWORDS.DEL, '🪦')
		]
	}
];

// Flattened keyword configs for chip tests (extracted from DEFAULT_CATEGORIES)
export const DEFAULT_KEYWORD_CONFIGS = DEFAULT_CATEGORIES.flatMap(cat => cat.keywords);

