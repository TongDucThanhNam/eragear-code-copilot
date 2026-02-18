interface PublicApiRouteRule {
  methods: readonly string[];
  pattern: RegExp;
}

const MUTATING_API_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PUBLIC_API_ROUTE_ALLOWLIST: readonly PublicApiRouteRule[] = [
  {
    methods: ["GET", "HEAD", "OPTIONS"],
    pattern: /^\/api\/health\/?$/,
  },
  {
    methods: ["POST", "OPTIONS"],
    pattern: /^\/api\/auth\/sign-in(?:\/[^/]+)?\/?$/,
  },
  {
    methods: ["POST", "OPTIONS"],
    pattern: /^\/api\/auth\/sign-up(?:\/[^/]+)?\/?$/,
  },
  {
    methods: ["POST", "OPTIONS"],
    pattern: /^\/api\/auth\/sign-out\/?$/,
  },
  {
    methods: ["POST", "OPTIONS"],
    pattern: /^\/api\/auth\/is-username-available\/?$/,
  },
  {
    methods: ["GET", "POST", "OPTIONS"],
    pattern: /^\/api\/auth\/(?:get-session|session|list-sessions)\/?$/,
  },
  {
    methods: ["POST", "OPTIONS"],
    pattern: /^\/api\/auth\/revoke-session\/?$/,
  },
  {
    methods: ["POST", "OPTIONS"],
    pattern: /^\/api\/auth\/api-key\/verify\/?$/,
  },
  {
    methods: ["GET", "POST", "OPTIONS"],
    pattern: /^\/api\/auth\/callback\/[^/]+\/?$/,
  },
];

export function isPublicApiRoute(method: string | undefined, path: string) {
  const normalizedMethod = (method ?? "GET").toUpperCase();
  return PUBLIC_API_ROUTE_ALLOWLIST.some(
    (rule) => rule.methods.includes(normalizedMethod) && rule.pattern.test(path)
  );
}

export function shouldForwardToRuntimeWriter(method: string, path: string) {
  if (!MUTATING_API_METHODS.has(method.toUpperCase())) {
    return false;
  }
  if (!path.startsWith("/api/")) {
    return false;
  }
  if (path.startsWith("/api/auth/") || path === "/api/health") {
    return false;
  }
  return true;
}
