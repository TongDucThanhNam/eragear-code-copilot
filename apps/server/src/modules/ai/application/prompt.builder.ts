import type { ContentBlock } from "@agentclientprotocol/sdk";

export interface PromptImageInput {
  base64: string;
  mimeType: string;
}

export interface PromptResourceInput {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

export function buildPrompt(params: {
  text: string;
  images?: PromptImageInput[];
  resources?: PromptResourceInput[];
}): ContentBlock[] {
  const prompt: ContentBlock[] = [{ type: "text", text: params.text }];

  if (params.images) {
    prompt.push(
      ...params.images.map(
        (img): ContentBlock => ({
          type: "image",
          data: img.base64,
          mimeType: img.mimeType,
        })
      )
    );
  }

  if (params.resources) {
    prompt.push(
      ...params.resources.map((res): ContentBlock => {
        if (res.text) {
          return {
            type: "resource",
            resource: {
              uri: res.uri,
              text: res.text,
              mimeType: res.mimeType,
            },
          };
        }
        return {
          type: "resource",
          resource: {
            uri: res.uri,
            blob: res.blob as string,
            mimeType: res.mimeType,
          },
        };
      })
    );
  }

  return prompt;
}
