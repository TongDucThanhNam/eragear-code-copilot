import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import type { TerminalOutputSnapshot } from "@/store/chat-stream-store";
import { getTerminalWritePlan } from "./terminal-view-plan";

interface TerminalViewProps {
  terminalSnapshots: readonly TerminalOutputSnapshot[];
}

function writeChunks(term: Terminal, chunks: readonly string[]) {
  for (const chunk of chunks) {
    if (chunk.length > 0) {
      term.write(chunk);
    }
  }
}

export function TerminalView({ terminalSnapshots }: TerminalViewProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const renderedSnapshotsRef = useRef<readonly TerminalOutputSnapshot[]>([]);

  useEffect(() => {
    if (!divRef.current) {
      return;
    }

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      theme: {
        background: "#09090b", // zinc-950
        foreground: "#e4e4e7", // zinc-200
      },
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(divRef.current);
    fitAddon.fit();

    termRef.current = term;

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }

    const writePlan = getTerminalWritePlan(
      renderedSnapshotsRef.current,
      terminalSnapshots
    );
    if (writePlan.type === "noop") {
      return;
    }
    if (writePlan.type === "reset") {
      term.reset();
    }
    writeChunks(term, writePlan.chunks);
    renderedSnapshotsRef.current = terminalSnapshots;
  }, [terminalSnapshots]);

  return (
    <div
      className="h-64 w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-2"
      ref={divRef}
    />
  );
}
