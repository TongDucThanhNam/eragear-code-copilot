"use client";

import type { TextUIPart } from "@repo/shared";
import { deduplicateKeys, getPartKey } from "../agentic-message-utils";
import { TextMessagePart } from "./text-message-part";

export interface UserTextPartsProps {
  parts: TextUIPart[];
}

export function UserTextParts({ parts }: UserTextPartsProps) {
  const keys = deduplicateKeys(parts, getPartKey);

  return (
    <>
      {parts.map((part, index) => {
        const key = keys[index] ?? `text:${index}`;
        return <TextMessagePart key={key} text={part.text} />;
      })}
    </>
  );
}
