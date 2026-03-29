import type { ActiveChip } from '../../interfaces/ActiveChip';

/**
 * HeaderRenderer - Handles rendering of matrix widget header
 * Renders subject selector, filter input, buttons, chips, and flags
 */
export class HeaderRenderer {
	private activeChips: Map<string, ActiveChip>;
	private trimSubItems: boolean;
	private topRecordOnly: boolean;
	private showLegend: boolean;

	// Callbacks
	private onTrimToggle: () => void;
	private onTopToggle: () => void;
	private onLegendToggle: () => void;
	private onChipClick: (chipId: string) => void;

	constructor(
		flags: {
			activeChips: Map<string, ActiveChip>;
			trimSubItems: boolean;
			topRecordOnly: boolean;
			showLegend: boolean;
		},
		callbacks: {
			onTrimToggle: () => void;
			onTopToggle: () => void;
			onLegendToggle: () => void;
			onChipClick: (chipId: string) => void;
		}
	) {
		this.activeChips = flags.activeChips;
		this.trimSubItems = flags.trimSubItems;
		this.topRecordOnly = flags.topRecordOnly;
		this.showLegend = flags.showLegend;

		this.onTrimToggle = callbacks.onTrimToggle;
		this.onTopToggle = callbacks.onTopToggle;
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
	 * NOTE: Chips are now rendered in RecordsRenderer below the filter input
	 */
	private renderChipsAndFlags(chipsContainer: HTMLElement): void {
		chipsContainer.empty();
		// Chips are now rendered in RecordsRenderer, not here
	}
}
