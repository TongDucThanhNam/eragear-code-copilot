// Error definitions
export class AppError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
  }
}
