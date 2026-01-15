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
		const m = lines[i].match(TODO_RE);
		if (m) out.push({ lineIndex: i, rawLine: lines[i], text: m[1] });
	}
	return out;
}

export function tickTodoLine(
	lines: string[],
	lineIndex: number,
	text: string,
	logPath: string,
) {
	lines[lineIndex] = `- [x] ${text} (log: ${logPath})`;
}
