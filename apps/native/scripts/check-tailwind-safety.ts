#!/usr/bin/env bun
import path from "node:path";
import { parseArgs } from "node:util";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const DEFAULT_SRC = "apps/mobile/src";
const DOM_TAGS = new Set([
	"article",
	"aside",
	"button",
	"div",
	"footer",
	"header",
	"img",
	"main",
	"nav",
	"section",
	"span",
]);

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		src: { type: "string", default: DEFAULT_SRC },
		strictColors: { type: "boolean", default: false },
		strictSizing: { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
	strict: true,
});

if (values.help) {
	console.log(
		"Usage: bun scripts/check-tailwind-safety.ts [--src <path>] [--strictColors] [--strictSizing]",
	);
	process.exit(0);
}

const projectRoot = process.cwd();
const srcDir = path.resolve(projectRoot, values.src ?? DEFAULT_SRC);

function rel(filePath: string) {
	return path.relative(projectRoot, filePath).split(path.sep).join("/");
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

async function main() {
	const files: string[] = [];
	const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,css}");
	for await (const matchedPath of glob.scan({
		cwd: srcDir,
		absolute: true,
		dot: true,
	})) {
		const normalized = String(matchedPath).replaceAll("\\", "/");
		if (
			normalized.includes("/__tests__/") ||
			normalized.includes(".test.") ||
			normalized.includes(".spec.")
		) {
			continue;
		}
		files.push(path.resolve(String(matchedPath)));
	}

	const hits: Array<{
		file: string;
		rule: string;
		sample: string;
		message: string;
	}> = [];

	for (const filePath of files) {
		const sourceText = await Bun.file(filePath).text();
		const extension = path.extname(filePath).toLowerCase();

		if (extension === ".css") {
			for (const match of sourceText.matchAll(/@apply\b/g)) {
				hits.push({
					file: rel(filePath),
					rule: "NO_APPLY",
					sample: match[0],
					message:
						"Avoid `@apply`; keep Uniwind tokens explicit so hierarchy scripts can read them.",
				});
			}
			continue;
		}

		const ast = parseAst(sourceText, filePath);
		traverse(ast, {
			JSXOpeningElement(nodePath: any) {
				const nameNode = nodePath.node.name;
				if (nameNode.type === "JSXIdentifier" && DOM_TAGS.has(nameNode.name)) {
					hits.push({
						file: rel(filePath),
						rule: "NO_DOM_TAGS",
						sample: `<${nameNode.name}>`,
						message:
							"DOM tags do not belong in Expo React Native screens/components.",
					});
				}
				for (const attribute of nodePath.node.attributes ?? []) {
					if (
						attribute.type === "JSXAttribute" &&
						attribute.name.type === "JSXIdentifier" &&
						attribute.name.name === "class"
					) {
						hits.push({
							file: rel(filePath),
							rule: "NO_CLASS_ATTR",
							sample: "class",
							message:
								"Use `className` in React Native/Uniwind JSX, never raw `class`.",
						});
					}
					if (
						attribute.type !== "JSXAttribute" ||
						attribute.name.type !== "JSXIdentifier" ||
						attribute.name.name !== "className"
					) {
						continue;
					}
					const rawValue =
						attribute.value?.type === "StringLiteral"
							? attribute.value.value
							: attribute.value?.type === "JSXExpressionContainer"
								? sourceText
										.slice(
											attribute.value.expression.start ?? 0,
											attribute.value.expression.end ?? 0,
										)
										.replace(/\s+/g, " ")
								: "";

					if (
						values.strictSizing &&
						/\b(w|h|min-w|min-h|max-w|max-h)-\[(?!var\(|--)[^\]]+\]/.test(
							rawValue,
						)
					) {
						hits.push({
							file: rel(filePath),
							rule: "NO_ARBITRARY_WIDTH_HEIGHT",
							sample: rawValue,
							message:
								"Avoid arbitrary sizing unless the value is deliberately canonicalized elsewhere.",
						});
					}

					if (
						values.strictColors &&
						/\b(bg|text|border|ring)-\[#([0-9a-fA-F]{3,8})\]/.test(rawValue)
					) {
						hits.push({
							file: rel(filePath),
							rule: "NO_ARBITRARY_COLOR",
							sample: rawValue,
							message:
								"Avoid arbitrary hex colors; prefer semantic tokens from `apps/mobile/global.css`.",
						});
					}
				}
			},
		});
	}

	if (hits.length > 0) {
		console.error("Uniwind safety checks failed:\n");
		for (const hit of hits) {
			console.error(`- ${hit.file} [${hit.rule}]: "${hit.sample}"`);
			console.error(`  -> ${hit.message}`);
		}
		console.error(
			"\nFix: remove web-only JSX patterns, or rerun without strict flags if you only want baseline Expo/Uniwind checks.",
		);
		process.exit(1);
	}

	console.log("Uniwind safety OK");
}

main().catch((error) => {
	console.error("check-tailwind-safety failed:", error?.message ?? error);
	process.exit(1);
});
