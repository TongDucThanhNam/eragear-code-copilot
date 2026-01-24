/**
 * JSON Storage Adapter
 *
 * Provides simple file-based JSON storage for persisting application data.
 * Stores data in `.eragear` directory within the project root.
 *
 * @module infra/storage/json-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Directory path for eragear storage */
const STORAGE_DIR = path.join(process.cwd(), ".eragear");

/**
 * Ensures the storage directory exists, creating it if necessary
 */
export function ensureStorageDir(): void {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Gets the full path to a storage file
 *
 * @param filename - The name of the storage file
 * @returns Full path to the storage file
 */
export function getStorageFile(filename: string): string {
  ensureStorageDir();
  return path.join(STORAGE_DIR, filename);
}

/**
 * Reads and parses a JSON file with fallback to default data
 *
 * @template T - The type of data to read
 * @param filename - The name of the storage file
 * @param fallback - Default data to return if file doesn't exist or is invalid
 * @returns The parsed data or fallback
 *
 * @example
 * ```typescript
 * const agents = readJsonFile<Agent[]>("agents.json", []);
 * ```
 */
export function readJsonFile<T>(filename: string, fallback: T): T {
  ensureStorageDir();
  const filePath = getStorageFile(filename);
  try {
    if (!existsSync(filePath)) {
      writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[Storage] Failed to read ${filename}:`, error);
    writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

/**
 * Writes data to a JSON file
 *
 * @template T - The type of data to write
 * @param filename - The name of the storage file
 * @param data - The data to write
 *
 * @example
 * ```typescript
 * writeJsonFile("agents.json", [{ id: "1", name: "Test Agent" }]);
 * ```
 */
export function writeJsonFile<T>(filename: string, data: T): void {
  ensureStorageDir();
  const filePath = getStorageFile(filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}
