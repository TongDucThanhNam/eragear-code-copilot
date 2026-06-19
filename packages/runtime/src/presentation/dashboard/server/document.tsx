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

        <link href={assets.stylesHref} rel="stylesheet" />
        <link href={assets.stylesEnhancedHref} rel="stylesheet" />

        {head}
      </head>
      <body {...restBody} className={mergedClassName || undefined}>
        {children}
      </body>
    </html>
  );
}
