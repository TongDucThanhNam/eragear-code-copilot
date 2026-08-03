import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const REQUIRED_ENV = [
  "MINIMAX_API_KEY",
  "ERAGEAR_SUPERVISOR_LIVE_AGENT_ID",
  "ERAGEAR_SUPERVISOR_LIVE_PROJECT_ROOT",
  "SUPERVISOR_ORCHESTRATION_VERIFICATION_COMMANDS",
] as const;

if (process.env.ERAGEAR_SUPERVISOR_LIVE !== "1") {
  throw new Error(
    "Live supervisor orchestration smoke requires ERAGEAR_SUPERVISOR_LIVE=1"
  );
}
for (const key of REQUIRED_ENV) {
  if (!process.env[key]?.trim()) {
    throw new Error(`Live supervisor orchestration smoke requires ${key}`);
  }
}

const projectRoot = path.resolve(
  process.env.ERAGEAR_SUPERVISOR_LIVE_PROJECT_ROOT ?? ""
);
const requiredAgentId = process.env.ERAGEAR_SUPERVISOR_LIVE_AGENT_ID ?? "";
const [{ createAppComposition }, { LOCAL_DESKTOP_USER_ID }] = await Promise.all(
  [
    import("../src/bootstrap/composition"),
    import("../src/platform/auth/local-desktop-user"),
  ]
);
const composition = await createAppComposition([projectRoot]);

try {
  await composition.deps.lifecycle.prepareStartup();
  await composition.deps.useCases.agent.ensureDefaults.execute(
    LOCAL_DESKTOP_USER_ID
  );
  const configured = await composition.deps.useCases.agent.list.execute(
    LOCAL_DESKTOP_USER_ID,
    null
  );
  if (!configured.agents.some((agent) => agent.id === requiredAgentId)) {
    throw new Error(
      `Required live ACP agent is not configured: ${requiredAgentId}`
    );
  }
  const started =
    await composition.deps.useCases.supervisorOrchestration.orchestrator.start({
      userId: LOCAL_DESKTOP_USER_ID,
      projectRoot,
      originalIntent:
        process.env.ERAGEAR_SUPERVISOR_LIVE_INTENT?.trim() ||
        "Inspect this repository with at least two independent read-only workers, then use one dependent verification worker to produce a structured result. Do not modify files.",
      constraints: [
        `Use configured agent ${requiredAgentId}`,
        "Prefer read-only tasks for this live smoke",
        "Return the required structured JSON evidence",
      ],
      limits: { maxConcurrency: 2, maxTasks: 6, maxAttemptsPerTask: 1 },
    });
  console.log(
    `SUPERVISOS_LIVE_PLAN ${started.runId} tasks=${started.tasks.length}`
  );

  const deadline = Date.now() + 10 * 60 * 1000;
  let workersMarked = false;
  while (Date.now() < deadline) {
    const run =
      await composition.deps.useCases.supervisorOrchestration.orchestrator.get(
        started.runId,
        LOCAL_DESKTOP_USER_ID
      );
    if (!run) {
      throw new Error("Live supervisor run disappeared");
    }
    const workerChats = run.tasks.flatMap((task) =>
      task.attempts.map((attempt) => attempt.chatId)
    );
    if (!workersMarked && new Set(workerChats).size >= 2) {
      workersMarked = true;
      console.log(`SUPERVISOS_LIVE_WORKERS ${workerChats.join(",")}`);
    }
    if (run.gates.length > 0 || run.status === "needs_user") {
      console.log(
        `SUPERVISOS_LIVE_GATE ${run.gates.map((gate) => `${gate.kind}:${gate.status}`).join(",") || "needs_user"}`
      );
    }
    if (run.status === "completed") {
      console.log(
        `SUPERVISOS_LIVE_GATE ${run.gates.length === 0 ? "safe" : "resolved"}`
      );
      console.log(
        `SUPERVISOS_LIVE_COMPLETE ${run.runId} verification=${run.finalVerification.length}`
      );
      process.exitCode = 0;
      break;
    }
    if (
      run.status === "needs_user" ||
      run.status === "failed" ||
      run.status === "cancelled"
    ) {
      throw new Error(`Live supervisor run stopped in ${run.status}`);
    }
    await delay(1000);
  }
  if (Date.now() >= deadline) {
    throw new Error("Live supervisor orchestration smoke timed out");
  }
} finally {
  await composition.dispose();
}
