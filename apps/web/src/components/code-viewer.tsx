import { trpc } from "@/lib/trpc";
import { Route as IndexRoute } from "@/routes/index";
import { useFileStore } from "@/store/file-store";
import Editor from "@monaco-editor/react";
import { Loader2, X } from "lucide-react";

export function CodeViewer() {
	const selectedFile = useFileStore((state) => state.selectedFile);
	const setSelectedFile = useFileStore((state) => state.setSelectedFile);

	const closeFile = () => setSelectedFile(null);

	return (
		<div className="flex flex-col h-full w-full bg-background border-r">
			<div className="flex items-center justify-between px-4 py-2 border-b h-12 bg-muted/20">
				<span className="text-sm font-medium truncate font-mono">
					{selectedFile}
				</span>
				<button
					type="button"
					onClick={closeFile}
					className="p-1 hover:bg-muted rounded-md duration-200"
				>
					<X className="size-4 opacity-70" />
				</button>
			</div>
			<div className="flex-1 relative min-h-0 bg-[#1e1e1e]">
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
		},
	);

	// If no chat session, we can't read files (backend requirement)
	if (!chatId) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-muted-foreground text-center">
				<div className="max-w-xs">
					Please start a chat session to view files.
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground animate-pulse">
				<Loader2 className="size-5 animate-spin mr-2" />
				Loading content...
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-destructive text-sm bg-destructive/10">
				Error: {error.message}
			</div>
		);
	}

	return (
		<Editor
			height="100%"
			defaultLanguage={getLanguage(filePath)}
			value={data?.content}
			theme="vs-dark"
			options={{
				readOnly: true,
				minimap: { enabled: true, scale: 0.5 },
				fontSize: 13,
				fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
				scrollBeyondLastLine: false,
				padding: { top: 16, bottom: 16 },
			}}
		/>
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
