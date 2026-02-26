import { Decoration } from '@codemirror/view';
import { type KeywordStyle } from 'src/shared';

export const highlightMark = (keyword: KeywordStyle) => {
  const styles = [];
  const showColor = keyword.showColor ?? true;
  if (showColor) {
    styles.push(`--kh-c: ${keyword.color}`);
  }
  const showBackgroundColor = keyword.showBackgroundColor ?? true;
  if (showBackgroundColor) {
    styles.push(`--kh-bgc: ${keyword.backgroundColor}`);
  }

  return Decoration.mark({
    class: 'kh-highlighted',
    attributes: {
      style: styles.join(';'),
    },
  });
};
