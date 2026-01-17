import { File, Folder, Tree } from "@/components/ui/file-tree";
import { type FileNode, useFileStore } from "@/store/file-store";

export function FileTree() {
  const { getFileTree } = useFileStore();
  const { setSelectedFile, selectedFile } = useFileStore();
  const files = getFileTree();

  const renderFileNode = (item: FileNode) => {
    const nodeId = item.path;
    const isSelected = selectedFile === item.path;

    if (item.type === "folder") {
      return (
        <Folder
          element={item.name}
          isSelect={isSelected}
          key={nodeId}
          value={nodeId}
        >
          {item.children?.map((child) => renderFileNode(child))}
        </Folder>
      );
    }

    return (
      <File
        isSelect={isSelected}
        key={nodeId}
        onClick={() => setSelectedFile(item.path)}
        value={nodeId}
      >
        {item.name}
      </File>
    );
  };

  return (
    <Tree initialSelectedId={selectedFile ?? undefined}>
      {files.map((item) => renderFileNode(item))}
    </Tree>
  );
}
