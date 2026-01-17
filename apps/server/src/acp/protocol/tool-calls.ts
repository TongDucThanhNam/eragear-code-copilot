import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import { broadcastToSession, chats } from "../../session/events";
import type { ChatSession, TerminalState } from "../../session/types";
import { createId } from "../../utils/id";
import { fileUriToPath } from "../../utils/path";

const LINE_SPLITTER_REGEX = /\r?\n/;

function normalizeOutputLimit(limit?: bigint | number | null) {
  if (limit === null || limit === undefined) {
    return undefined;
  }
  if (typeof limit === "bigint") {
    if (limit <= 0n) {
      return undefined;
    }
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(limit > maxSafe ? maxSafe : limit);
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }
  return Math.min(limit, Number.MAX_SAFE_INTEGER);
}

function envArrayToRecord(env?: acp.EnvVariable[] | null) {
  if (!env || env.length === 0) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const variable of env) {
    record[variable.name] = variable.value;
  }
  return record;
}

function getSessionOrThrow(chatId: string) {
  const session = chats.get(chatId);
  if (!session) {
    throw new Error("Session not found");
  }
  return session;
}

function getTerminalOrThrow(session: ChatSession, terminalId: string) {
  const terminal = session.terminals.get(terminalId);
  if (!terminal) {
    throw new Error("Terminal not found");
  }
  return terminal;
}

export async function readTextFile(
  params: acp.ReadTextFileRequest
): Promise<acp.ReadTextFileResponse> {
  const filePath = fileUriToPath(params.path);
  try {
    const text = await readFile(filePath, "utf8");
    const line = params.line ?? undefined;
    const limit = params.limit ?? undefined;

    if (line !== undefined || limit !== undefined) {
      const startLine = Math.max((line ?? 1) - 1, 0);
      if (limit !== undefined && limit <= 0) {
        return { content: "" };
      }
      const lines = text.split(LINE_SPLITTER_REGEX);
      const endLine = limit ? startLine + limit : undefined;
      return { content: lines.slice(startLine, endLine).join("\n") };
    }

    return { content: text };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw RequestError.resourceNotFound(filePath);
      }
    }
    throw error;
  }
}

export async function writeTextFile(
  params: acp.WriteTextFileRequest
): Promise<acp.WriteTextFileResponse> {
  const filePath = fileUriToPath(params.path);
  await writeFile(filePath, params.content, "utf8");
  return {};
}

export function createTerminal(
  chatId: string,
  params: acp.CreateTerminalRequest
): Promise<acp.CreateTerminalResponse> {
  const termId = createId("term");
  console.log(
    `[Server] Creating terminal ${termId}: ${params.command} ${params.args?.join(" ")}`
  );

  const session = getSessionOrThrow(chatId);
  const sessionCwd = session.projectRoot;
  const targetCwd = params.cwd
    ? path.resolve(sessionCwd, params.cwd)
    : sessionCwd;
  const outputByteLimit = normalizeOutputLimit(params.outputByteLimit ?? null);

  const termProc = spawn(params.command, params.args ?? [], {
    cwd: targetCwd,
    env: {
      ...process.env,
      ...envArrayToRecord(params.env ?? null),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const termState: TerminalState = {
    id: termId,
    process: termProc,
    outputBuffer: "",
    outputByteLimit,
    truncated: false,
    resolveExit: [],
  };

  session.terminals.set(termId, termState);

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    termState.outputBuffer += text;
    if (
      outputByteLimit !== undefined &&
      termState.outputBuffer.length > outputByteLimit
    ) {
      termState.outputBuffer = termState.outputBuffer.slice(
        termState.outputBuffer.length - outputByteLimit
      );
      termState.truncated = true;
    }

    broadcastToSession(chatId, {
      type: "terminal_output",
      terminalId: termId,
      data: text,
    });
  };

  termProc.stdout?.on("data", handleOutput);
  termProc.stderr?.on("data", handleOutput);

  termProc.on("exit", (code, signal) => {
    termState.exitStatus = { exitCode: code, signal };
    for (const resolve of termState.resolveExit) {
      resolve({ exitCode: code, signal });
    }
    termState.resolveExit = [];
  });

  termProc.on("error", (err) => {
    console.error(`[Server] Terminal ${termId} error:`, err);
  });

  return Promise.resolve({ terminalId: termId });
}

export async function waitForTerminalExit(
  chatId: string,
  params: acp.WaitForTerminalExitRequest
): Promise<acp.WaitForTerminalExitResponse> {
  const session = getSessionOrThrow(chatId);
  const term = getTerminalOrThrow(session, params.terminalId);

  if (term.exitStatus) {
    return await term.exitStatus;
  }

  return new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
    term.resolveExit.push(resolve);
  });
}

export async function terminalOutput(
  chatId: string,
  params: acp.TerminalOutputRequest
): Promise<acp.TerminalOutputResponse> {
  const session = getSessionOrThrow(chatId);
  const term = getTerminalOrThrow(session, params.terminalId);

  return await {
    output: term.outputBuffer,
    truncated: term.truncated ?? false,
    exitStatus: term.exitStatus ?? null,
  };
}

export function killTerminal(
  chatId: string,
  params: acp.KillTerminalCommandRequest
): Promise<acp.KillTerminalCommandResponse> {
  const session = getSessionOrThrow(chatId);
  const term = getTerminalOrThrow(session, params.terminalId);

  term.process.kill();
  return Promise.resolve({});
}

export function releaseTerminal(
  chatId: string,
  params: acp.ReleaseTerminalRequest
): Promise<acp.ReleaseTerminalResponse | undefined> {
  const session = getSessionOrThrow(chatId);
  const term = session.terminals.get(params.terminalId);
  if (!term) {
    return Promise.resolve(undefined);
  }

  if (!term.exitStatus) {
    term.process.kill();
  }
  session.terminals.delete(params.terminalId);
  return Promise.resolve(undefined);
}
