import type { Editor } from 'obsidian';

/**
 * Code block detection result
 */
export interface CodeBlockInfo {
  isInBlock: boolean;
  startLine: number;
  endLine: number;
  language: string;
}

/**
 * Detect if cursor is inside a code block
 * Returns info about the code block if inside one
 */
export function detectCodeBlock(editor: Editor, currentLine: number): CodeBlockInfo {
  const totalLines = editor.lineCount();
  let startLine = -1;
  let endLine = -1;

  // Count ``` markers from start to current line to determine if we're in a block
  let tickCount = 0;
  for (let i = 0; i < currentLine; i++) {
    const line = editor.getLine(i);
    if (line.trim().startsWith('```')) {
      tickCount++;
      if (tickCount % 2 === 1) {
        startLine = i;
      }
    }
  }

  // If odd number of ticks, we're inside a block
  const isInBlock = tickCount % 2 === 1;

  if (isInBlock) {
    // Find the end marker
    for (let i = currentLine; i < totalLines; i++) {
      const line = editor.getLine(i);
      if (line.trim().startsWith('```')) {
        endLine = i;
        break;
      }
    }

    // Get language from start line
    const startLineContent = editor.getLine(startLine);
    const language = startLineContent.trim().substring(3).trim();

    return {
      isInBlock: true,
      startLine,
      endLine,
      language
    };
  }

  return {
    isInBlock: false,
    startLine: -1,
    endLine: -1,
    language: ''
  };
}

/**
 * Update code block header with color reference
 * Format: ```language color:lineNumber
 */
export function updateCodeBlockHeader(
  editor: Editor,
  blockInfo: CodeBlockInfo,
  colorName: string,
  currentLine: number
): void {
  const headerLine = editor.getLine(blockInfo.startLine);
  const relativeLine = currentLine - blockInfo.startLine;

  // Parse existing header
  const match = headerLine.match(/^```(\S*)\s*(.*)/);
  if (!match) return;

  const language = match[1] || '';
  const existingRefs = match[2] || '';

  // Add or update color reference
  const refPattern = new RegExp(`${colorName}:\\d+`);
  let newRefs = existingRefs;

  if (refPattern.test(existingRefs)) {
    // Update existing reference
    newRefs = existingRefs.replace(refPattern, `${colorName}:${relativeLine}`);
  } else {
    // Add new reference
    newRefs = existingRefs ? `${existingRefs} ${colorName}:${relativeLine}` : `${colorName}:${relativeLine}`;
  }

  // Build new header
  const newHeader = `\`\`\`${language} ${newRefs}`.trim();

  // Replace header line
  editor.replaceRange(
    newHeader,
    { line: blockInfo.startLine, ch: 0 },
    { line: blockInfo.startLine, ch: headerLine.length }
  );
}
