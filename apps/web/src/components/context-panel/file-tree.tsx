import { useState } from "react";
import {
  FileTree as FileTreeComponent,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import { type FileNode, useFileStore } from "@/store/file-store";

export function FileTree() {
  const { getFileTree } = useFileStore();
  const { setSelectedFile, selectedFile } = useFileStore();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const files = getFileTree();

  const renderFileNode = (item: FileNode) => {
    const itemPath = item.path;

    if (item.type === "folder") {
      return (
        <FileTreeFolder key={itemPath} name={item.name} path={itemPath}>
          {item.children?.map((child) => renderFileNode(child))}
        </FileTreeFolder>
      );
    }

    return <FileTreeFile key={itemPath} name={item.name} path={itemPath} />;
  };

  return (
    <FileTreeComponent
      className="h-full"
      expanded={expandedPaths}
      onExpandedChange={setExpandedPaths}
      onSelect={(path: string) => setSelectedFile(path)}
      selectedPath={selectedFile ?? undefined}
    >
      {files.map((item) => renderFileNode(item))}
    </FileTreeComponent>
  );
}
