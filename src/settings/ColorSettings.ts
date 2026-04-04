/**
 * Color highlighting settings
 * Now integrated with keywords system - each color generates 4 keywords automatically
 */

/**
 * Calculate text color (white or black) based on background brightness
 */
function calculateTextColor(backgroundColor: string): string {
	const r = parseInt(backgroundColor.slice(1, 3), 16);
	const g = parseInt(backgroundColor.slice(3, 5), 16);
	const b = parseInt(backgroundColor.slice(5, 7), 16);
	const brightness = (r * 299 + g * 587 + b * 114) / 1000;
	return brightness > 155 ? '#000000' : '#ffffff';
}

/**
 * Simplified color entry - one row per color in settings
 * Automatically generates 4 keywords: gv{cc}, gr{cc}, lv{cc}, lr{cc}
 */
export interface ColorEntry {
	name: string;           // Display name (e.g., "red")
	cc: string;             // Color class - short identifier (e.g., "r")
	gvIcon: string;         // Global Value icon (🔴)
	grIcon: string;         // Global Reference icon (🟥)
	lvIcon: string;         // Local Value icon (💔)
	lrIcon: string;         // Local Reference icon (📕)
	backgroundColor: string; // Hex color for background
	textColor: string;       // Hex color for text (auto-calculated or manual)
}


export const DEFAULT_COLOR_ENTRIES: ColorEntry[] = [
	{
		name: 'red',
		cc: 'r',
		gvIcon: '🟥',
		grIcon: '🔴',
		lvIcon: '💔',
		lrIcon: '📕',
		backgroundColor: '#a62626',
		textColor: '#ffffff'
	},
	{
		name: 'green',
		cc: 'g',
		gvIcon: '🟩',
		grIcon: '🟢',
		lvIcon: '💚',
		lrIcon: '📗',
		backgroundColor: '#079db0',
		textColor: '#ffffff'
	},
	{
		name: 'blue',
		cc: 'b',
		gvIcon: '🟦',
		grIcon: '🔵',
		lvIcon: '💙',
		lrIcon: '📘',
		backgroundColor: '#0c5ddf',
		textColor: '#ffffff'
	},
	{
		name: 'yellow',
		cc: 'y',
		gvIcon: '🟨',
		grIcon: '🟡',
		lvIcon: '💛',
		lrIcon: '📔',
		backgroundColor: '#c7c729',
		textColor: '#000000'
	},
	{
		name: 'black',
		cc: 'bk',
		gvIcon: '⬛️',
		grIcon: '⚫️',
		lvIcon: '🖤',
		lrIcon: '📓',
		backgroundColor: '#000000',
		textColor: '#ffffff'
	},
	{
		name: 'orange',
		cc: 'o',
		gvIcon: '🟧',
		grIcon: '🟠',
		lvIcon: '🧡',
		lrIcon: '📙',
		backgroundColor: '#b57a0d',
		textColor: '#ffffff'
	},
	{
		name: 'purple',
		cc: 'p',
		gvIcon: '🟪',
		grIcon: '🟣',
		lvIcon: '💜',
		lrIcon: '📕',
		backgroundColor: '#800080',
		textColor: '#ffffff'
	},
	{
		name: 'white',
		cc: 'w',
		gvIcon: '⬜️',
		grIcon: '⚪️',
		lvIcon: '🤍',
		lrIcon: '📒',
		backgroundColor: '#FFFFFF',
		textColor: '#000000'
	}
];

