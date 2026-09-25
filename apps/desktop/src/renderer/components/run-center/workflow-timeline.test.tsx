import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LifecycleSpine } from "./lifecycle-spine";
import { createRunFixture, createTaskFixture } from "./test-fixtures";
import { buildSupervisorRunTimeline } from "./timeline-model";
import { SupervisorWorkflowTimeline } from "./workflow-timeline";

describe("SupervisorWorkflowTimeline", () => {
  test("renders stations, dependency arcs, and selectable heads", () => {
    const run = createRunFixture({
      status: "running",
      tasks: [
        createTaskFixture({
          taskId: "task-a",
          title: "Research",
          status: "completed",
          dependencies: [],
        }),
        createTaskFixture({
          taskId: "task-b",
          title: "Implement",
          status: "running",
          dependencies: ["task-a"],
        }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    const html = renderToStaticMarkup(
      <SupervisorWorkflowTimeline model={model} />
    );
    expect(html).toContain('data-testid="supervisor-workflow-timeline"');
    expect(html).toContain("Research");
    expect(html).toContain("Implement");
    // One declared dependency → exactly one arc.
    expect(html.split('data-testid="run-timeline-arc"').length - 1).toBe(1);
    // All 2 + 4 + 1 = 7 stations render as buttons.
    expect(html.split('data-testid="run-timeline-station"').length - 1).toBe(7);
    expect(html).not.toContain('data-testid="run-timeline-degraded"');
  });

  test("shows the degraded notice instead of invented arcs on cyclic data", () => {
    const run = createRunFixture({
      status: "running",
      tasks: [
        createTaskFixture({ taskId: "task-a", dependencies: ["task-b"] }),
        createTaskFixture({ taskId: "task-b", dependencies: ["task-a"] }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    const html = renderToStaticMarkup(
      <SupervisorWorkflowTimeline model={model} />
    );
    expect(model.degraded).toBe("cyclic");
    expect(html).toContain('data-testid="run-timeline-degraded"');
    expect(html.split('data-testid="run-timeline-arc"').length - 1).toBe(0);
  });

  test("agent pills open only with a real chat binding", () => {
    const run = createRunFixture({
      status: "running",
      manager: {
        agentId: "agent-manager",
        chatId: "chat-manager",
        status: "running",
        exactResumeRequired: true,
      },
      tasks: [
        createTaskFixture({
          taskId: "task-a",
          status: "running",
          attempts: [
            {
              attemptId: "attempt-1",
              agentId: "worker-a",
              status: "running",
              chatId: "chat-worker-a",
              verification: [],
            },
            {
              attemptId: "attempt-0",
              agentId: "worker-a",
              status: "terminal",
              chatId: "",
              verification: [],
            },
          ],
        }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    const html = renderToStaticMarkup(
      <SupervisorWorkflowTimeline model={model} onOpenChat={() => undefined} />
    );
    // Two openable pills (manager + live worker attempt)…
    expect(html.split('data-testid="run-agent-pill"').length - 1).toBe(2);
    // …and one honest inert pill for the failed attempt without a chat binding.
    expect(html.split('data-testid="run-agent-pill-inert"').length - 1).toBe(1);
    expect(html).toContain("Open worker chat for worker-a");
  });

  test("retry marker renders once a task has multiple attempts", () => {
    const run = createRunFixture({
      status: "running",
      tasks: [
        createTaskFixture({
          taskId: "task-a",
          status: "running",
          attempts: [
            {
              attemptId: "a1",
              agentId: "w",
              status: "terminal",
              chatId: "",
              verification: [],
            },
            {
              attemptId: "a2",
              agentId: "w",
              status: "running",
              chatId: "c2",
              verification: [],
            },
          ],
        }),
      ],
    });
    const html = renderToStaticMarkup(
      <SupervisorWorkflowTimeline model={buildSupervisorRunTimeline(run)} />
    );
    expect(html).toContain("×2");
  });
});

describe("LifecycleSpine", () => {
  test("renders an ordered list of the same stations", () => {
    const run = createRunFixture({
      status: "running",
      tasks: [
        createTaskFixture({
          taskId: "task-a",
          title: "Research",
          status: "running",
        }),
        createTaskFixture({
          taskId: "task-b",
          title: "Implement",
          status: "blocked",
          dependencies: ["task-a"],
        }),
      ],
    });
    const model = buildSupervisorRunTimeline(run);
    const html = renderToStaticMarkup(<LifecycleSpine model={model} />);
    expect(html).toContain('data-testid="lifecycle-spine"');
    expect(html).toContain("<ol");
    expect(html.split('data-testid="run-spine-station"').length - 1).toBe(7);
    // Blocked task gets its dependency reason, not a guessed status.
    expect(html).toContain("Waiting on");
  });

  test("selection state is exposed through aria-pressed", () => {
    const run = createRunFixture({
      status: "running",
      tasks: [createTaskFixture({ taskId: "task-a", status: "running" })],
    });
    const model = buildSupervisorRunTimeline(run);
    const html = renderToStaticMarkup(
      <LifecycleSpine
        model={model}
        onSelectStation={() => undefined}
        selectedStationId="station:task:task-a"
      />
    );
    expect(html).toContain('aria-pressed="true"');
  });
});
