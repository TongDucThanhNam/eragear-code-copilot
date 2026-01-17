import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentInfo } from "./types";

// Stored message format (simplified for persistence)
export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string; // Flattened text content
  timestamp: number;
  // Optional metadata
  toolCalls?: Array<{ name: string; args: unknown }>;
  reasoning?: string;
}

export interface StoredSession {
  id: string;
  sessionId?: string; // ACP sessionId
  projectRoot: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  loadSessionSupported?: boolean;
  agentInfo?: AgentInfo;
  status: "running" | "stopped";
  createdAt: number;
  lastActiveAt: number;
  modeId?: string;
  modelId?: string;
  messages: StoredMessage[]; // Chat history for read-only viewing
}

const STORAGE_DIR = path.join(process.cwd(), ".eragear");
const STORAGE_FILE = path.join(STORAGE_DIR, "sessions.json");

function ensureStorage() {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
  if (!existsSync(STORAGE_FILE)) {
    writeFileSync(STORAGE_FILE, JSON.stringify([], null, 2));
  }
}

export function loadSessions(): StoredSession[] {
  ensureStorage();
  try {
    const data = readFileSync(STORAGE_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error("[Store] Failed to load sessions:", e);
    return [];
  }
}

export function saveSession(session: StoredSession) {
  ensureStorage();
  const sessions = loadSessions();
  const existingIndex = sessions.findIndex((s) => s.id === session.id);

  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.push(session);
  }

  writeFileSync(STORAGE_FILE, JSON.stringify(sessions, null, 2));
}

export function updateSessionStatus(
  id: string,
  status: StoredSession["status"]
) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.status = status;
    session.lastActiveAt = Date.now();
    writeFileSync(STORAGE_FILE, JSON.stringify(sessions, null, 2));
  }
}

export function updateSessionMetadata(
  id: string,
  updates: Partial<StoredSession>
) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (session) {
    Object.assign(session, updates);
    session.lastActiveAt = Date.now();
    writeFileSync(STORAGE_FILE, JSON.stringify(sessions, null, 2));
  }
}

export function getSession(id: string): StoredSession | undefined {
  const sessions = loadSessions();
  return sessions.find((s) => s.id === id);
}

export function deleteSession(id: string) {
  const sessions = loadSessions();
  const newSessions = sessions.filter((s) => s.id !== id);
  writeFileSync(STORAGE_FILE, JSON.stringify(newSessions, null, 2));
}

export function appendMessage(id: string, message: StoredMessage) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (session) {
    if (!session.messages) {
      session.messages = [];
    }
    session.messages.push(message);
    session.lastActiveAt = Date.now();
    writeFileSync(STORAGE_FILE, JSON.stringify(sessions, null, 2));
  }
}

export function updateLastMessage(id: string, update: Partial<StoredMessage>) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (session?.messages && session.messages.length > 0) {
    const lastMsg = session.messages.at(-1);
    if (lastMsg) {
      Object.assign(lastMsg, update);
      session.lastActiveAt = Date.now();
      writeFileSync(STORAGE_FILE, JSON.stringify(sessions, null, 2));
    }
  }
}

export function getSessionMessages(id: string): StoredMessage[] {
  const session = getSession(id);
  return session?.messages ?? [];
}
