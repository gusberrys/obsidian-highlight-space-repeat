import { Decoration } from '@codemirror/view';
import { type KeywordStyle } from 'src/shared';

export const highlightMark = (keyword: KeywordStyle) => {
  // Build class list: base class + keyword class
  const classes = ['kh-highlighted', keyword.keyword].join(' ');

  return Decoration.mark({
    class: classes,
  });
};
