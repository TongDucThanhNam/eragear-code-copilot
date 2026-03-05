import type { BundledLanguage } from "shiki";
import type { StoredContentBlock } from "@/components/chat-ui/content-blocks/types";

const FILE_PROTOCOL = /^file:\/\//i;
const HTTP_PROTOCOL = /^https?:\/\//i;
const DATA_PROTOCOL = /^data:/i;

const MIME_LANGUAGE_MAP: Record<string, BundledLanguage> = {
  "application/json": "json",
  "application/javascript": "javascript",
  "application/typescript": "typescript",
  "text/javascript": "javascript",
  "text/typescript": "typescript",
  "text/markdown": "markdown",
  "text/plain": "log",
  "text/html": "html",
  "text/css": "css",
  "text/x-python": "python",
  "text/x-shellscript": "bash",
  "text/yaml": "yaml",
  "application/x-yaml": "yaml",
};

const EXT_LANGUAGE_MAP: Record<string, BundledLanguage> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  sh: "bash",
  html: "html",
  css: "css",
};

export function stripFileProtocol(uri?: string) {
  if (!uri) {
    return "";
  }
  return uri.replace(FILE_PROTOCOL, "");
}

export function getFileName(uri?: string, fallback = "resource") {
  if (!uri) {
    return fallback;
  }
  const cleaned = stripFileProtocol(uri);
  const segment = cleaned.split("/").pop();
  return segment || cleaned || fallback;
}

export function getRenderableUri(uri?: string) {
  if (!uri) {
    return null;
  }
  if (DATA_PROTOCOL.test(uri) || HTTP_PROTOCOL.test(uri)) {
    return uri;
  }
  return null;
}

export function buildDataUrl(mimeType?: string, data?: string) {
  if (!data) {
    return null;
  }
  const safeType = mimeType || "application/octet-stream";
  return `data:${safeType};base64,${data}`;
}

export function formatBytes(size: number) {
  if (!Number.isFinite(size)) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(size) / Math.log(1024)) - 1
  );
  const value = size / 1024 ** (index + 1);
  return `${value.toFixed(1)} ${units[index]}`;
}

export function formatAnnotations(annotations: unknown) {
  if (!annotations) {
    return "";
  }
  try {
    const raw = JSON.stringify(annotations);
    return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
  } catch {
    return "annotations";
  }
}

export function guessLanguage(
  mimeType?: string,
  uri?: string
): BundledLanguage {
  if (mimeType && MIME_LANGUAGE_MAP[mimeType]) {
    return MIME_LANGUAGE_MAP[mimeType];
  }
  if (uri) {
    const cleaned = uri.split(/[?#]/)[0];
    const ext = cleaned.split(".").pop()?.toLowerCase();
    if (ext && EXT_LANGUAGE_MAP[ext]) {
      return EXT_LANGUAGE_MAP[ext];
    }
  }
  return "log";
}

export function getBlockKey(block: StoredContentBlock, index: number) {
  switch (block.type) {
    case "image":
    case "audio":
      return `${block.type}:${block.uri ?? ""}:${block.mimeType}:${block.data.slice(
        0,
        24
      )}`;
    case "resource":
      return `resource:${block.resource.uri}:${block.resource.mimeType ?? ""}:${
        block.resource.text?.slice(0, 24) ??
        block.resource.blob?.slice(0, 24) ??
        index
      }`;
    case "resource_link":
      return `resource_link:${block.uri}:${block.name}:${block.size ?? ""}`;
    default:
      return `block:${index}`;
  }
}

export { HTTP_PROTOCOL };
