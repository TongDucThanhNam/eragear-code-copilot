import { X } from "lucide-react";
import { FileContentLoader } from "@/components/chat-ui/code-viewer/file-content-loader";
import { useFileStore } from "@/store/file-store";

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
