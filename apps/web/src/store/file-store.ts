import { create } from "zustand";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
}

interface FileStoreState {
  files: string[];
  selectedFile: string | null;
  setFiles: (files: string[]) => void;
  setSelectedFile: (file: string | null) => void;
  getFileTree: () => FileNode[];
}

function insertPath(root: FileNode[], path: string): void {
  const parts = path.split("/");
  let currentPath = "";
  let currentLevel = root;
  const partsLen = parts.length;

  for (let i = 0; i < partsLen; i++) {
    const part = parts[i];
    const isFile = i === partsLen - 1;
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    let node = currentLevel.find((n) => n.name === part);
    if (!node) {
      node = {
        name: part,
        path: currentPath,
        type: isFile ? "file" : "folder",
        children: isFile ? undefined : [],
      };
      currentLevel.push(node);
    }

    if (!isFile && node.children) {
      currentLevel = node.children;
    }
  }
}

function buildFileTree(files: string[]): FileNode[] {
  const root: FileNode[] = [];

  for (const path of files) {
    insertPath(root, path);
  }

  return root;
}

function sortNodes(nodes: FileNode[]): void {
  nodes.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === "folder" ? -1 : 1;
  });

  for (const node of nodes) {
    if (node.children) {
      sortNodes(node.children);
    }
  }
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  files: [],
  selectedFile: null,
  setFiles: (files) => set({ files }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  getFileTree: () => {
    const root = buildFileTree(get().files);
    sortNodes(root);
    return root;
  },
}));
