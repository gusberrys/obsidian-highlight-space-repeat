import { App, SuggestModal } from 'obsidian';
import type { ColorEntry } from '../settings/ColorSettings';
import type { CodeBlockInfo } from '../utils/color-helpers';

interface ColourTypeOption {
	id: string;
	name: string;
	description: string;
	isDefault: boolean;
}

export class ColourTypeModal extends SuggestModal<ColourTypeOption> {
	onSelectCallback: (type: string) => void;
	codeBlockInfo: CodeBlockInfo;

	constructor(app: App, codeBlockInfo: CodeBlockInfo, onSelectCallback: (type: string) => void) {
		super(app);
		this.codeBlockInfo = codeBlockInfo;
		this.onSelectCallback = onSelectCallback;

		if (codeBlockInfo.isInBlock) {
			this.setPlaceholder('📝 In code block - Press 1=Local Ref, 2=Global Ref');
		} else {
			this.setPlaceholder('Press 1-4 or Enter: 1=Local Ref, 2=Local Val, 3=Global Ref, 4=Global Val');
		}
	}

	getSuggestions(query: string): ColourTypeOption[] {
		let options: ColourTypeOption[];

		if (this.codeBlockInfo.isInBlock) {
			// Only show references when in code block
			options = [
				{
					id: 'local-reference',
					name: '1. Local Reference 📘',
					description: 'Default - Updates code block header',
					isDefault: true
				},
				{
					id: 'global-reference',
					name: '2. Global Reference 🔵',
					description: 'Inserts emoji on current line',
					isDefault: false
				}
			];
		} else {
			// Show all options outside code blocks
			options = [
				{
					id: 'local-reference',
					name: '1. Local Reference 📘',
					description: 'Default - Local scope, reference',
					isDefault: true
				},
				{
					id: 'local-value',
					name: '2. Local Value 💙',
					description: 'Local scope, value',
					isDefault: false
				},
				{
					id: 'global-reference',
					name: '3. Global Reference 🔵',
					description: 'Global scope, reference',
					isDefault: false
				},
				{
					id: 'global-value',
					name: '4. Global Value 🟦',
					description: 'Global scope, value',
					isDefault: false
				}
			];
		}

		if (!query) {
			return options;
		}

		return options.filter(option =>
			option.name.toLowerCase().includes(query.toLowerCase()) ||
			option.description.toLowerCase().includes(query.toLowerCase())
		);
	}

	renderSuggestion(option: ColourTypeOption, el: HTMLElement) {
		el.createEl("div", {
			text: option.name,
			cls: option.isDefault ? 'colour-type-default' : ''
		});
		el.createEl("small", { text: option.description });
	}

	onChooseSuggestion(option: ColourTypeOption) {
		this.onSelectCallback(option.id);
	}

	// Override to handle number key shortcuts
	onOpen() {
		super.onOpen();

		if (this.codeBlockInfo.isInBlock) {
			// In code block: only 1 and 2
			this.scope.register([], '1', () => {
				this.close();
				this.onSelectCallback('local-reference');
				return false;
			});

			this.scope.register([], '2', () => {
				this.close();
				this.onSelectCallback('global-reference');
				return false;
			});
		} else {
			// Outside code block: 1-4
			this.scope.register([], '1', () => {
				this.close();
				this.onSelectCallback('local-reference');
				return false;
			});

			this.scope.register([], '2', () => {
				this.close();
				this.onSelectCallback('local-value');
				return false;
			});

			this.scope.register([], '3', () => {
				this.close();
				this.onSelectCallback('global-reference');
				return false;
			});

			this.scope.register([], '4', () => {
				this.close();
				this.onSelectCallback('global-value');
				return false;
			});
		}
	}
}

interface ColourOption {
	colour?: ColorEntry;
	isAll: boolean;
	name: string;
	description: string;
}

export class ColourSuggestModalWithToggle extends SuggestModal<ColourOption> {
	colours: ColorEntry[];
	onSelectCallback: (colour: ColorEntry | null, isAll: boolean, isGlobal: boolean) => void;
	isGlobal: boolean = false;
	isReferenceMode: boolean; // true = reference, false = value
	isTextSelection: boolean; // true = for text selection (shows cl/cg)

	constructor(app: App, colours: ColorEntry[], onSelectCallback: (colour: ColorEntry | null, isAll: boolean, isGlobal: boolean) => void, isReferenceMode: boolean = false, isTextSelection: boolean = false) {
		super(app);
		this.colours = colours;
		this.onSelectCallback = onSelectCallback;
		this.isReferenceMode = isReferenceMode;
		this.isTextSelection = isTextSelection;
		this.updatePlaceholder();
	}

	updatePlaceholder() {
		if (this.isTextSelection) {
			const refType = this.isGlobal ? 'G.R. 🔵' : 'L.R. 📘';
			this.setPlaceholder(`Select color (${refType}) - Press Tab to toggle`);
		} else {
			const scope = this.isGlobal ? 'GLOBAL' : 'LOCAL';
			const type = this.isReferenceMode ? 'reference' : 'value';
			this.setPlaceholder(`Select color (${scope} ${type}) - Press Tab to toggle Local/Global`);
		}
	}

	getSuggestions(query: string): ColourOption[] {
		const options: ColourOption[] = this.colours.map(colour => {
			let emoji = '';
			if (this.isReferenceMode) {
				emoji = this.isGlobal ? colour.grIcon : colour.lrIcon;
			} else {
				emoji = this.isGlobal ? colour.gvIcon : colour.lvIcon;
			}

			return {
				colour: colour,
				isAll: false,
				name: colour.name,
				description: emoji
			};
		});

		// Add "all" option at the end
		options.push({
			isAll: true,
			name: 'All colours',
			description: 'Insert list of all emojis'
		});

		if (!query) {
			return options;
		}

		return options.filter(option =>
			option.name.toLowerCase().includes(query.toLowerCase()) ||
			option.description.toLowerCase().includes(query.toLowerCase())
		);
	}

	renderSuggestion(option: ColourOption, el: HTMLElement) {
		if (option.isAll) {
			el.createEl("div", { text: option.name });
			el.createEl("small", { text: option.description });
		} else {
			el.createEl("div", { text: `${option.name} ${option.description}` });
		}
	}

	onChooseSuggestion(option: ColourOption) {
		this.onSelectCallback(option.colour || null, option.isAll, this.isGlobal);
	}

	onOpen() {
		super.onOpen();

		// Register Tab key to toggle between local and global
		this.scope.register([], 'Tab', () => {
			this.isGlobal = !this.isGlobal;
			this.updatePlaceholder();
			// Force refresh of suggestions
			const input = this.inputEl;
			const currentValue = input.value;
			input.value = currentValue + ' ';
			input.value = currentValue;
			input.dispatchEvent(new Event('input'));
			return false;
		});
	}
}

export class ColourSuggestModal extends SuggestModal<ColourOption> {
	colours: ColorEntry[];
	colourType: string;
	onSelectCallback: (colour: ColorEntry | null, isAll: boolean) => void;

	constructor(app: App, colours: ColorEntry[], colourType: string, onSelectCallback: (colour: ColorEntry | null, isAll: boolean) => void) {
		super(app);
		this.colours = colours;
		this.colourType = colourType;
		this.onSelectCallback = onSelectCallback;
	}

	getSuggestions(query: string): ColourOption[] {
		const options: ColourOption[] = this.colours.map(colour => {
			let emoji = '';
			switch(this.colourType) {
				case 'global-reference':
					emoji = colour.grIcon;
					break;
				case 'global-value':
					emoji = colour.gvIcon;
					break;
				case 'local-reference':
					emoji = colour.lrIcon;
					break;
				case 'local-value':
					emoji = colour.lvIcon;
					break;
			}

			return {
				colour: colour,
				isAll: false,
				name: colour.name,
				description: emoji
			};
		});

		// Add "all" option at the end
		options.push({
			isAll: true,
			name: 'All colours',
			description: 'Insert list of all emojis'
		});

		if (!query) {
			return options;
		}

		return options.filter(option =>
			option.name.toLowerCase().includes(query.toLowerCase()) ||
			option.description.toLowerCase().includes(query.toLowerCase())
		);
	}

	renderSuggestion(option: ColourOption, el: HTMLElement) {
		if (option.isAll) {
			el.createEl("div", { text: option.name });
			el.createEl("small", { text: option.description });
		} else {
			el.createEl("div", { text: `${option.name} ${option.description}` });
		}
	}

	onChooseSuggestion(option: ColourOption) {
		this.onSelectCallback(option.colour || null, option.isAll);
	}
}
