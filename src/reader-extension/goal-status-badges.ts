import type { MarkdownPostProcessorContext, App } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';

/**
 * Add goal status change badges to reading view
 */
export function addGoalStatusBadges(
	element: HTMLElement,
	context: MarkdownPostProcessorContext,
	plugin: HighlightSpaceRepeatPlugin,
	app: App
): void {
	// Find all elements with kh-highlighted class that have 'goa' keyword (active goals)
	const highlightedElements = element.querySelectorAll('.kh-highlighted');

	highlightedElements.forEach((el) => {
		const htmlEl = el as HTMLElement;

		// Extract keywords from data-keywords attribute
		const keywordsAttr = htmlEl.getAttribute('data-keywords');
		if (!keywordsAttr) return;

		const keywords = keywordsAttr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);

		// Only add badges to goals with 'goa' status (not suc or fai)
		if (!keywords.includes('goa')) return;

		// Get text content (from the span with kh-highlighted)
		const textSpan = htmlEl.querySelector('span');
		const text = textSpan?.textContent?.trim() || '';

		// Find the parent paragraph container (el-p)
		let container = htmlEl.parentElement;
		while (container && !container.classList.contains('el-p')) {
			container = container.parentElement;
		}

		if (!container) return;

		// Create badges container
		const badgesContainer = document.createElement('div');
		badgesContainer.className = 'goal-status-badges';

		// Create success badge (✅)
		const successBadge = document.createElement('button');
		successBadge.className = 'goal-status-badge success-badge';
		successBadge.textContent = '✅';
		successBadge.title = 'Mark as Success';
		successBadge.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			await changeGoalStatus(context.sourcePath, htmlEl, 'suc', app);
		});

		// Create failure badge (❌)
		const failBadge = document.createElement('button');
		failBadge.className = 'goal-status-badge fail-badge';
		failBadge.textContent = '❌';
		failBadge.title = 'Mark as Failed';
		failBadge.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			await changeGoalStatus(context.sourcePath, htmlEl, 'fai', app);
		});

		badgesContainer.appendChild(successBadge);
		badgesContainer.appendChild(failBadge);

		// Insert badges at the beginning of the container (before existing badges)
		const firstChild = container.firstChild;
		if (firstChild && (firstChild as HTMLElement).classList?.contains('reading-view-record-badge')) {
			// Insert after the record badge
			container.insertBefore(badgesContainer, firstChild.nextSibling);
		} else {
			container.insertBefore(badgesContainer, firstChild);
		}
	});
}

/**
 * Change goal status in the file
 */
async function changeGoalStatus(filePath: string, element: HTMLElement, newStatus: 'suc' | 'fai', app: App): Promise<void> {
	// Get the file
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!file || !('extension' in file)) return; // Must be a file, not a folder

	// Read file content
	const content = await app.vault.read(file as any);
	const lines = content.split('\n');

	// Get keywords from element
	const keywordsAttr = element.getAttribute('data-keywords');
	if (!keywordsAttr) return;

	const keywords = keywordsAttr.split(/\s+/).filter(k => k.length > 0);

	// Get text content from element (for matching)
	// Get all text content, then remove the score badge text
	const scoreBadge = element.querySelector('.journal-goal-score-badge');
	const scoreBadgeText = scoreBadge?.textContent?.trim() || '';
	const fullText = element.textContent?.trim() || '';

	// Remove score badge text and icons to get just the goal text
	let elementText = fullText.replace(scoreBadgeText, '').trim();
	// Remove leading icons (emojis and slashes)
	elementText = elementText.replace(/^[^\w\s]+\s*/, '').trim();

	// Find the line with these keywords AND matching text
	const lineIndex = lines.findIndex(line => {
		// Check if line starts with keywords::
		const match = line.match(/^([\w\s]+)::\s*(.+)$/);
		if (!match) return false;

		const lineKeywords = match[1].trim().split(/\s+/);
		const lineText = match[2].trim();

		// Check if all keywords match (order-independent)
		const keywordsMatch = keywords.every(k => lineKeywords.includes(k)) &&
		                      lineKeywords.every(k => keywords.includes(k));

		if (!keywordsMatch) return false;

		// Also check if text content matches (remove HTML comments and extra whitespace)
		const cleanLineText = lineText.replace(/%%.*?%%/g, '').trim();

		// Check if element text is contained in line text (case-insensitive, partial match)
		return cleanLineText.toLowerCase().includes(elementText.toLowerCase());
	});

	if (lineIndex === -1) return;

	// Replace 'goa' with new status
	const line = lines[lineIndex];
	const updatedLine = line.replace(/\bgoa\b/, newStatus);

	lines[lineIndex] = updatedLine;

	// Write back to file
	await app.vault.modify(file as any, lines.join('\n'));

	console.log(`[GoalStatusBadge] Changed goal status to ${newStatus} in ${filePath}`);
}
