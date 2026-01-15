import { create } from "zustand";

export type FileNode = {
	name: string;
	path: string;
	type: "file" | "folder";
	children?: FileNode[];
};

type FileStoreState = {
	files: string[];
	selectedFile: string | null;
	setFiles: (files: string[]) => void;
	setSelectedFile: (file: string | null) => void;
	getFileTree: () => FileNode[];
};

export const useFileStore = create<FileStoreState>((set, get) => ({
	files: [],
	selectedFile: null,
	setFiles: (files) => set({ files }),
	setSelectedFile: (file) => set({ selectedFile: file }),
	getFileTree: () => {
		const files = get().files;
		const root: FileNode[] = [];

		for (const path of files) {
			const parts = path.split("/");
			let currentLevel = root;
			let currentPath = "";

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				const isFile = i === parts.length - 1;
				currentPath = currentPath ? `${currentPath}/${part}` : part;

				let existingNode = currentLevel.find((node) => node.name === part);

				if (!existingNode) {
					existingNode = {
						name: part,
						path: currentPath,
						type: isFile ? "file" : "folder",
						children: isFile ? undefined : [],
					};
					currentLevel.push(existingNode);
				}

				if (!isFile) {
					// safe cast because we initialized it with [] if !isFile
					currentLevel = existingNode.children!;
				}
			}
		}

		// Sort: folders first, then files
		const sortNodes = (nodes: FileNode[]) => {
			nodes.sort((a, b) => {
				if (a.type === b.type) return a.name.localeCompare(b.name);
				return a.type === "folder" ? -1 : 1;
			});
			nodes.forEach((node) => {
				if (node.children) sortNodes(node.children);
			});
		};

		sortNodes(root);

		return root;
	},
}));
