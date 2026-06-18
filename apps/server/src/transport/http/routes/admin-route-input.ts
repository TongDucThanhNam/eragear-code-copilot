export type AdminRouteInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; error: string };

export interface CreateApiKeyRouteInput {
  name?: string;
  prefix?: string;
  expiresIn?: number;
}

export interface DeleteApiKeyRouteInput {
  keyId: string;
}

export interface DeviceSessionRouteInput {
  sessionToken: string;
}

interface AdminRoutePayload {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is AdminRoutePayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function requiredString(
  value: unknown,
  fieldName: string
): AdminRouteInputResult<string> {
  if (typeof value === "string" && value.length > 0) {
    return { ok: true, input: value };
  }
  return { ok: false, error: `${fieldName} is required` };
}

export function parseCreateApiKeyRouteInput(
  payload: unknown
): AdminRouteInputResult<CreateApiKeyRouteInput> {
  if (!isRecord(payload)) {
    return { ok: true, input: {} };
  }

  return {
    ok: true,
    input: {
      name: optionalString(payload.name),
      prefix: optionalString(payload.prefix),
      expiresIn: optionalFiniteNumber(payload.expiresIn),
    },
  };
}

export function parseDeleteApiKeyRouteInput(
  payload: unknown
): AdminRouteInputResult<DeleteApiKeyRouteInput> {
  if (!isRecord(payload)) {
    return { ok: false, error: "keyId is required" };
  }

  const keyId =
    payload.keyId === undefined
      ? requiredString(payload.id, "keyId")
      : requiredString(payload.keyId, "keyId");
  if (!keyId.ok) {
    return keyId;
  }

  return { ok: true, input: { keyId: keyId.input } };
}

export function parseDeviceSessionRouteInput(
  payload: unknown
): AdminRouteInputResult<DeviceSessionRouteInput> {
  if (!isRecord(payload)) {
    return { ok: false, error: "sessionToken is required" };
  }

  const sessionToken = requiredString(payload.sessionToken, "sessionToken");
  if (!sessionToken.ok) {
    return sessionToken;
  }

  return { ok: true, input: { sessionToken: sessionToken.input } };
}
