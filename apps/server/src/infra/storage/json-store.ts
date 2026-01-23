// Shared JSON storage adapter
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STORAGE_DIR = path.join(process.cwd(), '.eragear');

export function ensureStorageDir(): void {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

export function getStorageFile(filename: string): string {
  ensureStorageDir();
  return path.join(STORAGE_DIR, filename);
}

export function readJsonFile<T>(filename: string, fallback: T): T {
  ensureStorageDir();
  const filePath = getStorageFile(filename);
  try {
    if (!existsSync(filePath)) {
      writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[Storage] Failed to read ${filename}:`, error);
    writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

export function writeJsonFile<T>(filename: string, data: T): void {
  ensureStorageDir();
  const filePath = getStorageFile(filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}
