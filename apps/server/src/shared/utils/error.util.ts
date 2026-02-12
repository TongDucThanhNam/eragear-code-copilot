export function toError(error: unknown, fallbackMessage?: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (fallbackMessage) {
    return new Error(fallbackMessage, { cause: error });
  }
  return new Error(String(error));
}
