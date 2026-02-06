import type { Context } from "hono";
import type { ReactElement } from "react";
import { createElement } from "react";
import { Document, type DocumentProps } from "./document";

export async function renderDocument(
  c: Context,
  element: ReactElement,
  options: Omit<DocumentProps, "children">
): Promise<Response> {
  const props: DocumentProps = { ...options, children: element };
  const response = await c.render(createElement(Document, props));
  const html = await response.text();
  const fullHtml = `<!DOCTYPE html>${html}`;
  return c.html(fullHtml);
}
