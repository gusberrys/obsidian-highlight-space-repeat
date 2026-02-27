/**
 * Combine priority for main keywords
 * Controls what priority this main keyword has when combined with auxiliary keywords
 */
export enum MainCombinePriority {
	/** No priority - default behavior (auxiliary colors shown, auxiliary icons appended) */
	None = 'None',
	/** Use this main keyword's styles (colors, classes) when auxiliary keywords present */
	Style = 'Style',
	/** Use this main keyword's icon when auxiliary keywords present */
	Icon = 'Icon',
	/** Use both styles AND icon from this main keyword when auxiliary keywords present */
	StyleAndIcon = 'StyleAndIcon'
}

/**
 * CombinePriority type (only MainCombinePriority)
 * Note: Auxiliary keywords always append their icons - no priority setting needed
 */
export type CombinePriority = MainCombinePriority;
