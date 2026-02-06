import type { HTMLAttributes, ReactNode } from "react";
import { getUiAssets } from "./ui-assets";

type BodyDataAttributes = Partial<Record<`data-${string}`, string>>;

export interface DocumentProps {
  title: string;
  children: ReactNode;
  head?: ReactNode;
  bodyClassName?: string;
  bodyAttributes?: HTMLAttributes<HTMLBodyElement> & BodyDataAttributes;
}

export function Document({
  title,
  children,
  head,
  bodyClassName,
  bodyAttributes,
}: DocumentProps) {
  const assets = getUiAssets();
  const { className, ...restBody } = bodyAttributes ?? {};
  const mergedClassName = [bodyClassName, className].filter(Boolean).join(" ");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        <title>{title}</title>

        {/* Tailwind CSS v4 */}
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" />

        {/* Fonts */}
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link
          crossOrigin="anonymous"
          href="https://fonts.gstatic.com"
          rel="preconnect"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;1,400&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap"
          rel="stylesheet"
        />

        <link href={assets.stylesHref} rel="stylesheet" />

        {head}
      </head>
      <body {...restBody} className={mergedClassName || undefined}>
        {children}
      </body>
    </html>
  );
}
