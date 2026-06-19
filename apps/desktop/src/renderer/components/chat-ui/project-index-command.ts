// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
export const PROJECT_INDEX_COMMAND_NAME = "index";

export function parseProjectIndexCommand(
  text: string
): { query: string } | null {
  const match = text.match(/^\/index(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }
  return { query: (match[1] ?? "").trim() };
}
