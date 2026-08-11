export function handleRuntimeWebSocketOpen(
  state: { current: boolean },
  refetchActiveQueries: () => void
): void {
  if (state.current) {
    refetchActiveQueries();
  }
  state.current = true;
}
