import { useMemo } from "react";
import { useDiffStore } from "@/store/diff-store";

export function ChangedFilesViewer() {
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
      <ul className="flex min-h-full flex-col">
        {sortedDiffs.map((diff) => (
          <li
            className="border-b px-3 py-2 font-mono text-xs last:border-b-0"
            key={diff.path}
            title={diff.path}
          >
            <span className="block truncate">{diff.path}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
