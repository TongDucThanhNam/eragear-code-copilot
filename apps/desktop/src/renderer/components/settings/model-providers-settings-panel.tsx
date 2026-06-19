// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  BrainCircuit,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
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
import { Textarea } from "@/components/ui/textarea";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type ModelProvider = RouterOutput["modelProvider"]["list"]["providers"][number];
type Credential = RouterOutput["credential"]["list"]["credentials"][number];
type ModelProviderFormat = "anthropic" | "openai" | "gemini";

interface ProviderFormState {
  id?: string;
  name: string;
  credentialId: string;
  apiKeyUrl: string;
  enabled: boolean;
  anthropicEndpoint: string;
  openaiEndpoint: string;
  geminiEndpoint: string;
  modelsText: string;
  formatsText: string;
  mappingHaiku: string;
  mappingSonnet: string;
  mappingOpus: string;
  mappingReasoning: string;
}

const NO_CREDENTIAL_VALUE = "__none__";
const FORMAT_VALUES = new Set<ModelProviderFormat>([
  "anthropic",
  "openai",
  "gemini",
]);
const EMPTY_FORM: ProviderFormState = {
  name: "",
  credentialId: "",
  apiKeyUrl: "",
  enabled: true,
  anthropicEndpoint: "",
  openaiEndpoint: "",
  geminiEndpoint: "",
  modelsText: "",
  formatsText: "",
  mappingHaiku: "",
  mappingSonnet: "",
  mappingOpus: "",
  mappingReasoning: "",
};

export function ModelProvidersSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM);
  const providersQuery = trpc.modelProvider.list.useQuery(
    { includeDisabled: true },
    { staleTime: 30_000 }
  );
  const credentialsQuery = trpc.credential.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const upsertProvider = trpc.modelProvider.upsert.useMutation({
    onSuccess: async () => {
      await utils.modelProvider.list.invalidate();
      setForm(EMPTY_FORM);
      toast.success("Model provider saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save model provider");
    },
  });
  const deleteProvider = trpc.modelProvider.delete.useMutation({
    onSuccess: async () => {
      await utils.modelProvider.list.invalidate();
      toast.success("Model provider deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete model provider");
    },
  });
  const restoreDefaults = trpc.modelProvider.restoreDefaults.useMutation({
    onSuccess: async () => {
      await utils.modelProvider.list.invalidate();
      toast.success("Default providers restored");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to restore default providers");
    },
  });

  const providers = providersQuery.data?.providers ?? [];
  const credentials = credentialsQuery.data?.credentials ?? [];
  const enabledCount = providers.filter((provider) => provider.enabled).length;
  const modelCount = providers.reduce(
    (total, provider) => total + provider.models.length,
    0
  );
  const isEditing = Boolean(form.id);
  const isBusy =
    providersQuery.isFetching ||
    credentialsQuery.isFetching ||
    upsertProvider.isPending ||
    deleteProvider.isPending ||
    restoreDefaults.isPending;
  const credentialOptions = useMemo(
    () =>
      credentials.filter(
        (credential) =>
          credential.kind === "api_key" || credential.kind === "bearer_token"
      ),
    [credentials]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("Provider name is required");
      return;
    }
    upsertProvider.mutate({
      ...(form.id ? { id: form.id } : {}),
      name,
      endpoints: {
        anthropic: form.anthropicEndpoint.trim(),
        openai: form.openaiEndpoint.trim(),
        gemini: form.geminiEndpoint.trim(),
      },
      ...(form.credentialId ? { credentialId: form.credentialId } : {}),
      ...(form.apiKeyUrl.trim() ? { apiKeyUrl: form.apiKeyUrl.trim() } : {}),
      models: parseModelList(form.modelsText),
      modelSupportedFormats: parseSupportedFormats(form.formatsText),
      providerMappings: buildClaudeMappings(form),
      enabled: form.enabled,
    });
  };

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isBusy}
            onClick={() => setForm(EMPTY_FORM)}
            size="sm"
            variant="outline"
          >
            <Plus className="mr-2 h-4 w-4" />
            New
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => restoreDefaults.mutate()}
            size="sm"
            variant="outline"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Defaults
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => void providersQuery.refetch()}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                providersQuery.isFetching ? "animate-spin" : ""
              )}
            />
            Refresh
          </Button>
        </div>
      }
      description="Provider registry with endpoints, encrypted credential links, model format support, and Claude family mappings."
      icon={BrainCircuit}
      title="Model Providers"
    >
      <div className="grid gap-4">
        <form
          className="grid gap-4 rounded-md border bg-muted/20 p-3"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-3 md:grid-cols-[1fr_220px_120px]">
            <div className="grid gap-1.5">
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="OpenRouter"
                value={form.name}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="provider-credential">Credential</Label>
              <Select
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    credentialId: value === NO_CREDENTIAL_VALUE ? "" : value,
                  }))
                }
                value={form.credentialId || NO_CREDENTIAL_VALUE}
              >
                <SelectTrigger className="w-full" id="provider-credential">
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
            <label
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
              htmlFor="provider-enabled"
            >
              <span className="text-sm">Enabled</span>
              <Switch
                checked={form.enabled}
                id="provider-enabled"
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <EndpointInput
              id="provider-anthropic"
              label="Anthropic endpoint"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, anthropicEndpoint: value }))
              }
              value={form.anthropicEndpoint}
            />
            <EndpointInput
              id="provider-openai"
              label="OpenAI endpoint"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, openaiEndpoint: value }))
              }
              value={form.openaiEndpoint}
            />
            <EndpointInput
              id="provider-gemini"
              label="Gemini endpoint"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, geminiEndpoint: value }))
              }
              value={form.geminiEndpoint}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="provider-api-key-url">API key URL</Label>
            <Input
              id="provider-api-key-url"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, apiKeyUrl: event.target.value }))
              }
              placeholder="https://platform.example.com/api-keys"
              value={form.apiKeyUrl}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="provider-models">Models</Label>
              <Textarea
                className="min-h-32 font-mono text-xs"
                id="provider-models"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    modelsText: event.target.value,
                  }))
                }
                placeholder={"gpt-5\nclaude-sonnet-4.6\nz-ai/glm-5.1"}
                value={form.modelsText}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="provider-formats">Model formats</Label>
              <Textarea
                className="min-h-32 font-mono text-xs"
                id="provider-formats"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    formatsText: event.target.value,
                  }))
                }
                placeholder={
                  "gpt-5: openai\nclaude-sonnet-4.6: anthropic, openai"
                }
                value={form.formatsText}
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-4">
            <MappingInput
              label="Haiku"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, mappingHaiku: value }))
              }
              value={form.mappingHaiku}
            />
            <MappingInput
              label="Sonnet"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, mappingSonnet: value }))
              }
              value={form.mappingSonnet}
            />
            <MappingInput
              label="Opus"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, mappingOpus: value }))
              }
              value={form.mappingOpus}
            />
            <MappingInput
              label="Reasoning"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, mappingReasoning: value }))
              }
              value={form.mappingReasoning}
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
              {isEditing ? "Save provider" : "Add provider"}
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {enabledCount}/{providers.length} enabled
          </Badge>
          <Badge variant="outline">{modelCount} models</Badge>
          <Badge variant="outline">
            {credentialOptions.length} credentials
          </Badge>
        </div>

        {providersQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading model providers...
          </div>
        ) : null}

        {!providersQuery.isLoading && providers.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No model providers configured.
          </div>
        ) : null}

        {providers.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {providers.map((provider) => (
              <ProviderRow
                credential={credentials.find(
                  (item) => item.id === provider.credentialId
                )}
                disabled={isBusy}
                key={provider.id}
                onDelete={() => deleteProvider.mutate({ id: provider.id })}
                onEdit={() => setForm(formFromProvider(provider))}
                provider={provider}
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function EndpointInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://api.example.com/v1"
        value={value}
      />
    </div>
  );
}

function MappingInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `provider-mapping-${label.toLowerCase()}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder="model-id"
        value={value}
      />
    </div>
  );
}

function ProviderRow({
  provider,
  credential,
  disabled,
  onEdit,
  onDelete,
}: {
  provider: ModelProvider;
  credential?: Credential;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const formats = summarizeFormats(provider);
  const claudeMapping = provider.providerMappings.claude;
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{provider.name}</h3>
            <Badge variant={provider.enabled ? "secondary" : "outline"}>
              {provider.enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Badge variant="outline">{provider.source}</Badge>
          </div>
          <div className="mt-1 truncate font-mono text-muted-foreground text-xs">
            {provider.id}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
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

      <div className="grid gap-2 text-xs">
        <ProviderEndpoint
          label="Anthropic"
          value={provider.endpoints.anthropic}
        />
        <ProviderEndpoint label="OpenAI" value={provider.endpoints.openai} />
        <ProviderEndpoint label="Gemini" value={provider.endpoints.gemini} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{provider.models.length} models</Badge>
        {formats.map((format) => (
          <Badge key={format} variant="outline">
            {format}
          </Badge>
        ))}
        {credential ? (
          <Badge variant="outline">{credential.name}</Badge>
        ) : provider.credentialId ? (
          <Badge variant="outline">{provider.credentialId}</Badge>
        ) : null}
      </div>

      {claudeMapping ? (
        <div className="grid gap-1 rounded-md bg-muted/40 p-2 text-xs">
          <MappingSummary label="Haiku" value={claudeMapping.haiku} />
          <MappingSummary label="Sonnet" value={claudeMapping.sonnet} />
          <MappingSummary label="Opus" value={claudeMapping.opus} />
          <MappingSummary label="Reasoning" value={claudeMapping.reasoning} />
        </div>
      ) : null}
    </div>
  );
}

function ProviderEndpoint({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}

function MappingSummary({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}

function credentialLabel(credential: Credential): string {
  return `${credential.name} ${credential.secretPreview}`;
}

function parseModelList(text: string): string[] {
  return unique(
    text
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parseSupportedFormats(
  text: string
): Record<string, ModelProviderFormat[]> {
  const formats: Record<string, ModelProviderFormat[]> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const [rawModel, rawFormats] = line.split(":");
    const model = rawModel?.trim();
    if (!(model && rawFormats)) {
      continue;
    }
    const parsedFormats = unique(
      rawFormats
        .split(/[,\s]+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is ModelProviderFormat =>
          FORMAT_VALUES.has(item as ModelProviderFormat)
        )
    );
    if (parsedFormats.length > 0) {
      formats[model] = parsedFormats;
    }
  }
  return formats;
}

function buildClaudeMappings(form: ProviderFormState) {
  const claude = {
    ...(form.mappingHaiku.trim() ? { haiku: form.mappingHaiku.trim() } : {}),
    ...(form.mappingSonnet.trim() ? { sonnet: form.mappingSonnet.trim() } : {}),
    ...(form.mappingOpus.trim() ? { opus: form.mappingOpus.trim() } : {}),
    ...(form.mappingReasoning.trim()
      ? { reasoning: form.mappingReasoning.trim() }
      : {}),
  };
  const mappings: Record<
    string,
    Partial<Record<"haiku" | "sonnet" | "opus" | "reasoning", string>>
  > = {};
  if (Object.keys(claude).length > 0) {
    mappings.claude = claude;
  }
  return mappings;
}

function formFromProvider(provider: ModelProvider): ProviderFormState {
  const claude = provider.providerMappings.claude ?? {};
  return {
    id: provider.id,
    name: provider.name,
    credentialId: provider.credentialId ?? "",
    apiKeyUrl: provider.apiKeyUrl ?? "",
    enabled: provider.enabled,
    anthropicEndpoint: provider.endpoints.anthropic ?? "",
    openaiEndpoint: provider.endpoints.openai ?? "",
    geminiEndpoint: provider.endpoints.gemini ?? "",
    modelsText: provider.models.join("\n"),
    formatsText: formatSupportedFormats(provider),
    mappingHaiku: claude.haiku ?? "",
    mappingSonnet: claude.sonnet ?? "",
    mappingOpus: claude.opus ?? "",
    mappingReasoning: claude.reasoning ?? "",
  };
}

function formatSupportedFormats(provider: ModelProvider): string {
  return Object.entries(provider.modelSupportedFormats)
    .map(([model, formats]) => `${model}: ${formats.join(", ")}`)
    .join("\n");
}

function summarizeFormats(provider: ModelProvider): ModelProviderFormat[] {
  return unique(
    Object.values(provider.modelSupportedFormats).flat()
  ) as ModelProviderFormat[];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
