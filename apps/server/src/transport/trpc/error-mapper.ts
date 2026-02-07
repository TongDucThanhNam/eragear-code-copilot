import { type TRPC_ERROR_CODE_KEY, TRPCError } from "@trpc/server";
import { AppError, isAppError } from "@/shared/errors";

function toTrpcCode(statusCode: number): TRPC_ERROR_CODE_KEY {
  switch (statusCode) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE_CONTENT";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 408:
    case 504:
      return "TIMEOUT";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

function fromUnknownError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
  module: string;
  op: string;
  cause: unknown;
} {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      module: error.module,
      op: error.op,
      cause: error,
    };
  }

  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const statusCode =
      typeof candidate.statusCode === "number" ? candidate.statusCode : 500;
    const code =
      typeof candidate.code === "string"
        ? candidate.code
        : "INTERNAL_SERVER_ERROR";
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : "Unexpected error";
    const module =
      typeof candidate.module === "string" ? candidate.module : "unknown";
    const op = typeof candidate.op === "string" ? candidate.op : "unknown";

    return {
      statusCode,
      code,
      message,
      module,
      op,
      cause: error,
    };
  }

  return {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Unexpected error",
    module: "unknown",
    op: "unknown",
    cause: error,
  };
}

export function toTrpcError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    return error;
  }

  const normalized = fromUnknownError(error);
  const appError = isAppError(error)
    ? error
    : new AppError({
        message: normalized.message,
        code: normalized.code,
        statusCode: normalized.statusCode,
        module: normalized.module,
        op: normalized.op,
        cause: normalized.cause,
      });

  return new TRPCError({
    code: toTrpcCode(appError.statusCode),
    message: appError.message,
    cause: appError,
  });
}

export function getAppErrorFromCause(error: TRPCError): AppError | null {
  if (isAppError(error.cause)) {
    return error.cause;
  }
  if (isAppError(error)) {
    return error;
  }
  return null;
}
