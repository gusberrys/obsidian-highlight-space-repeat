/**
 * Combine priority for main keywords
 * Controls what priority this main keyword has when combined with auxiliary keywords
 */
export enum MainCombinePriority {
	/** No priority - default behavior (auxiliary can override) */
	None = 'None',
	/** Use this main keyword's styles (colors, classes) when auxiliary keywords present */
	Style = 'Style',
	/** Use this main keyword's icon when auxiliary keywords present */
	Icon = 'Icon',
	/** Use both styles AND icon from this main keyword when auxiliary keywords present */
	StyleAndIcon = 'StyleAndIcon'
}

/**
 * Combine priority for auxiliary keywords
 * Controls how this auxiliary's icon behaves when multiple auxiliaries are present
 */
export enum AuxiliaryCombinePriority {
	/** Append this auxiliary's icon alongside other icons */
	AppendIcon = 'AppendIcon',
	/** Override/replace other icons with this auxiliary's icon */
	OverrideIcon = 'OverrideIcon'
}

/**
 * Union type for all combine priorities
 */
export type CombinePriority = MainCombinePriority | AuxiliaryCombinePriority;

/**
 * Type guard to check if priority is for main keyword
 */
export function isMainCombinePriority(priority: CombinePriority | undefined): priority is MainCombinePriority {
	return priority === MainCombinePriority.None ||
		priority === MainCombinePriority.Style ||
		priority === MainCombinePriority.Icon ||
		priority === MainCombinePriority.StyleAndIcon;
}

/**
 * Type guard to check if priority is for auxiliary keyword
 */
export function isAuxiliaryCombinePriority(priority: CombinePriority | undefined): priority is AuxiliaryCombinePriority {
	return priority === AuxiliaryCombinePriority.AppendIcon ||
		priority === AuxiliaryCombinePriority.OverrideIcon;
}
