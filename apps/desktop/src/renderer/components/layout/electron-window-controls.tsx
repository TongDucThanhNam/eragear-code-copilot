"use client";

import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DesktopWindowState } from "@/lib/desktop-bootstrap";
import { cn } from "@/lib/utils";

const getDesktopWindowControls = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.eragearDesktop?.windowControls ?? null;
};

export const ElectronWindowControls = memo(function ElectronWindowControls({
  className,
}: {
  className?: string;
}) {
  const controls = getDesktopWindowControls();
  const [windowState, setWindowState] = useState<DesktopWindowState | null>(
    null
  );

  useEffect(() => {
    const bridge = getDesktopWindowControls();
    if (!bridge) {
      return;
    }

    let mounted = true;
    bridge
      .getState()
      .then((nextState) => {
        if (mounted && nextState) {
          setWindowState(nextState);
        }
      })
      .catch((error) => {
        console.warn("[desktop] Failed to read window state", error);
      });

    const unsubscribe = bridge.onStateChange((nextState) => {
      setWindowState(nextState);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!controls) {
    return null;
  }

  const isMaximized = windowState?.isMaximized ?? false;
  const MaximizeIcon = isMaximized ? Minimize2 : Maximize2;
  const maximizeLabel = isMaximized ? "Restore window" : "Maximize window";

  return (
    <div
      className={cn(
        "-mr-3 flex h-12 shrink-0 items-center border-l",
        className
      )}
      data-eragear-window-no-drag="true"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Minimize window"
            className="h-12 w-10 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              controls.minimize().catch((error) => {
                console.warn("[desktop] Failed to minimize window", error);
              });
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Minus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Minimize window</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={maximizeLabel}
            className="h-12 w-10 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              controls
                .toggleMaximize()
                .then((nextState) => {
                  if (nextState) {
                    setWindowState(nextState);
                  }
                })
                .catch((error) => {
                  console.warn(
                    "[desktop] Failed to toggle maximize window",
                    error
                  );
                });
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <MaximizeIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{maximizeLabel}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Close window"
            className="h-12 w-10 rounded-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              controls.close().catch((error) => {
                console.warn("[desktop] Failed to close window", error);
              });
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close window</TooltipContent>
      </Tooltip>
    </div>
  );
});
