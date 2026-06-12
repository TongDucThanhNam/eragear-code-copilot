import { FeedbackFileRepository, FeedbackService } from "@/modules/feedback";
import type { FeedbackUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createFeedbackUseCases(): FeedbackUseCases {
  return {
    feedback: new FeedbackService(
      new FeedbackFileRepository({
        filePath: () => getStorageFileSync("feedback.json"),
      })
    ),
  };
}
