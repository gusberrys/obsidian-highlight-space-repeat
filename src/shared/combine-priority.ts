/**
 * Combine priority for main keywords
 * Controls what priority this main keyword has when combined with other keywords
 */
export enum MainCombinePriority {
	/** No priority - default behavior (other keyword colors shown, other keyword icons appended) */
	None = 'None',
	/** Use this main keyword's styles (colors, classes) when other keywords present */
	Style = 'Style',
	/** Use this main keyword's icon when other keywords present */
	Icon = 'Icon',
	/** Use both styles AND icon from this main keyword when other keywords present */
	StyleAndIcon = 'StyleAndIcon'
}

/**
 * CombinePriority type (only MainCombinePriority)
 * Note: Helper keywords don't have priority settings - they use default behavior
 */
export type CombinePriority = MainCombinePriority;
