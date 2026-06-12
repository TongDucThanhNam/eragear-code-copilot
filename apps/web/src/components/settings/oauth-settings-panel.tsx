"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { ExternalLink, RefreshCw, RotateCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useBetterAuthClient } from "@/components/auth/auth-client-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BetterAuthClient } from "@/lib/auth-client";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type OAuthProvider =
  RouterOutput["oauth"]["getProviders"]["providers"][number];
type OAuthLinkedAccount =
  RouterOutput["oauth"]["getProviders"]["activeProviders"][number];

interface OAuthRedirectResponse {
  data?: { url?: string; redirect?: boolean } | null;
  error?: { message?: string } | null;
}

type OAuthAuthClient = BetterAuthClient & {
  linkSocial: (
    input: {
      provider: string;
      callbackURL?: string;
      disableRedirect?: boolean;
      scopes?: string[];
    },
    options?: {
      onError?: (context: { error: { message?: string } }) => void;
    }
  ) => Promise<OAuthRedirectResponse>;
};

export function OAuthSettingsPanel() {
  const authClient = useBetterAuthClient() as OAuthAuthClient;
  const utils = trpc.useUtils();
  const [linkingProviderId, setLinkingProviderId] = useState<string | null>(
    null
  );
  const providersQuery = trpc.oauth.getProviders.useQuery(undefined, {
    staleTime: 30_000,
  });
  const restoreSession = trpc.oauth.restoreCachedSession.useMutation({
    onSuccess: async (result) => {
      await utils.oauth.getProviders.invalidate();
      await utils.oauth.getActiveProvider.invalidate();
      toast.success(
        result.restored
          ? "OAuth provider session restored"
          : "No linked OAuth provider session found"
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to restore OAuth session");
    },
  });

  const providers = providersQuery.data?.providers ?? [];
  const activeProviders = providersQuery.data?.activeProviders ?? [];
  const activeByProvider = useMemo(() => {
    return new Map(
      activeProviders.map((account) => [account.providerId, account])
    );
  }, [activeProviders]);
  const isBusy =
    providersQuery.isFetching ||
    restoreSession.isPending ||
    linkingProviderId !== null;

  async function handleLink(provider: OAuthProvider) {
    if (!provider.configured) {
      toast.error(`${provider.name} OAuth is not configured`);
      return;
    }

    setLinkingProviderId(provider.id);
    try {
      let signInError: string | null = null;
      const result = await authClient.linkSocial(
        {
          provider: provider.id,
          callbackURL: `${window.location.origin}/settings/oauth`,
          disableRedirect: true,
        },
        {
          onError(context) {
            signInError =
              context.error.message || `Failed to start ${provider.name} OAuth`;
          },
        }
      );

      if (result.error || signInError) {
        throw new Error(
          result.error?.message ||
            signInError ||
            `Failed to start ${provider.name} OAuth`
        );
      }

      const redirectUrl = result.data?.url;
      if (!redirectUrl) {
        throw new Error(`${provider.name} did not return a redirect URL`);
      }
      window.location.assign(redirectUrl);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to start ${provider.name} OAuth`
      );
      setLinkingProviderId(null);
    }
  }

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isBusy}
            onClick={() => restoreSession.mutate()}
            size="sm"
            variant="outline"
          >
            <RotateCw
              className={cn(
                "mr-2 h-4 w-4",
                restoreSession.isPending ? "animate-spin" : ""
              )}
            />
            Restore
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
      description="Provider login and account linking backed by Better Auth OAuth token storage."
      icon={ShieldCheck}
      title="OAuth Providers"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {providersQuery.data?.configuredCount ?? 0} configured
          </Badge>
          <Badge variant="outline">
            {providersQuery.data?.linkedCount ?? 0} linked
          </Badge>
        </div>

        {providersQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading OAuth providers...
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-3">
          {providers.map((provider) => (
            <OAuthProviderCard
              account={activeByProvider.get(provider.id) ?? null}
              disabled={isBusy}
              isLinking={linkingProviderId === provider.id}
              key={provider.id}
              onLink={() => void handleLink(provider)}
              provider={provider}
            />
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}

function OAuthProviderCard({
  provider,
  account,
  disabled,
  isLinking,
  onLink,
}: {
  provider: OAuthProvider;
  account: OAuthLinkedAccount | null;
  disabled: boolean;
  isLinking: boolean;
  onLink: () => void;
}) {
  return (
    <div className="grid min-h-48 gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-sm">{provider.name}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={provider.configured ? "secondary" : "outline"}>
              {provider.configured ? "Configured" : "Missing env"}
            </Badge>
            {account ? <Badge variant="secondary">Linked</Badge> : null}
          </div>
        </div>
        <Button
          disabled={disabled || !provider.configured}
          onClick={onLink}
          size="icon-sm"
          title={account ? `Reconnect ${provider.name}` : `Connect ${provider.name}`}
          variant="outline"
        >
          <ExternalLink className={cn("h-4 w-4", isLinking ? "animate-pulse" : "")} />
          <span className="sr-only">
            {account ? `Reconnect ${provider.name}` : `Connect ${provider.name}`}
          </span>
        </Button>
      </div>

      {account ? (
        <div className="grid gap-1 text-muted-foreground text-xs">
          <span>Account {account.accountId}</span>
          <span>Linked {formatTimestamp(account.linkedAt)}</span>
          <span>
            Token {account.hasAccessToken ? "stored" : "not stored"}
            {account.accessTokenExpiresAt
              ? `, expires ${formatTimestamp(account.accessTokenExpiresAt)}`
              : ""}
          </span>
        </div>
      ) : (
        <div className="text-muted-foreground text-xs">
          {provider.configured
            ? "No linked account for this provider."
            : provider.missingEnv.join(", ")}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-1">
        {provider.defaultScopes.map((scope) => (
          <Badge className="font-mono text-[10px]" key={scope} variant="outline">
            {scope}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
