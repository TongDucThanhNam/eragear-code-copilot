import type { Context } from "hono";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Document, type DocumentProps } from "./document";

export function renderDocument(
  c: Context,
  element: ReactElement,
  options: Omit<DocumentProps, "children">
): Response {
  const props: DocumentProps = { ...options, children: element };
  const html = renderToString(createElement(Document, props));
  const fullHtml = `<!DOCTYPE html>${html}`;
  return c.html(fullHtml);
}
