#!/usr/bin/env bun
import path from "node:path";
import { parseArgs } from "node:util";

const REQUIRED_AGENT_REFERENCES = [
	"bun run ui-map",
	"bun run context-pack:mobile",
];
const FORBIDDEN_AGENT_REFERENCES = [
	"docs/ui-map.ascii.txt",
	"docs/ui-map.json",
	"docs/ui-map.mmd",
	".ai/mobile-ui-context.md",
];

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		help: { type: "boolean", short: "h", default: false },
	},
	strict: true,
});

if (values.help) {
	console.log("Usage: bun scripts/check-ai-contracts.ts");
	process.exit(0);
}

const projectRoot = process.cwd();
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

async function main() {
	const failures: string[] = [];
	const uiMapBundleRaw = await runCommand([
		process.execPath,
		path.resolve(projectRoot, "scripts/generate-ui-map.ts"),
		"--format",
		"bundle",
	]);
	let uiMapBundle: any = null;
	try {
		uiMapBundle = JSON.parse(uiMapBundleRaw);
	} catch {
		failures.push(
			"`bun run ui-map -- --format bundle` did not return valid JSON.",
		);
	}

	if (uiMapBundle) {
		const rootFile = uiMapBundle?.graph?.root?.file;
		if (rootFile !== "apps/mobile/src/app/_layout.tsx") {
			failures.push(
				`UI map root mismatch: expected apps/mobile/src/app/_layout.tsx, got ${rootFile ?? "unknown"}`,
			);
		}
		if (
			!uiMapBundle?.graph?.stats?.totalNodes ||
			uiMapBundle.graph.stats.totalNodes < 2
		) {
			failures.push("UI map is too shallow; expected at least 2 nodes.");
		}
		if (!uiMapBundle?.ascii?.trim()) {
			failures.push("UI map ascii output is empty.");
		}
		if (!uiMapBundle?.mermaid?.trim()) {
			failures.push("UI map mermaid output is empty.");
		}
	}

	const contextPack = await runCommand([
		process.execPath,
		path.resolve(projectRoot, "scripts/context-pack.ts"),
		"--mobileRoot",
		"apps/mobile",
	]);
	if (!contextPack.includes("# MOBILE UI CONTEXT PACK")) {
		failures.push(
			"`bun run context-pack:mobile` output is missing the context pack header.",
		);
	}
	if (!contextPack.includes("# UI TREE (ASCII)")) {
		failures.push(
			"`bun run context-pack:mobile` output is missing the UI tree section.",
		);
	}

	for (const agentPath of ["AGENTS.md", "apps/mobile/AGENTS.md"]) {
		const content = await Bun.file(path.resolve(projectRoot, agentPath)).text();
		for (const requiredReference of REQUIRED_AGENT_REFERENCES) {
			if (!content.includes(requiredReference)) {
				failures.push(
					`${agentPath} is missing required reference: ${requiredReference}`,
				);
			}
		}
		for (const forbiddenReference of FORBIDDEN_AGENT_REFERENCES) {
			if (content.includes(forbiddenReference)) {
				failures.push(
					`${agentPath} still references generated artifact path: ${forbiddenReference}`,
				);
			}
		}
	}

	if (failures.length > 0) {
		console.error("AI context contract checks failed:\n");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		console.error(
			"\nFix: keep the workflow command-driven. `bun run ui-map` and `bun run context-pack:mobile` must work without writing files, and AGENTS must describe that flow.",
		);
		process.exit(1);
	}

	console.log("AI context contracts OK");
}

main().catch((error) => {
	console.error("check-ai-contracts failed:", error?.message ?? error);
	process.exit(1);
});
