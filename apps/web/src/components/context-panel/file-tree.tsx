import { ChevronRight, File, Folder } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type FileNode, useFileStore } from "@/store/file-store";

export function FileTree() {
  const { getFileTree } = useFileStore();
  const files = getFileTree();

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-1 p-2">
        {files.map((item) => (
          <FileTreeItem item={item} key={item.name} />
        ))}
      </div>
    </ScrollArea>
  );
}

function FileTreeItem({ item, depth = 0 }: { item: FileNode; depth?: number }) {
  const paddingLeft = depth * 12 + 4;
  const setSelectedFile = useFileStore((state) => state.setSelectedFile);
  const selectedFile = useFileStore((state) => state.selectedFile);
  const isSelected = selectedFile === item.path;

  if (item.type === "folder") {
    return (
      <div>
        <div
          className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-muted/50"
          style={{ paddingLeft }}
        >
          <ChevronRight className="size-4 opacity-50" />
          <Folder className="size-4 text-blue-400" />
          <span>{item.name}</span>
        </div>
        {item.children?.map((child) => (
          <FileTreeItem depth={depth + 1} item={child} key={child.name} />
        ))}
      </div>
    );
  }

  return (
    <button
      className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-muted/50 ${
        isSelected ? "bg-muted text-foreground" : "text-muted-foreground"
      }`}
      onClick={() => setSelectedFile(item.path)}
      style={{ paddingLeft: paddingLeft + 16 }}
      type={"button"}
    >
      <File className="size-4 opacity-50" />
      <span>{item.name}</span>
    </button>
  );
}
