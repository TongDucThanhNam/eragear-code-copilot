import { ValidationError } from "@/shared/errors";
import { AI_OP } from "../ai.constants";
import type { SendMessageExecuteInput } from "./send-message.types";

export class PayloadBudgetGuard {
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = Math.max(1, Math.trunc(maxBytes));
  }

  assertInlineMediaPayloadBudget(input: SendMessageExecuteInput): void {
    let totalInlineMediaBytes = 0;

    const consume = (bytes: number, field: string, index: number) => {
      if (bytes > this.maxBytes) {
        throw new ValidationError(
          `${field}[${index}] payload exceeds max size: ${bytes} bytes > ${this.maxBytes}`,
          {
            module: "ai",
            op: AI_OP.PROMPT_SEND,
            details: {
              chatId: input.chatId,
              field,
              index,
              payloadBytes: bytes,
              maxBytes: this.maxBytes,
            },
          }
        );
      }

      totalInlineMediaBytes += bytes;
      if (totalInlineMediaBytes > this.maxBytes) {
        throw new ValidationError(
          `Inline media payload exceeds max size: ${totalInlineMediaBytes} bytes > ${this.maxBytes}`,
          {
            module: "ai",
            op: AI_OP.PROMPT_SEND,
            details: {
              chatId: input.chatId,
              totalInlineMediaBytes,
              maxBytes: this.maxBytes,
            },
          }
        );
      }
    };

    for (let i = 0; i < (input.images?.length ?? 0); i += 1) {
      const image = input.images?.[i];
      if (!image) {
        continue;
      }
      consume(
        this.estimateBase64DecodedBytes(
          input.chatId,
          "images",
          i,
          image.base64
        ),
        "images",
        i
      );
    }

    for (let i = 0; i < (input.audio?.length ?? 0); i += 1) {
      const clip = input.audio?.[i];
      if (!clip) {
        continue;
      }
      consume(
        this.estimateBase64DecodedBytes(input.chatId, "audio", i, clip.base64),
        "audio",
        i
      );
    }

    for (let i = 0; i < (input.resources?.length ?? 0); i += 1) {
      const resource = input.resources?.[i];
      if (!resource?.blob) {
        continue;
      }
      consume(
        this.estimateBase64DecodedBytes(
          input.chatId,
          "resources.blob",
          i,
          resource.blob
        ),
        "resources.blob",
        i
      );
    }
  }

  private estimateBase64DecodedBytes(
    chatId: string,
    field: string,
    index: number,
    rawBase64: string
  ): number {
    const normalized = rawBase64.replace(/\s+/g, "");
    if (!normalized) {
      throw new ValidationError(`${field}[${index}] base64 payload is empty`, {
        module: "ai",
        op: AI_OP.PROMPT_SEND,
        details: { chatId, field, index },
      });
    }

    let decoded: Buffer;
    try {
      decoded = Buffer.from(normalized, "base64");
    } catch {
      throw new ValidationError(
        `${field}[${index}] has invalid base64 payload`,
        {
          module: "ai",
          op: AI_OP.PROMPT_SEND,
          details: {
            chatId,
            field,
            index,
            base64Length: normalized.length,
          },
        }
      );
    }

    const canonical = decoded.toString("base64");
    if (!canonical || canonical !== normalized) {
      throw new ValidationError(
        `${field}[${index}] has invalid base64 payload`,
        {
          module: "ai",
          op: AI_OP.PROMPT_SEND,
          details: {
            chatId,
            field,
            index,
            base64Length: normalized.length,
          },
        }
      );
    }

    const decodedBytes = decoded.length;
    if (!Number.isFinite(decodedBytes) || decodedBytes < 0) {
      throw new ValidationError(
        `${field}[${index}] has invalid base64 payload size`,
        {
          module: "ai",
          op: AI_OP.PROMPT_SEND,
          details: {
            chatId,
            field,
            index,
            base64Length: normalized.length,
            decodedBytes,
          },
        }
      );
    }

    return decodedBytes;
  }
}
