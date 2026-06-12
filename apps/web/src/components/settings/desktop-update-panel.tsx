"use client";

import type { DesktopAutoUpdateStatus } from "@repo/shared";
import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { checkForDesktopUpdates } from "@/lib/desktop-bootstrap";
import { cn } from "@/lib/utils";
import { useServerConfigStore } from "@/store/server-config-store";
import { SettingsSection } from "./settings-panels";

export function DesktopUpdatePanel() {
  const desktopBootstrap = useServerConfigStore((state) => state.desktopBootstrap);
  const setDesktopBootstrap = useServerConfigStore(
    (state) => state.setDesktopBootstrap
  );
  const [status, setStatus] = useState<DesktopAutoUpdateStatus | null>(
    desktopBootstrap?.autoUpdate ?? null
  );
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    setStatus(desktopBootstrap?.autoUpdate ?? null);
  }, [desktopBootstrap?.autoUpdate]);

  const checkNow = async () => {
    setIsChecking(true);
    try {
      const next = await checkForDesktopUpdates();
      if (!next) {
        toast.error("Desktop update bridge is not available");
        return;
      }
      setStatus(next);
      if (desktopBootstrap) {
        setDesktopBootstrap({ ...desktopBootstrap, autoUpdate: next });
      }
      toast.success(
        next.updateAvailable ? "Update available" : "No update available"
      );
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isChecking || !desktopBootstrap}
          onClick={checkNow}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", isChecking ? "animate-spin" : "")}
          />
          Check
        </Button>
      }
      description="Manifest-based desktop version check with Electron notification when an update is available."
      icon={Download}
      title="Desktop Updates"
    >
      {!desktopBootstrap ? (
        <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
          Desktop update checks are available only in the Electron shell.
        </div>
      ) : null}

      {desktopBootstrap ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={status?.updateAvailable ? "secondary" : "outline"}>
              {status?.state ?? "unknown"}
            </Badge>
            <Badge variant="outline">
              current {status?.currentVersion ?? "unknown"}
            </Badge>
            {status?.latestVersion ? (
              <Badge variant="outline">latest {status.latestVersion}</Badge>
            ) : null}
          </div>

          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs">
            <Metadata label="Manifest" value={status?.manifestUrl ?? "not configured"} />
            <Metadata label="Checked" value={status?.checkedAt ?? "never"} />
            {status?.downloadUrl ? (
              <Metadata label="Download" value={status.downloadUrl} />
            ) : null}
            {status?.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                {status.error}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[100px_minmax(0,1fr)]">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}
