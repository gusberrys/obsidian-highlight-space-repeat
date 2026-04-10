/**
 * VWord (Visual Word) - special pattern-based keywords for visual layout control
 *
 * Four types:
 * - i-keywords: Control image column width (i10 to i90, step 5)
 * - h-keywords: Control horizontal list item ratios (2-5 elements, sum 2-7)
 * - l-keywords: Control last-item grid layout (l10 to l90, step 5)
 * - n-keywords: Control next-element column width (n10 to n90, step 10)
 */

export interface VWordSettings {
  color: string;
  backgroundColor: string;
}

export const DEFAULT_VWORD_SETTINGS: VWordSettings = {
  color: '#ffffff',
  backgroundColor: '#666666'
};

export type VWordType = 'i' | 'h' | 'l' | 'n';

export interface VWordKeyword {
  keyword: string;  // e.g., "i67", "r123"
  type: VWordType;
  value: string;    // e.g., "67", "123"
}

/**
 * Check if a keyword matches VWord pattern
 * i-keywords: i10, i15, i20, ..., i90 (17 total)
 * h-keywords: 2-5 elements, sum 2-7 (112 total)
 * l-keywords: l10, l15, l20, ..., l90 (17 total)
 */
export function isVWordKeyword(keyword: string): boolean {
  return isIKeyword(keyword) || isHKeyword(keyword) || isLKeyword(keyword) || isNKeyword(keyword);
}

/**
 * Check if keyword is i-keyword (i10 to i90, step 5)
 */
export function isIKeyword(keyword: string): boolean {
  const match = keyword.match(/^i(\d+)$/);
  if (!match) return false;

  const value = parseInt(match[1], 10);
  // Must be 10-90 and divisible by 5
  return value >= 10 && value <= 90 && value % 5 === 0;
}

/**
 * Check if keyword is l-keyword (l10 to l90, step 5)
 */
export function isLKeyword(keyword: string): boolean {
  const match = keyword.match(/^l(\d+)$/);
  if (!match) return false;

  const value = parseInt(match[1], 10);
  // Must be 10-90 and divisible by 5
  return value >= 10 && value <= 90 && value % 5 === 0;
}

/**
 * Check if keyword is n-keyword (n10 to n90, step 5)
 */
export function isNKeyword(keyword: string): boolean {
  const match = keyword.match(/^n(\d+)$/);
  if (!match) return false;

  const value = parseInt(match[1], 10);
  // Must be 10-90 and divisible by 5
  return value >= 10 && value <= 90 && value % 5 === 0;
}

/**
 * Check if keyword is h-keyword (2-5 elements, sum 2-7)
 */
export function isHKeyword(keyword: string): boolean {
  const match = keyword.match(/^h(\d{2,5})$/);
  if (!match) return false;

  const digits = match[1];
  const numElements = digits.length;
  const sum = digits.split('').reduce((acc, d) => acc + parseInt(d, 10), 0);

  // 2-5 elements
  if (numElements < 2 || numElements > 5) return false;

  // Sum must be within valid range for this element count
  // 2 elements: sum 2-7
  // 3 elements: sum 3-7
  // 4 elements: sum 4-7
  // 5 elements: sum 5-7
  const minSum = numElements;
  const maxSum = 7;

  return sum >= minSum && sum <= maxSum;
}

/**
 * Parse VWord keyword into structured data
 */
export function parseVWordKeyword(keyword: string): VWordKeyword | null {
  if (isIKeyword(keyword)) {
    const value = keyword.substring(1); // Remove 'i' prefix
    return { keyword, type: 'i', value };
  }

  if (isHKeyword(keyword)) {
    const value = keyword.substring(1); // Remove 'h' prefix
    return { keyword, type: 'h', value };
  }

  if (isLKeyword(keyword)) {
    const value = keyword.substring(1); // Remove 'l' prefix
    return { keyword, type: 'l', value };
  }

  if (isNKeyword(keyword)) {
    const value = keyword.substring(1); // Remove 'n' prefix
    return { keyword, type: 'n', value };
  }

  return null;
}

/**
 * Generate all valid i-keywords
 */
export function generateIKeywords(): string[] {
  const keywords: string[] = [];
  for (let i = 10; i <= 90; i += 5) {
    keywords.push(`i${i}`);
  }
  return keywords;
}

/**
 * Generate all valid l-keywords
 */
export function generateLKeywords(): string[] {
  const keywords: string[] = [];
  for (let i = 10; i <= 90; i += 5) {
    keywords.push(`l${i}`);
  }
  return keywords;
}

/**
 * Generate all valid h-keywords for given element count and sum range
 */
function generateHKeywordsForElements(numElements: number, minSum: number, maxSum: number): string[] {
  const keywords: string[] = [];

  // Recursive function to generate all combinations
  function generate(current: number[], remainingElements: number, remainingSum: number) {
    if (remainingElements === 0) {
      if (remainingSum === 0) {
        keywords.push('h' + current.join(''));
      }
      return;
    }

    // Each digit can be 1-7, but must not exceed remainingSum
    for (let digit = 1; digit <= Math.min(7, remainingSum); digit++) {
      generate([...current, digit], remainingElements - 1, remainingSum - digit);
    }
  }

  for (let sum = minSum; sum <= maxSum; sum++) {
    generate([], numElements, sum);
  }

  return keywords;
}

/**
 * Generate all valid h-keywords (112 total)
 */
export function generateHKeywords(): string[] {
  const keywords: string[] = [];

  // 2 elements: sum 2-7
  keywords.push(...generateHKeywordsForElements(2, 2, 7));

  // 3 elements: sum 3-7
  keywords.push(...generateHKeywordsForElements(3, 3, 7));

  // 4 elements: sum 4-7
  keywords.push(...generateHKeywordsForElements(4, 4, 7));

  // 5 elements: sum 5-7
  keywords.push(...generateHKeywordsForElements(5, 5, 7));

  return keywords;
}

/**
 * Generate all VWord keywords (146 total: 17 i + 112 h + 17 l)
 */
export function generateAllVWordKeywords(): string[] {
  return [...generateIKeywords(), ...generateHKeywords(), ...generateLKeywords()];
}

/**
 * Calculate percentage widths from h-keyword weights
 * Example: "123" -> [16.66, 33.33, 50.00]
 */
export function calculateHKeywordWidths(value: string): number[] {
  const digits = value.split('').map(d => parseInt(d, 10));
  const sum = digits.reduce((acc, d) => acc + d, 0);

  return digits.map(d => (d / sum) * 100);
}
