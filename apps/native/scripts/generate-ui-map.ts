#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

const HELP_TEXT = `Usage: bun scripts/generate-ui-map.ts [options]

Options:
  --src <path>             Source directory (default: .)
  --entry <path>           Entry file (default: app/_layout.tsx)
  --out <path>             Optional output base path (writes .ascii.txt/.mmd/.json)
  --format <kind>          stdout format: ascii|mermaid|json|all|bundle (default: ascii)
  --rootComponent <name>   Root component name override
  --alias <key=value>      Path aliases, repeatable (default: @=.)
  --focus <name>           Focus on a specific component
  --scope <mode>           Focus scope: up|full|down (default: down)
                             up   = ancestors → target (children collapsed)
                             full = ancestors → target → full subtree
                             down = target as root → full subtree
  --layoutOnly             Keep only layout-relevant class/style signals
  -h, --help               Show this help
`;

const DEFAULT_SRC = ".";
const DEFAULT_ENTRY = "app/_layout.tsx";
const DEFAULT_ALIASES = ["@=."];
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const PROJECT_ROOT = process.cwd();

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		src: { type: "string", default: DEFAULT_SRC },
		entry: { type: "string", default: DEFAULT_ENTRY },
		out: { type: "string" },
		format: { type: "string", default: "ascii" },
		rootComponent: { type: "string" },
		alias: { type: "string", multiple: true, default: DEFAULT_ALIASES },
		focus: { type: "string" },
		scope: { type: "string", default: "down" },
		layoutOnly: { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
	strict: true,
});

if (values.help) {
	console.log(HELP_TEXT);
	process.exit(0);
}

const validFormats = new Set(["ascii", "mermaid", "json", "all", "bundle"]);
if (!validFormats.has(values.format ?? "ascii")) {
	console.error(
		`Error: --format must be one of ${[...validFormats].join(", ")}`,
	);
	process.exit(1);
}

const validScopes = new Set(["up", "full", "down"]);
if (!validScopes.has(values.scope ?? "down")) {
	console.error(
		`Error: --scope must be one of ${[...validScopes].join(", ")}`,
	);
	process.exit(1);
}

const srcDir = path.resolve(PROJECT_ROOT, values.src ?? DEFAULT_SRC);
const entryFile = path.resolve(PROJECT_ROOT, values.entry ?? DEFAULT_ENTRY);
const outBase = values.out ? path.resolve(PROJECT_ROOT, values.out) : null;

const aliasMap = Object.fromEntries(
	(values.alias ?? DEFAULT_ALIASES).map((pair) => {
		const index = pair.indexOf("=");
		if (index < 0) {
			return [pair, ""];
		}
		return [pair.slice(0, index), pair.slice(index + 1)];
	}),
);

const LAYOUT_CLASS_EXACT = new Set([
	"absolute",
	"contents",
	"fixed",
	"flex",
	"grid",
	"grow",
	"hidden",
	"inline",
	"relative",
	"shrink",
	"static",
	"sticky",
]);

const LAYOUT_CLASS_PREFIXES = [
	"-bottom-",
	"-inset-",
	"-left-",
	"-m-",
	"-mb-",
	"-ml-",
	"-mr-",
	"-mt-",
	"-mx-",
	"-my-",
	"-right-",
	"-top-",
	"absolute",
	"aspect-",
	"basis-",
	"bottom-",
	"col-",
	"content-",
	"display-",
	"end-",
	"flex-",
	"gap-",
	"grid-",
	"grow-",
	"h-",
	"inset-",
	"items-",
	"justify-",
	"left-",
	"m-",
	"max-h-",
	"max-w-",
	"mb-",
	"min-h-",
	"min-w-",
	"ml-",
	"mr-",
	"mt-",
	"mx-",
	"my-",
	"order-",
	"overflow-",
	"overscroll-",
	"p-",
	"pb-",
	"pe-",
	"pl-",
	"place-",
	"pr-",
	"ps-",
	"pt-",
	"px-",
	"py-",
	"right-",
	"row-",
	"self-",
	"shrink-",
	"size-",
	"space-x-",
	"space-y-",
	"start-",
	"top-",
	"w-",
	"z-",
];

const STYLE_KEYS = new Set([
	"alignContent",
	"alignItems",
	"alignSelf",
	"aspectRatio",
	"bottom",
	"display",
	"end",
	"flex",
	"flexBasis",
	"flexDirection",
	"flexGrow",
	"flexShrink",
	"flexWrap",
	"gap",
	"height",
	"inset",
	"insetBlockEnd",
	"insetBlockStart",
	"insetInlineEnd",
	"insetInlineStart",
	"justifyContent",
	"left",
	"margin",
	"marginBottom",
	"marginHorizontal",
	"marginLeft",
	"marginRight",
	"marginTop",
	"marginVertical",
	"maxHeight",
	"maxWidth",
	"minHeight",
	"minWidth",
	"overflow",
	"padding",
	"paddingBottom",
	"paddingHorizontal",
	"paddingLeft",
	"paddingRight",
	"paddingTop",
	"paddingVertical",
	"position",
	"right",
	"start",
	"top",
	"width",
	"zIndex",
]);

function rel(filePath: string) {
	return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

function parseAst(source: string, filename: string) {
	return parse(source, {
		sourceType: "module",
		sourceFilename: filename,
		plugins: [
			"jsx",
			"typescript",
			"classProperties",
			"decorators-legacy",
			"dynamicImport",
			"topLevelAwait",
		],
	});
}

function isComponentName(name: string | null | undefined) {
	return /^[A-Z][A-Za-z0-9]*$/.test(name ?? "");
}

function inferComponentName(filePath: string) {
	const ext = path.extname(filePath);
	let base = path.basename(filePath, ext);
	if (base.toLowerCase() === "index") {
		base = path.basename(path.dirname(filePath));
	}
	return base
		.split(/[^a-zA-Z0-9]+/g)
		.filter(Boolean)
		.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
		.join("");
}

function unwrapExpression(node: any): any {
	let current = node;
	while (current) {
		if (
			current.type === "ParenthesizedExpression" ||
			current.type === "TSAsExpression" ||
			current.type === "TSTypeAssertion" ||
			current.type === "TSNonNullExpression"
		) {
			current = current.expression;
			continue;
		}
		return current;
	}
	return node;
}

function jsxNameToString(nameNode: any): string | null {
	if (!nameNode) {
		return null;
	}
	if (nameNode.type === "JSXIdentifier") {
		return nameNode.name;
	}
	if (nameNode.type === "JSXMemberExpression") {
		const left = jsxNameToString(nameNode.object);
		const right = jsxNameToString(nameNode.property);
		return left && right ? `${left}.${right}` : null;
	}
	return null;
}

function sourceSlice(source: string, node: any) {
	if (!node || typeof node.start !== "number" || typeof node.end !== "number") {
		return null;
	}
	return source.slice(node.start, node.end).replace(/\s+/g, " ").trim();
}

function pushClassTokens(out: string[], value: string | null | undefined) {
	if (!value) {
		return;
	}
	for (const token of value
		.split(/\s+/)
		.map((item) => item.trim())
		.filter(Boolean)) {
		out.push(token);
	}
}

function normalizeClassTokens(tokens: string[]) {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const token of tokens) {
		if (!token || seen.has(token)) {
			continue;
		}
		seen.add(token);
		out.push(token);
	}
	return out.join(" ");
}

function isLayoutClass(token: string) {
	const base = token.replace(/^(?:[a-zA-Z0-9_-]+:)+/, "");
	if (LAYOUT_CLASS_EXACT.has(base)) {
		return true;
	}
	return LAYOUT_CLASS_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function filterLayoutClasses(className: string | null) {
	if (!className) {
		return null;
	}
	const filtered = className
		.split(/\s+/)
		.map((item) => item.trim())
		.filter(Boolean)
		.filter(isLayoutClass);
	return filtered.length > 0 ? filtered.join(" ") : null;
}

type JSImport = {
	source: string;
	kind: "default" | "named" | "namespace";
	importedName: string;
};

type RenderFlow =
	| {
			kind: "expression";
			node: any;
	  }
	| {
			kind: "branch";
			condition: any;
			thenFlow: RenderFlow | null;
			elseFlow: RenderFlow | null;
	  };

type ComponentDefinition = {
	key: string;
	name: string;
	fileAbs: string;
	fileRel: string;
	rootRender: RenderFlow | null;
	imports: Map<string, JSImport>;
	bindings: Map<string, any>;
	source: string;
	acceptsChildren: boolean;
	isDefault: boolean;
	rootLayout: string | null;
};

type TreeNode = {
	id: string;
	kind: "component" | "framework" | "text" | "branch" | "slot";
	name: string;
	fileRel?: string | null;
	module?: string | null;
	layout?: string | null;
	text?: string | null;
	recursive?: boolean;
	duplicate?: boolean;
	children: TreeNode[];
};

function collectImports(ast: any) {
	const imports = new Map<string, JSImport>();
	traverse(ast, {
		ImportDeclaration(nodePath: any) {
			const importSource = nodePath.node.source.value;
			for (const specifier of nodePath.node.specifiers ?? []) {
				if (specifier.type === "ImportDefaultSpecifier") {
					imports.set(specifier.local.name, {
						source: importSource,
						kind: "default",
						importedName: "default",
					});
					continue;
				}
				if (specifier.type === "ImportNamespaceSpecifier") {
					imports.set(specifier.local.name, {
						source: importSource,
						kind: "namespace",
						importedName: "*",
					});
					continue;
				}
				if (specifier.type === "ImportSpecifier") {
					imports.set(specifier.local.name, {
						source: importSource,
						kind: "named",
						importedName:
							specifier.imported.type === "Identifier"
								? specifier.imported.name
								: specifier.imported.value,
					});
				}
			}
		},
	});
	return imports;
}

function collectBindings(ast: any) {
	const bindings = new Map<string, any>();
	traverse(ast, {
		VariableDeclarator(nodePath: any) {
			if (
				nodePath.node.id?.type === "Identifier" &&
				nodePath.node.init &&
				!bindings.has(nodePath.node.id.name)
			) {
				bindings.set(nodePath.node.id.name, nodePath.node.init);
			}
		},
	});
	return bindings;
}

function hasChildrenParam(funcNode: any) {
	for (const param of funcNode?.params ?? []) {
		if (param.type !== "ObjectPattern") {
			continue;
		}
		for (const property of param.properties ?? []) {
			if (
				property.type === "ObjectProperty" &&
				property.key?.type === "Identifier" &&
				property.key.name === "children"
			) {
				return true;
			}
		}
	}
	return false;
}

function findJsxInExpression(node: any): any | null {
	const current = unwrapExpression(node);
	if (!current) {
		return null;
	}
	if (current.type === "JSXElement" || current.type === "JSXFragment") {
		return current;
	}
	if (current.type === "CallExpression") {
		for (const argument of current.arguments ?? []) {
			const fromArgument = findJsxInExpression(argument);
			if (fromArgument) {
				return fromArgument;
			}
		}
		return findJsxInExpression(current.callee);
	}
	if (current.type === "ArrayExpression") {
		for (const element of current.elements ?? []) {
			const fromElement = findJsxInExpression(element);
			if (fromElement) {
				return fromElement;
			}
		}
		return null;
	}
	if (
		current.type === "ConditionalExpression" ||
		current.type === "LogicalExpression" ||
		current.type === "BinaryExpression"
	) {
		return (
			findJsxInExpression(current.left) ??
			findJsxInExpression(current.right) ??
			findJsxInExpression(current.consequent) ??
			findJsxInExpression(current.alternate)
		);
	}
	if (
		current.type === "ArrowFunctionExpression" ||
		current.type === "FunctionExpression"
	) {
		return extractReturnJsx(current);
	}
	if (current.type === "ObjectExpression") {
		for (const property of current.properties ?? []) {
			if (property?.type === "ObjectProperty") {
				const fromValue = findJsxInExpression(property.value);
				if (fromValue) {
					return fromValue;
				}
			}
		}
	}
	return null;
}

function findReturnJsxInStatement(statement: any): any | null {
	if (!statement) {
		return null;
	}
	if (statement.type === "ReturnStatement") {
		return statement.argument ? findJsxInExpression(statement.argument) : null;
	}
	if (statement.type === "BlockStatement") {
		for (const child of statement.body ?? []) {
			const found = findReturnJsxInStatement(child);
			if (found) {
				return found;
			}
		}
		return null;
	}
	if (statement.type === "IfStatement") {
		return (
			findReturnJsxInStatement(statement.consequent) ??
			findReturnJsxInStatement(statement.alternate)
		);
	}
	if (statement.type === "SwitchStatement") {
		for (const switchCase of statement.cases ?? []) {
			for (const child of switchCase.consequent ?? []) {
				const found = findReturnJsxInStatement(child);
				if (found) {
					return found;
				}
			}
		}
		return null;
	}
	if (
		statement.type === "ForStatement" ||
		statement.type === "ForInStatement" ||
		statement.type === "ForOfStatement" ||
		statement.type === "WhileStatement" ||
		statement.type === "DoWhileStatement" ||
		statement.type === "LabeledStatement" ||
		statement.type === "TryStatement"
	) {
		return (
			findReturnJsxInStatement(statement.body) ??
			findReturnJsxInStatement(statement.block) ??
			findReturnJsxInStatement(statement.handler?.body) ??
			findReturnJsxInStatement(statement.finalizer)
		);
	}
	return null;
}

function extractReturnJsx(funcNode: any): any | null {
	if (
		funcNode.type === "ArrowFunctionExpression" &&
		(funcNode.body.type === "JSXElement" ||
			funcNode.body.type === "JSXFragment")
	) {
		return funcNode.body;
	}
	if (funcNode.body?.type !== "BlockStatement") {
		return findJsxInExpression(funcNode.body);
	}
	for (const statement of funcNode.body.body ?? []) {
		const found = findReturnJsxInStatement(statement);
		if (found) {
			return found;
		}
	}
	return null;
}

function createExpressionFlow(node: any): RenderFlow | null {
	const current = unwrapExpression(node);
	if (!current) {
		return null;
	}
	return {
		kind: "expression",
		node: current,
	};
}

function buildRenderFlowFromStatements(
	statements: any[],
	source: string,
	fallbackFlow: RenderFlow | null = null,
): RenderFlow | null {
	let currentFlow = fallbackFlow;
	for (let index = statements.length - 1; index >= 0; index -= 1) {
		const nextFlow = buildRenderFlowFromStatement(
			statements[index],
			source,
			currentFlow,
		);
		if (nextFlow) {
			currentFlow = nextFlow;
		}
	}
	return currentFlow;
}

function buildRenderFlowFromStatement(
	statement: any,
	source: string,
	fallbackFlow: RenderFlow | null = null,
): RenderFlow | null {
	if (!statement) {
		return fallbackFlow;
	}
	if (statement.type === "ReturnStatement") {
		return statement.argument ? createExpressionFlow(statement.argument) : null;
	}
	if (statement.type === "BlockStatement") {
		return buildRenderFlowFromStatements(
			statement.body ?? [],
			source,
			fallbackFlow,
		);
	}
	if (statement.type === "IfStatement") {
		const thenFlow =
			buildRenderFlowFromStatement(
				statement.consequent,
				source,
				fallbackFlow,
			) ?? fallbackFlow;
		const elseFlow = statement.alternate
			? (buildRenderFlowFromStatement(
					statement.alternate,
					source,
					fallbackFlow,
				) ?? fallbackFlow)
			: fallbackFlow;
		if (!thenFlow && !elseFlow) {
			return fallbackFlow;
		}
		return {
			kind: "branch",
			condition: statement.test,
			thenFlow,
			elseFlow,
		};
	}
	if (statement.type === "SwitchStatement") {
		const discriminant =
			sourceSlice(source, statement.discriminant) ?? "switch";
		let currentFlow = fallbackFlow;
		for (
			let index = (statement.cases?.length ?? 0) - 1;
			index >= 0;
			index -= 1
		) {
			const switchCase = statement.cases[index];
			const caseFlow =
				buildRenderFlowFromStatements(
					switchCase.consequent ?? [],
					source,
					currentFlow,
				) ?? currentFlow;
			if (!switchCase.test) {
				currentFlow = caseFlow;
				continue;
			}
			currentFlow = {
				kind: "branch",
				condition: `${discriminant} === ${sourceSlice(source, switchCase.test) ?? "case"}`,
				thenFlow: caseFlow,
				elseFlow: currentFlow,
			};
		}
		return currentFlow;
	}
	if (statement.type === "TryStatement") {
		const finalizerFlow = statement.finalizer
			? (buildRenderFlowFromStatement(
					statement.finalizer,
					source,
					fallbackFlow,
				) ?? fallbackFlow)
			: fallbackFlow;
		const catchFlow = statement.handler?.body
			? (buildRenderFlowFromStatement(
					statement.handler.body,
					source,
					finalizerFlow,
				) ?? finalizerFlow)
			: finalizerFlow;
		return (
			buildRenderFlowFromStatement(statement.block, source, catchFlow) ??
			catchFlow
		);
	}
	if (
		statement.type === "ForStatement" ||
		statement.type === "ForInStatement" ||
		statement.type === "ForOfStatement" ||
		statement.type === "WhileStatement" ||
		statement.type === "DoWhileStatement" ||
		statement.type === "LabeledStatement"
	) {
		return (
			buildRenderFlowFromStatement(statement.body, source, fallbackFlow) ??
			fallbackFlow
		);
	}
	return fallbackFlow;
}

function extractRenderFlow(funcNode: any, source: string): RenderFlow | null {
	if (
		funcNode.type === "ArrowFunctionExpression" &&
		(funcNode.body.type === "JSXElement" ||
			funcNode.body.type === "JSXFragment")
	) {
		return createExpressionFlow(funcNode.body);
	}
	if (funcNode.body?.type !== "BlockStatement") {
		return createExpressionFlow(funcNode.body);
	}
	return buildRenderFlowFromStatements(funcNode.body.body ?? [], source);
}

function unwrapComponentFunction(node: any): any | null {
	let current = unwrapExpression(node);
	while (current) {
		if (
			current.type === "ArrowFunctionExpression" ||
			current.type === "FunctionExpression" ||
			current.type === "FunctionDeclaration"
		) {
			return current;
		}
		if (current.type === "CallExpression") {
			const fnArg = (current.arguments ?? []).find((argument: any) =>
				["ArrowFunctionExpression", "FunctionExpression"].includes(
					unwrapExpression(argument)?.type,
				),
			);
			if (fnArg) {
				return unwrapExpression(fnArg);
			}
			current = unwrapExpression(
				(current.arguments ?? []).find((argument: any) =>
					unwrapExpression(argument),
				),
			);
			continue;
		}
		break;
	}
	return null;
}

/**
 * Resolve wrapper patterns like `memo(ComponentName)` or
 * `forwardRef(ComponentName)` where the argument is an Identifier
 * referencing another function in the same file (not an inline function).
 * Returns the referenced component name, or null.
 */
function resolveWrapperTarget(node: any): string | null {
	const current = unwrapExpression(node);
	if (!current || current.type !== "CallExpression") {
		return null;
	}
	for (const arg of current.arguments ?? []) {
		const unwrapped = unwrapExpression(arg);
		if (unwrapped?.type === "Identifier" && isComponentName(unwrapped.name)) {
			return unwrapped.name;
		}
		// Handle nested wrappers: memo(forwardRef(Component))
		if (unwrapped?.type === "CallExpression") {
			const nested = resolveWrapperTarget(unwrapped);
			if (nested) {
				return nested;
			}
		}
	}
	return null;
}

async function analyzeFile(filePath: string) {
	const source = await Bun.file(filePath).text();
	const ast = parseAst(source, filePath);
	const imports = collectImports(ast);
	const bindings = collectBindings(ast);
	const fileRel = rel(filePath);
	const components = new Map<string, ComponentDefinition>();
	let defaultName: string | null = null;

	function registerComponent(name: string, funcNode: any, isDefault = false) {
		if (!name) {
			return;
		}
		if (!isComponentName(name)) {
			return;
		}
		const rootRender = extractRenderFlow(funcNode, source);
		const key = `${name}@${fileRel}`;
		const rootLayout =
			rootRender?.kind === "expression" &&
			rootRender.node?.type === "JSXElement"
				? summarizeElementLayout(rootRender.node, bindings, source, false)
				: null;
		components.set(name, {
			key,
			name,
			fileAbs: filePath,
			fileRel,
			rootRender,
			imports,
			bindings,
			source,
			acceptsChildren: hasChildrenParam(funcNode),
			isDefault,
			rootLayout,
		});
		if (isDefault) {
			defaultName = name;
		}
	}

	traverse(ast, {
		FunctionDeclaration(nodePath: any) {
			const name = nodePath.node.id?.name;
			if (name) {
				registerComponent(name, nodePath.node);
			}
		},
		VariableDeclarator(nodePath: any) {
			if (nodePath.node.id?.type !== "Identifier" || !nodePath.node.init) {
				return;
			}
			const name = nodePath.node.id.name;
			const componentFn = unwrapComponentFunction(nodePath.node.init);
			if (componentFn) {
				registerComponent(name, componentFn);
			}
		},
		ExportDefaultDeclaration(nodePath: any) {
			const declaration = unwrapExpression(nodePath.node.declaration);
			if (!declaration) {
				return;
			}
			if (declaration.type === "Identifier") {
				defaultName = declaration.name;
				return;
			}
			if (
				declaration.type === "FunctionDeclaration" ||
				declaration.type === "FunctionExpression" ||
				declaration.type === "ArrowFunctionExpression"
			) {
				const inferredName =
					declaration.id?.name ??
					inferComponentName(filePath) ??
					"RootComponent";
				registerComponent(inferredName, declaration, true);
			}
		},
	});

	// Post-pass: resolve wrapper aliases like `const X = memo(Y)` or
	// `const X = forwardRef(Y)` where Y is an Identifier referencing a
	// component already registered in this file.
	for (const [name, initNode] of bindings) {
		if (components.has(name) || !isComponentName(name)) {
			continue;
		}
		const referencedName = resolveWrapperTarget(initNode);
		if (referencedName && components.has(referencedName)) {
			const original = components.get(referencedName)!;
			components.set(name, {
				...original,
				key: `${name}@${fileRel}`,
				name,
				isDefault: false,
			});
		}
	}

	if (!defaultName) {
		for (const component of components.values()) {
			if (component.isDefault) {
				defaultName = component.name;
				break;
			}
		}
	}

	return { fileAbs: filePath, fileRel, components, imports, defaultName };
}

function resolveAliasImport(source: string) {
	for (const [prefix, target] of Object.entries(aliasMap)) {
		if (!prefix || !target) {
			continue;
		}
		if (source === prefix) {
			return path.resolve(PROJECT_ROOT, target);
		}
		if (source.startsWith(`${prefix}/`)) {
			return path.resolve(
				PROJECT_ROOT,
				target,
				source.slice(prefix.length + 1),
			);
		}
	}
	return null;
}

function isProjectImportSource(source: string) {
	if (!source) {
		return false;
	}
	if (source.startsWith(".")) {
		return true;
	}
	return Object.keys(aliasMap).some(
		(prefix) => source === prefix || source.startsWith(`${prefix}/`),
	);
}

async function resolveImportToFile(fromFile: string, source: string) {
	let basePath: string | null = null;
	if (source.startsWith(".")) {
		basePath = path.resolve(path.dirname(fromFile), source);
	} else {
		basePath = resolveAliasImport(source);
	}
	if (!basePath) {
		return null;
	}
	if (await Bun.file(basePath).exists()) {
		return basePath;
	}
	for (const ext of EXTENSIONS) {
		const candidate = `${basePath}${ext}`;
		if (await Bun.file(candidate).exists()) {
			return candidate;
		}
	}
	for (const ext of EXTENSIONS) {
		const candidate = path.join(basePath, `index${ext}`);
		if (await Bun.file(candidate).exists()) {
			return candidate;
		}
	}
	return null;
}

function collectClassTokensFromExpression(
	node: any,
	bindings: Map<string, any>,
	source: string,
	seen = new Set<string>(),
	out: string[] = [],
): string[] {
	const current = unwrapExpression(node);
	if (!current) {
		return out;
	}
	if (current.type === "StringLiteral") {
		pushClassTokens(out, current.value);
		return out;
	}
	if (current.type === "TemplateLiteral") {
		for (const quasi of current.quasis ?? []) {
			pushClassTokens(out, quasi.value?.cooked ?? quasi.value?.raw ?? "");
		}
		for (const expression of current.expressions ?? []) {
			collectClassTokensFromExpression(expression, bindings, source, seen, out);
		}
		return out;
	}
	if (current.type === "Identifier") {
		if (!bindings.has(current.name) || seen.has(current.name)) {
			return out;
		}
		seen.add(current.name);
		collectClassTokensFromExpression(
			bindings.get(current.name),
			bindings,
			source,
			seen,
			out,
		);
		seen.delete(current.name);
		return out;
	}
	if (current.type === "ArrayExpression") {
		for (const item of current.elements ?? []) {
			collectClassTokensFromExpression(item, bindings, source, seen, out);
		}
		return out;
	}
	if (current.type === "ObjectExpression") {
		for (const property of current.properties ?? []) {
			if (property?.type === "ObjectProperty") {
				if (!property.computed && property.key.type === "StringLiteral") {
					pushClassTokens(out, property.key.value);
				}
				if (!property.computed && property.key.type === "Identifier") {
					pushClassTokens(
						out,
						property.key.name.includes("-") ? property.key.name : "",
					);
				}
				collectClassTokensFromExpression(
					property.value,
					bindings,
					source,
					seen,
					out,
				);
			}
		}
		return out;
	}
	if (
		current.type === "ConditionalExpression" ||
		current.type === "LogicalExpression" ||
		current.type === "BinaryExpression"
	) {
		collectClassTokensFromExpression(current.left, bindings, source, seen, out);
		collectClassTokensFromExpression(
			current.right,
			bindings,
			source,
			seen,
			out,
		);
		collectClassTokensFromExpression(
			current.consequent,
			bindings,
			source,
			seen,
			out,
		);
		collectClassTokensFromExpression(
			current.alternate,
			bindings,
			source,
			seen,
			out,
		);
		return out;
	}
	if (current.type === "CallExpression") {
		for (const argument of current.arguments ?? []) {
			collectClassTokensFromExpression(argument, bindings, source, seen, out);
		}
		return out;
	}
	if (
		current.type === "ArrowFunctionExpression" ||
		current.type === "FunctionExpression"
	) {
		if (current.body?.type === "BlockStatement") {
			for (const statement of current.body.body ?? []) {
				if (statement.type === "ReturnStatement" && statement.argument) {
					collectClassTokensFromExpression(
						statement.argument,
						bindings,
						source,
						seen,
						out,
					);
				}
			}
			return out;
		}
		collectClassTokensFromExpression(current.body, bindings, source, seen, out);
		return out;
	}
	if (
		current.type === "MemberExpression" ||
		current.type === "OptionalMemberExpression"
	) {
		if (current.computed) {
			collectClassTokensFromExpression(
				current.property,
				bindings,
				source,
				seen,
				out,
			);
		}
		return out;
	}
	const raw = sourceSlice(source, current);
	if (raw && /^[A-Za-z0-9_ :/.[\]-]+$/.test(raw)) {
		pushClassTokens(out, raw);
	}
	return out;
}

function summarizeStyleExpression(
	node: any,
	bindings: Map<string, any>,
	source: string,
	seen = new Set<string>(),
	entries = new Map<string, string>(),
) {
	const current = unwrapExpression(node);
	if (!current) {
		return entries;
	}
	if (current.type === "Identifier") {
		if (!bindings.has(current.name) || seen.has(current.name)) {
			return entries;
		}
		seen.add(current.name);
		summarizeStyleExpression(
			bindings.get(current.name),
			bindings,
			source,
			seen,
			entries,
		);
		seen.delete(current.name);
		return entries;
	}
	if (current.type === "ArrayExpression") {
		for (const item of current.elements ?? []) {
			summarizeStyleExpression(item, bindings, source, seen, entries);
		}
		return entries;
	}
	if (current.type === "ObjectExpression") {
		for (const property of current.properties ?? []) {
			if (property?.type !== "ObjectProperty") {
				continue;
			}
			let key: string | null = null;
			if (!property.computed && property.key.type === "Identifier") {
				key = property.key.name;
			} else if (!property.computed && property.key.type === "StringLiteral") {
				key = property.key.value;
			}
			if (!key || !STYLE_KEYS.has(key)) {
				continue;
			}
			const value =
				property.value.type === "StringLiteral"
					? property.value.value
					: (sourceSlice(source, property.value) ?? "?");
			entries.set(key, value);
		}
		return entries;
	}
	if (
		current.type === "ConditionalExpression" ||
		current.type === "LogicalExpression"
	) {
		summarizeStyleExpression(current.left, bindings, source, seen, entries);
		summarizeStyleExpression(current.right, bindings, source, seen, entries);
		summarizeStyleExpression(
			current.consequent,
			bindings,
			source,
			seen,
			entries,
		);
		summarizeStyleExpression(
			current.alternate,
			bindings,
			source,
			seen,
			entries,
		);
		return entries;
	}
	return entries;
}

function summarizeElementLayout(
	jsxNode: any,
	bindings: Map<string, any>,
	source: string,
	layoutOnly: boolean,
) {
	if (!jsxNode || jsxNode.type !== "JSXElement") {
		return null;
	}
	const segments: string[] = [];
	for (const attribute of jsxNode.openingElement.attributes ?? []) {
		if (
			attribute.type !== "JSXAttribute" ||
			attribute.name.type !== "JSXIdentifier"
		) {
			continue;
		}
		const propName = attribute.name.name;
		if (propName === "className" || propName.endsWith("ClassName")) {
			const tokens: string[] = [];
			if (attribute.value?.type === "StringLiteral") {
				pushClassTokens(tokens, attribute.value.value);
			} else if (
				attribute.value?.type === "JSXExpressionContainer" &&
				attribute.value.expression
			) {
				collectClassTokensFromExpression(
					attribute.value.expression,
					bindings,
					source,
					new Set<string>(),
					tokens,
				);
			}
			const normalized = normalizeClassTokens(tokens);
			const filtered = layoutOnly
				? filterLayoutClasses(normalized)
				: normalized;
			if (filtered) {
				segments.push(
					propName === "className" ? filtered : `${propName}=${filtered}`,
				);
			}
			continue;
		}
		if (propName.endsWith("Style")) {
			if (
				attribute.value?.type !== "JSXExpressionContainer" ||
				!attribute.value.expression
			) {
				continue;
			}
			const entries = summarizeStyleExpression(
				attribute.value.expression,
				bindings,
				source,
			);
			if (entries.size > 0) {
				segments.push(
					`${propName}={${[...entries.entries()]
						.map(([key, value]) => `${key}:${value}`)
						.join(", ")}}`,
				);
			}
		}
	}
	return segments.length > 0 ? segments.join(" | ") : null;
}

function summarizeCondition(node: any, source: string) {
	if (typeof node === "string") {
		return node;
	}
	return sourceSlice(source, node) ?? "condition";
}

function getStringJsxAttribute(jsxNode: any, attributeName: string) {
	if (!jsxNode || jsxNode.type !== "JSXElement") {
		return null;
	}
	for (const attribute of jsxNode.openingElement.attributes ?? []) {
		if (
			attribute.type !== "JSXAttribute" ||
			attribute.name.type !== "JSXIdentifier" ||
			attribute.name.name !== attributeName
		) {
			continue;
		}
		if (attribute.value?.type === "StringLiteral") {
			return attribute.value.value;
		}
		if (
			attribute.value?.type === "JSXExpressionContainer" &&
			attribute.value.expression?.type === "StringLiteral"
		) {
			return attribute.value.expression.value;
		}
	}
	return null;
}

let nextNodeId = 1;

function createNode(
	kind: TreeNode["kind"],
	name: string,
	overrides: Partial<TreeNode> = {},
): TreeNode {
	return {
		id: `n${nextNodeId++}`,
		kind,
		name,
		children: [],
		...overrides,
	};
}

function cloneTreeNode(node: TreeNode): TreeNode {
	return {
		...node,
		id: `n${nextNodeId++}`,
		children: node.children.map(cloneTreeNode),
	};
}

function buildTextNode(raw: string) {
	const text = raw.replace(/\s+/g, " ").trim();
	if (!text) {
		return null;
	}
	return createNode("text", "text", {
		text: text.length > 80 ? `${text.slice(0, 77)}...` : text,
	});
}

async function main() {
	const files: string[] = [];
	const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
	for await (const matchedPath of glob.scan({
		cwd: srcDir,
		absolute: true,
		dot: true,
	})) {
		const normalized = String(matchedPath).replaceAll("\\", "/");
		if (
			normalized.includes("/__tests__/") ||
			normalized.includes(".test.") ||
			normalized.includes(".spec.") ||
			normalized.endsWith(".d.ts")
		) {
			continue;
		}
		files.push(path.resolve(String(matchedPath)));
	}
	files.sort((left, right) => left.localeCompare(right));

	const analyses = await Promise.all(files.map((file) => analyzeFile(file)));
	const componentsByKey = new Map<string, ComponentDefinition>();
	const componentsByFile = new Map<string, Map<string, ComponentDefinition>>();
	const defaultByFile = new Map<string, string | null>();
	const expandedComponents = new Set<string>();

	for (const analysis of analyses) {
		componentsByFile.set(analysis.fileAbs, analysis.components);
		defaultByFile.set(analysis.fileAbs, analysis.defaultName);
		for (const component of analysis.components.values()) {
			componentsByKey.set(component.key, component);
		}
	}

	async function resolveLocalComponentKey(
		tagName: string,
		fromComponent: ComponentDefinition,
	): Promise<string | null> {
		if (!tagName.includes(".")) {
			const sameFile = componentsByFile
				.get(fromComponent.fileAbs)
				?.get(tagName);
			if (sameFile) {
				return sameFile.key;
			}
		}

		const importLocal = tagName.split(".")[0] ?? tagName;
		const importRecord = fromComponent.imports.get(importLocal);
		if (!importRecord) {
			return null;
		}
		if (!isProjectImportSource(importRecord.source)) {
			return null;
		}
		const targetFile = await resolveImportToFile(
			fromComponent.fileAbs,
			importRecord.source,
		);
		if (!targetFile) {
			return null;
		}
		const targetComponents = componentsByFile.get(targetFile);
		if (!targetComponents) {
			return null;
		}
		if (tagName.includes(".") && importRecord.kind === "namespace") {
			const lastMember = tagName.split(".").pop() ?? "";
			if (targetComponents.has(lastMember)) {
				return targetComponents.get(lastMember)?.key ?? null;
			}
			if (targetComponents.size === 1) {
				return [...targetComponents.values()][0]?.key ?? null;
			}
			return null;
		}
		if (importRecord.kind === "default") {
			const defaultName = defaultByFile.get(targetFile);
			if (defaultName && targetComponents.has(defaultName)) {
				return targetComponents.get(defaultName)?.key ?? null;
			}
			if (targetComponents.size === 1) {
				return [...targetComponents.values()][0]?.key ?? null;
			}
			return null;
		}
		if (importRecord.kind === "named") {
			const target = targetComponents.get(importRecord.importedName);
			return target?.key ?? null;
		}
		return null;
	}

	async function resolveModuleName(
		tagName: string,
		fromComponent: ComponentDefinition,
	): Promise<string | null> {
		const base = tagName.split(".")[0] ?? tagName;
		const importRecord = fromComponent.imports.get(base);
		if (!importRecord) {
			return null;
		}
		if (isProjectImportSource(importRecord.source)) {
			return null;
		}
		return importRecord.source;
	}

	async function resolveRouteFileFromName(
		routeName: string,
		fromComponent: ComponentDefinition,
	) {
		const layoutDir = path.dirname(fromComponent.fileAbs);
		const candidates: string[] = [];
		if (routeName.startsWith("(") && routeName.endsWith(")")) {
			candidates.push(path.join(layoutDir, routeName, "_layout"));
		}
		candidates.push(path.join(layoutDir, routeName));
		for (const base of candidates) {
			if (await Bun.file(base).exists()) {
				return base;
			}
			for (const ext of EXTENSIONS) {
				if (await Bun.file(`${base}${ext}`).exists()) {
					return `${base}${ext}`;
				}
			}
			for (const ext of EXTENSIONS) {
				const layoutCandidate = path.join(base, `_layout${ext}`);
				if (await Bun.file(layoutCandidate).exists()) {
					return layoutCandidate;
				}
				const indexCandidate = path.join(base, `index${ext}`);
				if (await Bun.file(indexCandidate).exists()) {
					return indexCandidate;
				}
			}
		}
		return null;
	}

	async function resolveExpoRouteComponentKey(
		jsxNode: any,
		fromComponent: ComponentDefinition,
	) {
		const routeName = getStringJsxAttribute(jsxNode, "name");
		if (!routeName) {
			return null;
		}
		const routeFile = await resolveRouteFileFromName(routeName, fromComponent);
		if (!routeFile) {
			return null;
		}
		const defaultName = defaultByFile.get(routeFile);
		if (defaultName && componentsByFile.get(routeFile)?.has(defaultName)) {
			return componentsByFile.get(routeFile)?.get(defaultName)?.key ?? null;
		}
		const firstComponent = [
			...(componentsByFile.get(routeFile)?.values() ?? []),
		][0];
		return firstComponent?.key ?? null;
	}

	async function buildNodesFromRenderFlow(
		renderFlow: RenderFlow | null,
		context: ComponentDefinition,
		stack: string[],
		slotChildren: TreeNode[],
	): Promise<TreeNode[]> {
		if (!renderFlow) {
			return [];
		}
		if (renderFlow.kind === "expression") {
			return buildNodesFromExpression(
				renderFlow.node,
				context,
				stack,
				slotChildren,
			);
		}
		const branchNode = createNode(
			"branch",
			summarizeCondition(renderFlow.condition, context.source),
		);
		const thenChildren = await buildNodesFromRenderFlow(
			renderFlow.thenFlow,
			context,
			stack,
			slotChildren,
		);
		const elseChildren = await buildNodesFromRenderFlow(
			renderFlow.elseFlow,
			context,
			stack,
			slotChildren,
		);
		if (thenChildren.length > 0) {
			branchNode.children.push(
				createNode("branch", "then", { children: thenChildren }),
			);
		}
		if (elseChildren.length > 0) {
			branchNode.children.push(
				createNode("branch", "else", { children: elseChildren }),
			);
		}
		return branchNode.children.length > 0 ? [branchNode] : [];
	}

	async function buildNodesFromExpression(
		expression: any,
		context: ComponentDefinition,
		stack: string[],
		slotChildren: TreeNode[],
	): Promise<TreeNode[]> {
		const current = unwrapExpression(expression);
		if (!current) {
			return [];
		}
		if (current.type === "Identifier" && current.name === "children") {
			return slotChildren.map(cloneTreeNode);
		}
		if (current.type === "JSXElement" || current.type === "JSXFragment") {
			return buildNodesFromJsx(current, context, stack, slotChildren);
		}
		if (
			current.type === "ConditionalExpression" &&
			(current.consequent || current.alternate)
		) {
			const branchNode = createNode(
				"branch",
				summarizeCondition(current.test, context.source),
			);
			const thenChildren = await buildNodesFromExpression(
				current.consequent,
				context,
				stack,
				slotChildren,
			);
			const elseChildren = await buildNodesFromExpression(
				current.alternate,
				context,
				stack,
				slotChildren,
			);
			if (thenChildren.length > 0) {
				branchNode.children.push(
					createNode("branch", "then", { children: thenChildren }),
				);
			}
			if (elseChildren.length > 0) {
				branchNode.children.push(
					createNode("branch", "else", { children: elseChildren }),
				);
			}
			return branchNode.children.length > 0 ? [branchNode] : [];
		}
		if (current.type === "LogicalExpression") {
			const children =
				(await buildNodesFromExpression(
					current.right,
					context,
					stack,
					slotChildren,
				)) ?? [];
			if (children.length === 0) {
				return [];
			}
			return [
				createNode("branch", summarizeCondition(current.left, context.source), {
					children,
				}),
			];
		}
		if (current.type === "ArrayExpression") {
			const out: TreeNode[] = [];
			for (const item of current.elements ?? []) {
				out.push(
					...(await buildNodesFromExpression(
						item,
						context,
						stack,
						slotChildren,
					)),
				);
			}
			return out;
		}
		if (
			current.type === "ArrowFunctionExpression" ||
			current.type === "FunctionExpression"
		) {
			return buildNodesFromRenderFlow(
				extractRenderFlow(current, context.source),
				context,
				stack,
				slotChildren,
			);
		}
		if (current.type === "ObjectExpression") {
			const out: TreeNode[] = [];
			for (const property of current.properties ?? []) {
				if (property?.type === "ObjectProperty") {
					out.push(
						...(await buildNodesFromExpression(
							property.value,
							context,
							stack,
							slotChildren,
						)),
					);
				}
			}
			return out;
		}
		if (current.type === "CallExpression") {
			const out: TreeNode[] = [];
			for (const argument of current.arguments ?? []) {
				out.push(
					...(await buildNodesFromExpression(
						argument,
						context,
						stack,
						slotChildren,
					)),
				);
			}
			return out;
		}
		return [];
	}

	async function buildChildrenFromJsxChildren(
		children: any[],
		context: ComponentDefinition,
		stack: string[],
		slotChildren: TreeNode[],
	): Promise<TreeNode[]> {
		const out: TreeNode[] = [];
		for (const child of children ?? []) {
			if (!child) {
				continue;
			}
			if (child.type === "JSXText") {
				const textNode = buildTextNode(child.value);
				if (textNode) {
					out.push(textNode);
				}
				continue;
			}
			if (child.type === "JSXExpressionContainer") {
				out.push(
					...(await buildNodesFromExpression(
						child.expression,
						context,
						stack,
						slotChildren,
					)),
				);
				continue;
			}
			out.push(
				...(await buildNodesFromJsx(child, context, stack, slotChildren)),
			);
		}
		return out;
	}

	async function buildNodesFromJsx(
		jsxNode: any,
		context: ComponentDefinition,
		stack: string[],
		slotChildren: TreeNode[],
	): Promise<TreeNode[]> {
		if (!jsxNode) {
			return [];
		}
		if (jsxNode.type === "JSXFragment") {
			return buildChildrenFromJsxChildren(
				jsxNode.children ?? [],
				context,
				stack,
				slotChildren,
			);
		}
		if (jsxNode.type !== "JSXElement") {
			return [];
		}

		const tagName = jsxNameToString(jsxNode.openingElement?.name);
		if (!tagName || tagName === "Fragment") {
			return buildChildrenFromJsxChildren(
				jsxNode.children ?? [],
				context,
				stack,
				slotChildren,
			);
		}

		const directChildren = await buildChildrenFromJsxChildren(
			jsxNode.children ?? [],
			context,
			stack,
			slotChildren,
		);
		const embeddedChildren: TreeNode[] = [];
		for (const attribute of jsxNode.openingElement.attributes ?? []) {
			if (
				attribute.type !== "JSXAttribute" ||
				attribute.name.type !== "JSXIdentifier" ||
				!attribute.value
			) {
				continue;
			}
			const propName = attribute.name.name;
			if (propName.endsWith("ClassName") || propName.endsWith("Style")) {
				continue;
			}
			if (attribute.value.type === "JSXExpressionContainer") {
				embeddedChildren.push(
					...(await buildNodesFromExpression(
						attribute.value.expression,
						context,
						stack,
						[],
					)),
				);
			}
		}

		const localKey = await resolveLocalComponentKey(tagName, context);
		if (localKey) {
			const targetComponent = componentsByKey.get(localKey);
			if (!targetComponent) {
				return [];
			}
			const componentNode = createNode("component", targetComponent.name, {
				fileRel: targetComponent.fileRel,
				layout: targetComponent.rootLayout,
			});
			if (stack.includes(localKey)) {
				componentNode.recursive = true;
				return [componentNode];
			}
			if (expandedComponents.has(localKey)) {
				componentNode.duplicate = true;
				return [componentNode];
			}
			expandedComponents.add(localKey);
			componentNode.children = await buildNodesFromRenderFlow(
				targetComponent.rootRender,
				targetComponent,
				[...stack, localKey],
				directChildren,
			);
			return [componentNode];
		}

		const moduleName = await resolveModuleName(tagName, context);
		const frameworkNode = createNode("framework", tagName, {
			module: moduleName,
			layout: summarizeElementLayout(
				jsxNode,
				context.bindings,
				context.source,
				Boolean(values.layoutOnly),
			),
			children: [...directChildren, ...embeddedChildren],
		});
		if (
			moduleName === "expo-router" &&
			(tagName === "Stack.Screen" || tagName === "Tabs.Screen")
		) {
			const routeComponentKey = await resolveExpoRouteComponentKey(
				jsxNode,
				context,
			);
			if (routeComponentKey) {
				const routeComponent = componentsByKey.get(routeComponentKey);
				if (routeComponent) {
					const routeNode = createNode("component", routeComponent.name, {
						fileRel: routeComponent.fileRel,
						layout: routeComponent.rootLayout,
					});
					routeNode.children = await buildNodesFromRenderFlow(
						routeComponent.rootRender,
						routeComponent,
						[...stack, routeComponent.key],
						[],
					);
					frameworkNode.children.push(routeNode);
				}
			}
		}
		return [frameworkNode];
	}

	function buildFocusedAsciiTree(
		rootNode: TreeNode,
		focusNodeId: string,
		scope: "up" | "full" | "down",
	) {
		const lines: string[] = [];
		const pathToFocus = findPathToNode(rootNode, focusNodeId);
		const focusTarget = pathToFocus[pathToFocus.length - 1] ?? rootNode;

		if (scope === "down") {
			// Target as root → full subtree
			lines.push(buildAsciiTree(focusTarget));
			return lines.join("\n");
		}

		if (scope === "up") {
			// Ancestors → target (children summarized)
			if (pathToFocus.length > 1) {
				lines.push("Ancestor chain → target:");
				for (let index = 0; index < pathToFocus.length; index += 1) {
					const node = pathToFocus[index];
					const isTarget = index === pathToFocus.length - 1;
					const marker = isTarget ? "★ " : "";
					const label = formatAsciiLabel(node);
					const childCount = node.children.length;
					const suffix =
						isTarget && childCount > 0
							? ` [${childCount} children]`
							: "";
					lines.push(
						`${"  ".repeat(index + 1)}${marker}${label}${suffix}`,
					);
				}
			} else {
				const childCount = focusTarget.children.length;
				const suffix = childCount > 0 ? ` [${childCount} children]` : "";
				lines.push(`★ ${formatAsciiLabel(focusTarget)}${suffix}`);
			}
			return lines.join("\n");
		}

		// scope === "full": Ancestors → target → full subtree
		if (pathToFocus.length > 1) {
			lines.push("Ancestor chain (layout context):");
			for (let index = 0; index < pathToFocus.length; index += 1) {
				const node = pathToFocus[index];
				const marker = index === pathToFocus.length - 1 ? "★ " : "";
				lines.push(
					`${"  ".repeat(index + 1)}${marker}${formatAsciiLabel(node)}`,
				);
			}
			lines.push("");
		}
		lines.push(buildAsciiTree(focusTarget));
		return lines.join("\n");
	}

	function formatAsciiLabel(node: TreeNode) {
		if (node.kind === "text") {
			return `"${node.text ?? ""}"`;
		}
		const parts = [`[${node.name}]`];
		if (node.fileRel) {
			parts.push(`- ${node.fileRel}`);
		} else if (node.module) {
			parts.push(`- ${node.module}`);
		}
		if (node.layout) {
			parts.push(`(${node.layout})`);
		}
		if (node.recursive) {
			parts.push("↺");
		}
		if (node.duplicate) {
			parts.push("(see above)");
		}
		return parts.join(" ");
	}

	function buildAsciiTree(rootNode: TreeNode) {
		const lines: string[] = [];
		function walk(
			node: TreeNode,
			prefix: string,
			isLast: boolean,
			depth: number,
		) {
			const connector = depth === 0 ? "" : isLast ? "└── " : "├── ";
			lines.push(`${prefix}${connector}${formatAsciiLabel(node)}`);
			for (let index = 0; index < node.children.length; index += 1) {
				walk(
					node.children[index],
					depth === 0 ? "" : `${prefix}${isLast ? "    " : "│   "}`,
					index === node.children.length - 1,
					depth + 1,
				);
			}
		}
		walk(rootNode, "", true, 0);
		return lines.join("\n");
	}

	function flattenTree(rootNode: TreeNode) {
		const nodes: TreeNode[] = [];
		const edges: Array<[string, string]> = [];
		function walk(node: TreeNode) {
			nodes.push(node);
			for (const child of node.children) {
				edges.push([node.id, child.id]);
				walk(child);
			}
		}
		walk(rootNode);
		return { nodes, edges };
	}

	function buildMermaid(rootNode: TreeNode) {
		const { nodes, edges } = flattenTree(rootNode);
		const byId = new Map(nodes.map((node) => [node.id, node]));
		const lines = ["```mermaid", "graph TD"];
		for (const node of nodes) {
			const label =
				node.kind === "text"
					? (node.text ?? "").replace(/"/g, '\\"')
					: `${node.name}${
							node.fileRel
								? `<br/>${node.fileRel}`
								: node.module
									? `<br/>${node.module}`
									: ""
						}`.replace(/"/g, '\\"');
			lines.push(`  ${node.id}["${label}"]`);
		}
		for (const [from, to] of edges) {
			if (!byId.has(from) || !byId.has(to)) {
				continue;
			}
			lines.push(`  ${from} --> ${to}`);
		}
		lines.push("```");
		return lines.join("\n");
	}

	function findNodeByName(node: TreeNode, name: string): TreeNode | null {
		if (node.name === name) {
			return node;
		}
		for (const child of node.children) {
			const found = findNodeByName(child, name);
			if (found) {
				return found;
			}
		}
		return null;
	}

	function collectComponentNames(node: TreeNode, seen = new Set<string>()): string[] {
		if (node.kind === "component" && node.name && !seen.has(node.name)) {
			seen.add(node.name);
		}
		for (const child of node.children) {
			collectComponentNames(child, seen);
		}
		return [...seen].sort();
	}

	function findSimilarNames(target: string, candidates: string[], maxResults: number): string[] {
		const lower = target.toLowerCase();
		const scored = candidates
			.map((name) => {
				const nameLower = name.toLowerCase();
				if (nameLower.includes(lower) || lower.includes(nameLower)) {
					return { name, score: 0 };
				}
				let score = 0;
				for (let i = 0; i < lower.length; i++) {
					if (!nameLower.includes(lower[i])) score++;
				}
				return { name, score };
			})
			.sort((a, b) => a.score - b.score)
			.slice(0, maxResults);
		return scored.filter((s) => s.score <= Math.ceil(target.length * 0.5)).map((s) => s.name);
	}

	function findPathToNode(
		node: TreeNode,
		targetId: string,
		pathAcc: TreeNode[] = [],
	): TreeNode[] {
		const nextPath = [...pathAcc, node];
		if (node.id === targetId) {
			return nextPath;
		}
		for (const child of node.children) {
			const found = findPathToNode(child, targetId, nextPath);
			if (found.length > 0 && found[found.length - 1]?.id === targetId) {
				return found;
			}
		}
		return [];
	}

	let rootComponent: ComponentDefinition | null = null;
	if (values.rootComponent) {
		rootComponent =
			[...componentsByKey.values()].find(
				(component) => component.name === values.rootComponent,
			) ?? null;
	}

	if (!rootComponent) {
		const entryDefaultName = defaultByFile.get(entryFile);
		if (entryDefaultName) {
			rootComponent =
				componentsByFile.get(entryFile)?.get(entryDefaultName) ?? null;
		}
	}

	if (!rootComponent) {
		rootComponent =
			[...componentsByKey.values()].find(
				(component) => component.fileAbs === entryFile,
			) ?? null;
	}

	if (!rootComponent) {
		throw new Error(
			`Cannot determine root component for ${rel(entryFile)}. Use --rootComponent.`,
		);
	}

	const rootNode = createNode("component", rootComponent.name, {
		fileRel: rootComponent.fileRel,
		layout: rootComponent.rootLayout,
	});
	rootNode.children = await buildNodesFromRenderFlow(
		rootComponent.rootRender,
		rootComponent,
		[rootComponent.key],
		[],
	);

	let focusNode = values.focus
		? findNodeByName(rootNode, values.focus)
		: null;

	// If the focus target isn't in the main tree (e.g. used inside renderItem),
	// look it up in the full component registry and build a standalone subtree.
	const scope = (values.scope ?? "down") as "up" | "full" | "down";
	let standaloneRoot: TreeNode | null = null;
	if (values.focus && !focusNode) {
		const match = [...componentsByKey.values()].find(
			(c) => c.name === values.focus,
		);
		if (match) {
			expandedComponents.clear();
			standaloneRoot = createNode("component", match.name, {
				fileRel: match.fileRel,
				layout: match.rootLayout,
			});
			standaloneRoot.children = await buildNodesFromRenderFlow(
				match.rootRender,
				match,
				[match.key],
				[],
			);
			if (scope === "up" || scope === "full") {
				console.error(
					`Note: "${values.focus}" is not reachable from the main navigation tree (likely used inside a renderItem/callback prop). Ancestor chain is unavailable — falling back to --scope down.\n`,
				);
			} else {
				console.error(
					`Note: "${values.focus}" is not reachable from the main navigation tree (likely used inside a renderItem/callback prop). Showing standalone subtree.\n`,
				);
			}
		}
	}

	if (values.focus && !focusNode && !standaloneRoot) {
		const treeNames = collectComponentNames(rootNode);
		const allRegistered = [...new Set([...componentsByKey.values()].map((c) => c.name))].sort();
		const suggestions = findSimilarNames(values.focus, allRegistered, 5);
		console.error(
			`Error: --focus "${values.focus}" not found in the component tree or registry.`,
		);
		if (suggestions.length > 0) {
			console.error(`\nDid you mean one of these?`);
			for (const name of suggestions) {
				console.error(`  - ${name}`);
			}
		}
		console.error(
			`\nIn tree (${treeNames.length}): ${treeNames.slice(0, 15).join(", ")}${treeNames.length > 15 ? ", ..." : ""}`,
		);
		const registryOnly = allRegistered.filter((n) => !treeNames.includes(n));
		if (registryOnly.length > 0) {
			console.error(
				`In registry but not tree (${registryOnly.length}): ${registryOnly.slice(0, 15).join(", ")}${registryOnly.length > 15 ? ", ..." : ""}`,
			);
		}
		process.exit(1);
	}

	const ascii = standaloneRoot
		? buildAsciiTree(standaloneRoot)
		: focusNode
			? buildFocusedAsciiTree(rootNode, focusNode.id, scope)
			: buildAsciiTree(rootNode);
	const mermaid = buildMermaid(rootNode);
	const { nodes, edges } = flattenTree(rootNode);
	const graphJson = {
		generatedAt: new Date().toISOString(),
		root: {
			id: rootNode.id,
			name: rootComponent.name,
			file: rootComponent.fileRel,
		},
		tree: rootNode,
		nodes: nodes.map((node) => ({
			id: node.id,
			kind: node.kind,
			name: node.name,
			fileRel: node.fileRel ?? null,
			module: node.module ?? null,
			layout: node.layout ?? null,
			text: node.text ?? null,
			recursive: node.recursive ?? false,
		})),
		edges,
		stats: {
			totalNodes: nodes.length,
			totalEdges: edges.length,
			componentNodes: nodes.filter((node) => node.kind === "component").length,
			frameworkNodes: nodes.filter((node) => node.kind === "framework").length,
			textNodes: nodes.filter((node) => node.kind === "text").length,
			branchNodes: nodes.filter((node) => node.kind === "branch").length,
		},
	};

	if (outBase) {
		await mkdir(path.dirname(outBase), { recursive: true });
		await Bun.write(`${outBase}.ascii.txt`, `${ascii}\n`);
		await Bun.write(`${outBase}.mmd`, `${mermaid}\n`);
		await Bun.write(
			`${outBase}.json`,
			`${JSON.stringify(graphJson, null, 2)}\n`,
		);
	}

	if (values.format === "ascii") {
		console.log(ascii);
		return;
	}
	if (values.format === "mermaid") {
		console.log(mermaid);
		return;
	}
	if (values.format === "json") {
		console.log(JSON.stringify(graphJson, null, 2));
		return;
	}
	if (values.format === "bundle") {
		console.log(
			JSON.stringify(
				{
					ascii,
					mermaid,
					graph: graphJson,
				},
				null,
				2,
			),
		);
		return;
	}
	console.log("=== UI_MAP_ASCII ===");
	console.log(ascii);
	console.log("\n=== UI_MAP_MERMAID ===");
	console.log(mermaid);
	console.log("\n=== UI_MAP_JSON ===");
	console.log(JSON.stringify(graphJson, null, 2));
}

main().catch((error) => {
	console.error("generate-ui-map failed:", error?.message ?? error);
	process.exit(1);
});
