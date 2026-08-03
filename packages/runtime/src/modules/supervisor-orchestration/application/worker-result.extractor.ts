import {
  type SupervisorWorkerResult,
  SupervisorWorkerResultSchema,
} from "../domain/supervisor-run.schemas";

const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/iu;

export class WorkerResultExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkerResultExtractionError";
  }
}

export function extractWorkerResult(text: string): SupervisorWorkerResult {
  const trimmed = text.trim();
  const fenced = JSON_FENCE_RE.exec(trimmed)?.[1]?.trim();
  const candidate = fenced ?? extractJsonObject(trimmed);
  if (!candidate) {
    throw new WorkerResultExtractionError(
      "Worker terminal response did not contain a JSON object"
    );
  }
  try {
    return SupervisorWorkerResultSchema.parse(JSON.parse(candidate));
  } catch (error) {
    throw new WorkerResultExtractionError(
      "Worker terminal JSON did not match the structured result contract",
      { cause: error }
    );
  }
}

function extractJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return start >= 0 && end > start ? value.slice(start, end + 1) : null;
}
