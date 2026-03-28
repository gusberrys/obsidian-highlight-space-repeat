import { Setting, Notice, ButtonComponent } from 'obsidian';
import { DATA_PATHS } from '../shared/data-paths';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';

/**
 * Add SRS settings section to settings tab
 */
export function addSRSSettings(containerEl: HTMLElement, plugin: HighlightSpaceRepeatPlugin): void {
	containerEl.createEl('h2', { text: 'Spaced Repetition System (SRS)' });

	// Description
	const description = containerEl.createDiv({ cls: 'setting-item-description' });
	description.textContent = 'Review keyword records and code blocks with spaced repetition. The system uses fuzzy matching to preserve your review progress even when content moves to different lines.';

	// Stats section
	const statsContainer = containerEl.createDiv({ cls: 'srs-stats-section' });
	statsContainer.createEl('h3', { text: 'Statistics' });

	const stats = plugin.srsManager.getStats();
	const orphanStats = plugin.orphanManager.getOrphanStats();

	const statsGrid = statsContainer.createDiv({ cls: 'srs-stats-grid' });

	createStatCard(statsGrid, '📊 Total Cards', stats.total.toString());
	createStatCard(statsGrid, '🔥 Due Today', stats.due.toString());
	createStatCard(statsGrid, '✨ New Cards', stats.new.toString());
	createStatCard(statsGrid, '👻 Orphans', stats.orphans.toString());
	createStatCard(statsGrid, '⚡ Avg Ease', stats.avgEaseFactor.toFixed(2));
	createStatCard(statsGrid, '📅 Avg Interval', `${Math.round(stats.avgInterval)} days`);

	// Show scores setting
	new Setting(containerEl)
		.setName('Show Scores in Review')
		.setDesc('Display review statistics (reviews, interval, ease factor, lapses) during SRS review sessions')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.srsManager.getShowScores())
				.onChange(async (value) => {
					await plugin.srsManager.setShowScores(value);
					new Notice(`Score display ${value ? 'enabled' : 'disabled'}`);
				})
		);

	// Review session button
	new Setting(containerEl)
		.setName('Start Review Session')
		.setDesc(`Review ${stats.due} cards that are due today`)
		.addButton((button: ButtonComponent) =>
			button
				.setButtonText(`Review ${stats.due} Cards`)
				.setCta()
				.setDisabled(stats.due === 0)
				.onClick(async () => {
					const dueCards = plugin.srsManager.getDueCards();
					await plugin.activateSRSReviewView(dueCards);
				})
		);

	// Orphan management
	const orphanSection = containerEl.createDiv({ cls: 'srs-orphan-section' });
	orphanSection.createEl('h3', { text: 'Orphan Management' });

	const orphanDescription = orphanSection.createDiv({ cls: 'setting-item-description' });
	orphanDescription.textContent = `Orphaned cards (${orphanStats.count}) are review records that no longer match any parsed entry. This happens when content is deleted or moved to a different file.`;

	new Setting(containerEl)
		.setName('Detect Orphans')
		.setDesc('Scan parsed records and identify orphaned cards')
		.addButton((button: ButtonComponent) =>
			button
				.setButtonText('Detect Orphans')
				.onClick(async () => {
					new Notice('Scanning for orphans...');

					// Get parsed records from plugin RAM cache
					if (plugin.parsedRecords.length === 0) {
						new Notice('No parsed records found. Run a scan first.', 5000);
						return;
					}

					await plugin.orphanManager.detectOrphans(plugin.parsedRecords);

					const newStats = plugin.srsManager.getStats();
					new Notice(`Orphan detection complete. Found ${newStats.orphans} orphans.`);

					// Refresh settings display
					containerEl.empty();
					addSRSSettings(containerEl, plugin);
				})
		);

	new Setting(containerEl)
		.setName('Attempt Reconnection')
		.setDesc('Try to reconnect orphaned cards using fuzzy matching')
		.addButton((button: ButtonComponent) =>
			button
				.setButtonText('Reconnect Orphans')
				.setDisabled(orphanStats.count === 0)
				.onClick(async () => {
					new Notice('Attempting to reconnect orphans...');

					// Get parsed records from plugin RAM cache
					if (plugin.parsedRecords.length === 0) {
						new Notice('No parsed records found. Run a scan first.', 5000);
						return;
					}

					const reconnected = await plugin.orphanManager.attemptReconnection(plugin.parsedRecords);

					new Notice(`Reconnected ${reconnected} orphaned cards.`);

					// Refresh settings display
					containerEl.empty();
					addSRSSettings(containerEl, plugin);
				})
		);

	new Setting(containerEl)
		.setName('Cleanup Old Orphans')
		.setDesc('Delete orphans that have not been reviewed in 90+ days')
		.addButton((button: ButtonComponent) =>
			button
				.setButtonText('Cleanup Old Orphans')
				.setWarning()
				.setDisabled(orphanStats.count === 0)
				.onClick(async () => {
					const cleaned = await plugin.orphanManager.cleanupOldOrphans(90);
					new Notice(`Cleaned up ${cleaned} old orphans.`);

					// Refresh settings display
					containerEl.empty();
					addSRSSettings(containerEl, plugin);
				})
		);

	// Database management
	const dbSection = containerEl.createDiv({ cls: 'srs-database-section' });
	dbSection.createEl('h3', { text: 'Database Management' });

	new Setting(containerEl)
		.setName('Reset All Cards')
		.setDesc('⚠️ Delete ALL review data. This cannot be undone!')
		.addButton((button: ButtonComponent) =>
			button
				.setButtonText('Reset Database')
				.setWarning()
				.onClick(async () => {
					// Confirm
					const confirmed = confirm(
						'Are you sure you want to reset ALL SRS data? This will delete all review progress and cannot be undone!'
					);

					if (confirmed) {
						await plugin.srsManager.resetAll();
						new Notice('SRS database reset.');

						// Refresh settings display
						containerEl.empty();
						addSRSSettings(containerEl, plugin);
					}
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
