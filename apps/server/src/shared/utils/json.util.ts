/**
 * JSON utilities that safely handle BigInt values.
 */
export function stringifyJson(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, currentValue: unknown) => {
      if (typeof currentValue === "bigint") {
        const safeNumber = Number(currentValue);
        if (Number.isSafeInteger(safeNumber)) {
          return safeNumber;
        }
        return currentValue.toString();
      }
      return currentValue;
    },
    space
  );
}
