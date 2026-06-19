import { z } from "zod";

export const FeedbackRatingSchema = z.enum(["positive", "negative"]);
export type FeedbackRating = z.infer<typeof FeedbackRatingSchema>;

export const SubmitFeedbackInputSchema = z
  .object({
    chatId: z.string().trim().min(1),
    messageId: z.string().trim().min(1),
    rating: FeedbackRatingSchema,
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export type SubmitFeedbackInput = z.infer<typeof SubmitFeedbackInputSchema>;

export const ListFeedbackInputSchema = z
  .object({
    chatId: z.string().trim().min(1).optional(),
    messageId: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict()
  .optional();
export type ListFeedbackInput = z.input<typeof ListFeedbackInputSchema>;

export const FeedbackRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  chatId: z.string(),
  messageId: z.string(),
  rating: FeedbackRatingSchema,
  comment: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

export const FeedbackListResultSchema = z.object({
  feedback: z.array(FeedbackRecordSchema),
  totalCount: z.number(),
});
export type FeedbackListResult = z.infer<typeof FeedbackListResultSchema>;
