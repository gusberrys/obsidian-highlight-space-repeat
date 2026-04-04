import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { RangeSet, StateField, StateEffect } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { CollectingStatus, isSpaced } from '../shared/collecting-status';
import type { HighlightSpaceRepeatPlugin } from '../highlight-space-repeat-plugin';
import type { ParsedEntry } from '../interfaces/ParsedFile';
import { keywordsStore } from '../stores/settings-store';
import { get } from 'svelte/store';

/**
 * Gutter marker for record badges
 */
class RecordBadgeMarker extends GutterMarker {
	constructor(
		private badge: '🔄' | '✅',
		private recordYaml: string
	) {
		super();
	}

	toDOM(): HTMLElement {
		const marker = document.createElement('div');
		marker.className = 'record-badge-marker';
		marker.textContent = this.badge;

		// Create tooltip
		const tooltip = document.createElement('div');
		tooltip.className = 'record-badge-tooltip';
		tooltip.innerHTML = `<pre>${this.recordYaml}</pre>`;
		marker.appendChild(tooltip);

		// Show tooltip on hover
		marker.addEventListener('mouseenter', () => {
			tooltip.classList.add('visible');
		});
		marker.addEventListener('mouseleave', () => {
			tooltip.classList.remove('visible');
		});

		return marker;
	}
}

/**
 * Parse a line and generate record YAML
 */
function generateRecordYaml(lineText: string, lineNumber: number, plugin: HighlightSpaceRepeatPlugin): string | null {
	// Check if line has keyword syntax: foo bar :: text
	const match = lineText.match(/^([\w\s]+)::\s*(.*)$/);
	if (!match) return null;

	const keywordsStr = match[1].trim();
	const text = match[2];
	const keywords = keywordsStr.split(/\s+/).map(k => k.toLowerCase()).filter(k => k.length > 0);

	if (keywords.length === 0) return null;

	// Build record representation
	const record: Partial<ParsedEntry> = {
		type: 'keyword',
		lineNumber,
		text,
		keywords
	};

	// Convert to YAML-like format
	let yaml = 'type: keyword\n';
	yaml += `lineNumber: ${lineNumber}\n`;
	yaml += `text: "${text}"\n`;
	yaml += 'keywords:\n';
	for (const kw of keywords) {
		yaml += `  - ${kw}\n`;
	}

	return yaml;
}

/**
 * Get collecting status for keywords
 */
function getCollectingStatus(keywords: string[]): CollectingStatus | null {
	const keywordsData = get(keywordsStore);

	for (const keyword of keywords) {
		// Find keyword in categories
		for (const category of keywordsData.categories) {
			const keywordObj = category.keywords.find((k: any) => k.keyword === keyword);
			if (keywordObj && keywordObj.collectingStatus) {
				return keywordObj.collectingStatus;
			}
		}
	}

	return null;
}

/**
 * State effect to update badges
 */
const updateBadges = StateEffect.define<RangeSet<GutterMarker>>();

/**
 * State field to track badge markers
 */
const badgeState = StateField.define<RangeSet<GutterMarker>>({
	create() {
		return RangeSet.empty;
	},
	update(badges, tr) {
		// Check for update effects
		for (const effect of tr.effects) {
			if (effect.is(updateBadges)) {
				return effect.value;
			}
		}
		return badges.map(tr.changes);
	}
});

/**
 * Create the record badge gutter extension
 */
export function recordBadgeGutter(plugin: HighlightSpaceRepeatPlugin): Extension {
	return [
		badgeState,
		gutter({
			class: 'record-badge-gutter',
			markers: (view) => view.state.field(badgeState),
			initialSpacer: () => new RecordBadgeMarker('✅', ''),
		}),
		EditorView.updateListener.of((update) => {
			if (update.docChanged || update.viewportChanged) {
				const markers: { from: number; marker: GutterMarker }[] = [];
				const doc = update.state.doc;

				// Scan visible lines
				for (let i = 1; i <= doc.lines; i++) {
					const line = doc.line(i);
					const lineText = line.text.trim();

					// Check if line has keywords
					const yamlRecord = generateRecordYaml(lineText, i, plugin);
					if (!yamlRecord) continue;

					// Extract keywords to check status
					const match = lineText.match(/^([\w\s]+)::/);
					if (!match) continue;

					const keywords = match[1].trim().split(/\s+/).map(k => k.toLowerCase());
					const status = getCollectingStatus(keywords);

					if (!status) continue;

					// Don't show badges for IGNORED keywords
					if (status === CollectingStatus.IGNORED) continue;

					// Determine badge (IGNORED filtered above)
					// SPACED → 🔄, PARSED → ✅
					const badge = isSpaced(status) ? '🔄' : '✅';

					markers.push({
						from: line.from,
						marker: new RecordBadgeMarker(badge, yamlRecord)
					});
				}

				// Build range set
				const rangeSet = RangeSet.of(markers.map(m => m.marker.range(m.from)), true);

				// Update state
				update.view.dispatch({
					effects: updateBadges.of(rangeSet)
				});
			}
		})
	];
}
