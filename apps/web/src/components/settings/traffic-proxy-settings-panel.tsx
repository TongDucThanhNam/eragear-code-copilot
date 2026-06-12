"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Network, RefreshCw, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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
type TrafficProxyConfig =
  RouterOutput["trafficProxy"]["getStatus"]["config"];

const EMPTY_FORM: TrafficProxyConfig = {
  enabled: false,
  applyToAgents: true,
  httpProxy: "",
  httpsProxy: "",
  noProxy: "localhost,127.0.0.1,::1",
  useSystemCa: true,
  caBundlePath: "",
  updatedAt: 0,
};

export function TrafficProxySettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<TrafficProxyConfig>(EMPTY_FORM);
  const statusQuery = trpc.trafficProxy.getStatus.useQuery(undefined, {
    staleTime: 30_000,
  });
  const updateConfig = trpc.trafficProxy.updateConfig.useMutation({
    onSuccess: async (status) => {
      setForm(status.config);
      await utils.trafficProxy.getStatus.invalidate();
      toast.success("Traffic proxy updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update traffic proxy");
    },
  });

  useEffect(() => {
    if (statusQuery.data?.config) {
      setForm(statusQuery.data.config);
    }
  }, [statusQuery.data?.config]);

  const preview = statusQuery.data?.agentEnvironmentPreview ?? {};
  const isBusy = statusQuery.isFetching || updateConfig.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateConfig.mutate({
      enabled: form.enabled,
      applyToAgents: form.applyToAgents,
      httpProxy: form.httpProxy,
      httpsProxy: form.httpsProxy,
      noProxy: form.noProxy,
      useSystemCa: form.useSystemCa,
      caBundlePath: form.caBundlePath,
    });
  };

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
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
        </div>
      }
      description="Proxy and certificate environment injected into spawned ACP agent processes."
      icon={Network}
      title="ACP Traffic Proxy"
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <Badge variant={form.enabled ? "secondary" : "outline"}>
            {form.enabled ? "enabled" : "disabled"}
          </Badge>
          <Badge variant={form.applyToAgents ? "secondary" : "outline"}>
            {form.applyToAgents ? "applies to agents" : "stored only"}
          </Badge>
          <Badge variant={form.useSystemCa ? "outline" : "secondary"}>
            {form.useSystemCa ? "system CA" : "custom CA only"}
          </Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ToggleField
            checked={form.enabled}
            label="Proxy enabled"
            onCheckedChange={(enabled) =>
              setForm((prev) => ({ ...prev, enabled }))
            }
          />
          <ToggleField
            checked={form.applyToAgents}
            label="Apply to agents"
            onCheckedChange={(applyToAgents) =>
              setForm((prev) => ({ ...prev, applyToAgents }))
            }
          />
          <ToggleField
            checked={form.useSystemCa}
            label="Use system CA"
            onCheckedChange={(useSystemCa) =>
              setForm((prev) => ({ ...prev, useSystemCa }))
            }
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <TextField
            label="HTTP proxy"
            onChange={(httpProxy) =>
              setForm((prev) => ({ ...prev, httpProxy }))
            }
            placeholder="http://proxy.example.com:8080"
            value={form.httpProxy}
          />
          <TextField
            label="HTTPS proxy"
            onChange={(httpsProxy) =>
              setForm((prev) => ({ ...prev, httpsProxy }))
            }
            placeholder="https://proxy.example.com:8443"
            value={form.httpsProxy}
          />
        </div>

        <TextField
          label="NO_PROXY"
          onChange={(noProxy) => setForm((prev) => ({ ...prev, noProxy }))}
          placeholder="localhost,127.0.0.1,.internal"
          value={form.noProxy}
        />

        <TextField
          label="CA bundle path"
          onChange={(caBundlePath) =>
            setForm((prev) => ({ ...prev, caBundlePath }))
          }
          placeholder="C:/certs/internal-ca.pem"
          value={form.caBundlePath}
        />

        <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
          <div className="font-medium text-sm">Agent environment preview</div>
          {Object.keys(preview).length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-muted-foreground text-xs">
              No proxy environment will be injected.
            </div>
          ) : (
            <div className="grid gap-1">
              {Object.entries(preview).map(([key, value]) => (
                <code
                  className="block overflow-hidden text-ellipsis whitespace-nowrap rounded bg-background px-2 py-1 text-xs"
                  key={key}
                  title={`${key}=${value}`}
                >
                  {key}={maskValue(key, value)}
                </code>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button disabled={isBusy} type="submit">
            <Save className="mr-2 h-4 w-4" />
            Save proxy
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = `traffic-proxy-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label
      className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
      htmlFor={id}
    >
      <span className="text-sm">{label}</span>
      <Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = `traffic-proxy-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

function maskValue(key: string, value: string): string {
  if (!key.toLowerCase().includes("proxy")) {
    return value;
  }
  return value.replace(/\/\/([^:@]+):([^@]+)@/, "//$1:***@");
}
