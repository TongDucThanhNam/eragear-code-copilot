export interface AcpSessionConfigOption {
  id: string;
  category?: string | null;
  currentValue?: string | boolean;
  options?: Array<{
    value?: string;
    options?: Array<{ value: string }>;
  }>;
}

export function resolvePreferredSessionEffort(
  configOptions: AcpSessionConfigOption[] | undefined,
  preferredEffort: string | undefined
): { configId: string; value: string } | null {
  if (!preferredEffort) {
    return null;
  }
  const effort = configOptions?.find(
    (option) =>
      option.id.toLowerCase() === "effort" ||
      option.category?.toLowerCase() === "thought_level"
  );
  if (!effort) {
    return null;
  }
  const supportedValues = effort.options?.flatMap((option) => [
    ...(option.value ? [option.value] : []),
    ...(option.options?.map((nested) => nested.value) ?? []),
  ]);
  const resolvedEffort = [
    preferredEffort,
    ...(preferredEffort === "max" ? ["xhigh"] : []),
  ].find((candidate) => supportedValues?.includes(candidate));
  if (!resolvedEffort || effort.currentValue === resolvedEffort) {
    return null;
  }
  return { configId: effort.id, value: resolvedEffort };
}
