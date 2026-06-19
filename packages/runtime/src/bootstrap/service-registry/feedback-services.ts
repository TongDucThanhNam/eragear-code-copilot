import {
  FeedbackFileRepository,
  FeedbackService,
} from "#runtime/modules/feedback";
import type { FeedbackUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createFeedbackUseCases(): FeedbackUseCases {
  return {
    feedback: new FeedbackService(
      new FeedbackFileRepository({
        filePath: () => getStorageFileSync("feedback.json"),
      })
    ),
  };
}
