import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

const MAX_CONTEXT_CHARS = 16_000;
const MAX_MANAGER_TASKS = 4;
const MAX_MANAGER_JSON_CHARS = 12_000;
const MAX_MANAGER_DIRTY_PATHS = 32;
const AWWWARDS_ARENA_OBJECTIVE =
  /\b(?:awwwards?|arena)\b|(?:^|[\\/])demos[\\/]/i;

export function buildAcpManagerPrompt(input: {
  run: SupervisorRunState;
  turnKind: "plan" | "replan";
  requestedChanges?: string;
  projectIndexSummary?: string;
  scopeResolutionSummary?: string;
  trustedVerificationCommands?: string[];
}): string {
  const run = input.run;
  const context = {
    runId: run.runId,
    turnKind: input.turnKind,
    intent: run.originalIntent,
    constraints: run.constraints,
    priority: run.priority,
    outputLimits: {
      maxTasks: Math.min(run.limits.maxTasks, MAX_MANAGER_TASKS),
      maxJsonChars: MAX_MANAGER_JSON_CHARS,
    },
    project: {
      projectId: run.projectId,
      selectedRoot: run.projectRoot,
      branch: run.baseSnapshot.branch,
      head: run.baseSnapshot.head,
      dirtyPathCount: run.baseSnapshot.dirtyPaths.length,
      dirtyPaths: run.baseSnapshot.dirtyPaths.slice(0, MAX_MANAGER_DIRTY_PATHS),
    },
    eligibleAgentIds: run.agentAllowlist,
    trustedVerificationCommands: input.trustedVerificationCommands ?? [],
    approvedEnvelope:
      input.turnKind === "replan" && run.plan?.approvedAt
        ? run.plan.envelope
        : undefined,
    completedTasks: run.tasks
      .filter((task) => task.status === "completed")
      .map((task) => ({
        taskId: task.taskId,
        summary:
          [...task.attempts].reverse().find((attempt) => attempt.result)?.result
            ?.outcomeSummary ?? "completed with persisted evidence",
      })),
    requestedChanges: input.requestedChanges,
    projectIndexSummary: truncate(input.projectIndexSummary),
    scopeResolutionSummary: truncate(input.scopeResolutionSummary),
  };
  const arenaPlanningProtocol = AWWWARDS_ARENA_OBJECTIVE.test(
    [run.originalIntent, ...run.constraints].join("\n")
  )
    ? [
        "This is an AWWWARDS Arena entry. Plan one end-to-end implementation task per entry; that task owns research, art direction, implementation, responsive hardening, and visual QA so discoveries stay with the builder.",
        "Scope writes only to the exact new demos/<slug> directory. AGENTS.md, LIBRARY.md, WORLDS.md, TOOLBOX.md, SLOP-CHECKLIST.md, and components/ are read-only research sources and must never appear in scopeIntent or envelope.fileScopes.",
        "The task goal must explicitly require: read lab guidance; inspect LIBRARY.md before source; diverge into at least seven directions spanning at least five component categories; discard Direction 1; choose Direction 2-7 by a deterministic seed; and record the full provenance in PROJECT.md.",
        "The task goal must require deep inspection of at least three shortlisted components from at least three relevant categories. Read each selected GUIDE.md or DESIGN.md when present plus the actual HTML/CSS/JavaScript/TypeScript mechanism. Synthesize and re-theme; never paste a component verbatim and never inspect an unrequested demos/<slug> entry.",
        "When the user names an existing demo as the quality reference, the task goal must require a read-only benchmark audit of that exact entry. For crav-burgers, inspect its DESIGN.md, PROJECT.md, rendered contact sheet, asset inventory, HTML/CSS/JavaScript structure, viewport-scale typography, layered hero, scene-to-scene composition changes, and interaction set-pieces. Match its ambition and visual payoff without copying its layout, palette, assets, subject, or branded forms.",
        "The task goal must require an implementation-grade design contract before coding: thesis, own-world, visitor story, exact first viewport, form/seed, signature asset, scene hierarchy, motion/state choreography, responsive branches, accessibility/reduced-motion behavior, performance budget, and binary acceptance checks.",
        "Reject safe AI art direction before implementation. Every proposed direction must name a dominant first-viewport visual event, a credible high-fidelity signature-asset pipeline, a large-scale typography gesture, a color/shape system, and at least five compositionally distinct scenes. Restrained, dark, editorial, archival, specimen, ledger, or luxury language cannot substitute for spectacle, material fidelity, hierarchy, or scene variety.",
        "The task goal must bind a benchmark-relative creative gate: the first viewport reads at contact-sheet thumbnail size; the signature visual is neither a low-detail procedural placeholder nor generic stock; the subject remains identifiable when copy is hidden; sphere/disc/blob/gradient primitives cannot pass asset fidelity merely because their shader source is complex; at least four major scenes use visibly different spatial compositions and at least three are object-led rather than heading-led; mobile is re-authored rather than merely stacked; and the final contact sheet approaches the named reference in hierarchy, asset fidelity, color/shape authorship, interaction density, and memorable moments.",
        "The task goal must require a standalone entry package, an honest signature-asset pipeline or explicit constraint argument, DESIGN.md kept in sync, PROJECT.md component provenance and distill candidates, console-safe interactions, and visual QA at 390, 834, and 1600 widths across multiple exact scroll depths. No sampled viewport may be a fixed header over dead space.",
        "Use the configured trusted verification commands exactly and preserve their real exit codes without pipes, redirects, tails, wrappers, fallbacks, or alternate executables. Validation is the floor: completion also requires a rendered side-by-side contact-sheet audit by a vision-capable inspector against the named benchmark, the six-line design contract, and SLOP-CHECKLIST, with screenshot-specific visible observations and at least one correction-and-recapture pass when a visible defect or generic AI tell is found. Pre-build self-scores and source-code descriptions are not visual evidence. Missing, timed-out, or non-vision-audited visual evidence is a blocker, never inferred success.",
      ]
    : [];
  return [
    "You are the sticky ACP engineering manager for this goal.",
    "You are read-only: do not edit files, execute write tools, dispatch workers, or authorize transitions.",
    "Return exactly one JSON object and no markdown fence.",
    "An optional top-level runId may be included only when it exactly equals the supplied runId; include no other unspecified top-level keys.",
    `Keep the entire JSON response at or below ${MAX_MANAGER_JSON_CHARS} characters; use concise one-sentence strings and no more than ${Math.min(run.limits.maxTasks, MAX_MANAGER_TASKS)} tasks.`,
    "These output limits are hard: if you cannot comply, return a question turn instead of an oversized plan.",
    "Allowed kind values are plan, replan, question, continue, and complete.",
    "The top-level discriminator field is named kind. Never emit turnKind, even though turnKind appears in the supplied context.",
    "For plan/replan include schemaVersion=1, summary, risks, tasks, and envelope.",
    "Each task must have taskId, title, goal, role, executionMode, dependencies, optional candidateAgentId, optional preferredModelId, scopeIntent, and verificationRequirements.",
    "task.role must be exactly one of research, implementation, test, review, or integration; task.executionMode must be exactly read_only or write.",
    "task.dependencies, task.scopeIntent, and task.verificationRequirements must each be JSON arrays of strings, including when there is only one item; risks must also be an array of strings.",
    "Every task.scopeIntent item must be an exact repo-relative file path from envelope.fileScopes, never prose, an instruction, or a success criterion.",
    "All task and envelope paths are relative to project.selectedRoot. Never prefix the selected root folder name, never use an absolute path, and never add a trailing slash.",
    "Prefer the fewest safe directory roots in scopeIntent and envelope.fileScopes; a directory root covers its descendants, so do not enumerate files inside an allowed directory.",
    "Write tasks execute serially on the current branch. Combine research, implementation, and per-deliverable verification into each implementation task, then use one aggregate review task when needed; do not assume parallel write isolation and do not create separate research or per-deliverable verification tasks.",
    "Keep risks at 3 items or fewer, each task verificationRequirements at 2 items or fewer, envelope successCriteria at 4 items or fewer, and permissionScopes at 3 items or fewer.",
    "Worker task titles, goals, and verificationRequirements must omit every runtime-owned delivery, repository-mutation, credential, permission, and destructive-action term entirely. Do not repeat such terms even inside a negative prohibition: fail-closed safety classification scans the literal task text. Bind delivery authorization only in envelope.delivery and let the runtime enforce all worker restrictions.",
    "The envelope must bind goal, fileScopes, verificationCommands, successCriteria, permissionScopes, destructiveActions, and delivery.",
    "envelope.fileScopes, verificationCommands, successCriteria, permissionScopes, and destructiveActions must each be JSON arrays of strings.",
    "Use destructiveActions=[] when none are requested; never write placeholder values such as None.",
    "For plan/replan, copy the supplied intent verbatim into envelope.goal; never summarize, rewrite, or expand it.",
    "delivery must contain createCommit, targetBranch, targetHead, and allowDefaultBranch; createCommit must be true, allowDefaultBranch must be a boolean, and targetBranch/targetHead must equal the supplied current branch/head.",
    "Commands are requirements only; runtime trusted allowlists remain authoritative.",
    "Copy context.trustedVerificationCommands exactly into envelope.verificationCommands. Do not translate executable names, combine several commands into one string, or invent another command.",
    "Omit candidateAgentId unless context.eligibleAgentIds contains an exact id; when exactly one eligible id is supplied, use that exact value and no nickname.",
    "Omit preferredModelId unless the supplied intent explicitly requests an exact provider/model id. When requested, copy that id exactly without an effort suffix; the runtime validates and selects it before dispatch.",
    "Set delivery.allowDefaultBranch=true: explicit approval of this Supervisor plan authorizes the runtime's direct-branch before/after worker checkpoints and final commit on the supplied current branch.",
    "Ask a question when product ambiguity, scope expansion, destructive action, or success-criteria change is required.",
    ...arenaPlanningProtocol,
    JSON.stringify(context),
  ].join("\n\n");
}

function truncate(value: string | undefined): string | undefined {
  return value?.slice(0, MAX_CONTEXT_CHARS);
}
