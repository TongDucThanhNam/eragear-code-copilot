export const MAX_ATTACHMENTS = 6;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

const BASE64PaddingRegex = /=+$/u;

export interface ImageAttachment {
  id: string;
  kind: "image";
  uri: string;
  name?: string;
  mimeType: string;
  base64: string;
  size: number;
}

export interface AudioAttachment {
  id: string;
  kind: "audio";
  uri: string;
  name: string;
  mimeType: string;
  base64: string;
  size: number;
}

export interface ResourceAttachment {
  id: string;
  kind: "resource";
  uri: string;
  name: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  size: number;
}

export type Attachment = ImageAttachment | AudioAttachment | ResourceAttachment;

export interface SendMessageInput {
  text: string;
  textAnnotations?: Record<string, unknown>;
  images?: Array<{
    base64: string;
    mimeType: string;
    uri?: string;
    annotations?: Record<string, unknown>;
  }>;
  audio?: Array<{
    base64: string;
    mimeType: string;
    annotations?: Record<string, unknown>;
  }>;
  resources?: Array<{
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
    annotations?: Record<string, unknown>;
  }>;
  resourceLinks?: Array<{
    uri: string;
    name: string;
    mimeType?: string;
    title?: string;
    description?: string;
    size?: number;
    annotations?: Record<string, unknown>;
  }>;
}

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/typescript",
]);

const EXTENSION_MIME_MAP: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
  xml: "application/xml",
  yml: "application/x-yaml",
  yaml: "application/x-yaml",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/typescript",
  jsx: "text/javascript",
  tsx: "text/typescript",
};

export function createAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function guessMimeType(
  filename: string | undefined
): string | undefined {
  if (!filename) {
    return undefined;
  }
  const parts = filename.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  const ext = parts.at(-1)?.toLowerCase() ?? "";
  return EXTENSION_MIME_MAP[ext];
}

export function isTextMimeType(
  mimeType: string | undefined,
  filename?: string
): boolean {
  if (mimeType) {
    if (mimeType.startsWith("text/")) {
      return true;
    }
    if (TEXT_MIME_TYPES.has(mimeType)) {
      return true;
    }
  }
  const guessed = guessMimeType(filename);
  return guessed ? isTextMimeType(guessed) : false;
}

export function estimateBase64Bytes(base64: string): number {
  const trimmed = base64.replace(BASE64PaddingRegex, "");
  return Math.floor((trimmed.length * 3) / 4);
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function buildSendMessagePayload(
  text: string,
  attachments: Attachment[]
): SendMessageInput {
  const images = attachments
    .filter((att): att is ImageAttachment => att.kind === "image")
    .map((att) => ({
      base64: att.base64,
      mimeType: att.mimeType,
      uri: att.uri,
    }));
  const audio = attachments
    .filter((att): att is AudioAttachment => att.kind === "audio")
    .map((att) => ({
      base64: att.base64,
      mimeType: att.mimeType,
    }));
  const resources = attachments
    .filter((att): att is ResourceAttachment => att.kind === "resource")
    .map((att) => ({
      uri: att.uri,
      text: att.text,
      blob: att.blob,
      mimeType: att.mimeType,
    }));

  return {
    text,
    ...(images.length > 0 ? { images } : {}),
    ...(audio.length > 0 ? { audio } : {}),
    ...(resources.length > 0 ? { resources } : {}),
  };
}
