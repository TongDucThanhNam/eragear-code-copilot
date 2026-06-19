import { useMemo } from "react";
import type { TerminalOutputSnapshot } from "@/store/chat-stream-store";
import { WtermTerminalSurface } from "./wterm-terminal-surface";

interface TerminalViewProps {
  terminalSnapshots: readonly TerminalOutputSnapshot[];
}

export function TerminalView({ terminalSnapshots }: TerminalViewProps) {
  const output = useMemo(
    () => terminalSnapshots.flatMap((terminal) => terminal.chunks).join(""),
    [terminalSnapshots]
  );

  return (
    <WtermTerminalSurface
      className="h-64"
      disabled
      onData={() => undefined}
      output={output}
    />
  );
}
