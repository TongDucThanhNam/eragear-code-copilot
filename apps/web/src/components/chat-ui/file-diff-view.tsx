"use client";

import { useTheme } from "next-themes";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";

interface FileDiffViewProps {
	original?: string;
	modified: string;
	filename: string;
}

export function FileDiffView({
	original = "",
	modified,
	filename,
}: FileDiffViewProps) {
	const { resolvedTheme } = useTheme();

	const fileDiff = useMemo(() => {
		return parseDiffFromFile(
			{ name: filename, contents: original || "" },
			{ name: filename, contents: modified || "" },
		);
	}, [filename, original, modified]);

	return (
		<FileDiff
			fileDiff={fileDiff}
			options={{
				theme: resolvedTheme === "dark" ? "github-dark" : "github-light",
				diffStyle: "split",
				disableBackground: false,
				hunkSeparators: "simple",
			}}
		/>
	);
}
