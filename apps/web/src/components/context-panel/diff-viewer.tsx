import { trpc } from "@/lib/trpc";
import { Route as IndexRoute } from "@/routes/index";
import {
	type FileDiffMetadata,
	type ParsedPatch,
	parsePatchFiles,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";

export function DiffViewer() {
	const { chatId } = IndexRoute.useSearch();

	if (!chatId) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-muted-foreground text-center text-sm">
				Start a chat session to view changes.
			</div>
		);
	}

	return <DiffLoader chatId={chatId} />;
}

function DiffLoader({ chatId }: { chatId: string }) {
	const {
		data: patchString,
		isLoading,
		error,
	} = trpc.getGitDiff.useQuery({ chatId }, { refetchOnWindowFocus: true });

	const parsedPatches = useMemo(() => {
		if (!patchString) return [];
		// The backend returns a unified patch string
		// If it's empty, parsePatchFiles calculates []
		try {
			// Type assertion as trpc inference might still think it's the old type
			// until full rebuild/type-check update, but runtime it's string.
			// Actually pure string in implementation plan.
			return parsePatchFiles(patchString as unknown as string);
		} catch (e) {
			console.error("Failed to parse patch", e);
			return [];
		}
	}, [patchString]);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<Loader2 className="size-5 animate-spin mr-2" />
				Loading changes...
			</div>
		);
	}

	if (error) {
		return (
			<div className="p-4 text-destructive text-sm">
				Error loading diffs: {error.message}
				<br />
				<span className="text-xs text-muted-foreground mt-2 block">
					Make sure this is a git repository.
				</span>
			</div>
		);
	}

	if (parsedPatches.length === 0) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-muted-foreground text-sm">
				No changes found in working directory.
			</div>
		);
	}

	return (
		<div className="absolute inset-0 overflow-y-auto">
			<div className="flex flex-col min-h-full">
				{parsedPatches.map((patch, index) => (
					<div key={index} className="border-b last:border-b-0">
						{patch.files.map((fileDiff: FileDiffMetadata) => {
							const key = fileDiff.name || "unknown";
							return (
								<div key={key} className="text-[13px] overflow-x-auto">
									<FileDiff
										fileDiff={fileDiff}
										options={{
											theme: "github-dark",
											diffStyle: "unified",
											disableBackground: false,
										}}
									/>
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}
