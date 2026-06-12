"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { memo, useMemo } from "react";
import { toast } from "sonner";
import { MessageAction } from "@/components/ai-elements/message";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export interface FeedbackMessageActionsProps {
  chatId: string | null;
  messageId: string;
}

export const FeedbackMessageActions = memo(function FeedbackMessageActions({
  chatId,
  messageId,
}: FeedbackMessageActionsProps) {
  const utils = trpc.useUtils();
  const feedbackInput = useMemo(
    () => (chatId ? { chatId, messageId, limit: 1 } : undefined),
    [chatId, messageId]
  );
  const feedbackQuery = trpc.feedback.list.useQuery(feedbackInput, {
    enabled: Boolean(feedbackInput),
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
  const submitFeedback = trpc.feedback.submit.useMutation({
    onSuccess: async () => {
      if (feedbackInput) {
        await utils.feedback.list.invalidate(feedbackInput);
      }
      toast.success("Feedback saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save feedback");
    },
  });

  const currentRating = feedbackQuery.data?.feedback[0]?.rating ?? null;
  const disabled = !chatId || submitFeedback.isPending;

  const submit = (rating: "positive" | "negative") => {
    if (!chatId) {
      return;
    }
    submitFeedback.mutate({ chatId, messageId, rating });
  };

  return (
    <>
      <MessageAction
        aria-label="Helpful"
        disabled={disabled}
        label="Helpful"
        onClick={() => submit("positive")}
        tooltip="Helpful"
      >
        <ThumbsUp
          className={cn(
            "size-3.5",
            currentRating === "positive" ? "fill-current" : ""
          )}
        />
      </MessageAction>
      <MessageAction
        aria-label="Not helpful"
        disabled={disabled}
        label="Not helpful"
        onClick={() => submit("negative")}
        tooltip="Not helpful"
      >
        <ThumbsDown
          className={cn(
            "size-3.5",
            currentRating === "negative" ? "fill-current" : ""
          )}
        />
      </MessageAction>
    </>
  );
});
