#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

import {
	parsePendingTodos,
	tickTodoLine,
	type RunnerEvent,
} from "@repo/shared";

function nowTs() {
	return Date.now();
}
function id(prefix: string) {
	return `${prefix}-${nowTs()}-${Math.random().toString(16).slice(2)}`;
}
function printlnEvent(ev: RunnerEvent) {
	process.stdout.write(JSON.stringify(ev) + "\n");
}

function parseArgs(argv: string[]) {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a?.startsWith("--")) {
			out[a.slice(2)] = argv[i + 1] ?? "";
			i++;
		}
	}
	return out;
}

type AgentProc = {
	proc: ReturnType<typeof spawn>;
	conn: ClientSideConnection;
};

function fileUriToPath(uri: string) {
	if (uri.startsWith("file://"))
		return decodeURIComponent(uri.replace("file://", ""));
	return uri;
}

/**
 * ACP connection: spawn agent command và nối stdio NDJSON.
 * Ghi nhận session/update để emit event.
 */
async function startAcpAgent(
	_runId: string,
	_taskId: string,
	agentCmd: string,
	agentArgs: string[],
	cwd: string,
	onAgentChunk: (text: string) => void,
	onToolCall: (toolCallId: string, name: string, args: unknown) => void,
	onToolResult: (
		toolCallId: string,
		status: "in_progress" | "completed" | "failed",
		output?: unknown,
	) => void,
): Promise<AgentProc> {
	const proc = spawn(agentCmd, agentArgs, {
		cwd,
		stdio: ["pipe", "pipe", "inherit"],
	});

	const handlers = {
		// Agent -> Client streaming updates
		async sessionUpdate(p: any) {
			const u = p?.update;
			const kind = u?.sessionUpdate;

			if (kind === "agent_message_chunk") {
				const chunk = u?.content?.text ?? u?.text ?? "";
				if (chunk) onAgentChunk(String(chunk));
				return;
			}

			if (kind === "tool_call") {
				const toolCallId = u?.toolCallId ?? id("tool");
				const name = u?.toolName ?? u?.tool?.name ?? "tool";
				const args = u?.args ?? u?.tool?.args ?? {};
				onToolCall(String(toolCallId), String(name), args);
				return;
			}

			if (kind === "tool_call_update") {
				const toolCallId = u?.toolCallId ?? "tool";
				const status = u?.status ?? "completed";
				onToolResult(String(toolCallId), status, u?.content ?? u?.output);
				return;
			}
		},

		// Nếu agent xin quyền thì auto allow để khỏi bị treo
		async requestPermission(p: any) {
			const options = p?.options ?? [];
			return { outcome: options[0]?.outcome ?? "allow" };
		},

		/**
		 * FS methods (best-effort).
		 * Nhiều agent ACP sẽ gọi các method này để đọc/ghi file.
		 * Tuỳ agent, tên method có thể khác; SDK thường map đúng theo spec.
		 */
		async readTextFile(p: any) {
			const filePath = fileUriToPath(p?.uri ?? p?.path ?? "");
			const text = await readFile(filePath, "utf8");
			return { text };
		},

		async writeTextFile(p: any) {
			const filePath = fileUriToPath(p?.uri ?? p?.path ?? "");
			await writeFile(filePath, String(p?.text ?? p?.content ?? ""), "utf8");
			return { ok: true };
		},
	};

	const conn = new ClientSideConnection(
		() => handlers as any,
		ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout)),
	);

	await conn.initialize({
		protocolVersion: 1,
		clientInfo: { name: "acp-todo-runner", version: "0.0.1" },
		clientCapabilities: {},
	});

	return { proc, conn };
}

function buildTaskPrompt(taskText: string) {
	// Prompt ngắn, rõ scope. Bạn có thể mở rộng sau (inject design.md, constraints, verify commands...).
	return [
		"Bạn là coding agent. Chỉ làm đúng MỘT TODO dưới đây, không làm TODO khác.",
		"",
		`TODO: ${taskText}`,
		"",
		"Yêu cầu:",
		"- Nếu TODO nhắc tới file spec/design thì hãy đọc file đó.",
		"- Thực hiện thay đổi trong codebase để hoàn thành TODO.",
		"- Kết thúc bằng tóm tắt: đã sửa file nào, thay đổi gì, còn rủi ro gì.",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	const cmd = argv[0];
	const args = parseArgs(argv.slice(1));

	if (cmd !== "run") {
		console.error(
			"Usage: acp-todo-runner run --projectRoot . --todoPath todo.md --agentCmd opencode --agentArgs acp",
		);
		process.exit(1);
	}

	const projectRoot = args.projectRoot || process.cwd();
	const todoPath = path.isAbsolute(args.todoPath || "")
		? args.todoPath || "todo.md"
		: path.join(projectRoot, args.todoPath || "todo.md");
	const agentCmd = args.agentCmd || "opencode";
	const agentArgs = (args.agentArgs || "acp").split(" ").filter(Boolean);

	const runId = id("run");
	const logDir = path.join(projectRoot, "ai-logs");
	await mkdir(logDir, { recursive: true });

	printlnEvent({
		type: "run_start",
		runId,
		todoPath,
		projectRoot,
		ts: nowTs(),
	});

	const md = await readFile(todoPath, "utf8");
	const lines = md.split("\n");
	const pending = parsePendingTodos(md);

	for (let i = 0; i < pending.length; i++) {
		const item = pending[i];
		const taskId = id("task");
		const logPath = path.join("ai-logs", `${taskId}.md`);
		const absLogPath = path.join(projectRoot, logPath);

		printlnEvent({
			type: "task_start",
			runId,
			taskId,
			taskText: item!.text,
			index: i + 1,
			total: pending.length,
			ts: nowTs(),
		});

		let transcript = "";
		const onAgentChunk = (text: string) => {
			transcript += text;
			printlnEvent({ type: "agent_chunk", runId, taskId, text, ts: nowTs() });
		};
		const onToolCall = (toolCallId: string, name: string, args: unknown) => {
			printlnEvent({
				type: "tool_call",
				runId,
				taskId,
				toolCallId,
				name,
				args,
				ts: nowTs(),
			});
		};
		const onToolResult = (
			toolCallId: string,
			status: "in_progress" | "completed" | "failed",
			output?: unknown,
		) => {
			printlnEvent({
				type: "tool_result",
				runId,
				taskId,
				toolCallId,
				status,
				output,
				ts: nowTs(),
			});
		};

		// 1) Start agent (ACP)
		const agent = await startAcpAgent(
			runId,
			taskId,
			agentCmd,
			agentArgs,
			projectRoot,
			onAgentChunk,
			onToolCall,
			onToolResult,
		);

		// 2) newSession per TODO (đúng yêu cầu)
		const { sessionId } = await agent.conn.newSession({
			cwd: projectRoot,
			mcpServers: [],
		});

		// 3) prompt
		const promptText = buildTaskPrompt(item!.text);
		const res = await agent.conn.prompt({
			sessionId,
			prompt: [{ type: "text", text: promptText }],
		});

		// 4) Ghi log markdown
		const logMd =
			`# ${taskId}\n\n` +
			`- Run: **${runId}**\n` +
			`- TODO: **${item!.text}**\n` +
			`- Agent: \`${agentCmd} ${agentArgs.join(" ")}\`\n` +
			`- StopReason: \`${res?.stopReason ?? "unknown"}\`\n\n` +
			`---\n\n` +
			`## Transcript\n\n` +
			"```text\n" +
			transcript +
			"\n```\n";

		await writeFile(absLogPath, logMd, "utf8");

		// 5) Tick todo + save
		tickTodoLine(lines, item!.lineIndex, item!.text, logPath);
		await writeFile(todoPath, lines.join("\n"), "utf8");

		// 6) Cleanup agent process
		agent.proc.kill("SIGTERM");

		printlnEvent({
			type: "task_done",
			runId,
			taskId,
			ok: true,
			logPath,
			ts: nowTs(),
		});
	}

	printlnEvent({ type: "run_done", runId, ok: true, ts: nowTs() });
}

main().catch((e) => {
	const msg = e instanceof Error ? e.message : String(e);
	printlnEvent({
		type: "error",
		message: msg,
		detail: e,
		ts: Date.now(),
	} as any);
	process.exit(1);
});
