// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { KeyRound, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type Credential = RouterOutput["credential"]["list"]["credentials"][number];
type CredentialKind = Credential["kind"];

const CREDENTIAL_KINDS: Array<{ value: CredentialKind; label: string }> = [
  { value: "api_key", label: "API key" },
  { value: "bearer_token", label: "Bearer token" },
  { value: "oauth_token", label: "OAuth token" },
  { value: "secret", label: "Secret" },
];

interface CredentialFormState {
  id?: string;
  name: string;
  providerId: string;
  kind: CredentialKind;
  secret: string;
}

const EMPTY_FORM: CredentialFormState = {
  name: "",
  providerId: "",
  kind: "api_key",
  secret: "",
};

export function CredentialsSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<CredentialFormState>(EMPTY_FORM);
  const credentialsQuery = trpc.credential.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const upsertCredential = trpc.credential.upsert.useMutation({
    onSuccess: async () => {
      await utils.credential.list.invalidate();
      setForm(EMPTY_FORM);
      toast.success("Credential saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save credential");
    },
  });
  const deleteCredential = trpc.credential.delete.useMutation({
    onSuccess: async () => {
      await utils.credential.list.invalidate();
      toast.success("Credential deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete credential");
    },
  });

  const credentials = credentialsQuery.data?.credentials ?? [];
  const providerCount = useMemo(
    () =>
      new Set(
        credentials
          .map((credential) => credential.providerId)
          .filter((providerId): providerId is string => Boolean(providerId))
      ).size,
    [credentials]
  );
  const isEditing = Boolean(form.id);
  const isBusy =
    credentialsQuery.isFetching ||
    upsertCredential.isPending ||
    deleteCredential.isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    const providerId = form.providerId.trim();
    const secret = form.secret.trim();
    if (!(name && secret)) {
      toast.error("Name and secret are required");
      return;
    }
    upsertCredential.mutate({
      ...(form.id ? { id: form.id } : {}),
      name,
      kind: form.kind,
      ...(providerId ? { providerId } : {}),
      secret,
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void credentialsQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              credentialsQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="Encrypted provider and agent secrets stored outside agent configs."
      icon={KeyRound}
      title="Credentials"
    >
      <div className="grid gap-4">
        <form
          className="grid gap-3 rounded-md border bg-muted/20 p-3"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
            <div className="grid gap-1.5">
              <Label htmlFor="credential-name">Name</Label>
              <Input
                autoComplete="off"
                id="credential-name"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="OpenAI production key"
                value={form.name}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="credential-provider">Provider</Label>
              <Input
                autoComplete="off"
                id="credential-provider"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    providerId: event.target.value,
                  }))
                }
                placeholder="openai"
                value={form.providerId}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="credential-kind">Kind</Label>
              <Select
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    kind: value as CredentialKind,
                  }))
                }
                value={form.kind}
              >
                <SelectTrigger className="w-full" id="credential-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREDENTIAL_KINDS.map((kind) => (
                    <SelectItem key={kind.value} value={kind.value}>
                      {kind.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="credential-secret">Secret</Label>
            <Input
              autoComplete="off"
              id="credential-secret"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, secret: event.target.value }))
              }
              placeholder={isEditing ? "New secret value" : "Secret value"}
              type="password"
              value={form.secret}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {isEditing ? (
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
              {isEditing ? "Rotate credential" : "Save credential"}
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {credentialsQuery.data?.totalCount ?? 0} stored
          </Badge>
          <Badge variant="outline">{providerCount} providers</Badge>
        </div>

        {credentialsQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading credentials...
          </div>
        ) : null}

        {!credentialsQuery.isLoading && credentials.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No credentials stored.
          </div>
        ) : null}

        {credentials.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {credentials.map((credential) => (
              <CredentialRow
                credential={credential}
                disabled={isBusy}
                key={credential.id}
                onDelete={() => deleteCredential.mutate({ id: credential.id })}
                onRotate={() =>
                  setForm({
                    id: credential.id,
                    name: credential.name,
                    providerId: credential.providerId ?? "",
                    kind: credential.kind,
                    secret: "",
                  })
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function CredentialRow({
  credential,
  disabled,
  onDelete,
  onRotate,
}: {
  credential: Credential;
  disabled: boolean;
  onDelete: () => void;
  onRotate: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{credential.name}</h3>
            <Badge variant="secondary">{formatKind(credential.kind)}</Badge>
            {credential.providerId ? (
              <Badge variant="outline">{credential.providerId}</Badge>
            ) : null}
          </div>
          <div className="mt-2 font-mono text-muted-foreground text-xs">
            {credential.secretPreview}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            disabled={disabled}
            onClick={onRotate}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="sr-only">Rotate</span>
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
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <span>Updated {formatTimestamp(credential.updatedAt)}</span>
        {credential.lastUsedAt ? (
          <span>Used {formatTimestamp(credential.lastUsedAt)}</span>
        ) : null}
      </div>
    </div>
  );
}

function formatKind(kind: CredentialKind): string {
  return CREDENTIAL_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
