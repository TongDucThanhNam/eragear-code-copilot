import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  prepareImageForPrompt,
  type PrepareImageResult,
} from "@/lib/image-prompt";

export interface SubmitPromptImage {
  base64: string;
  mimeType: string;
}

export interface SubmitPromptImageError {
  fileName: string;
  message: string;
}

export interface PreparedSubmitImages {
  imageFileCount: number;
  images: SubmitPromptImage[];
  errors: SubmitPromptImageError[];
}

export async function prepareSubmitImages(
  files: PromptInputMessage["files"],
  options?: {
    prepare?: (file: File) => Promise<PrepareImageResult>;
  }
): Promise<PreparedSubmitImages> {
  const prepare = options?.prepare ?? prepareImageForPrompt;
  const imageFiles = files.filter((filePart) =>
    filePart.file?.type.startsWith("image/")
  );
  const images: SubmitPromptImage[] = [];
  const errors: SubmitPromptImageError[] = [];

  for (const filePart of imageFiles) {
    const file = filePart.file;
    if (!file) {
      continue;
    }
    try {
      const result = await prepare(file);
      if (result.ok) {
        images.push({
          base64: result.image.base64,
          mimeType: result.image.mimeType,
        });
      } else {
        errors.push({
          fileName: file.name,
          message: result.error.message,
        });
      }
    } catch {
      errors.push({
        fileName: file.name,
        message: "Failed to process image.",
      });
    }
  }

  return {
    imageFileCount: imageFiles.length,
    images,
    errors,
  };
}
