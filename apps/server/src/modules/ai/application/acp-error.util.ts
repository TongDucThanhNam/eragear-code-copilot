interface AcpErrorShape {
  message?: unknown;
  data?: { details?: unknown };
}

export const getAcpErrorText = (error: unknown): string => {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "string") {
    parts.push(error);
  }

  if (typeof error === "object" && error) {
    const err = error as AcpErrorShape;
    if (typeof err.message === "string") {
      parts.push(err.message);
    }
    if (typeof err.data?.details === "string") {
      parts.push(err.data.details);
    }
  }

  return parts.filter(Boolean).join(" | ");
};

export const isProcessTransportNotReady = (errorText: string) => {
  return errorText
    .toLowerCase()
    .includes("processtransport is not ready for writing");
};

export const isProcessExited = (errorText: string) => {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("process exited") ||
    normalized.includes("terminated") ||
    normalized.includes("cannot write to terminated process")
  );
};

export const isMethodNotFound = (errorText: string) => {
  return errorText.toLowerCase().includes("method not found");
};
