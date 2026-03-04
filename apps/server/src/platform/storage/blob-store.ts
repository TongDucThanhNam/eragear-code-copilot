import {
  mkdirSync,
  readFile,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@/platform/logging/structured-logger";
import { createId } from "@/shared/utils/id.util";
import { getStorageDirPathSync } from "./storage-path";

const logger = createLogger("Storage");
const readFileAsync = promisify(readFile);

const BLOB_DIR_NAME = "blobs";
const BLOB_DATA_EXT = ".bin";
const BLOB_META_EXT = ".json";
const BLOB_ID_MAX_LENGTH = 128;
const BLOB_ID_PATTERN = /^blob-[0-9a-f-]{36}$/i;

export type BlobSourceType =
  | "image"
  | "audio"
  | "resource"
  | "tool-content"
  | "unknown";

export interface BlobRef {
  id: string;
  url: string;
  sizeBytes: number;
  mimeType?: string;
}

interface BlobMetadata {
  id: string;
  ownerUserId: string;
  chatId: string;
  sizeBytes: number;
  mimeType?: string;
  source: BlobSourceType;
  createdAt: number;
}

export interface StoreInlineBlobInput {
  userId: string;
  chatId: string;
  base64: string;
  mimeType?: string;
  source: BlobSourceType;
}

export interface StoredBlobReadResult {
  metadata: BlobMetadata;
  payload: Buffer;
}

function getBlobDirectoryPathSync(): string {
  const storageDir = getStorageDirPathSync();
  return path.join(storageDir, BLOB_DIR_NAME);
}

function buildBlobFilePath(blobId: string): string {
  return path.join(getBlobDirectoryPathSync(), `${blobId}${BLOB_DATA_EXT}`);
}

function buildBlobMetaPath(blobId: string): string {
  return path.join(getBlobDirectoryPathSync(), `${blobId}${BLOB_META_EXT}`);
}

function isValidBlobId(blobId: string): boolean {
  return (
    blobId.length > 0 &&
    blobId.length <= BLOB_ID_MAX_LENGTH &&
    BLOB_ID_PATTERN.test(blobId)
  );
}

function decodeStrictBase64(raw: string): Buffer | null {
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
  if (!decoded.length) {
    return null;
  }
  if (decoded.toString("base64") !== normalized) {
    return null;
  }
  return decoded;
}

function readMetadataFileSync(blobId: string): BlobMetadata | null {
  const filePath = buildBlobMetaPath(blobId);
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BlobMetadata>;
    if (
      parsed &&
      typeof parsed.id === "string" &&
      parsed.id === blobId &&
      typeof parsed.ownerUserId === "string" &&
      parsed.ownerUserId.length > 0 &&
      typeof parsed.chatId === "string" &&
      parsed.chatId.length > 0 &&
      typeof parsed.sizeBytes === "number" &&
      Number.isFinite(parsed.sizeBytes) &&
      parsed.sizeBytes >= 0 &&
      typeof parsed.source === "string" &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return {
        id: parsed.id,
        ownerUserId: parsed.ownerUserId,
        chatId: parsed.chatId,
        sizeBytes: Math.trunc(parsed.sizeBytes),
        mimeType:
          typeof parsed.mimeType === "string" && parsed.mimeType.length > 0
            ? parsed.mimeType
            : undefined,
        source: parsed.source as BlobSourceType,
        createdAt: Math.trunc(parsed.createdAt),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function safeUnlinkSync(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort cleanup for partially persisted blob artifacts.
  }
}

export function buildBlobUrlPath(blobId: string): string {
  return `/api/blobs/${encodeURIComponent(blobId)}`;
}

export function storeInlineBlobSync(input: StoreInlineBlobInput): BlobRef | null {
  const decoded = decodeStrictBase64(input.base64);
  if (!decoded) {
    logger.warn("Rejected invalid inline blob payload for out-of-band storage", {
      userId: input.userId,
      chatId: input.chatId,
      source: input.source,
      base64Length: input.base64.length,
    });
    return null;
  }

  const blobId = createId("blob");
  const blobDir = getBlobDirectoryPathSync();
  const dataPath = buildBlobFilePath(blobId);
  const metaPath = buildBlobMetaPath(blobId);
  const metadata: BlobMetadata = {
    id: blobId,
    ownerUserId: input.userId,
    chatId: input.chatId,
    sizeBytes: decoded.length,
    mimeType: input.mimeType,
    source: input.source,
    createdAt: Date.now(),
  };

  try {
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(dataPath, decoded, { flag: "wx" });
    writeFileSync(metaPath, JSON.stringify(metadata), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    safeUnlinkSync(dataPath);
    safeUnlinkSync(metaPath);
    logger.warn("Failed to persist inline blob out-of-band", {
      blobId,
      userId: input.userId,
      chatId: input.chatId,
      source: input.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  return {
    id: blobId,
    url: buildBlobUrlPath(blobId),
    sizeBytes: decoded.length,
    mimeType: input.mimeType,
  };
}

export async function readStoredBlobForUser(input: {
  blobId: string;
  userId: string;
}): Promise<StoredBlobReadResult | null> {
  if (!isValidBlobId(input.blobId)) {
    return null;
  }
  const metadata = readMetadataFileSync(input.blobId);
  if (!metadata) {
    return null;
  }
  if (metadata.ownerUserId !== input.userId) {
    return null;
  }

  const filePath = buildBlobFilePath(input.blobId);
  try {
    const payload = await readFileAsync(filePath);
    return { metadata, payload };
  } catch {
    return null;
  }
}
