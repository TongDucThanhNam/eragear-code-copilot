// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  KeyRound,
  Link2,
  Play,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Wifi,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type RemoteConnectTunnelMode = "off" | "quick" | "named";

interface DesktopRemoteConnectFormState {
  enabled: boolean;
  host: string;
  port: string;
  accessToken: string;
  allowedOrigins: string;
  bodyLimitBytes: string;
  tunnelMode: RemoteConnectTunnelMode;
  tunnelToken: string;
  tunnelPublicUrl: string;
  cloudflaredPath: string;
  cloudflaredNoAutoupdate: boolean;
  cloudflareAccessClientId: string;
  cloudflareAccessClientSecret: string;
}

interface DesktopRemoteConnectSettingsView {
  enabled: boolean;
  host: string;
  port: number;
  accessToken: string;
  allowedOrigins: string[];
  bodyLimitBytes: number;
  tunnelMode: RemoteConnectTunnelMode;
  tunnelToken: string;
  tunnelPublicUrl: string;
  cloudflaredPath: string;
  cloudflaredNoAutoupdate: boolean;
  cloudflareAccessClientId: string;
  cloudflareAccessClientSecret: string;
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

const DEFAULT_REMOTE_CONNECT_FORM: DesktopRemoteConnectFormState = {
  enabled: false,
  host: "127.0.0.1",
  port: "0",
  accessToken: "",
  allowedOrigins: "*",
  bodyLimitBytes: "524288",
  tunnelMode: "off",
  tunnelToken: "",
  tunnelPublicUrl: "",
  cloudflaredPath: "cloudflared",
  cloudflaredNoAutoupdate: true,
  cloudflareAccessClientId: "",
  cloudflareAccessClientSecret: "",
};

function splitList(value: string): string[] {
  const entries = value
    .split(/[,\n]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? [...new Set(entries)] : ["*"];
}

function formFromDesktopSettings(
  value: unknown
): DesktopRemoteConnectFormState {
  const settings = readRemoteConnectSettings(value);
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: String(settings.port),
    accessToken: settings.accessToken,
    allowedOrigins: settings.allowedOrigins.join(", "),
    bodyLimitBytes: String(settings.bodyLimitBytes),
    tunnelMode: settings.tunnelMode,
    tunnelToken: settings.tunnelToken,
    tunnelPublicUrl: settings.tunnelPublicUrl,
    cloudflaredPath: settings.cloudflaredPath,
    cloudflaredNoAutoupdate: settings.cloudflaredNoAutoupdate,
    cloudflareAccessClientId: settings.cloudflareAccessClientId,
    cloudflareAccessClientSecret: settings.cloudflareAccessClientSecret,
  };
}

function readRemoteConnectSettings(
  value: unknown
): DesktopRemoteConnectSettingsView {
  const root =
    isRecord(value) && isRecord(value.settings) ? value.settings : value;
  const remoteConnect =
    isRecord(root) && isRecord(root.remoteConnect) ? root.remoteConnect : {};
  return {
    enabled: readBoolean(remoteConnect.enabled, false),
    host: readString(remoteConnect.host, "127.0.0.1"),
    port: readNumber(remoteConnect.port, 0),
    accessToken: readString(remoteConnect.accessToken, ""),
    allowedOrigins: Array.isArray(remoteConnect.allowedOrigins)
      ? remoteConnect.allowedOrigins
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : ["*"],
    bodyLimitBytes: readNumber(remoteConnect.bodyLimitBytes, 524_288),
    tunnelMode: readTunnelMode(remoteConnect.tunnelMode),
    tunnelToken: readString(remoteConnect.tunnelToken, ""),
    tunnelPublicUrl: readString(remoteConnect.tunnelPublicUrl, ""),
    cloudflaredPath: readString(remoteConnect.cloudflaredPath, "cloudflared"),
    cloudflaredNoAutoupdate: readBoolean(
      remoteConnect.cloudflaredNoAutoupdate,
      true
    ),
    cloudflareAccessClientId: readString(
      remoteConnect.cloudflareAccessClientId,
      ""
    ),
    cloudflareAccessClientSecret: readString(
      remoteConnect.cloudflareAccessClientSecret,
      ""
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readTunnelMode(value: unknown): RemoteConnectTunnelMode {
  return value === "quick" || value === "named" || value === "off"
    ? value
    : "off";
}

function DesktopRemoteConnectSettingsPanel() {
  const [form, setForm] = useState<DesktopRemoteConnectFormState>(
    DEFAULT_REMOTE_CONNECT_FORM
  );
  const [isLoading, setIsLoading] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const bridge =
    typeof window !== "undefined" ? window.eragearDesktop : undefined;
  const bridgeAvailable = Boolean(
    bridge?.getDesktopSettings && bridge?.updateRemoteConnectSettings
  );

  useEffect(() => {
    if (!bridge?.getDesktopSettings) {
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    bridge
      .getDesktopSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setForm(formFromDesktopSettings(settings));
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load Desktop Remote Connect settings"
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const isBusy = isLoading;
  const port = Number(form.port);
  const bodyLimitBytes = Number(form.bodyLimitBytes);
  const invalidPort = !Number.isInteger(port) || port < 0 || port >= 65_536;
  const invalidBodyLimit =
    !Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0;
  const missingToken =
    form.enabled && form.accessToken.trim().length > 0
      ? form.accessToken.trim().length < 32
      : form.enabled;
  const missingNamedTunnelToken =
    form.enabled &&
    form.tunnelMode === "named" &&
    form.tunnelToken.trim().length < 32;
  const invalidCloudflareAccess =
    Boolean(form.cloudflareAccessClientId.trim()) !==
    Boolean(form.cloudflareAccessClientSecret.trim());
  const canSubmit =
    bridgeAvailable &&
    !isBusy &&
    !invalidPort &&
    !invalidBodyLimit &&
    !missingToken &&
    !missingNamedTunnelToken &&
    !invalidCloudflareAccess;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bridge?.updateRemoteConnectSettings) {
      toast.error("Desktop bridge is not available");
      return;
    }
    if (!canSubmit) {
      toast.error("Remote Connect settings need a valid token and port");
      return;
    }
    setIsLoading(true);
    bridge
      .updateRemoteConnectSettings({
        enabled: form.enabled,
        host: form.host.trim(),
        port,
        accessToken: form.accessToken.trim(),
        allowedOrigins: splitList(form.allowedOrigins),
        bodyLimitBytes,
        tunnelMode: form.tunnelMode,
        tunnelToken: form.tunnelToken.trim(),
        tunnelPublicUrl: form.tunnelPublicUrl.trim(),
        cloudflaredPath: form.cloudflaredPath.trim(),
        cloudflaredNoAutoupdate: form.cloudflaredNoAutoupdate,
        cloudflareAccessClientId: form.cloudflareAccessClientId.trim(),
        cloudflareAccessClientSecret: form.cloudflareAccessClientSecret.trim(),
      })
      .then((result) => {
        setForm(formFromDesktopSettings(result));
        setRestartRequired(true);
        toast.success("Desktop Remote Connect settings saved");
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to save Desktop Remote Connect settings"
        );
      })
      .finally(() => setIsLoading(false));
  };

  const handleGenerateToken = () => {
    if (!bridge?.createRemoteConnectToken) {
      toast.error("Desktop bridge is not available");
      return;
    }
    bridge
      .createRemoteConnectToken()
      .then((token) => {
        if (typeof token === "string" && token.length > 0) {
          setForm((prev) => ({ ...prev, accessToken: token }));
        }
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to generate Remote Connect token"
        );
      });
  };

  return (
    <form
      className="grid gap-3 rounded-md border bg-muted/20 p-3"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-sm">Desktop Remote Connect</div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={form.enabled ? "secondary" : "outline"}>
            {form.enabled ? "Enabled" : "Off"}
          </Badge>
          {restartRequired ? (
            <Badge variant="outline">Restart needed</Badge>
          ) : null}
        </div>
      </div>

      <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
        <span className="text-sm">Enabled</span>
        <Switch
          checked={form.enabled}
          disabled={!bridgeAvailable || isBusy}
          onCheckedChange={(enabled) =>
            setForm((prev) => ({ ...prev, enabled }))
          }
        />
      </label>

      <div className="grid gap-3 md:grid-cols-[1fr_140px]">
        <Field label="Host">
          <Input
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, host: event.target.value }))
            }
            value={form.host}
          />
        </Field>
        <Field label="Port">
          <Input
            disabled={!bridgeAvailable || isBusy}
            max={65535}
            min={0}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, port: event.target.value }))
            }
            type="number"
            value={form.port}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <Field label="Access token">
          <Input
            autoComplete="off"
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                accessToken: event.target.value,
              }))
            }
            type="password"
            value={form.accessToken}
          />
        </Field>
        <Button
          className="self-end"
          disabled={!bridge?.createRemoteConnectToken || isBusy}
          onClick={handleGenerateToken}
          type="button"
          variant="outline"
        >
          <KeyRound className="mr-2 h-4 w-4" />
          Generate
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_160px]">
        <Field label="Allowed origins">
          <Input
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                allowedOrigins: event.target.value,
              }))
            }
            value={form.allowedOrigins}
          />
        </Field>
        <Field label="Body limit">
          <Input
            disabled={!bridgeAvailable || isBusy}
            min={1}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                bodyLimitBytes: event.target.value,
              }))
            }
            type="number"
            value={form.bodyLimitBytes}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr]">
        <Field label="Tunnel">
          <Select
            disabled={!bridgeAvailable || isBusy}
            onValueChange={(value) =>
              setForm((prev) => ({
                ...prev,
                tunnelMode: value as RemoteConnectTunnelMode,
              }))
            }
            value={form.tunnelMode}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="quick">Quick</SelectItem>
              <SelectItem value="named">Named</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tunnel token">
          <Input
            autoComplete="off"
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                tunnelToken: event.target.value,
              }))
            }
            type="password"
            value={form.tunnelToken}
          />
        </Field>
        <Field label="Public URL">
          <Input
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                tunnelPublicUrl: event.target.value,
              }))
            }
            value={form.tunnelPublicUrl}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <Field label="Cloudflared path">
          <Input
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                cloudflaredPath: event.target.value,
              }))
            }
            value={form.cloudflaredPath}
          />
        </Field>
        <label className="flex min-h-10 items-center justify-between gap-3 self-end rounded-md border bg-background px-3 py-2">
          <span className="text-sm">No autoupdate</span>
          <Switch
            checked={form.cloudflaredNoAutoupdate}
            disabled={!bridgeAvailable || isBusy}
            onCheckedChange={(cloudflaredNoAutoupdate) =>
              setForm((prev) => ({ ...prev, cloudflaredNoAutoupdate }))
            }
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <Field label="Cloudflare client id">
          <Input
            autoComplete="off"
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                cloudflareAccessClientId: event.target.value,
              }))
            }
            value={form.cloudflareAccessClientId}
          />
        </Field>
        <Field label="Cloudflare client secret">
          <Input
            autoComplete="off"
            disabled={!bridgeAvailable || isBusy}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                cloudflareAccessClientSecret: event.target.value,
              }))
            }
            type="password"
            value={form.cloudflareAccessClientSecret}
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button disabled={!canSubmit} type="submit">
          <Save className="mr-2 h-4 w-4" />
          Save Remote Connect
        </Button>
      </div>
    </form>
  );
}

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
    if (!(deviceForm.name.trim() && deviceForm.relayUrl.trim())) {
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

        <DesktopRemoteConnectSettingsPanel />

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

function Field({ label, children }: { label: string; children: ReactNode }) {
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
            <Badge
              variant={device.status === "online" ? "secondary" : "outline"}
            >
              {device.status}
            </Badge>
            {device.enabled ? null : <Badge variant="outline">disabled</Badge>}
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
        <Badge variant="outline">
          updated {formatTimestamp(device.updatedAt)}
        </Badge>
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
          <Badge
            variant={session.status === "active" ? "secondary" : "outline"}
          >
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
        <Button
          disabled={disabled}
          onClick={onStop}
          size="sm"
          variant="outline"
        >
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
