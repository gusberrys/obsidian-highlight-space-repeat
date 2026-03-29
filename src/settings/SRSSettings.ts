import { Setting, Notice, ButtonComponent } from 'obsidian';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';

/**
 * Add SRS settings section to settings tab
 */
export function addSRSSettings(containerEl: HTMLElement, plugin: HighlightSpaceRepeatPlugin): void {
	containerEl.createEl('h2', { text: 'Spaced Repetition System (SRS)' });

	// Description
	const description = containerEl.createDiv({ cls: 'setting-item-description' });
	description.textContent = 'Review keyword entries with spaced repetition. SRS data is stored as HTML comments directly in your markdown files.';

	// Stats section
	const statsContainer = containerEl.createDiv({ cls: 'srs-stats-section' });
	statsContainer.createEl('h3', { text: 'Statistics' });

	const stats = plugin.srsManager.getStats(plugin.parsedRecords);

	const statsGrid = statsContainer.createDiv({ cls: 'srs-stats-grid' });

	createStatCard(statsGrid, '📊 Total Entries', stats.total.toString());
	createStatCard(statsGrid, '🔥 Due Today', stats.due.toString());
	createStatCard(statsGrid, '✨ New Entries', stats.new.toString());
	createStatCard(statsGrid, '⚡ Avg Ease', stats.avgEaseFactor.toFixed(2));
	createStatCard(statsGrid, '📅 Avg Interval', `${Math.round(stats.avgInterval)} days`);

	// Review session button
	new Setting(containerEl)
		.setName('Start Review Session')
		.setDesc(`Review ${stats.due} entries that are due today`)
		.addButton((button: ButtonComponent) =>
			button
				.setButtonText(`Review ${stats.due} Entries`)
				.setCta()
				.setDisabled(stats.due === 0)
				.onClick(async () => {
					const dueEntries = plugin.srsManager.getDueEntries(plugin.parsedRecords);
					await plugin.activateSRSReviewView(dueEntries);
				})
		);
}

/**
 * Create stat card
 */
function createStatCard(container: HTMLElement, label: string, value: string): void {
	const card = container.createDiv({ cls: 'srs-stat-card' });
	card.createDiv({ cls: 'srs-stat-card-label', text: label });
	card.createDiv({ cls: 'srs-stat-card-value', text: value });
}
