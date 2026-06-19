import {
  FileTree as PierreFileTree,
  useFileTree,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { FileIcon } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { useFileStore } from "@/store/file-store";

type TreeStyle = CSSProperties & Record<`--${string}`, string | number>;

const TREE_STYLE = {
  "--trees-bg-override": "transparent",
  "--trees-bg-muted-override": "var(--accent)",
  "--trees-border-color-override": "var(--border)",
  "--trees-border-radius-override": "calc(var(--radius) - 2px)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "0.8125rem",
  "--trees-item-margin-x-override": "0.375rem",
  "--trees-padding-inline-override": "0.25rem",
  "--trees-search-bg-override": "var(--background)",
  "--trees-search-fg-override": "var(--foreground)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
  height: "100%",
  minHeight: 0,
} satisfies TreeStyle;

export function FileTree() {
  const files = useFileStore((state) => state.files);
  const selectedFile = useFileStore((state) => state.selectedFile);
  const setSelectedFile = useFileStore((state) => state.setSelectedFile);

  const paths = useMemo(
    () => [...new Set(files)].sort((left, right) => left.localeCompare(right)),
    [files]
  );
  const fileSet = useMemo(() => new Set(paths), [paths]);
  const initialSelectedPaths = useMemo(
    () => (selectedFile && fileSet.has(selectedFile) ? [selectedFile] : []),
    [fileSet, selectedFile]
  );
  const initialExpandedPaths = useMemo(
    () =>
      selectedFile && fileSet.has(selectedFile)
        ? getAncestorDirectoryPaths(selectedFile)
        : undefined,
    [fileSet, selectedFile]
  );

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    icons: { colored: true, set: "standard" },
    initialExpansion: 1,
    initialExpandedPaths,
    initialSelectedPaths,
    paths,
    search: true,
    searchBlurBehavior: "retain",
    stickyFolders: true,
  });

  const selectedPaths = useFileTreeSelection(model);
  const previousPathsRef = useRef(paths);

  useEffect(() => {
    if (arePathListsEqual(previousPathsRef.current, paths)) {
      return;
    }

    model.resetPaths(paths);
    previousPathsRef.current = paths;
  }, [model, paths]);

  useEffect(() => {
    const nextSelectedFile =
      [...selectedPaths].reverse().find((path) => fileSet.has(path)) ?? null;

    if (nextSelectedFile !== selectedFile) {
      setSelectedFile(nextSelectedFile);
    }
  }, [fileSet, selectedFile, selectedPaths, setSelectedFile]);

  useEffect(() => {
    const currentSelectedPaths = model.getSelectedPaths();

    if (!(selectedFile && fileSet.has(selectedFile))) {
      for (const path of currentSelectedPaths) {
        model.getItem(path)?.deselect();
      }
      return;
    }

    if (
      currentSelectedPaths.length === 1 &&
      currentSelectedPaths[0] === selectedFile
    ) {
      return;
    }

    for (const path of currentSelectedPaths) {
      model.getItem(path)?.deselect();
    }

    const selectedItem = model.getItem(selectedFile);
    selectedItem?.select();
    selectedItem?.focus();
    model.scrollToPath(selectedFile, { focus: false, offset: "nearest" });
  }, [fileSet, model, selectedFile]);

  if (paths.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-9 items-center justify-center rounded-md border bg-background text-muted-foreground">
          <FileIcon className="size-4" />
        </div>
        <p className="max-w-[18rem] text-muted-foreground text-sm leading-6">
          No files in this session yet.
        </p>
      </div>
    );
  }

  return (
    <PierreFileTree
      className="block h-full min-h-0 overflow-hidden bg-transparent pt-2 pb-3"
      model={model}
      style={TREE_STYLE}
    />
  );
}

function arePathListsEqual(left: readonly string[], right: readonly string[]) {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function getAncestorDirectoryPaths(path: string) {
  const segments = path.split("/").slice(0, -1);
  const ancestors: string[] = [];

  for (let index = 0; index < segments.length; index++) {
    ancestors.push(segments.slice(0, index + 1).join("/"));
  }

  return ancestors;
}
