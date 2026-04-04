/**
 * Color highlighting settings
 * Separate from keyword highlighting - uses <mark> tags with color classes
 */

export interface ColourPair {
	colourName: string;
	globalReference: string;
	globalReferenceClass: string;
	globalValue: string;
	globalValueClass: string;
	localReference: string;
	localReferenceClass: string;
	localValue: string;
	localValueClass: string;
	localColour: string;
	localName: string;
}

export const DEFAULT_COLOR_SETTINGS: ColourPair[] = [
	{
		colourName: 'red',
		globalReference: '🔴',
		globalReferenceClass: 'grr',
		globalValue: '🟥',
		globalValueClass: 'gvr',
		localReference: '📕',
		localReferenceClass: 'lrr',
		localValue: '💔',
		localValueClass: 'lvr',
		localColour: '#a62626',
		localName: 'r'
	},
	{
		colourName: 'green',
		globalReference: '🟢',
		globalReferenceClass: 'grg',
		globalValue: '🟩',
		globalValueClass: 'gvg',
		localReference: '📗',
		localReferenceClass: 'lrg',
		localValue: '💚',
		localValueClass: 'lvg',
		localColour: '#079db0',
		localName: 'g'
	},
	{
		colourName: 'blue',
		globalReference: '🔵',
		globalReferenceClass: 'grb',
		globalValue: '🟦',
		globalValueClass: 'gvb',
		localReference: '📘',
		localReferenceClass: 'lrb',
		localValue: '💙',
		localValueClass: 'lvb',
		localColour: '#0c5ddf',
		localName: 'b'
	},
	{
		colourName: 'yellow',
		globalReference: '🟡',
		globalReferenceClass: 'gry',
		globalValue: '🟨',
		globalValueClass: 'gvy',
		localReference: '📔',
		localReferenceClass: 'lry',
		localValue: '💛',
		localValueClass: 'lvy',
		localColour: '#c7c729',
		localName: 'y'
	},
	{
		colourName: 'black',
		globalReference: '⚫️',
		globalReferenceClass: 'grbk',
		globalValue: '⬛️',
		globalValueClass: 'gvbk',
		localReference: '📓',
		localReferenceClass: 'lrbk',
		localValue: '🖤',
		localValueClass: 'lvbk',
		localColour: '#000000',
		localName: 'bk'
	},
	{
		colourName: 'orange',
		globalReference: '🟠',
		globalReferenceClass: 'gro',
		globalValue: '🟧',
		globalValueClass: 'gvo',
		localReference: '📙',
		localReferenceClass: 'lro',
		localValue: '🧡',
		localValueClass: 'lvo',
		localColour: '#b57a0d',
		localName: 'o'
	},
	{
		colourName: 'purple',
		globalReference: '🟣',
		globalReferenceClass: 'grp',
		globalValue: '🟪',
		globalValueClass: 'gvp',
		localReference: '📕',
		localReferenceClass: 'lrp',
		localValue: '💜',
		localValueClass: 'lvp',
		localColour: '#800080',
		localName: 'p'
	},
	{
		colourName: 'white',
		globalReference: '⚪️',
		globalReferenceClass: 'grw',
		globalValue: '⬜️',
		globalValueClass: 'gvw',
		localReference: '📒',
		localReferenceClass: 'lrw',
		localValue: '🤍',
		localValueClass: 'lvw',
		localColour: '#FFFFFF',
		localName: 'w'
	}
];
