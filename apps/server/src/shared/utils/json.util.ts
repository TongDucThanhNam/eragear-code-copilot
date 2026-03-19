/**
 * JSON utilities that safely handle circular references, Error objects,
 * and BigInt values.
 */
export function stringifyJson(value: unknown, space?: number): string {
  return safeJsonStringify(value, space);
}

export function safeJsonStringify(value: unknown, space?: number): string {
  const ancestors: object[] = [];
  return JSON.stringify(value, createSafeJsonReplacer(ancestors), space);
}

function createSafeJsonReplacer(ancestors: object[]) {
  return function replace(this: unknown, _key: string, currentValue: unknown) {
    if (typeof currentValue === "bigint") {
      const safeNumber = Number(currentValue);
      if (Number.isSafeInteger(safeNumber)) {
        return safeNumber;
      }
      return currentValue.toString();
    }

    if (currentValue instanceof Error) {
      return {
        name: currentValue.name,
        message: currentValue.message,
        stack: currentValue.stack,
      };
    }

    if (!currentValue || typeof currentValue !== "object") {
      return currentValue;
    }

    while (ancestors.length > 0 && ancestors.at(-1) !== this) {
      ancestors.pop();
    }

    if (ancestors.includes(currentValue)) {
      return "[Circular]";
    }

    ancestors.push(currentValue);
    return currentValue;
  };
}
