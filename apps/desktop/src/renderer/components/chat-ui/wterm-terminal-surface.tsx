"use client";

import type { WTerm } from "@wterm/dom";
import { type TerminalHandle, Terminal as WtermTerminal } from "@wterm/react";
import "@wterm/react/css";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface WtermTerminalSurfaceProps {
  className?: string;
  disabled?: boolean;
  output: string;
  onData: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export function WtermTerminalSurface({
  className,
  disabled = false,
  output,
  onData,
  onResize,
}: WtermTerminalSurfaceProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const renderedOutputRef = useRef("");
  const latestOutputRef = useRef(output);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const disabledRef = useRef(disabled);
  const [terminalKey, setTerminalKey] = useState(0);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    latestOutputRef.current = output;
  }, [output]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const previous = renderedOutputRef.current;
    if (!output) {
      renderedOutputRef.current = "";
      setTerminalKey((key) => key + 1);
      return;
    }
    if (output.startsWith(previous)) {
      terminal.write(output.slice(previous.length));
    } else {
      renderedOutputRef.current = "";
      setTerminalKey((key) => key + 1);
    }
    renderedOutputRef.current = output;
  }, [output]);

  const handleReady = (terminal: WTerm) => {
    const currentOutput = latestOutputRef.current;
    renderedOutputRef.current = "";
    if (currentOutput.length > 0) {
      terminal.write(currentOutput);
      renderedOutputRef.current = currentOutput;
    }
  };

  return (
    <WtermTerminal
      autoResize
      className={cn(
        "h-full min-h-0 w-full overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[12px]",
        disabled ? "opacity-70" : "",
        className
      )}
      cursorBlink={!disabled}
      key={terminalKey}
      onData={(data) => {
        if (disabledRef.current) {
          return;
        }
        onDataRef.current(data);
      }}
      onReady={handleReady}
      onResize={(cols, rows) => {
        onResizeRef.current?.(cols, rows);
      }}
      ref={terminalRef}
      theme="monokai"
    />
  );
}
