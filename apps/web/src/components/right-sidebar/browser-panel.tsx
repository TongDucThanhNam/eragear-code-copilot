import { ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BrowserPanel() {
  const [inputValue, setInputValue] = useState("");
  const [url, setUrl] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const normalizedUrl = useMemo(() => normalizeUrl(url), [url]);

  const navigate = () => {
    const nextUrl = normalizeUrl(inputValue);
    if (!nextUrl) {
      return;
    }
    setUrl(nextUrl);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2"
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        <Globe2 className="size-4 shrink-0 text-muted-foreground" />
        <Input
          aria-label="Browser URL"
          className="h-7 flex-1 border-muted bg-muted/20"
          onChange={(event) => setInputValue(event.target.value)}
          spellCheck={false}
          value={inputValue}
        />
        <Button size="xs" type="submit" variant="outline">
          Go
        </Button>
        <Button
          aria-label="Refresh browser"
          disabled={!normalizedUrl}
          onClick={() => setReloadKey((value) => value + 1)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <RefreshCw className="size-3" />
        </Button>
        <Button
          aria-label="Open browser URL externally"
          disabled={!normalizedUrl}
          onClick={() => {
            if (normalizedUrl) {
              window.open(normalizedUrl, "_blank", "noopener,noreferrer");
            }
          }}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <ExternalLink className="size-3" />
        </Button>
      </form>

      <div className="min-h-0 flex-1 bg-muted/20">
        {normalizedUrl ? (
          <iframe
            className="size-full bg-background"
            key={`${normalizedUrl}:${reloadKey}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            src={normalizedUrl}
            title="Integrated browser"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="grid max-w-56 gap-3">
              <div className="mx-auto flex size-9 items-center justify-center border bg-background">
                <Globe2 className="size-4 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm leading-6">
                No page loaded.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}
