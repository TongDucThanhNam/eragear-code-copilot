export type TodoItem = {
  lineIndex: number;
  rawLine: string;
  text: string;
};

const TODO_RE = /^- \[ \] (.+)\s*$/;

export function parsePendingTodos(markdown: string): TodoItem[] {
  const lines = markdown.split("\n");
  const out: TodoItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const match = line.match(TODO_RE);
    if (!match?.[1]) {
      continue;
    }
    out.push({ lineIndex: i, rawLine: line, text: match[1] });
  }
  return out;
}

export function tickTodoLine(
  lines: string[],
  lineIndex: number,
  text: string,
  logPath: string
) {
  if (lines[lineIndex] === undefined) {
    return;
  }
  lines[lineIndex] = `- [x] ${text} (log: ${logPath})`;
}
