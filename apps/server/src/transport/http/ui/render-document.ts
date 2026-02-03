import type { Context } from "hono";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { ViteDevServer } from "vite";
import { ENV } from "@/config/environment";
import { Document, type DocumentProps } from "./document";

export async function renderDocument(
  c: Context,
  element: ReactElement,
  options: Omit<DocumentProps, "children">
): Promise<Response> {
  const response = await c.render(createElement(Document, options, element));
  const html = await response.text();
  const fullHtml = `<!DOCTYPE html>${html}`;
  const vite = c.get("vite") as ViteDevServer | null;
  if (ENV.isDev && vite) {
    const requestUrl = c.req.raw.url ?? c.req.path;
    const transformed = await vite.transformIndexHtml(requestUrl, fullHtml);
    return c.html(transformed);
  }
  return c.html(fullHtml);
}
