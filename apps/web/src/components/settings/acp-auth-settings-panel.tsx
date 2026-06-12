"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Fingerprint,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
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
type AcpAuthRecord = RouterOutput["acpAuth"]["list"]["providers"][number];
type AcpAuthMethod = AcpAuthRecord["method"];
type Credential = RouterOutput["credential"]["list"]["credentials"][number];
type ModelProvider =
  RouterOutput["modelProvider"]["list"]["providers"][number];

const NO_CREDENTIAL_VALUE = "__none__";
const CUSTOM_PROVIDER_VALUE = "__custom__";
const METHOD_OPTIONS: Array<{ value: AcpAuthMethod; label: string }> = [
  { value: "api_key", label: "API key" },
  { value: "bearer_token", label: "Bearer token" },
  { value: "oauth_token", label: "OAuth token" },
  { value: "external_cli", label: "External CLI" },
];

interface AcpAuthFormState {
  providerId: string;
  displayName: string;
  method: AcpAuthMethod;
  credentialId: string;
  envKey: string;
  authFilePath: string;
  enabled: boolean;
}

const EMPTY_FORM: AcpAuthFormState = {
  providerId: "",
  displayName: "",
  method: "api_key",
  credentialId: "",
  envKey: "",
  authFilePath: "",
  enabled: true,
};

export function AcpAuthSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<AcpAuthFormState>(EMPTY_FORM);
  const acpAuthQuery = trpc.acpAuth.list.useQuery(
    { includeDisabled: true },
    { staleTime: 30_000 }
  );
  const credentialsQuery = trpc.credential.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const providersQuery = trpc.modelProvider.list.useQuery(
    { includeDisabled: true },
    { staleTime: 30_000 }
  );
  const upsertAuth = trpc.acpAuth.upsert.useMutation({
    onSuccess: async () => {
      await utils.acpAuth.list.invalidate();
      setForm(EMPTY_FORM);
      toast.success("ACP auth provider saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save ACP auth provider");
    },
  });
  const deleteAuth = trpc.acpAuth.delete.useMutation({
    onSuccess: async () => {
      await utils.acpAuth.list.invalidate();
      toast.success("ACP auth provider deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete ACP auth provider");
    },
  });
  const syncAuth = trpc.acpAuth.sync.useMutation({
    onSuccess: async (result) => {
      await utils.acpAuth.list.invalidate();
      toast.success(`Synced ${result.totalCount} provider auth record(s)`);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to sync ACP auth");
    },
  });

  const authRecords = acpAuthQuery.data?.providers ?? [];
  const credentials = credentialsQuery.data?.credentials ?? [];
  const modelProviders = providersQuery.data?.providers ?? [];
  const credentialOptions = useMemo(
    () =>
      credentials.filter((credential) =>
        ["api_key", "bearer_token", "oauth_token", "secret"].includes(
          credential.kind
        )
      ),
    [credentials]
  );
  const syncedCount = authRecords.filter(
    (record) => record.syncStatus === "synced"
  ).length;
  const isBusy =
    acpAuthQuery.isFetching ||
    credentialsQuery.isFetching ||
    providersQuery.isFetching ||
    upsertAuth.isPending ||
    deleteAuth.isPending ||
    syncAuth.isPending;

  const selectedProvider = modelProviders.find(
    (provider) => provider.id === form.providerId
  );

  const handleProviderSelect = (value: string) => {
    if (value === CUSTOM_PROVIDER_VALUE) {
      setForm((prev) => ({ ...prev, providerId: "", displayName: "" }));
      return;
    }
    const provider = modelProviders.find((item) => item.id === value);
    setForm((prev) => ({
      ...prev,
      providerId: value,
      displayName: provider?.name ?? prev.displayName,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const providerId = form.providerId.trim();
    const displayName = form.displayName.trim();
    const credentialId = form.credentialId.trim();
    const envKey = form.envKey.trim();
    const authFilePath = form.authFilePath.trim();

    if (!providerId) {
      toast.error("Provider id is required");
      return;
    }
    if (form.method !== "external_cli" && !credentialId) {
      toast.error("Credential is required for this auth method");
      return;
    }

    upsertAuth.mutate({
      providerId,
      ...(displayName ? { displayName } : {}),
      method: form.method,
      ...(credentialId ? { credentialId } : {}),
      ...(envKey ? { envKey } : {}),
      ...(authFilePath ? { authFilePath } : {}),
      enabled: form.enabled,
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => syncAuth.mutate({})}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", syncAuth.isPending && "animate-spin")}
          />
          Sync
        </Button>
      }
      description="Provider-scoped ACP auth files restored from encrypted credentials at startup."
      icon={Fingerprint}
      title="ACP Auth"
    >
      <div className="grid gap-4">
        <form className="grid gap-4 rounded-md border bg-muted/20 p-3" onSubmit={handleSubmit}>
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_180px]">
            <div className="grid gap-1.5">
              <Label htmlFor="acp-auth-provider-select">Provider</Label>
              <Select
                onValueChange={handleProviderSelect}
                value={
                  selectedProvider ? selectedProvider.id : CUSTOM_PROVIDER_VALUE
                }
              >
                <SelectTrigger className="w-full" id="acp-auth-provider-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM_PROVIDER_VALUE}>Custom</SelectItem>
                  {modelProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="acp-auth-provider-id">Provider id</Label>
              <Input
                autoComplete="off"
                id="acp-auth-provider-id"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    providerId: event.target.value,
                  }))
                }
                placeholder="codex"
                value={form.providerId}
              />
            </div>
            <label
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
              htmlFor="acp-auth-enabled"
            >
              <span className="text-sm">Enabled</span>
              <Switch
                checked={form.enabled}
                id="acp-auth-enabled"
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_180px_260px]">
            <div className="grid gap-1.5">
              <Label htmlFor="acp-auth-display-name">Display name</Label>
              <Input
                autoComplete="off"
                id="acp-auth-display-name"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    displayName: event.target.value,
                  }))
                }
                placeholder="Codex"
                value={form.displayName}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="acp-auth-method">Method</Label>
              <Select
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    method: value as AcpAuthMethod,
                    credentialId:
                      value === "external_cli" ? "" : prev.credentialId,
                  }))
                }
                value={form.method}
              >
                <SelectTrigger className="w-full" id="acp-auth-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="acp-auth-credential">Credential</Label>
              <Select
                disabled={form.method === "external_cli"}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    credentialId:
                      value === NO_CREDENTIAL_VALUE ? "" : value,
                  }))
                }
                value={form.credentialId || NO_CREDENTIAL_VALUE}
              >
                <SelectTrigger className="w-full" id="acp-auth-credential">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CREDENTIAL_VALUE}>None</SelectItem>
                  {credentialOptions.map((credential) => (
                    <SelectItem key={credential.id} value={credential.id}>
                      {credentialLabel(credential)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="acp-auth-env-key">Env key</Label>
              <Input
                autoComplete="off"
                id="acp-auth-env-key"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, envKey: event.target.value }))
                }
                placeholder="OPENAI_API_KEY"
                value={form.envKey}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="acp-auth-file-path">Auth file path</Label>
              <Input
                autoComplete="off"
                id="acp-auth-file-path"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    authFilePath: event.target.value,
                  }))
                }
                placeholder="acp-auth/codex/auth.json"
                value={form.authFilePath}
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {form.providerId ? (
              <Button
                disabled={isBusy}
                onClick={() => setForm(EMPTY_FORM)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            ) : null}
            <Button disabled={isBusy} type="submit">
              <Save className="mr-2 h-4 w-4" />
              Save auth
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {syncedCount}/{authRecords.length} synced
          </Badge>
          <Badge variant="outline">{credentialOptions.length} credentials</Badge>
        </div>

        {acpAuthQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading ACP auth providers...
          </div>
        ) : null}

        {!acpAuthQuery.isLoading && authRecords.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No ACP auth providers configured.
          </div>
        ) : null}

        {authRecords.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {authRecords.map((record) => (
              <AcpAuthRow
                credential={credentials.find(
                  (credential) => credential.id === record.credentialId
                )}
                disabled={isBusy}
                key={`${record.userId}:${record.providerId}`}
                onDelete={() =>
                  deleteAuth.mutate({ providerId: record.providerId })
                }
                onEdit={() => setForm(formFromRecord(record))}
                onSync={() => syncAuth.mutate({ providerId: record.providerId })}
                record={record}
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function AcpAuthRow({
  record,
  credential,
  disabled,
  onDelete,
  onEdit,
  onSync,
}: {
  record: AcpAuthRecord;
  credential: Credential | undefined;
  disabled: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onSync: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">
              {record.displayName ?? record.providerId}
            </h3>
            <Badge variant={statusVariant(record.syncStatus)}>
              {formatStatus(record.syncStatus)}
            </Badge>
            <Badge variant="outline">{formatMethod(record.method)}</Badge>
            {record.enabled ? null : (
              <Badge variant="secondary">Disabled</Badge>
            )}
          </div>
          <div className="mt-2 truncate font-mono text-muted-foreground text-xs">
            {record.providerId}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            disabled={disabled}
            onClick={onSync}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Sync</span>
          </Button>
          <Button
            disabled={disabled}
            onClick={onEdit}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Edit</span>
          </Button>
          <Button
            disabled={disabled}
            onClick={onDelete}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      </div>
      <div className="grid gap-1 text-muted-foreground text-xs">
        <span className="truncate font-mono">{record.authFilePath}</span>
        {credential ? <span>{credentialLabel(credential)}</span> : null}
        {record.envKey ? <span className="font-mono">{record.envKey}</span> : null}
        {record.syncError ? (
          <span className="text-destructive">{record.syncError}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <span>Updated {formatTimestamp(record.updatedAt)}</span>
        {record.lastSyncedAt ? (
          <span>Synced {formatTimestamp(record.lastSyncedAt)}</span>
        ) : null}
      </div>
    </div>
  );
}

function formFromRecord(record: AcpAuthRecord): AcpAuthFormState {
  return {
    providerId: record.providerId,
    displayName: record.displayName ?? "",
    method: record.method,
    credentialId: record.credentialId ?? "",
    envKey: record.envKey ?? "",
    authFilePath: record.authFilePath,
    enabled: record.enabled,
  };
}

function credentialLabel(credential: Credential): string {
  return `${credential.name} (${credential.kind}${credential.providerId ? `, ${credential.providerId}` : ""})`;
}

function formatMethod(method: AcpAuthMethod): string {
  return METHOD_OPTIONS.find((item) => item.value === method)?.label ?? method;
}

function formatStatus(status: AcpAuthRecord["syncStatus"]): string {
  return status.replace(/_/g, " ");
}

function statusVariant(
  status: AcpAuthRecord["syncStatus"]
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "synced") {
    return "default";
  }
  if (status === "error" || status === "missing_credential") {
    return "destructive";
  }
  if (status === "disabled") {
    return "secondary";
  }
  return "outline";
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
