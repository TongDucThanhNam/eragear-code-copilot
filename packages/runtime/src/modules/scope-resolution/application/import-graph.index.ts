import fs from "node:fs/promises";
import path from "node:path";
import {
  canHaveModifiers,
  createSourceFile,
  forEachChild,
  getModifiers,
  isClassDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamedExports,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableStatement,
  type NamedExportBindings,
  type Node,
  ScriptKind,
  ScriptTarget,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
} from "typescript";
import type {
  RepoSnapshotIndexData,
  RepoSnapshotIndexFile,
} from "#runtime/modules/repo-snapshot-indexing";
import type {
  ScopeImportGraphIndex,
  ScopeImportGraphNode,
  ScopeImportGraphPort,
  ScopeImportGraphSymbol,
  ScopeRouteMapEntry,
} from "./ports/scope-import-graph.port";

const GRAPH_PARSE_MAX_BYTES = 512_000;
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx"]);
const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const ROUTE_INDEX_SUFFIX_PATTERN = /\/index$/;
const ROUTE_PARAM_SEGMENT_PATTERN = /\[[^\]]+\]/g;
const NON_ROUTE_TOKEN_PATTERN = /[^a-zA-Z0-9]+/g;
const TYPESCRIPT_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/;
const ROOT_FILE_NAMES = new Set([
  "index.ts",
  "index.tsx",
  "main.ts",
  "main.tsx",
  "app.ts",
  "app.tsx",
  "router.ts",
  "router.tsx",
]);

interface ReadSourceInput {
  absolutePath: string;
  file: RepoSnapshotIndexFile;
}

interface ScopeImportGraphServiceDeps {
  readSource?: (input: ReadSourceInput) => Promise<string | null>;
  now?: () => string;
}

export class ScopeImportGraphService implements ScopeImportGraphPort {
  private readonly cache = new Map<
    string,
    { fingerprint: string; graph: ScopeImportGraphIndex }
  >();
  private readonly readSource: (
    input: ReadSourceInput
  ) => Promise<string | null>;
  private readonly now: () => string;

  constructor(deps: ScopeImportGraphServiceDeps = {}) {
    this.readSource = deps.readSource ?? readIndexedSourceFromDisk;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async getGraph(data: RepoSnapshotIndexData): Promise<ScopeImportGraphIndex> {
    const fingerprint = createIndexFingerprint(data);
    const cached = this.cache.get(data.projectRoot);
    if (cached?.fingerprint === fingerprint) {
      return cached.graph;
    }

    const graph = await buildScopeImportGraphIndex(data, {
      now: this.now,
      readSource: this.readSource,
    });
    this.cache.set(data.projectRoot, { fingerprint, graph });
    return graph;
  }

  invalidateFile(input: { projectRoot: string; path: string }): void {
    this.cache.delete(input.projectRoot);
  }
}

export async function buildScopeImportGraphIndex(
  data: RepoSnapshotIndexData,
  options: ScopeImportGraphServiceDeps = {}
): Promise<ScopeImportGraphIndex> {
  const now = options.now ?? (() => new Date().toISOString());
  const readSource = options.readSource ?? readIndexedSourceFromDisk;
  const diagnostics: string[] = [];
  const fileSet = new Set(
    data.index.files.map((file) => normalizeSlash(file.path))
  );
  const nodesByPath = new Map<string, ScopeImportGraphNode>();

  for (const file of data.index.files) {
    const normalizedPath = normalizeSlash(file.path);
    if (!TYPESCRIPT_EXTENSIONS.has(file.extension)) {
      continue;
    }
    if (file.sizeBytes > GRAPH_PARSE_MAX_BYTES) {
      diagnostics.push(
        `importGraphSkippedBySize: ${normalizedPath} exceeded ${GRAPH_PARSE_MAX_BYTES} bytes.`
      );
      continue;
    }

    const absolutePath = resolveIndexedFilePath(
      data.projectRoot,
      normalizedPath
    );
    if (!absolutePath) {
      diagnostics.push(`importGraphSkippedOutsideRoot: ${normalizedPath}`);
      continue;
    }

    const source = await readSource({ absolutePath, file });
    if (source === null) {
      diagnostics.push(`importGraphSourceUnavailable: ${normalizedPath}`);
      continue;
    }

    const parsed = parseTypeScriptFile({
      filePath: normalizedPath,
      fileSet,
      source,
    });
    const routeKey = routeKeyForPath(normalizedPath);
    nodesByPath.set(normalizedPath, {
      path: normalizedPath,
      imports: parsed.imports,
      exports: parsed.exports,
      importedBy: [],
      symbols: parsed.symbols,
      workspace: workspaceForPath(normalizedPath),
      ...(routeKey ? { routeKey } : {}),
      reachableFromRoots: false,
    });
  }

  for (const node of nodesByPath.values()) {
    for (const importPath of node.imports) {
      const imported = nodesByPath.get(importPath);
      if (imported) {
        imported.importedBy.push(node.path);
      }
    }
  }

  const rootPaths = [...nodesByPath.values()]
    .filter((node) => isRootOrRouteNode(node))
    .map((node) => node.path);
  const reachable = computeReachability(rootPaths, nodesByPath);
  for (const pathName of reachable) {
    const node = nodesByPath.get(pathName);
    if (node) {
      node.reachableFromRoots = true;
    }
  }

  const routeMap: ScopeRouteMapEntry[] = [...nodesByPath.values()]
    .filter((node) => node.routeKey)
    .map((node) => ({
      path: node.path,
      routeKey: node.routeKey ?? "",
      workspace: node.workspace,
      exportedSymbols: node.exports,
    }));

  return {
    importGraph: true,
    projectRoot: data.projectRoot,
    indexedAt: now(),
    nodes: [...nodesByPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
    routeMap,
    diagnostics,
  };
}

export function buildScopeImportGraphIndexFromSources(params: {
  projectRoot: string;
  files: RepoSnapshotIndexFile[];
  sources: Record<string, string>;
  now?: () => string;
}): Promise<ScopeImportGraphIndex> {
  return buildScopeImportGraphIndex(
    {
      projectRoot: params.projectRoot,
      index: {
        storagePath: path.join(
          params.projectRoot,
          ".eragear",
          "repo-index.json"
        ),
        indexedAt: params.now?.(),
        indexedFiles: params.files.length,
        totalBytes: params.files.reduce((sum, file) => sum + file.sizeBytes, 0),
        semantic: {
          status: "ready",
          profiledFiles: params.files.length,
          tokenCount: 0,
          source: "local-token-profile",
        },
        extensions: [],
        files: params.files,
        symbols: [],
        tasks: [],
        diagnostics: [],
      },
    },
    {
      now: params.now,
      readSource: async ({ file }) =>
        params.sources[normalizeSlash(file.path)] ?? null,
    }
  );
}

interface ParsedTypeScriptFile {
  imports: string[];
  exports: string[];
  symbols: ScopeImportGraphSymbol[];
}

function parseTypeScriptFile(params: {
  filePath: string;
  fileSet: ReadonlySet<string>;
  source: string;
}): ParsedTypeScriptFile {
  const scriptKind = params.filePath.endsWith(".tsx")
    ? ScriptKind.TSX
    : ScriptKind.TS;
  const sourceFile = createSourceFile(
    params.filePath,
    params.source,
    ScriptTarget.Latest,
    true,
    scriptKind
  );
  const imports = new Set<string>();
  const exports = new Set<string>();
  const symbols: ScopeImportGraphSymbol[] = [];

  const visit = (node: Node) => {
    collectModuleImport({
      node,
      filePath: params.filePath,
      fileSet: params.fileSet,
      imports,
    });
    collectNamedExports(node, exports);
    collectDeclarationSymbol({
      node,
      sourceFile,
      filePath: params.filePath,
      symbols,
      exports,
    });
    collectVariableSymbols({
      node,
      sourceFile,
      filePath: params.filePath,
      symbols,
      exports,
    });
    forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    imports: [...imports].sort(),
    exports: [...exports].sort(),
    symbols: dedupeSymbols(symbols),
  };
}

function collectModuleImport(params: {
  node: Node;
  filePath: string;
  fileSet: ReadonlySet<string>;
  imports: Set<string>;
}): void {
  if (!(isImportDeclaration(params.node) || isExportDeclaration(params.node))) {
    return;
  }
  const moduleSpecifier = params.node.moduleSpecifier;
  if (!(moduleSpecifier && isStringLiteral(moduleSpecifier))) {
    return;
  }
  const resolved = resolveImportPath({
    filePath: params.filePath,
    fileSet: params.fileSet,
    specifier: moduleSpecifier.text,
  });
  if (resolved) {
    params.imports.add(resolved);
  }
}

function collectNamedExports(node: Node, exports: Set<string>): void {
  if (isExportDeclaration(node) && node.exportClause) {
    collectExportNames(node.exportClause, exports);
  }
}

function collectDeclarationSymbol(params: {
  node: Node;
  sourceFile: SourceFile;
  filePath: string;
  symbols: ScopeImportGraphSymbol[];
  exports: Set<string>;
}): void {
  const symbol = symbolFromNode(
    params.sourceFile,
    params.node,
    params.filePath
  );
  if (!symbol) {
    return;
  }
  params.symbols.push(symbol);
  if (hasExportModifier(params.node)) {
    params.exports.add(symbol.name);
  }
}

function collectVariableSymbols(params: {
  node: Node;
  sourceFile: SourceFile;
  filePath: string;
  symbols: ScopeImportGraphSymbol[];
  exports: Set<string>;
}): void {
  if (!isVariableStatement(params.node)) {
    return;
  }
  for (const declaration of params.node.declarationList.declarations) {
    if (!isIdentifier(declaration.name)) {
      continue;
    }
    const variableSymbol = symbolFromVariableDeclaration(
      params.sourceFile,
      declaration,
      params.filePath
    );
    if (!variableSymbol) {
      continue;
    }
    params.symbols.push(variableSymbol);
    if (hasExportModifier(params.node)) {
      params.exports.add(variableSymbol.name);
    }
  }
}

function collectExportNames(
  exportClause: NamedExportBindings,
  exports: Set<string>
): void {
  if (isNamedExports(exportClause)) {
    for (const element of exportClause.elements) {
      exports.add(element.name.text);
    }
    return;
  }
  exports.add(exportClause.name.text);
}

function symbolFromNode(
  sourceFile: SourceFile,
  node: Node,
  filePath: string
): ScopeImportGraphSymbol | null {
  if (isFunctionDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind:
        filePath.endsWith(".tsx") && isComponentName(node.name.text)
          ? "component"
          : "function",
      line: lineOf(sourceFile, node),
    };
  }
  if (isClassDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: "class",
      line: lineOf(sourceFile, node),
    };
  }
  if (isInterfaceDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "interface",
      line: lineOf(sourceFile, node),
    };
  }
  if (isTypeAliasDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "type",
      line: lineOf(sourceFile, node),
    };
  }
  return null;
}

function symbolFromVariableDeclaration(
  sourceFile: SourceFile,
  declaration: VariableDeclaration,
  filePath: string
): ScopeImportGraphSymbol | null {
  if (!isIdentifier(declaration.name)) {
    return null;
  }
  const name = declaration.name.text;
  return {
    name,
    kind:
      filePath.endsWith(".tsx") && isComponentName(name)
        ? "component"
        : "export",
    line: lineOf(sourceFile, declaration),
  };
}

function hasExportModifier(node: Node): boolean {
  return Boolean(
    canHaveModifiers(node) &&
      getModifiers(node)?.some(
        (modifier) => modifier.kind === SyntaxKind.ExportKeyword
      )
  );
}

function dedupeSymbols(
  symbols: ScopeImportGraphSymbol[]
): ScopeImportGraphSymbol[] {
  const byKey = new Map<string, ScopeImportGraphSymbol>();
  for (const symbol of symbols) {
    byKey.set(`${symbol.kind}:${symbol.name}:${symbol.line}`, symbol);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.line - right.line || left.name.localeCompare(right.name)
  );
}

function lineOf(sourceFile: SourceFile, node: Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function isComponentName(value: string): boolean {
  return COMPONENT_NAME_PATTERN.test(value);
}

function resolveImportPath(params: {
  filePath: string;
  fileSet: ReadonlySet<string>;
  specifier: string;
}): string | null {
  if (!params.specifier.startsWith(".")) {
    return null;
  }
  const fromDir = path.posix.dirname(normalizeSlash(params.filePath));
  const normalizedBase = normalizeSlash(
    path.posix.normalize(path.posix.join(fromDir, params.specifier))
  );
  const candidates = [
    normalizedBase,
    `${normalizedBase}.ts`,
    `${normalizedBase}.tsx`,
    `${normalizedBase}.js`,
    `${normalizedBase}.jsx`,
    `${normalizedBase}/index.ts`,
    `${normalizedBase}/index.tsx`,
  ];
  return candidates.find((candidate) => params.fileSet.has(candidate)) ?? null;
}

function computeReachability(
  roots: string[],
  nodesByPath: ReadonlyMap<string, ScopeImportGraphNode>
): Set<string> {
  const visited = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const node = nodesByPath.get(current);
    if (!node) {
      continue;
    }
    for (const importPath of node.imports) {
      if (!visited.has(importPath)) {
        stack.push(importPath);
      }
    }
  }
  return visited;
}

function isRootOrRouteNode(node: ScopeImportGraphNode): boolean {
  const basename = path.posix.basename(node.path);
  return (
    ROOT_FILE_NAMES.has(basename) ||
    node.path.includes("/routes/") ||
    node.path.includes("/app/")
  );
}

function routeKeyForPath(filePath: string): string | null {
  const normalized = normalizeSlash(filePath);
  let routeSegment: string | undefined;
  if (normalized.includes("/routes/")) {
    routeSegment = normalized.split("/routes/")[1];
  } else if (normalized.includes("/app/")) {
    routeSegment = normalized.split("/app/")[1];
  }
  if (!routeSegment) {
    return null;
  }
  return stripExtension(routeSegment)
    .replace(ROUTE_INDEX_SUFFIX_PATTERN, "")
    .replace(ROUTE_PARAM_SEGMENT_PATTERN, "param")
    .replace(NON_ROUTE_TOKEN_PATTERN, " ")
    .trim()
    .toLowerCase();
}

function workspaceForPath(filePath: string): string {
  const parts = normalizeSlash(filePath).split("/");
  if (parts[0] === "apps" && parts[1]) {
    return `apps/${parts[1]}`;
  }
  if (parts[0] === "packages" && parts[1]) {
    return `packages/${parts[1]}`;
  }
  return parts[0] ?? "";
}

function stripExtension(value: string): string {
  return value.replace(TYPESCRIPT_EXTENSION_PATTERN, "");
}

function createIndexFingerprint(data: RepoSnapshotIndexData): string {
  return data.index.files
    .map((file) =>
      [
        normalizeSlash(file.path),
        file.modifiedAt ?? "",
        String(file.sizeBytes),
        file.semanticHash ?? "",
      ].join(":")
    )
    .sort()
    .join("|");
}

async function readIndexedSourceFromDisk({
  absolutePath,
}: ReadSourceInput): Promise<string | null> {
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
}

function resolveIndexedFilePath(
  projectRoot: string,
  relativePath: string
): string | null {
  const absoluteRoot = path.resolve(projectRoot);
  const absoluteFile = path.resolve(absoluteRoot, relativePath);
  if (
    absoluteFile !== absoluteRoot &&
    !absoluteFile.startsWith(`${absoluteRoot}${path.sep}`)
  ) {
    return null;
  }
  return absoluteFile;
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/");
}
