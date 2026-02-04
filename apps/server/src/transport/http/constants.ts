/**
 * HTTP Transport Constants
 *
 * Centralized constants for HTTP server configuration and UI routing.
 *
 * @module transport/http/constants
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Path to the public dashboard assets directory */
export const PUBLIC_DASHBOARD_ASSETS_PATH = join(
  __dirname,
  "../../../public/dashboard"
);

/** Dashboard UI entry path */
export const DASHBOARD_UI_PATH = "/_/dashboard";

/** Dashboard static assets URL prefix */
export const DASHBOARD_ASSET_PATH = "/_/dashboard/assets";

/** Regex to match dashboard asset path prefix */
export const DASHBOARD_ASSET_PATH_PREFIX = /^\/_\/dashboard\/assets\//;

/** Regex to remove leading slashes from paths */
export const LEADING_SLASHES = /^\/+/;

/** HTTP status codes */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

/** Allowed HTTP methods */
export const ALLOWED_METHODS = {
  AUTH: ["POST", "GET", "OPTIONS"] as const,
  HEALTH: ["GET", "OPTIONS"] as const,
} as const;

/** CORS configuration defaults */
export const CORS_DEFAULTS = {
  maxAge: 600,
  exposeHeaders: ["Content-Length"],
  allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
} as const;
