#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_MOBILE_ROOT = "apps/mobile";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		out: { type: "string" },
		uiMapBase: { type: "string" },
		mobileRoot: { type: "string", default: DEFAULT_MOBILE_ROOT },
		inlineRules: { type: "boolean", default: true },
		help: { type: "boolean", short: "h", default: false },
	},
	strict: true,
});

if (values.help) {
	console.log(
		"Usage: bun scripts/context-pack.ts [--out <path>] [--uiMapBase <path>] [--mobileRoot <path>] [--inlineRules]",
	);
	process.exit(0);
}

const projectRoot = process.cwd();
const mobileRoot = path.resolve(
	projectRoot,
	values.mobileRoot ?? DEFAULT_MOBILE_ROOT,
);
const uiMapBase = values.uiMapBase
	? path.resolve(projectRoot, values.uiMapBase)
	: null;

async function readIfExists(relativeOrAbsolutePath: string) {
	const filePath = path.isAbsolute(relativeOrAbsolutePath)
		? relativeOrAbsolutePath
		: path.resolve(projectRoot, relativeOrAbsolutePath);
	const file = Bun.file(filePath);
	try {
		if (!(await file.exists())) {
			return null;
		}
		return await file.text();
	} catch {
		return null;
	}
}

function buildSection(title: string, body: string | null | undefined) {
	const trimmed = body?.trim();
	if (!trimmed) {
		return "";
	}
	return `\n\n# ${title}\n\n${trimmed}\n`;
}

async function runCommand(cmd: string[]) {
	const proc = Bun.spawn({
		cmd,
		cwd: projectRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || `Command failed: ${cmd.join(" ")}`);
	}
	return stdout;
}

async function resolveUiMapArtifacts() {
	if (uiMapBase) {
		return {
			ascii: await readIfExists(`${uiMapBase}.ascii.txt`),
			mermaid: await readIfExists(`${uiMapBase}.mmd`),
			json: await readIfExists(`${uiMapBase}.json`),
		};
	}

	const bundleRaw = await runCommand([
		process.execPath,
		path.resolve(projectRoot, "scripts/generate-ui-map.ts"),
		"--format",
		"bundle",
	]);
	const bundle = JSON.parse(bundleRaw);
	return {
		ascii: typeof bundle?.ascii === "string" ? bundle.ascii : null,
		mermaid: typeof bundle?.mermaid === "string" ? bundle.mermaid : null,
		json: bundle?.graph ? JSON.stringify(bundle.graph, null, 2) : null,
	};
}

function summarizeUiMap(uiMapJson: string | null) {
	if (!uiMapJson) {
		return null;
	}
	try {
		const parsed = JSON.parse(uiMapJson);
		const stats = parsed?.stats ?? {};
		const root = parsed?.root ?? {};
		return [
			`Root: ${root.name ?? "unknown"} (${root.file ?? "unknown"})`,
			`Nodes: ${stats.totalNodes ?? 0}`,
			`Edges: ${stats.totalEdges ?? 0}`,
			`Components: ${stats.componentNodes ?? 0}`,
			`Framework nodes: ${stats.frameworkNodes ?? 0}`,
			`Text nodes: ${stats.textNodes ?? 0}`,
			`Branches: ${stats.branchNodes ?? 0}`,
		].join("\n");
	} catch {
		return null;
	}
}

async function main() {
	const uiMap = await resolveUiMapArtifacts();
	const mobileGlobalCss = await readIfExists(
		path.join(mobileRoot, "global.css"),
	);
	const rootLayout = await readIfExists(
		path.join(mobileRoot, "src/app/_layout.tsx"),
	);
	const tabsLayout = await readIfExists(
		path.join(mobileRoot, "src/app/(tabs)/_layout.tsx"),
	);
	const themeContext = await readIfExists(
		path.join(mobileRoot, "src/contexts/app-theme-context.tsx"),
	);

	const parts = [
		`# MOBILE UI CONTEXT PACK\nGeneratedAt: ${new Date().toISOString()}\n`,
		buildSection("UI MAP SUMMARY", summarizeUiMap(uiMap.json)),
		buildSection("UI TREE (ASCII)", uiMap.ascii),
		buildSection("UI GRAPH (MERMAID)", uiMap.mermaid),
		buildSection("UI MAP JSON", uiMap.json),
		buildSection("ROOT LAYOUT", rootLayout),
		buildSection("TABS LAYOUT", tabsLayout),
		buildSection("THEME CONTEXT", themeContext),
		buildSection("GLOBAL CSS / UNIWIND TOKENS", mobileGlobalCss),
	];

	if (values.inlineRules) {
		parts.push(buildSection("ROOT AGENTS", await readIfExists("AGENTS.md")));
		parts.push(
			buildSection(
				"MOBILE AGENTS",
				await readIfExists(path.join(mobileRoot, "AGENTS.md")),
			),
		);
		parts.push(buildSection("ROOT CLAUDE", await readIfExists("CLAUDE.md")));
		parts.push(
			buildSection(
				"MOBILE CLAUDE",
				await readIfExists(path.join(mobileRoot, "CLAUDE.md")),
			),
		);
	}

	const output = `${parts.join("").trim()}\n`;
	if (values.out) {
		const outFile = path.resolve(projectRoot, values.out);
		await mkdir(path.dirname(outFile), { recursive: true });
		await Bun.write(outFile, output);
		console.log(
			`Wrote mobile UI context pack: ${path.relative(projectRoot, outFile)}`,
		);
		return;
	}
	console.log(output);
}

main().catch((error) => {
	console.error("context-pack failed:", error?.message ?? error);
	process.exit(1);
});
