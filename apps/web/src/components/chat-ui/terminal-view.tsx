import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

interface TerminalViewProps {
  output: string;
}

export function TerminalView({ output }: TerminalViewProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenRef = useRef<number>(0);

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
    fitRef.current = fitAddon;

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  // Handle output updates
  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }

    // Initial write or update
    if (writtenRef.current === 0 && output.length > 0) {
      term.write(output);
      writtenRef.current = output.length;
    } else if (output.length > writtenRef.current) {
      const newPart = output.slice(writtenRef.current);
      term.write(newPart);
      writtenRef.current = output.length;
    } else if (output.length < writtenRef.current) {
      // Reset if output shrunk (cleared)
      term.reset();
      term.write(output);
      writtenRef.current = output.length;
    }
  }, [output]);

  return (
    <div
      className="h-64 w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-2"
      ref={divRef}
    />
  );
}
