import {
  ATTACHMENT_HARD_LIMIT_BYTES,
  IMAGE_PROMPT_MAX_BYTES,
  IMAGE_PROMPT_MAX_DIMENSION,
  IMAGE_PROMPT_QUALITY_STEPS,
} from "@/config/attachments";

export type PreparedPromptImage = {
  base64: string;
  mimeType: string;
  sizeBytes: number;
};

type PrepareImageErrorCode = "unsupported" | "too_large" | "encode_failed";

export type PrepareImageResult =
  | { ok: true; image: PreparedPromptImage }
  | { ok: false; error: { code: PrepareImageErrorCode; message: string } };

export async function prepareImageForPrompt(
  file: File
): Promise<PrepareImageResult> {
  if (!file.type.startsWith("image/")) {
    return {
      ok: false,
      error: { code: "unsupported", message: "Unsupported image type." },
    };
  }
  if (file.size > ATTACHMENT_HARD_LIMIT_BYTES) {
    return {
      ok: false,
      error: {
        code: "too_large",
        message: `Image exceeds ${formatBytes(
          ATTACHMENT_HARD_LIMIT_BYTES
        )} upload limit.`,
      },
    };
  }

  if (file.size <= IMAGE_PROMPT_MAX_BYTES) {
    const base64 = await fileToBase64(file);
    return {
      ok: true,
      image: {
        base64,
        mimeType: normalizeImageMimeType(file.type),
        sizeBytes: file.size,
      },
    };
  }

  const canvas = await renderImageToCanvas(file, IMAGE_PROMPT_MAX_DIMENSION);
  const preferredType = normalizeImageMimeType(file.type);
  const mimeCandidates = buildMimeCandidates(preferredType);

  for (const mimeType of mimeCandidates) {
    for (const quality of IMAGE_PROMPT_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, mimeType, quality);
      if (!blob) {
        continue;
      }
      if (blob.size <= IMAGE_PROMPT_MAX_BYTES) {
        const base64 = await blobToBase64(blob);
        return {
          ok: true,
          image: {
            base64,
            mimeType,
            sizeBytes: blob.size,
          },
        };
      }
    }
  }

  return {
    ok: false,
    error: {
      code: "too_large",
      message: `Image could not be compressed under ${formatBytes(
        IMAGE_PROMPT_MAX_BYTES
      )}.`,
    },
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function normalizeImageMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  if (normalized.startsWith("image/")) {
    return normalized;
  }
  return "image/png";
}

function buildMimeCandidates(preferred: string): string[] {
  const candidates = [preferred];
  if (preferred !== "image/webp") {
    candidates.push("image/webp");
  }
  if (preferred !== "image/jpeg") {
    candidates.push("image/jpeg");
  }
  return Array.from(new Set(candidates));
}

async function renderImageToCanvas(
  file: File,
  maxDimension: number
): Promise<HTMLCanvasElement> {
  const bitmap = await loadImageBitmap(file);
  if (bitmap) {
    try {
      return drawBitmapToCanvas(bitmap, maxDimension);
    } finally {
      bitmap.close?.();
    }
  }
  const img = await loadHtmlImage(file);
  return drawHtmlImageToCanvas(img, maxDimension);
}

async function loadImageBitmap(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") {
    return null;
  }
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
}

async function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawBitmapToCanvas(
  bitmap: ImageBitmap,
  maxDimension: number
): HTMLCanvasElement {
  const { width, height } = scaleDimensions(
    bitmap.width,
    bitmap.height,
    maxDimension
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not supported.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function drawHtmlImageToCanvas(
  img: HTMLImageElement,
  maxDimension: number
): HTMLCanvasElement {
  const { width, height } = scaleDimensions(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    maxDimension
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not supported.");
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function scaleDimensions(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(1, maxDimension / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      clampQuality(quality)
    );
  });
}

function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) {
    return 0.85;
  }
  return Math.min(1, Math.max(0.1, quality));
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  return dataUrlToBase64(dataUrl);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await readAsDataUrl(blob);
  return dataUrlToBase64(dataUrl);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl: string): string {
  const [, base64] = dataUrl.split(",");
  if (!base64) {
    throw new Error("Invalid data URL.");
  }
  return base64;
}
