import { describe, expect, test } from "bun:test";
import { createRunFixture, createTaskFixture } from "./test-fixtures";
import { buildSupervisorRunTimeline } from "./timeline-model";

describe("supervisor run timeline model", () => {
  test("orders independent tasks without inventing sequential arrows", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({
          taskId: "t1",
          title: "Research A",
          status: "completed",
        }),
        createTaskFixture({
          taskId: "t2",
          title: "Research B",
          status: "running",
        }),
        createTaskFixture({
          taskId: "t3",
          title: "Write docs",
          status: "ready",
        }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    expect(model.stations[0]?.kind).toBe("plan");
    expect(model.stations.map((station) => station.label)).toEqual([
      "Plan",
      "Research A",
      "Research B",
      "Write docs",
      "Review",
      "Integration",
      "Verify",
      "Deliver",
    ]);
    expect(model.links).toEqual([]);
    expect(model.degraded).toBeNull();
  });

  test("creates dependency links only for declared dependencies", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({ taskId: "t1", status: "completed" }),
        createTaskFixture({
          taskId: "t2",
          status: "running",
          dependencies: ["t1"],
        }),
        createTaskFixture({
          taskId: "t3",
          status: "blocked",
          dependencies: ["t1"],
        }),
        createTaskFixture({
          taskId: "t4",
          status: "ready",
          dependencies: ["t2", "t3"],
        }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    const taskIds = model.stations.map((station) => station.taskId);
    expect(taskIds.filter(Boolean)).toEqual(["t1", "t2", "t3", "t4"]);
    const links = model.links.map((link) => {
      const from = model.stations[link.from]?.taskId;
      const to = model.stations[link.to]?.taskId;
      return `${from}->${to}`;
    });
    expect(new Set(links)).toEqual(
      new Set(["t1->t2", "t1->t3", "t2->t4", "t3->t4"])
    );
  });

  test("keeps topological order so dependencies render left of dependents", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({
          taskId: "late",
          status: "blocked",
          dependencies: ["early"],
        }),
        createTaskFixture({ taskId: "early", status: "completed" }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    const taskIds = model.stations
      .map((station) => station.taskId)
      .filter(Boolean);
    expect(taskIds).toEqual(["early", "late"]);
    const link = model.links[0];
    expect(model.stations[link.from]?.taskId).toBe("early");
    expect(model.stations[link.to]?.taskId).toBe("late");
  });

  test("degrades cyclic dependency data to input order without fabricated links", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({
          taskId: "a",
          status: "running",
          dependencies: ["b"],
        }),
        createTaskFixture({
          taskId: "b",
          status: "running",
          dependencies: ["a"],
        }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    expect(model.degraded).toBe("cyclic");
    expect(model.links).toEqual([]);
    expect(
      model.stations.map((station) => station.taskId).filter(Boolean)
    ).toEqual(["a", "b"]);
  });

  test("degrades unknown dependencies to input order with a flag, dropping dangling links", () => {
    const run = createRunFixture({
      tasks: [
        createTaskFixture({
          taskId: "a",
          status: "blocked",
          dependencies: ["ghost-task"],
        }),
        createTaskFixture({ taskId: "b", status: "ready" }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    expect(model.degraded).toBe("missing_dependency");
    expect(model.links).toEqual([]);
    expect(
      model.stations.map((station) => station.taskId).filter(Boolean)
    ).toEqual(["a", "b"]);
  });

  test("renders worker pills with real chat bindings and honest statuses", () => {
    const run = createRunFixture({
      status: "running",
      tasks: [
        createTaskFixture({
          taskId: "t1",
          title: "Implement",
          status: "completed",
          attempts: [
            {
              attemptId: "a1",
              chatId: "chat-1",
              agentId: "agent-a",
              status: "terminal",
              verification: [{ command: "bun test", exitCode: 1 }],
            },
            {
              attemptId: "a2",
              chatId: "chat-2",
              agentId: "agent-a",
              status: "terminal",
              verification: [{ command: "bun test", exitCode: 0 }],
            },
          ],
        }),
        createTaskFixture({
          taskId: "t2",
          title: "Waiting task",
          status: "ready",
          dependencies: ["t1"],
        }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    const implement = model.stations.find((station) => station.taskId === "t1");
    expect(implement?.pills).toHaveLength(2);
    expect(implement?.pills[0]?.status.kind).toBe("superseded");
    expect(implement?.pills[0]?.chatId).toBe("chat-1");
    expect(implement?.pills[1]?.status.kind).toBe("accepted");
    expect(implement?.rounds).toBe(2);
    const waiting = model.stations.find((station) => station.taskId === "t2");
    expect(waiting?.pills).toEqual([]);
    expect(waiting?.status.kind).toBe("ready");
  });

  test("marks plan station as needing approval and waiting capacity in planning", () => {
    const awaiting = createRunFixture({
      status: "awaiting_approval",
      plan: {
        version: 1,
        hash: "c".repeat(64),
        summary: "Plan",
        envelope: {
          goal: "g",
          fileScopes: [],
          verificationCommands: [],
          successCriteria: ["s"],
          permissionScopes: [],
          destructiveActions: [],
          delivery: {
            createCommit: true,
            targetBranch: "main",
            targetHead: "h",
            allowDefaultBranch: false,
          },
        },
      },
    });
    const model = buildSupervisorRunTimeline(awaiting);
    expect(model.stations[0]?.status.kind).toBe("awaiting_approval");
    expect(model.stations[0]?.detail).toContain("Plan v1");

    const planning = createRunFixture({ status: "planning", tasks: [] });
    expect(buildSupervisorRunTimeline(planning).stations[0]?.status.kind).toBe(
      "planning"
    );
  });

  test("keeps lifecycle stations upcoming until evidence exists", () => {
    const run = createRunFixture({
      status: "running",
      tasks: [createTaskFixture({ taskId: "t1", status: "running" })],
    });
    const model = buildSupervisorRunTimeline(run);
    const review = model.stations.find((station) => station.kind === "review");
    const integration = model.stations.find(
      (station) => station.kind === "integration"
    );
    const verification = model.stations.find(
      (station) => station.kind === "verification"
    );
    const delivery = model.stations.find(
      (station) => station.kind === "delivery"
    );
    expect(review?.status.kind).toBe("draft");
    expect(integration?.status.kind).toBe("draft");
    expect(verification?.status.kind).toBe("draft");
    expect(delivery?.status.kind).toBe("draft");
  });

  test("reflects completing, verification evidence, and delivery honestly", () => {
    const completing = createRunFixture({
      status: "completing",
      tasks: [createTaskFixture({ taskId: "t1", status: "completed" })],
      finalVerification: [{ command: "bun test", exitCode: null }],
    });
    const model = buildSupervisorRunTimeline(completing);
    expect(
      model.stations.find((station) => station.kind === "review")?.status.kind
    ).toBe("completed");
    expect(
      model.stations.find((station) => station.kind === "verification")?.status
        .kind
    ).toBe("running");
    expect(
      model.stations.find((station) => station.kind === "delivery")?.status.kind
    ).toBe("draft");

    const completed = createRunFixture({
      status: "completed",
      tasks: [createTaskFixture({ taskId: "t1", status: "completed" })],
      finalVerification: [
        { command: "bun test", exitCode: 0 },
        { command: "bun lint", exitCode: 0 },
      ],
      finalCommitSha: "abcdef1234567890",
    });
    const done = buildSupervisorRunTimeline(completed);
    expect(
      done.stations.find((station) => station.kind === "verification")?.status
        .kind
    ).toBe("completed");
    expect(
      done.stations.find((station) => station.kind === "verification")?.detail
    ).toContain("2/2");
    expect(
      done.stations.find((station) => station.kind === "delivery")?.detail
    ).toContain("abcdef123456");
  });

  test("renders a failed run's delivery station as failed, never as success", () => {
    const run = createRunFixture({
      status: "failed",
      tasks: [createTaskFixture({ taskId: "t1", status: "failed" })],
    });
    const model = buildSupervisorRunTimeline(run);
    expect(
      model.stations.find((station) => station.kind === "delivery")?.status.tone
    ).toBe("failed");
  });

  test("attaches the manager pill only when a real manager binding exists", () => {
    const withManager = createRunFixture({
      manager: {
        agentId: "manager-agent",
        chatId: "manager-chat",
        status: "running",
        exactResumeRequired: true,
      },
    });
    const model = buildSupervisorRunTimeline(withManager);
    expect(model.stations[0]?.pills).toHaveLength(1);
    expect(model.stations[0]?.pills[0]?.chatId).toBe("manager-chat");
    expect(model.stations[0]?.pills[0]?.kind).toBe("manager");

    const withoutManager = createRunFixture({});
    expect(
      buildSupervisorRunTimeline(withoutManager).stations[0]?.pills
    ).toEqual([]);
  });
});
