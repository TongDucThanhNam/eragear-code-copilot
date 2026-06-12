import { expect, test } from "bun:test";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { prepareSubmitImages } from "./chat-submit-images";

test("prepares image files for sendMessage payloads", async () => {
  const image = new File(["image-bytes"], "screen.png", {
    type: "image/png",
  });
  const text = new File(["hello"], "notes.txt", {
    type: "text/plain",
  });

  const result = await prepareSubmitImages(
    [filePart(image), filePart(text)],
    {
      prepare: async (file) => ({
        ok: true,
        image: {
          base64: `encoded:${file.name}`,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      }),
    }
  );

  expect(result).toEqual({
    imageFileCount: 1,
    images: [{ base64: "encoded:screen.png", mimeType: "image/png" }],
    errors: [],
  });
});

test("reports image preparation errors without including failed images", async () => {
  const image = new File(["image-bytes"], "large.png", {
    type: "image/png",
  });

  const result = await prepareSubmitImages([filePart(image)], {
    prepare: async () => ({
      ok: false,
      error: {
        code: "too_large",
        message: "Image is too large.",
      },
    }),
  });

  expect(result).toEqual({
    imageFileCount: 1,
    images: [],
    errors: [{ fileName: "large.png", message: "Image is too large." }],
  });
});

function filePart(file: File): PromptInputMessage["files"][number] {
  return {
    type: "file",
    mediaType: file.type,
    filename: file.name,
    url: `blob:test-${file.name}`,
    file,
  };
}
