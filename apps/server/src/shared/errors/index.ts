type ErrorDetails = Record<string, unknown>;

export interface AppErrorContext {
  module?: string;
  op?: string;
  details?: ErrorDetails;
  cause?: unknown;
}

export interface AppErrorInput extends AppErrorContext {
  message: string;
  code: string;
  statusCode?: number;
}

const DEFAULT_MODULE = "unknown";
const DEFAULT_OP = "unknown";

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly module: string;
  readonly op: string;
  readonly details?: ErrorDetails;

  constructor(input: AppErrorInput) {
    super(input.message);
    this.code = input.code;
    this.statusCode = input.statusCode ?? 500;
    this.module = input.module ?? DEFAULT_MODULE;
    this.op = input.op ?? DEFAULT_OP;
    this.details = input.details;
    this.name = "AppError";
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export class NotFoundError extends AppError {
  constructor(message: string, context: AppErrorContext = {}) {
    super({
      message,
      code: "NOT_FOUND",
      statusCode: 404,
      ...context,
    });
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context: AppErrorContext = {}) {
    super({
      message,
      code: "VALIDATION_ERROR",
      statusCode: 400,
      ...context,
    });
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, context: AppErrorContext = {}) {
    super({
      message,
      code: "UNAUTHORIZED",
      statusCode: 401,
      ...context,
    });
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context: AppErrorContext = {}) {
    super({
      message,
      code: "CONFLICT",
      statusCode: 409,
      ...context,
    });
    this.name = "ConflictError";
  }
}
