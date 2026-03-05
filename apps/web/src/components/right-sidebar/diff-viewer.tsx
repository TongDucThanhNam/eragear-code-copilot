import { useMemo } from "react";
import { FileDiffView } from "@/components/chat-ui/file-diff-view";
import { useDiffStore } from "@/store/diff-store";

export function DiffViewer() {
  const diffs = useDiffStore((state) => state.diffs);

  const sortedDiffs = useMemo(() => {
    return Object.values(diffs).sort((a, b) => a.path.localeCompare(b.path));
  }, [diffs]);

  if (sortedDiffs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground text-sm">
        No changes in this session.
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="flex min-h-full flex-col">
        {sortedDiffs.map((diff) => (
          <div className="border-b last:border-b-0" key={diff.path}>
            <div className="overflow-x-auto text-[13px]">
              <FileDiffView
                filename={diff.path}
                modified={diff.newText}
                original={diff.oldText}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
