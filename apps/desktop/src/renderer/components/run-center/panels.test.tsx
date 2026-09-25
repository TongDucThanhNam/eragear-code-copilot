import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NeedsAttentionPanel } from "./needs-attention-panel";
import { getRunAttentionItems, getRunWaitingRows } from "./run-display";
import { createRunFixture, createTaskFixture } from "./test-fixtures";
import { RunWaitingList } from "./waiting-panel";

const FIXNOW = Date.parse("2026-09-21T11:05:00.000Z");

describe("NeedsAttentionPanel", () => {
  test("renders user gates and machine gates with distinct authorities", () => {
    const run = createRunFixture({
      status: "running",
      gates: [
        {
          gateId: "gate-1",
          taskId: "task-1",
          attemptId: "attempt-1",
          kind: "deletion",
          status: "pending",
        },
        {
          gateId: "gate-2",
          taskId: "task-1",
          attemptId: "attempt-1",
          kind: "verification",
          status: "pending",
        },
      ],
    });
    const items = getRunAttentionItems(run);
    const html = renderToStaticMarkup(
      <NeedsAttentionPanel items={items} onAction={() => undefined} />
    );
    expect(html.split('data-testid="needs-attention-item"').length - 1).toBe(2);
    expect(html).toContain('data-authority="user"');
    expect(html).toContain('data-authority="machine"');
    // Machine gate: no buttons, explicit non-approvability.
    expect(html).toContain("not by user approval");
    expect(html).toContain("Your approval");
  });

  test("disabled actions keep their reason visible", () => {
    const run = createRunFixture({
      status: "running",
      decisions: [
        {
          decisionId: "dec-1",
          kind: "goal_criteria_acceptance",
          prompt: "Was the criterion met?",
          status: "open",
          criterionIds: ["crit-1"],
          createdAt: "2026-09-21T10:40:00.000Z",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <NeedsAttentionPanel
        items={getRunAttentionItems(run)}
        onAction={() => undefined}
      />
    );
    expect(html).toContain("A review note is required to waive");
    expect(html).toContain('disabled=""');
  });

  test("empty state is explicit", () => {
    const html = renderToStaticMarkup(
      <NeedsAttentionPanel items={[]} onAction={() => undefined} />
    );
    expect(html).toContain('data-testid="needs-attention-empty"');
    expect(html).toContain("Nothing needs your attention.");
  });
});

describe("RunWaitingList", () => {
  test("quota wait shows cause, owner, and provider reset time", () => {
    const run = createRunFixture({
      status: "waiting_capacity",
      tasks: [
        createTaskFixture({
          taskId: "task-1",
          title: "Implement feature",
          status: "waiting_capacity",
        }),
      ],
      capacityWaits: [
        {
          waitId: "wait-1",
          owner: "task",
          taskId: "task-1",
          agentId: "worker-a",
          kind: "quota_exhausted",
          retryAt: "2026-09-21T11:30:00.000Z",
          resetAt: "2026-09-21T12:00:00.000Z",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <RunWaitingList nowMs={FIXNOW} rows={getRunWaitingRows(run, [run])} />
    );
    expect(html).toContain("Quota");
    expect(html).toContain("Worker for “Implement feature”");
    expect(html).toContain("resets");
  });

  test("waits without any known time say so instead of inventing one", () => {
    const blocker = createRunFixture({
      runId: "run-writer",
      status: "running",
      tasks: [
        createTaskFixture({
          taskId: "task-w",
          executionMode: "write",
          status: "running",
          attempts: [
            {
              attemptId: "a1",
              chatId: "c1",
              agentId: "w",
              status: "running",
              verification: [],
            },
          ],
        }),
      ],
    });
    const queued = createRunFixture({
      runId: "run-queued",
      status: "queued",
      tasks: [
        createTaskFixture({
          taskId: "task-q",
          executionMode: "write",
          status: "ready",
        }),
      ],
    });
    const html = renderToStaticMarkup(
      <RunWaitingList
        nowMs={FIXNOW}
        rows={getRunWaitingRows(queued, [queued, blocker])}
      />
    );
    expect(html).toContain("Repository busy");
    expect(html).toContain("no time estimate");
  });

  test("human waits are flagged as waiting on you, not as elapsed-time waits", () => {
    const run = createRunFixture({
      status: "waiting_capacity",
      capacityWaits: [
        {
          waitId: "wait-auth",
          owner: "manager",
          agentId: "manager-a",
          kind: "auth_required",
          retryAt: "2026-09-21T11:40:00.000Z",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <RunWaitingList nowMs={FIXNOW} rows={getRunWaitingRows(run, [run])} />
    );
    expect(html).toContain("waiting on you");
    // Human waits still show the provider retry estimate when one exists —
    // but they are marked as waiting on the user, not as an elapsed-time wait.
    expect(html).toContain("retry in");
    expect(html).toContain("Sign-in required");
  });
});
