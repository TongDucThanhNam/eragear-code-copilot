import { useDiffStore } from "@/store/diff-store";
import { useMemo } from "react";
import { FileDiffView } from "@/components/chat-ui/file-diff-view";

export function DiffViewer() {
	const diffs = useDiffStore((state) => state.diffs);

	const sortedDiffs = useMemo(() => {
		return Object.values(diffs).sort((a, b) => a.path.localeCompare(b.path));
	}, [diffs]);

	if (sortedDiffs.length === 0) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-muted-foreground text-center text-sm">
				No changes in this session.
			</div>
		);
	}

	return (
		<div className="absolute inset-0 overflow-y-auto">
			<div className="flex flex-col min-h-full">
				{sortedDiffs.map((diff) => (
					<div key={diff.path} className="border-b last:border-b-0">
						<div className="text-[13px] overflow-x-auto">
							<FileDiffView
								filename={diff.path}
								original={diff.oldText}
								modified={diff.newText}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
