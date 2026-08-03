export type RepoIndexSymbolKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "component"
  | "export";

export interface RepoIndexSymbolLineInput {
  line: string;
  extension: string;
}

export interface RepoIndexSymbolLineResult {
  kind: RepoIndexSymbolKind;
  name: string;
}

const CLASS_PATTERN =
  /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const INTERFACE_PATTERN = /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/;
const TYPE_PATTERN = /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_PATTERN =
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const CONST_PATTERN =
  /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$])/;
const PYTHON_PATTERN =
  /^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)/;
const GO_FUNC_PATTERN = /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/;
const GO_TYPE_PATTERN = /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/;
const RUST_PATTERN =
  /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)|^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/;
const COMPONENT_EXTENSION_PATTERN = /\.(tsx|jsx)$/;
const COMPONENT_NAME_PATTERN = /^[A-Z]/;

export function extractRepoIndexSymbolFromLine(
  params: RepoIndexSymbolLineInput
): RepoIndexSymbolLineResult | null {
  const trimmed = params.line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) {
    return null;
  }

  return (
    extractTypeScriptSymbol(trimmed, params.extension) ??
    extractPythonSymbol(trimmed, params.extension) ??
    extractGoSymbol(trimmed, params.extension) ??
    extractRustSymbol(trimmed, params.extension)
  );
}

function extractTypeScriptSymbol(
  trimmed: string,
  extension: string
): RepoIndexSymbolLineResult | null {
  const classMatch = trimmed.match(CLASS_PATTERN);
  if (classMatch?.[1]) {
    return { kind: "class", name: classMatch[1] };
  }

  const interfaceMatch = trimmed.match(INTERFACE_PATTERN);
  if (interfaceMatch?.[1]) {
    return { kind: "interface", name: interfaceMatch[1] };
  }

  const typeMatch = trimmed.match(TYPE_PATTERN);
  if (typeMatch?.[1]) {
    return { kind: "type", name: typeMatch[1] };
  }

  const functionMatch = trimmed.match(FUNCTION_PATTERN);
  if (functionMatch?.[1]) {
    return { kind: "function", name: functionMatch[1] };
  }

  const constMatch = trimmed.match(CONST_PATTERN);
  if (constMatch?.[1]) {
    const name = constMatch[1];
    return {
      kind:
        COMPONENT_NAME_PATTERN.test(name) &&
        COMPONENT_EXTENSION_PATTERN.test(extension)
          ? "component"
          : "export",
      name,
    };
  }

  return null;
}

function extractPythonSymbol(
  trimmed: string,
  extension: string
): RepoIndexSymbolLineResult | null {
  if (extension !== ".py") {
    return null;
  }
  const pythonMatch = trimmed.match(PYTHON_PATTERN);
  const name = pythonMatch?.[1] ?? pythonMatch?.[2];
  if (!name) {
    return null;
  }
  return {
    kind: trimmed.startsWith("class ") ? "class" : "function",
    name,
  };
}

function extractGoSymbol(
  trimmed: string,
  extension: string
): RepoIndexSymbolLineResult | null {
  if (extension !== ".go") {
    return null;
  }
  const goFunc = trimmed.match(GO_FUNC_PATTERN);
  if (goFunc?.[1]) {
    return { kind: "function", name: goFunc[1] };
  }
  const goType = trimmed.match(GO_TYPE_PATTERN);
  if (goType?.[1]) {
    return { kind: "type", name: goType[1] };
  }
  return null;
}

function extractRustSymbol(
  trimmed: string,
  extension: string
): RepoIndexSymbolLineResult | null {
  if (extension !== ".rs") {
    return null;
  }
  const rustMatch = trimmed.match(RUST_PATTERN);
  const name = rustMatch?.[1] ?? rustMatch?.[2];
  if (!name) {
    return null;
  }
  return {
    kind: rustMatch?.[1] ? "function" : "type",
    name,
  };
}
