import { z } from "zod";
import type {
  Annotations,
  AnnotationValue,
} from "@/shared/types/annotation.types";

const MAX_MESSAGE_TEXT_CHARS = 100_000;
const MAX_INLINE_MEDIA_ITEMS = 8;
const MAX_BASE64_CHARS = 6 * 1024 * 1024;
const MAX_RESOURCE_ITEMS = 16;
const MAX_RESOURCE_TEXT_CHARS = 200_000;
const MAX_RESOURCE_LINK_ITEMS = 32;
const MAX_RESOURCE_LINK_SIZE = Number.MAX_SAFE_INTEGER;

const AnnotationValueSchema: z.ZodType<AnnotationValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(AnnotationValueSchema),
    z.record(z.string(), AnnotationValueSchema),
  ])
);

const AnnotationsSchema: z.ZodType<Annotations> = z.record(
  z.string(),
  AnnotationValueSchema
);

const InlineImageInputSchema = z.object({
  base64: z.string().min(1).max(MAX_BASE64_CHARS),
  mimeType: z.string().min(1).max(255),
  uri: z.string().max(4096).optional(),
  annotations: AnnotationsSchema.optional(),
});

const InlineAudioInputSchema = z.object({
  base64: z.string().min(1).max(MAX_BASE64_CHARS),
  mimeType: z.string().min(1).max(255),
  annotations: AnnotationsSchema.optional(),
});

const ResourceInputSchema = z
  .object({
    uri: z.string().min(1).max(4096),
    text: z.string().max(MAX_RESOURCE_TEXT_CHARS).optional(),
    blob: z.string().max(MAX_BASE64_CHARS).optional(),
    mimeType: z.string().min(1).max(255).optional(),
    annotations: AnnotationsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasText = value.text !== undefined;
    const hasBlob = value.blob !== undefined;
    if (hasText === hasBlob) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resource must include exactly one of text or blob",
      });
    }
  });

const ResourceLinkInputSchema = z.object({
  uri: z.string().min(1).max(4096),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255).optional(),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  size: z.number().int().nonnegative().max(MAX_RESOURCE_LINK_SIZE).optional(),
  annotations: AnnotationsSchema.optional(),
});

export const SendMessageInputSchema = z.object({
  chatId: z.string(),
  text: z.string().max(MAX_MESSAGE_TEXT_CHARS),
  textAnnotations: AnnotationsSchema.optional(),
  images: z
    .array(InlineImageInputSchema)
    .max(MAX_INLINE_MEDIA_ITEMS)
    .optional(),
  audio: z.array(InlineAudioInputSchema).max(MAX_INLINE_MEDIA_ITEMS).optional(),
  resources: z.array(ResourceInputSchema).max(MAX_RESOURCE_ITEMS).optional(),
  resourceLinks: z
    .array(ResourceLinkInputSchema)
    .max(MAX_RESOURCE_LINK_ITEMS)
    .optional(),
});

export const SetModelInputSchema = z.object({
  chatId: z.string(),
  modelId: z.string(),
});

export const SetModeInputSchema = z.object({
  chatId: z.string(),
  modeId: z.string(),
});

export const SetConfigOptionInputSchema = z.object({
  chatId: z.string(),
  configId: z.string().min(1),
  value: z.string().min(1),
});

export const CancelPromptInputSchema = z.object({
  chatId: z.string(),
});

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type SetModelInput = z.infer<typeof SetModelInputSchema>;
export type SetModeInput = z.infer<typeof SetModeInputSchema>;
export type SetConfigOptionInput = z.infer<typeof SetConfigOptionInputSchema>;
export type CancelPromptInput = z.infer<typeof CancelPromptInputSchema>;
