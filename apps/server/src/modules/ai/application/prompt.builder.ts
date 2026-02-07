/**
 * Prompt Builder
 *
 * Constructs prompt content blocks for the ACP protocol from various input types.
 * Supports text, images, audio, resources, and resource links.
 *
 * @module modules/ai/application/prompt.builder
 */

import type { Annotations, ContentBlock } from "@agentclientprotocol/sdk";

/**
 * Input for an image in a prompt
 */
export interface PromptImageInput {
  /** Base64-encoded image data */
  base64: string;
  /** MIME type of the image (e.g., "image/png") */
  mimeType: string;
  /** Optional URI for the image resource */
  uri?: string;
  /** Optional annotations for the image */
  annotations?: Annotations;
}

/**
 * Input for an audio clip in a prompt
 */
export interface PromptAudioInput {
  /** Base64-encoded audio data */
  base64: string;
  /** MIME type of the audio (e.g., "audio/mp3") */
  mimeType: string;
  /** Optional annotations for the audio */
  annotations?: Annotations;
}

/**
 * Input for a resource (text or blob) in a prompt
 */
export interface PromptResourceInput {
  /** URI identifying the resource */
  uri: string;
  /** Text content of the resource (mutually exclusive with blob) */
  text?: string;
  /** Blob content of the resource (mutually exclusive with text) */
  blob?: string;
  /** MIME type of the resource */
  mimeType?: string;
  /** Optional annotations for the resource */
  annotations?: Annotations;
}

/**
 * Input for a resource link in a prompt
 */
export interface PromptResourceLinkInput {
  /** URI of the linked resource */
  uri: string;
  /** Display name for the link */
  name: string;
  /** MIME type of the linked resource */
  mimeType?: string;
  /** Title of the linked resource */
  title?: string;
  /** Description of the linked resource */
  description?: string;
  /** Size of the linked resource in bytes */
  size?: number;
  /** Optional annotations for the link */
  annotations?: Annotations;
}

/**
 * Builds an array of ACP ContentBlocks from various input types
 *
 * Combines text, images, audio, resources, and resource links into
 * a format suitable for sending to the agent via the ACP protocol.
 *
 * @param params - Prompt construction parameters
 * @returns Array of ACP ContentBlocks
 *
 * @example
 * ```typescript
 * const prompt = buildPrompt({
 *   text: "Analyze this image",
 *   images: [{
 *     base64: imageData,
 *     mimeType: "image/png"
 *   }]
 * });
 *
 * await session.conn.prompt({
 *   sessionId: "session-123",
 *   prompt
 * });
 * ```
 */
export function buildPrompt(params: {
  /** Main text content of the prompt */
  text: string;
  /** Optional annotations for the text content */
  textAnnotations?: Annotations;
  /** Optional images to include in the prompt */
  images?: PromptImageInput[];
  /** Optional audio clips to include in the prompt */
  audio?: PromptAudioInput[];
  /** Optional resources to include in the prompt */
  resources?: PromptResourceInput[];
  /** Optional resource links to include in the prompt */
  resourceLinks?: PromptResourceLinkInput[];
}): ContentBlock[] {
  const prompt: ContentBlock[] = [
    {
      type: "text",
      text: params.text,
      annotations: params.textAnnotations,
    },
  ];

  if (params.images) {
    prompt.push(
      ...params.images.map(
        (img): ContentBlock => ({
          type: "image",
          data: img.base64,
          mimeType: img.mimeType,
          uri: img.uri,
          annotations: img.annotations,
        })
      )
    );
  }

  if (params.audio) {
    prompt.push(
      ...params.audio.map(
        (clip): ContentBlock => ({
          type: "audio",
          data: clip.base64,
          mimeType: clip.mimeType,
          annotations: clip.annotations,
        })
      )
    );
  }

  if (params.resources) {
    prompt.push(
      ...params.resources.map((res): ContentBlock => {
        const hasText = res.text !== undefined;
        const hasBlob = res.blob !== undefined;
        if (hasText === hasBlob) {
          throw new Error("Resource must include exactly one of text or blob.");
        }
        if (hasText) {
          return {
            type: "resource",
            resource: {
              uri: res.uri,
              text: res.text ?? "",
              mimeType: res.mimeType,
            },
            annotations: res.annotations,
          };
        }
        return {
          type: "resource",
          resource: {
            uri: res.uri,
            blob: res.blob ?? "",
            mimeType: res.mimeType,
          },
          annotations: res.annotations,
        };
      })
    );
  }

  if (params.resourceLinks) {
    prompt.push(
      ...params.resourceLinks.map((link): ContentBlock => {
        const size = normalizeResourceLinkSize(link.size);
        return {
          type: "resource_link",
          uri: link.uri,
          name: link.name,
          mimeType: link.mimeType,
          title: link.title,
          description: link.description,
          ...(size !== undefined ? { size: size as unknown as bigint } : {}),
          annotations: link.annotations,
        };
      })
    );
  }

  return prompt;
}

function normalizeResourceLinkSize(size?: number): number | undefined {
  if (size === undefined) {
    return undefined;
  }
  if (typeof size === "number") {
    if (!Number.isFinite(size)) {
      return undefined;
    }
    const normalized = Math.floor(size);
    return normalized >= 0 ? normalized : undefined;
  }
  return undefined;
}
