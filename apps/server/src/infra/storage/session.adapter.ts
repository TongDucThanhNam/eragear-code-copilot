// Session storage adapter
import { readJsonFile, writeJsonFile } from './json-store';
import type { SessionRepositoryPort } from '../../shared/types/ports';
import type { StoredSession, StoredMessage } from '../../shared/types/session.types';

const SESSIONS_FILE = 'sessions.json';

export class SessionStorageAdapter implements SessionRepositoryPort {
  private getSessions(): StoredSession[] {
    return readJsonFile(SESSIONS_FILE, []);
  }

  private saveSessions(sessions: StoredSession[]): void {
    writeJsonFile(SESSIONS_FILE, sessions);
  }

  findById(id: string): StoredSession | undefined {
    const sessions = this.getSessions();
    return sessions.find((s) => s.id === id);
  }

  findAll(): StoredSession[] {
    return this.getSessions();
  }

  save(session: StoredSession): void {
    const sessions = this.getSessions();
    const existingIndex = sessions.findIndex((s) => s.id === session.id);

    if (existingIndex >= 0) {
      sessions[existingIndex] = session;
    } else {
      sessions.push(session);
    }

    this.saveSessions(sessions);
  }

  updateStatus(id: string, status: 'running' | 'stopped'): void {
    const sessions = this.getSessions();
    const session = sessions.find((s) => s.id === id);
    if (session) {
      session.status = status;
      session.lastActiveAt = Date.now();
      this.saveSessions(sessions);
    }
  }

  updateMetadata(id: string, updates: Partial<StoredSession>): void {
    const sessions = this.getSessions();
    const session = sessions.find((s) => s.id === id);
    if (session) {
      Object.assign(session, updates);
      session.lastActiveAt = Date.now();
      this.saveSessions(sessions);
    }
  }

  delete(id: string): void {
    const sessions = this.getSessions();
    const newSessions = sessions.filter((s) => s.id !== id);
    this.saveSessions(newSessions);
  }

  appendMessage(id: string, message: StoredMessage): void {
    const sessions = this.getSessions();
    const session = sessions.find((s) => s.id === id);
    if (session) {
      if (!session.messages) {
        session.messages = [];
      }
      session.messages.push(message);
      session.lastActiveAt = Date.now();
      this.saveSessions(sessions);
    }
  }

  getMessages(id: string): StoredMessage[] {
    const session = this.findById(id);
    return session?.messages ?? [];
  }
}
