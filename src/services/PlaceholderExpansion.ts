import type { Topic } from '../interfaces/Topic';
import type { Subject } from '../interfaces/Subject';

/**
 * Expand placeholders in filter expressions based on Topic/Subject data
 * This service is owned by Subject Matrix plugin since it knows about Topics and Subjects
 */
export class PlaceholderExpansion {
	/**
	 * Expand placeholders in filter expression
	 * For secondary topics: use topic's own values (or subject's if no topic)
	 * For intersections: use primary topic's values
	 *
	 * Placeholder syntax:
	 * - $TAG → topicTag (e.g., #java)
	 * - $KEY → topicKeyword (e.g., .jav)
	 * - $BLOCK or $CODE → code block language (e.g., `java)
	 * - $TEXT → topicText (e.g., "java")
	 */
	static expandPlaceholders(expression: string, primaryTopic: Topic | null, subject?: Subject): string {
		if (!primaryTopic && !subject) {
			return expression;
		}

		let result = expression;

		// Expand $TAG with topicTag (or subject mainTag)
		const tagSource = primaryTopic?.topicTag || subject?.mainTag;
		if (tagSource) {
			// NORMALIZE: Strip leading # from tag if present (works regardless of storage format)
			const tagValue = tagSource.replace(/^#/, '');
			result = result.replace(/\$TAG/g, `#${tagValue}`);
		}

		// Expand $KEY with topicKeyword (or subject keyword)
		const keywordSource = primaryTopic?.topicKeyword || subject?.keyword;
		if (keywordSource) {
			result = result.replace(/\$KEY/g, `.${keywordSource}`);
		}

		// Expand $BLOCK and $CODE with topicText (language/code block)
		if (primaryTopic?.topicText) {
			result = result.replace(/\$BLOCK/g, `\`${primaryTopic.topicText}`);
			result = result.replace(/\$CODE/g, `\`${primaryTopic.topicText}`);
		}

		// Expand $TEXT with topicText
		if (primaryTopic?.topicText) {
			result = result.replace(/\$TEXT/g, `"${primaryTopic.topicText}"`);
		}

		return result;
	}
}
