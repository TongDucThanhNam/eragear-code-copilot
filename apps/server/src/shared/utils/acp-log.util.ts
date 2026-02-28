function normalizeMessage(message: string): string {
  return message.toLowerCase();
}

function hasAcpJsonRpcSignature(message: string): boolean {
  const normalized = normalizeMessage(message);
  if (!normalized.includes("jsonrpc")) {
    return false;
  }

  const hasMethod = normalized.includes("method:");
  const hasSession = normalized.includes("sessionid");
  const isErrorHandlingRequest = normalized.includes("error handling request");

  return hasMethod && (hasSession || isErrorHandlingRequest);
}

export function isAcpLogMessage(message: string): boolean {
  const normalized = normalizeMessage(message);
  if (normalized.includes("acp")) {
    return true;
  }
  return hasAcpJsonRpcSignature(normalized);
}
