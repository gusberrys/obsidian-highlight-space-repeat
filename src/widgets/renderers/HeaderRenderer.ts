import type { ActiveChip } from '../../interfaces/ActiveChip';

/**
 * HeaderRenderer - Handles rendering of matrix widget header
 * Renders subject selector, filter input, buttons, chips, and flags
 */
export class HeaderRenderer {
	private activeChips: Map<string, ActiveChip>;
	private trimSubItems: boolean;
	private topRecordOnly: boolean;
	private showAll: boolean;
	private showLegend: boolean;

	// Callbacks
	private onTrimToggle: () => void;
	private onTopToggle: () => void;
	private onShowAllToggle: () => void;
	private onLegendToggle: () => void;
	private onChipClick: (chipId: string) => void;

	constructor(
		flags: {
			activeChips: Map<string, ActiveChip>;
			trimSubItems: boolean;
			topRecordOnly: boolean;
			showAll: boolean;
			showLegend: boolean;
		},
		callbacks: {
			onTrimToggle: () => void;
			onTopToggle: () => void;
			onShowAllToggle: () => void;
			onLegendToggle: () => void;
			onChipClick: (chipId: string) => void;
		}
	) {
		this.activeChips = flags.activeChips;
		this.trimSubItems = flags.trimSubItems;
		this.topRecordOnly = flags.topRecordOnly;
		this.showAll = flags.showAll;
		this.showLegend = flags.showLegend;

		this.onTrimToggle = callbacks.onTrimToggle;
		this.onTopToggle = callbacks.onTopToggle;
		this.onShowAllToggle = callbacks.onShowAllToggle;
		this.onLegendToggle = callbacks.onLegendToggle;
		this.onChipClick = callbacks.onChipClick;
	}

	/**
	 * Render complete header (chips/flags only now)
	 * IMPORTANT: Preserves exact DOM structure:
	 * - Creates 'kh-chips-section' div with id='kh-chips-container'
	 */
	render(container: HTMLElement): void {
		// Chips and flags section
		this.renderChipsSection(container);
	}

	/**
	 * Render chips and flags section
	 * IMPORTANT: Creates div with id='kh-chips-container' for external access
	 */
	private renderChipsSection(container: HTMLElement): void {
		const chipsSection = container.createDiv({ cls: 'kh-chips-section' });
		chipsSection.id = 'kh-chips-container';

		this.renderChipsAndFlags(chipsSection);
	}

	/**
	 * Render chips content (flags moved to RecordsRenderer)
	 */
	private renderChipsAndFlags(chipsContainer: HTMLElement): void {
		chipsContainer.empty();

		if (this.activeChips.size === 0) {
			return;
		}

		// Render active chips
		const sortedChips = Array.from(this.activeChips.entries()).sort(([idA, chipA], [idB, chipB]) => {
			// Category chips first
			if (chipA.type === 'category' && chipB.type !== 'category') return -1;
			if (chipA.type !== 'category' && chipB.type === 'category') return 1;
			return 0;
		});

		sortedChips.forEach(([chipId, chip]) => {
			const classList = [
				'grid-keyword-chip',
				chip.active ? 'active' : 'inactive',
				chip.mode === 'exclude' ? 'excluded' : '',
				chip.type === 'category' ? 'kh-category-master' : '',
				chip.cssClass || ''
			].filter(c => c).join(' ');

			const chipEl = chipsContainer.createEl('button', { cls: classList });

			if (chip.backgroundColor) {
				chipEl.style.backgroundColor = chip.backgroundColor;
			}
			if (chip.color) {
				chipEl.style.color = chip.color;
			}

			if (chip.icon) {
				chipEl.createEl('span', {
					cls: 'keyword-chip-icon',
					text: chip.icon
				});
			}

			chipEl.createEl('span', {
				cls: 'keyword-chip-label',
				text: chip.label
			});

			// Chip click handler
			chipEl.onclick = () => {
				this.onChipClick(chipId);
			};
		});
	}
}
