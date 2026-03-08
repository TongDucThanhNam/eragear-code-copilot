function normalizeMessage(message: string): string {
  return message.toLowerCase();
}

const ACP_METHOD_PATTERN = /["']?method["']?\s*:/i;

function hasAcpJsonRpcSignature(normalizedMessage: string): boolean {
  if (!normalizedMessage.includes("jsonrpc")) {
    return false;
  }

  const hasMethod = ACP_METHOD_PATTERN.test(normalizedMessage);
  const hasSession = normalizedMessage.includes("sessionid");
  const isErrorHandlingRequest = normalizedMessage.includes(
    "error handling request"
  );

  return hasMethod && (hasSession || isErrorHandlingRequest);
}

export function isAcpLogMessage(message: string): boolean {
  const normalized = normalizeMessage(message);
  if (normalized.includes("acp")) {
    return true;
  }
  return hasAcpJsonRpcSignature(normalized);
}
