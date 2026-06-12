"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Link2,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Wifi,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type RemoteDevice =
  RouterOutput["remoteControl"]["getStatus"]["devices"][number];
type RemoteSession =
  RouterOutput["remoteControl"]["getStatus"]["sessions"][number];

interface DeviceFormState {
  id?: string;
  name: string;
  relayUrl: string;
  pairingCode: string;
  enabled: boolean;
}

interface SessionFormState {
  deviceId: string;
  chatId: string;
  projectId: string;
  ttlMinutes: string;
  contextText: string;
}

const EMPTY_DEVICE_FORM: DeviceFormState = {
  name: "",
  relayUrl: "",
  pairingCode: "",
  enabled: true,
};

const EMPTY_SESSION_FORM: SessionFormState = {
  deviceId: "",
  chatId: "",
  projectId: "",
  ttlMinutes: "30",
  contextText: "",
};

export function RemoteControlSettingsPanel() {
  const utils = trpc.useUtils();
  const [deviceForm, setDeviceForm] =
    useState<DeviceFormState>(EMPTY_DEVICE_FORM);
  const [sessionForm, setSessionForm] =
    useState<SessionFormState>(EMPTY_SESSION_FORM);
  const statusQuery = trpc.remoteControl.getStatus.useQuery(undefined, {
    staleTime: 15_000,
  });
  const upsertDevice = trpc.remoteControl.upsertDevice.useMutation({
    onSuccess: async () => {
      await utils.remoteControl.getStatus.invalidate();
      setDeviceForm(EMPTY_DEVICE_FORM);
      toast.success("Remote relay saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save remote relay");
    },
  });
  const deleteDevice = trpc.remoteControl.deleteDevice.useMutation({
    onSuccess: async () => {
      await utils.remoteControl.getStatus.invalidate();
      toast.success("Remote relay deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete remote relay");
    },
  });
  const heartbeat = trpc.remoteControl.recordHeartbeat.useMutation({
    onSuccess: async () => {
      await utils.remoteControl.getStatus.invalidate();
      toast.success("Relay heartbeat recorded");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to record heartbeat");
    },
  });
  const startSession = trpc.remoteControl.startSession.useMutation({
    onSuccess: async () => {
      await utils.remoteControl.getStatus.invalidate();
      toast.success("Remote session started");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to start remote session");
    },
  });
  const stopSession = trpc.remoteControl.stopSession.useMutation({
    onSuccess: async () => {
      await utils.remoteControl.getStatus.invalidate();
      toast.success("Remote session stopped");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to stop remote session");
    },
  });

  const devices = statusQuery.data?.devices ?? [];
  const sessions = statusQuery.data?.sessions ?? [];
  const isBusy =
    statusQuery.isFetching ||
    upsertDevice.isPending ||
    deleteDevice.isPending ||
    heartbeat.isPending ||
    startSession.isPending ||
    stopSession.isPending;
  const enabledDevices = devices.filter((device) => device.enabled);
  const liveSessions = sessions.filter((session) =>
    ["requested", "active"].includes(session.status)
  );

  const handleDeviceSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deviceForm.name.trim() || !deviceForm.relayUrl.trim()) {
      toast.error("Relay name and URL are required");
      return;
    }
    upsertDevice.mutate({
      ...(deviceForm.id ? { id: deviceForm.id } : {}),
      name: deviceForm.name.trim(),
      relayUrl: deviceForm.relayUrl.trim(),
      ...(deviceForm.pairingCode.trim()
        ? { pairingCode: deviceForm.pairingCode.trim() }
        : {}),
      enabled: deviceForm.enabled,
    });
  };

  const handleSessionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ttlMinutes = Number(sessionForm.ttlMinutes);
    if (!sessionForm.deviceId) {
      toast.error("Select a relay device");
      return;
    }
    if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1) {
      toast.error("TTL must be at least one minute");
      return;
    }
    startSession.mutate({
      deviceId: sessionForm.deviceId,
      ...(sessionForm.chatId.trim()
        ? { chatId: sessionForm.chatId.trim() }
        : {}),
      ...(sessionForm.projectId.trim()
        ? { projectId: sessionForm.projectId.trim() }
        : {}),
      ttlMs: Math.round(ttlMinutes * 60_000),
      context: parseContext(sessionForm.contextText),
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void statusQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              statusQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="External relay device registry and user-scoped remote session lifecycle for queue-driven workflows."
      icon={Wifi}
      title="Remote Control"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{devices.length} relays</Badge>
          <Badge variant="outline">{enabledDevices.length} enabled</Badge>
          <Badge variant="outline">{liveSessions.length} live sessions</Badge>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <form
            className="grid gap-3 rounded-md border bg-muted/20 p-3"
            onSubmit={handleDeviceSubmit}
          >
            <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_auto]">
              <Field label="Name">
                <Input
                  onChange={(event) =>
                    setDeviceForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Desk relay"
                  value={deviceForm.name}
                />
              </Field>
              <Field label="Relay URL">
                <Input
                  onChange={(event) =>
                    setDeviceForm((prev) => ({
                      ...prev,
                      relayUrl: event.target.value,
                    }))
                  }
                  placeholder="https://relay.example.com/device"
                  value={deviceForm.relayUrl}
                />
              </Field>
              <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <span className="text-sm">Enabled</span>
                <Switch
                  checked={deviceForm.enabled}
                  onCheckedChange={(enabled) =>
                    setDeviceForm((prev) => ({ ...prev, enabled }))
                  }
                />
              </label>
            </div>
            <Field label="Pairing code">
              <Input
                onChange={(event) =>
                  setDeviceForm((prev) => ({
                    ...prev,
                    pairingCode: event.target.value,
                  }))
                }
                placeholder="Optional"
                value={deviceForm.pairingCode}
              />
            </Field>
            <div className="flex justify-end gap-2">
              {deviceForm.id ? (
                <Button
                  onClick={() => setDeviceForm(EMPTY_DEVICE_FORM)}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              ) : null}
              <Button disabled={isBusy} type="submit">
                {deviceForm.id ? "Save relay" : "Add relay"}
              </Button>
            </div>
          </form>

          <form
            className="grid gap-3 rounded-md border bg-muted/20 p-3"
            onSubmit={handleSessionSubmit}
          >
            <Field label="Relay device">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                onChange={(event) =>
                  setSessionForm((prev) => ({
                    ...prev,
                    deviceId: event.target.value,
                  }))
                }
                value={sessionForm.deviceId}
              >
                <option value="">Select relay</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} ({device.status})
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Chat ID">
                <Input
                  onChange={(event) =>
                    setSessionForm((prev) => ({
                      ...prev,
                      chatId: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                  value={sessionForm.chatId}
                />
              </Field>
              <Field label="Project ID">
                <Input
                  onChange={(event) =>
                    setSessionForm((prev) => ({
                      ...prev,
                      projectId: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                  value={sessionForm.projectId}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
              <Field label="TTL minutes">
                <Input
                  min={1}
                  onChange={(event) =>
                    setSessionForm((prev) => ({
                      ...prev,
                      ttlMinutes: event.target.value,
                    }))
                  }
                  type="number"
                  value={sessionForm.ttlMinutes}
                />
              </Field>
              <Field label="Context">
                <Input
                  onChange={(event) =>
                    setSessionForm((prev) => ({
                      ...prev,
                      contextText: event.target.value,
                    }))
                  }
                  placeholder="trigger=queue,source=mobile"
                  value={sessionForm.contextText}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button disabled={isBusy || devices.length === 0} type="submit">
                <Play className="mr-2 h-4 w-4" />
                Start session
              </Button>
            </div>
          </form>
        </div>

        {statusQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading remote control...
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {devices.map((device) => (
            <DeviceRow
              device={device}
              disabled={isBusy}
              key={device.id}
              onDelete={() => deleteDevice.mutate({ id: device.id })}
              onEdit={() => setDeviceForm(formFromDevice(device))}
              onHeartbeat={() => heartbeat.mutate({ deviceId: device.id })}
            />
          ))}
        </div>

        {sessions.length > 0 ? (
          <div className="grid gap-3">
            <div className="font-medium text-sm">Remote sessions</div>
            {sessions.map((session) => (
              <SessionRow
                disabled={isBusy}
                key={session.id}
                onStop={() => stopSession.mutate({ sessionId: session.id })}
                session={session}
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = `remote-control-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div id={id}>{children}</div>
    </div>
  );
}

function DeviceRow({
  device,
  disabled,
  onDelete,
  onEdit,
  onHeartbeat,
}: {
  device: RemoteDevice;
  disabled: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onHeartbeat: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{device.name}</h3>
            <Badge variant={device.status === "online" ? "secondary" : "outline"}>
              {device.status}
            </Badge>
            {!device.enabled ? <Badge variant="outline">disabled</Badge> : null}
          </div>
          <div className="mt-1 truncate font-mono text-muted-foreground text-xs">
            {device.id}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            disabled={disabled}
            onClick={onHeartbeat}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Link2 className="h-4 w-4" />
            <span className="sr-only">Record heartbeat</span>
          </Button>
          <Button
            disabled={disabled}
            onClick={onEdit}
            size="sm"
            type="button"
            variant="ghost"
          >
            Edit
          </Button>
          <Button
            disabled={disabled}
            onClick={onDelete}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete relay</span>
          </Button>
        </div>
      </div>
      <div className="truncate font-mono text-muted-foreground text-xs">
        {device.relayUrl}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">
          last seen {formatOptionalTimestamp(device.lastSeenAt)}
        </Badge>
        <Badge variant="outline">updated {formatTimestamp(device.updatedAt)}</Badge>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  disabled,
  onStop,
}: {
  session: RemoteSession;
  disabled: boolean;
  onStop: () => void;
}) {
  const canStop = session.status === "requested" || session.status === "active";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-sm">{session.id}</span>
          <Badge variant={session.status === "active" ? "secondary" : "outline"}>
            {session.status}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground text-xs">
          <span>relay {session.deviceId}</span>
          {session.chatId ? <span>chat {session.chatId}</span> : null}
          {session.projectId ? <span>project {session.projectId}</span> : null}
          <span>expires {formatTimestamp(session.expiresAt)}</span>
        </div>
      </div>
      {canStop ? (
        <Button disabled={disabled} onClick={onStop} size="sm" variant="outline">
          <Square className="mr-2 h-4 w-4" />
          Stop
        </Button>
      ) : null}
    </div>
  );
}

function formFromDevice(device: RemoteDevice): DeviceFormState {
  return {
    id: device.id,
    name: device.name,
    relayUrl: device.relayUrl,
    pairingCode: device.pairingCode ?? "",
    enabled: device.enabled,
  };
}

function parseContext(text: string): Record<string, string> {
  const context: Record<string, string> = {};
  for (const pair of text.split(",")) {
    const [rawKey, ...rawValue] = pair.split("=");
    const key = rawKey?.trim();
    const value = rawValue.join("=").trim();
    if (key && value) {
      context[key] = value;
    }
  }
  return context;
}

function formatOptionalTimestamp(value: number | null): string {
  return value ? formatTimestamp(value) : "never";
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
