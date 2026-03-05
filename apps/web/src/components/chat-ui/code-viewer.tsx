import Editor from "@monaco-editor/react";
import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Route as IndexRoute } from "@/routes/index";
import { useFileStore } from "@/store/file-store";

const DIRTY_SYNC_DEBOUNCE_MS = 350;

export function CodeViewer() {
  const selectedFile = useFileStore((state) => state.selectedFile);
  const setSelectedFile = useFileStore((state) => state.setSelectedFile);

  const closeFile = () => setSelectedFile(null);

  return (
    <div className="flex h-full w-full flex-col border-r bg-background">
      <div className="flex h-12 items-center justify-between border-b bg-muted/20 px-4 py-2">
        <span className="truncate font-medium font-mono text-sm">
          {selectedFile}
        </span>
        <button
          className="rounded-md p-1 duration-200 hover:bg-muted"
          onClick={closeFile}
          type="button"
        >
          <X className="size-4 opacity-70" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 bg-[#1e1e1e]">
        {selectedFile && <FileContentLoader filePath={selectedFile} />}
      </div>
    </div>
  );
}

function FileContentLoader({ filePath }: { filePath: string }) {
  const { chatId } = IndexRoute.useSearch();

  const { data, isLoading, error } = trpc.getFileContent.useQuery(
    { chatId: chatId || "", path: filePath },
    {
      enabled: !!chatId,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 mins
    }
  );
  const syncEditorBufferMutation = trpc.syncEditorBuffer.useMutation();
  const [draftModeEnabled, setDraftModeEnabled] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const dirtyRef = useRef(false);
  const initialContentRef = useRef("");
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  const syncEditorBuffer = useCallback(
    async (payload: { isDirty: boolean; content?: string }) => {
      if (!chatId) {
        return;
      }
      try {
        await syncEditorBufferMutation.mutateAsync({
          chatId,
          path: filePath,
          isDirty: payload.isDirty,
          ...(payload.isDirty ? { content: payload.content ?? "" } : {}),
        });
      } catch (syncError) {
        console.warn("[CodeViewer] Failed to sync editor buffer", {
          chatId,
          path: filePath,
          isDirty: payload.isDirty,
          error:
            syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    },
    [chatId, filePath, syncEditorBufferMutation]
  );

  const clearDirtyBuffer = useCallback(async () => {
    clearSyncTimer();
    if (!dirtyRef.current) {
      return;
    }
    dirtyRef.current = false;
    setIsDirty(false);
    await syncEditorBuffer({ isDirty: false });
  }, [clearSyncTimer, syncEditorBuffer]);

  const discardDraft = useCallback(() => {
    setDraftContent(initialContentRef.current);
    setIsDirty(false);
    dirtyRef.current = false;
  }, []);

  useEffect(() => {
    const nextContent = data?.content ?? "";
    initialContentRef.current = nextContent;
    setDraftContent(nextContent);
    setIsDirty(false);
    dirtyRef.current = false;
  }, [data?.content, filePath]);

  useEffect(() => {
    return () => {
      clearSyncTimer();
      if (dirtyRef.current) {
        void syncEditorBuffer({ isDirty: false });
      }
    };
  }, [clearSyncTimer, syncEditorBuffer]);

  // If no chat session, we can't read files (backend requirement)
  if (!chatId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">
        <div className="max-w-xs">
          Please start a chat session to view files.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full animate-pulse items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading content...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-destructive/10 p-6 text-destructive text-sm">
        Error: {error.message}
      </div>
    );
  }

  const onDraftChange = (value: string | undefined) => {
    const next = value ?? "";
    setDraftContent(next);
    if (!draftModeEnabled) {
      return;
    }
    const nextDirty = next !== initialContentRef.current;
    setIsDirty(nextDirty);
    if (!nextDirty) {
      clearSyncTimer();
      if (dirtyRef.current) {
        dirtyRef.current = false;
        syncEditorBuffer({ isDirty: false });
      }
      return;
    }
    dirtyRef.current = true;
    clearSyncTimer();
    syncTimerRef.current = setTimeout(() => {
      syncEditorBuffer({ isDirty: true, content: next });
    }, DIRTY_SYNC_DEBOUNCE_MS);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
        <p className="text-muted-foreground text-xs">
          {draftModeEnabled
            ? "Draft mode syncs unsaved buffer to agent (not saved to disk)."
            : "Viewer mode (read-only)."}
        </p>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700">
              Unsaved draft
            </span>
          )}
          <button
            className="rounded-md border px-2 py-1 font-medium text-xs hover:bg-muted"
            onClick={() => {
              if (draftModeEnabled) {
                discardDraft();
                clearDirtyBuffer();
                setDraftModeEnabled(false);
                return;
              }
              setDraftModeEnabled(true);
            }}
            type="button"
          >
            {draftModeEnabled ? "Discard Draft" : "Enable Draft"}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          defaultLanguage={getLanguage(filePath)}
          height="100%"
          onChange={onDraftChange}
          options={{
            readOnly: !draftModeEnabled,
            minimap: { enabled: true, scale: 0.5 },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            scrollBeyondLastLine: false,
            padding: { top: 16, bottom: 16 },
          }}
          theme="vs-dark"
          value={draftContent}
        />
      </div>
    </div>
  );
}

function getLanguage(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
    case "jsonc":
      return "json";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "md":
    case "mdx":
    case "markdown":
      return "markdown";
    case "py":
      return "python";
    case "rust":
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "c":
    case "cpp":
    case "h":
      return "cpp";
    case "sh":
    case "bash":
      return "shell";
    case "yml":
    case "yaml":
      return "yaml";
    case "xml":
      return "xml";
    case "sql":
      return "sql";
    default:
      return "plaintext";
  }
}
