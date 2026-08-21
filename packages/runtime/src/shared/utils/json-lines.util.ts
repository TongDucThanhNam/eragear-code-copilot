/**
 * Parses JSON Lines with Bun's native batch parser while preserving the
 * tolerant behavior needed for partially-written CLI transcripts. Malformed
 * rows are skipped and parsing resumes at the next line boundary.
 */
export function parseTolerantJsonLines(input: string): unknown[] {
  const values: unknown[] = [];
  let offset = 0;

  while (offset < input.length) {
    const result = JSONL.parseChunk(input.slice(offset));
    values.push(...result.values);
    if (result.done) {
      break;
    }

    let malformedStart = offset + result.read;
    while (
      input.charCodeAt(malformedStart) === 10 ||
      input.charCodeAt(malformedStart) === 13
    ) {
      malformedStart += 1;
    }
    const nextLineBoundary = input.indexOf("\n", malformedStart);
    if (nextLineBoundary === -1) {
      break;
    }
    offset = nextLineBoundary + 1;
  }

  return values;
}

import { JSONL } from "bun";
