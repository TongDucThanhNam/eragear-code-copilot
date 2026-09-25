"use strict";
// Interactive Run Center verification against the ACTUAL application renderer
// (index.html -> main.tsx -> TanStack router) with an isolated mocked
// transport (scripts/run-center-mock-bridge.cjs). Drives real browser
// clicks and keyboard input, records every tRPC operation the UI issues,
// asserts exact mutation payloads, and collects console errors. Fixture data
// only: no runtime process, no ACP session, no provider, no real authority.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

app.setPath(
  "userData",
  path.join(os.tmpdir(), `run-center-interactions-${Date.now()}`)
);
// The harness recreates its window between some steps; without this Electron
// would quit the app as soon as the old window is destroyed.
app.on("window-all-closed", () => {
  // Recreating windows between steps must not quit the harness app.
});

const baseUrl = process.env.RUN_CENTER_INTERACTIONS_URL;
const outDir = process.env.RUN_CENTER_INTERACTIONS_OUT_DIR;

const stepResults = [];
const consoleMessages = [];
let win;

function log(message) {
  console.log(`[run-center-interactions] ${message}`);
}

/** Fresh offscreen window at an exact content size (no resize events fired). */
function createMainWindow(width, height) {
  win = new BrowserWindow({
    width,
    height,
    show: false,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "run-center-mock-bridge.cjs"),
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  win.webContents.on("console-message", (_event, level, message) => {
    consoleMessages.push({ level, message: String(message).slice(0, 400) });
  });
  return win;
}

async function evalJs(code) {
  const result = await win.webContents.executeJavaScript(code, true);
  return result;
}

async function waitForSelector(selector, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = await evalJs(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`
    );
    if (found) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function currentUrl() {
  return evalJs("window.location.href");
}

async function screenshot(name) {
  const image = await win.webContents.capturePage();
  if (image.isEmpty()) {
    log(`WARN: empty frame for ${name}`);
    return;
  }
  fs.writeFileSync(
    path.join(outDir, "screens", "interactions", `${name}.png`),
    image.toPNG()
  );
}

async function step(name, fn) {
  try {
    const details = await fn();
    stepResults.push({ name, ok: true, details: details ?? null });
    log(`PASS ${name}`);
  } catch (error) {
    stepResults.push({
      name,
      ok: false,
      details: {
        error: String(error?.message ?? error),
      },
    });
    log(`FAIL ${name}: ${error}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findButtonByText(itemSelector, text) {
  return `const button = (() => {
    const item = document.querySelector(${JSON.stringify(itemSelector)});
    if (!item) return null;
    for (const candidate of item.querySelectorAll("button")) {
      if ((candidate.textContent || "").trim() === ${JSON.stringify(text)}) {
        return candidate;
      }
    }
    return null;
  })();`;
}

function clickButtonInItem(itemSelector, text) {
  return evalJs(`
    (() => {
      ${findButtonByText(itemSelector, text)}
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
}

function setInputValue(selector, value) {
  return evalJs(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()
  `);
}

function recordedOperations() {
  return evalJs("window.__ERAGEAR_MOCK__.getOperations()");
}

function configureMock(key, path, value) {
  const method = key === "delayMs" ? "setDelay" : "setRejection";
  return evalJs(
    `window.__ERAGEAR_MOCK__.${method}(${JSON.stringify(path)}, ${JSON.stringify(value)})`
  );
}

async function waitForOperation(path, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ops = await recordedOperations();
    const match = ops.filter((op) => op.path === path);
    if (match.length > 0) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`no recorded operation for ${path}`);
}

async function navigateAndWait(url, selector) {
  await win.loadURL(url);
  const found = await waitForSelector(selector);
  assert(found, `selector never appeared: ${selector}`);
}

async function navigateToRun(runId) {
  await win.loadURL(`${baseUrl}/runs?runId=${runId}`);
  const found = await waitForSelector(
    `[data-testid="run-workspace"][data-run-id="${runId}"]`
  );
  assert(found, `workspace for ${runId} never appeared`);
}

/**
 * Workspace tab triggers carry an attention-count badge span, so their
 * textContent is e.g. "Overview3"; strip trailing digits. Scoping to the
 * workspace tablist also avoids the Run Center group tabs, which are
 * unrelated role="tab" buttons ("Attention2" etc.).
 */
function workspaceTabScript(label, body) {
  return `
    (() => {
      const tabs = document.querySelectorAll(
        '[role="tablist"][aria-label="Run workspace views"] [role="tab"]'
      );
      const labelOf = (tab) =>
        (tab.textContent || "").trim().replace(/\\d+$/, "").trim();
      const tab = [...tabs].find((candidate) => labelOf(candidate) === ${JSON.stringify(label)});
      if (!tab) {
        return { ok: false, seen: [...tabs].map(labelOf) };
      }
      ${body}
    })()
  `;
}

/**
 * Click through real trusted input events at the trigger's coordinates —
 * closer to a user click than element.click() for Radix activation, and the
 * coordinates prove the trigger is actually on screen.
 */
async function activateWorkspaceTab(label) {
  const target = await evalJs(
    workspaceTabScript(
      label,
      `const rect = tab.getBoundingClientRect();
       tab.setAttribute("data-harness-tab", "1");
       return {
         ok: true,
         seen: [],
         rect: {
           x: Math.round(rect.left + rect.width / 2),
           y: Math.round(rect.top + rect.height / 2),
         },
       };`
    )
  );
  assert(
    target.ok,
    `tab trigger not found: ${label} (saw ${JSON.stringify(target.seen)})`
  );
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: target.rect.x,
    y: target.rect.y,
    button: "left",
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: target.rect.x,
    y: target.rect.y,
    button: "left",
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

function selectedWorkspaceTab() {
  return evalJs(`
    (() => {
      const tabs = document.querySelectorAll(
        '[role="tablist"][aria-label="Run workspace views"] [role="tab"]'
      );
      const labelOf = (tab) =>
        (tab.textContent || "").trim().replace(/\\d+$/, "").trim();
      const selected = [...tabs].find(
        (tab) => tab.getAttribute("aria-selected") === "true"
      );
      return selected ? labelOf(selected) : null;
    })()
  `);
}

async function main() {
  await app.whenReady();
  fs.mkdirSync(path.join(outDir, "screens", "interactions"), {
    recursive: true,
  });
  createMainWindow(1360, 900);
  // ---- Phase A: real-route integration walkthrough ------------------------
  await step(
    "A1 load /runs via the real app router with mocked transport",
    async () => {
      await navigateAndWait(
        `${baseUrl}/runs`,
        '[data-testid="run-center-list"]'
      );
      const sidebar = await evalJs(
        "Boolean(document.querySelector('a[href=\"/runs\"]'))"
      );
      assert(sidebar, "sidebar Run Center link missing on /runs");
      const attentionItem = await evalJs(
        `(() => {
        const items = [...document.querySelectorAll('[data-testid="run-center-item"]')];
        return items.map((item) => (item.textContent || "").trim()).join(" | ");
      })()`
      );
      assert(
        attentionItem.includes("Needs your approval"),
        `attention group does not list the approval run: ${attentionItem}`
      );
      await screenshot("01-runs-route-live");
      return { attentionListItem: attentionItem };
    }
  );

  await step(
    "A2 select a run from the Run Center list opens its workspace",
    async () => {
      await evalJs(
        "document.querySelector('[data-testid=\"run-center-item\"]').click()"
      );
      assert(
        await waitForSelector('[data-testid="run-workspace"]'),
        "workspace did not open after selecting a run"
      );
      const runId = await evalJs(
        'document.querySelector(\'[data-testid="run-workspace"]\').getAttribute("data-run-id")'
      );
      assert(runId === "run-approve", `expected run-approve, got ${runId}`);
      assert(
        (await currentUrl()).includes("runId=run-approve"),
        "URL does not carry the selected runId"
      );
      await screenshot("02-workspace-overview-selected");
      return { selectedRunId: runId, url: await currentUrl() };
    }
  );

  await step(
    "A3 all six tabs render live content via mouse clicks",
    async () => {
      await navigateToRun("run-branch");
      const expectations = [
        ["Overview", "needs-attention-panel"],
        ["Workflow", "supervisor-workflow-timeline"],
        ["Tasks", "workspace-task"],
        ["Changes", "workspace-changes"],
        ["Evidence", "workspace-evidence"],
        ["Logs", "run-logs"],
      ];
      const seen = [];
      for (const [label, selector] of expectations) {
        await activateWorkspaceTab(label);
        assert(
          (await selectedWorkspaceTab()) === label,
          `clicking tab ${label} did not activate it (selected ${await selectedWorkspaceTab()})`
        );
        assert(
          await waitForSelector(`[data-testid="${selector}"]`),
          `tab ${label} did not render ${selector}`
        );
        seen.push(`${label}->${selector}`);
      }
      await screenshot("03-workspace-evidence-tab");
      return { tabs: seen };
    }
  );

  await step("A4 keyboard moves between tabs (Radix arrow keys)", async () => {
    await activateWorkspaceTab("Tasks");
    assert(
      (await selectedWorkspaceTab()) === "Tasks",
      "Tasks tab did not activate before the keyboard test"
    );
    // Arrow-key roving focus moves element focus, but Chromium suppresses
    // focus events (and Radix's automatic activation) until the frame itself
    // is focused. Surface and focus the window for this keyboard step, then
    // hide it again afterwards.
    win.show();
    win.focus();
    app.focus({ steal: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const frameFocused = await evalJs("document.hasFocus()");
    await evalJs(
      workspaceTabScript(
        "Tasks",
        `window.__harnessKeys = [];
         window.__evts = [];
         document.addEventListener(
           "keydown",
           (event) => {
             window.__harnessKeys.push({ key: event.key, target: event.target.tagName });
           },
           true
         );
         document.addEventListener(
           "keydown",
           (event) => {
             window.__evts.push({
               at: "doc-bubble",
               key: event.key,
               defaultPrevented: event.defaultPrevented,
             });
           },
           false
         );
         document.addEventListener(
           "focusin",
           (event) => window.__evts.push({ at: "focusin", id: event.target.id }),
           true
         );
         tab.focus();
         return { ok: true, focused: document.activeElement === tab, seen: [] };`
      )
    );
    win.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "Right",
      windowsVirtualKeyCode: 39,
      code: "ArrowRight",
    });
    win.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: "Right",
      windowsVirtualKeyCode: 39,
      code: "ArrowRight",
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const active = await selectedWorkspaceTab();
    if (active !== "Changes") {
      const probe = await evalJs(`(() => {
        const before = document.activeElement?.textContent;
        const tabs = [...document.querySelectorAll(
          '[role="tablist"][aria-label="Run workspace views"] [role="tab"]'
        )];
        const changes = tabs.find((tab) =>
          (tab.textContent || "").trim().replace(/\\d+$/, "").trim() === "Changes"
        );
        changes.focus();
        return {
          frameFocused: document.hasFocus(),
          focusBefore: (before || "").slice(0, 20),
          focusAfterDirect: (document.activeElement?.textContent || "").slice(0, 20),
          changesVisible: Boolean(changes.offsetParent),
          changesTabIndex: changes.tabIndex,
        };
      })()`);
      const evts = await evalJs("window.__evts");
      throw new Error(
        `ArrowRight from Tasks selected "${active}" (probe: ${JSON.stringify(probe)}, events: ${JSON.stringify(evts)})`
      );
    }
    // Move back for the next steps.
    win.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "Left",
      windowsVirtualKeyCode: 37,
      code: "ArrowLeft",
    });
    win.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: "Left",
      windowsVirtualKeyCode: 37,
      code: "ArrowLeft",
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const restored = await selectedWorkspaceTab();
    // Keep the window shown for the rest of the run: hiding an offscreen
    // window breaks the capture surface for later screenshots.
    return {
      selectedAfterArrowRight: active,
      selectedAfterArrowLeft: restored,
      frameFocused,
    };
  });

  await step(
    "A5 selecting a station opens the inspector with prompt and pills",
    async () => {
      await navigateToRun("run-branch");
      await activateWorkspaceTab("Workflow");
      await waitForSelector('[data-testid="supervisor-workflow-timeline"]');
      const stations = await evalJs(
        "document.querySelectorAll('[data-testid=\"run-timeline-station\"]').length"
      );
      assert(stations >= 3, `expected >=3 stations, got ${stations}`);
      await evalJs(`
      (() => {
        const station = [...document.querySelectorAll('[data-testid="run-timeline-station"]')]
          .find((station) => (station.textContent || "").includes("Implement feature"));
        station.click();
        return true;
      })()
    `);
      assert(
        await waitForSelector('[data-testid="run-station-inspector"]'),
        "inspector did not open on station select"
      );
      const inspector = await evalJs(
        "document.querySelector('[data-testid=\"run-station-inspector\"]').textContent"
      );
      assert(
        inspector.includes("Implement the export pipeline"),
        "inspector does not show the task prompt"
      );
      assert(
        inspector.includes("worker-b2"),
        "inspector does not list the worker pill"
      );
      await screenshot("04-station-inspector");
      return {
        stationCount: stations,
        inspectorHasPrompt: inspector.includes("Implement the export pipeline"),
        inspectorHasWorkerPill: inspector.includes("worker-b2"),
      };
    }
  );

  await step(
    "A6 exact historical worker chat id navigation from an attempt",
    async () => {
      await activateWorkspaceTab("Tasks");
      await waitForSelector('[data-testid="workspace-task"]');
      const clicked = await evalJs(`
      (() => {
        const card = document.querySelector('[data-task-id="task-b"]');
        if (!card) return "no task-b card";
        const button = [...card.querySelectorAll("button")]
          .find((button) => /Open worker chat for attempt 2/.test(button.getAttribute("aria-label") || ""));
        if (!button) return "no attempt-2 chat button";
        button.click();
        return "clicked";
      })()
    `);
      assert(clicked === "clicked", `worker chat button: ${clicked}`);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const url = await currentUrl();
      assert(
        url.includes("/?chatId=chat-worker-b2"),
        `expected exact worker chat id in URL, got ${url}`
      );
      await screenshot("05-worker-chat-route");
      return { navigatedTo: url };
    }
  );

  await step(
    "A7 back returns to the same run workspace with context",
    async () => {
      await win.webContents.executeJavaScript("history.back()", true);
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert(
        await waitForSelector('[data-testid="run-workspace"]'),
        "back did not restore the run workspace"
      );
      const runId = await evalJs(
        'document.querySelector(\'[data-testid="run-workspace"]\').getAttribute("data-run-id")'
      );
      assert(
        runId === "run-branch",
        `back restored ${runId}, expected run-branch`
      );
      await screenshot("06-back-on-run-branch");
      return { restoredRunId: runId, url: await currentUrl() };
    }
  );

  await step("A8 Mission Control entry opens the run workspace", async () => {
    await navigateAndWait(
      `${baseUrl}/mission-control`,
      '[data-testid="mission-control-open-workspace"]'
    );
    await evalJs(
      "document.querySelector('[data-testid=\"mission-control-open-workspace\"]').click()"
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    const url = await currentUrl();
    assert(
      url.includes("/runs") && url.includes("runId="),
      `Mission Control Open did not navigate to /runs: ${url}`
    );
    await screenshot("07-mission-control-entry");
    return { navigatedTo: url };
  });

  await step(
    "A9 chat rail entry: Supervisos Runs surface links into Run Center",
    async () => {
      await navigateAndWait(
        `${baseUrl}/?chatId=chat-main`,
        '[aria-label="Supervised runs"]'
      );
      const clicked = await evalJs(`
      (() => {
        const section = document.querySelector('[aria-label="Supervised runs"]');
        const button = [...section.querySelectorAll("button")]
          .find((button) => (button.textContent || "").includes("Open Run Center"));
        if (!button) return false;
        button.click();
        return true;
      })()
    `);
      assert(
        clicked,
        "Open Run Center button not found in the chat rail surface"
      );
      await new Promise((resolve) => setTimeout(resolve, 700));
      const url = await currentUrl();
      assert(url.includes("/runs"), `Open Run Center navigated to ${url}`);
      await screenshot("08-chat-entry-to-run-center");
      return { navigatedTo: url };
    }
  );

  // ---- Phase B: authority mutations with recorded payloads ----------------
  await step("B1 machine gates expose no approval path", async () => {
    await navigateAndWait(
      `${baseUrl}/runs?runId=run-approve`,
      '[data-testid="needs-attention-panel"]'
    );
    const machineButtons = await evalJs(`
      (() => {
        const item = document.querySelector(
          '[data-testid="needs-attention-item"][data-kind="machine_gate"]'
        );
        if (!item) return null;
        return item.querySelectorAll("button").length;
      })()
    `);
    assert(machineButtons !== null, "no machine_gate attention item rendered");
    assert(
      machineButtons === 0,
      `machine gate exposes ${machineButtons} buttons — must expose none`
    );
    await screenshot("09-machine-gate-no-buttons");
    return { machineGateButtonCount: machineButtons };
  });

  await step(
    "B2 approve plan sends exact planVersion/hash/revision payload",
    async () => {
      const clicked = await clickButtonInItem(
        '[data-testid="needs-attention-item"][data-kind="plan_approval"]',
        "Approve plan"
      );
      assert(clicked, "Approve plan button missing on plan_approval item");
      const ops = await waitForOperation("supervisorRuns.approvePlan");
      const payload = ops.at(-1).input;
      assert(
        JSON.stringify(payload) ===
          JSON.stringify({
            runId: "run-approve",
            planVersion: 2,
            planHash: "feedfacefeedfacefeedfacefeedface",
            expectedRevision: 4,
          }),
        `approvePlan payload mismatch: ${JSON.stringify(payload)}`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const toast = await evalJs(
        'Boolean([...document.querySelectorAll("[data-sonner-toast]")].find((toast) => toast.textContent.includes("Supervisor plan approved")))'
      );
      assert(toast, "success toast for plan approval not visible");
      await screenshot("10-approve-plan-payload");
      return { payload };
    }
  );

  await step("B3 request-changes carries the typed note", async () => {
    await navigateAndWait(
      `${baseUrl}/runs?runId=run-approve`,
      '[data-testid="needs-attention-panel"]'
    );
    const note = "Tighten the file scope to src/export/**";
    const typed = await setInputValue(
      '[data-testid="needs-attention-item"][data-kind="plan_approval"] input',
      note
    );
    assert(typed, "plan changes draft input not found");
    const clicked = await clickButtonInItem(
      '[data-testid="needs-attention-item"][data-kind="plan_approval"]',
      "Request changes"
    );
    assert(clicked, "Request changes button missing");
    const ops = await waitForOperation("supervisorRuns.requestPlanChanges");
    const payload = ops.at(-1).input;
    assert(
      payload.requestedChanges === note && payload.runId === "run-approve",
      `requestPlanChanges payload mismatch: ${JSON.stringify(payload)}`
    );
    return { payload };
  });

  await step(
    "B4 decision accept records explicit criterion acceptance",
    async () => {
      await navigateAndWait(
        `${baseUrl}/runs?runId=run-approve`,
        '[data-testid="needs-attention-panel"]'
      );
      const clicked = await clickButtonInItem(
        '[data-testid="needs-attention-item"][data-kind="decision"]',
        "Accept criterion"
      );
      assert(clicked, "Accept criterion button missing");
      const ops = await waitForOperation("supervisorRuns.answerDecision");
      const payload = ops.at(-1).input;
      assert(
        payload.decisionId === "dec-1" &&
          payload.criterionResolution === "accept" &&
          payload.answer === "Accepted after explicit user review." &&
          payload.expectedRevision === 4,
        `accept payload mismatch: ${JSON.stringify(payload)}`
      );
      return { payload };
    }
  );

  await step("B5 waive requires a note and records it verbatim", async () => {
    await navigateAndWait(
      `${baseUrl}/runs?runId=run-approve`,
      '[data-testid="needs-attention-panel"]'
    );
    const waiveSelector =
      '[data-testid="needs-attention-item"][data-kind="decision"]';
    const disabledBefore = await evalJs(`
      (() => {
        const item = document.querySelector(${JSON.stringify(waiveSelector)});
        const button = [...item.querySelectorAll("button")]
          .find((button) => (button.textContent || "").trim() === "Waive with note");
        return button ? button.disabled : null;
      })()
    `);
    assert(disabledBefore === true, "waive was enabled without a note");
    const note = "Tests verified locally by me";
    await setInputValue(`${waiveSelector} input`, note);
    const clicked = await clickButtonInItem(waiveSelector, "Waive with note");
    assert(clicked, "Waive with note button missing");
    const ops = await waitForOperation("supervisorRuns.answerDecision");
    const payload = ops.at(-1).input;
    assert(
      payload.criterionResolution === "waive" && payload.answer === note,
      `waive payload mismatch: ${JSON.stringify(payload)}`
    );
    return { payload };
  });

  await step(
    "B6 pending authority action disables the panel buttons",
    async () => {
      await navigateAndWait(
        `${baseUrl}/runs?runId=run-approve`,
        '[data-testid="needs-attention-panel"]'
      );
      // Configure only after the navigation: loadURL re-runs the preload and
      // resets all mock config.
      await configureMock("delayMs", "supervisorRuns.approveGate", 1200);
      const clicked = await clickButtonInItem(
        '[data-testid="needs-attention-item"][data-kind="gate"]',
        "Approve"
      );
      assert(clicked, "gate Approve button missing");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const midFlight = await evalJs(`
      (() => {
        const buttons = [...document.querySelectorAll(
          '[data-testid="needs-attention-item"] button'
        )];
        return buttons.map((button) => button.disabled);
      })()
    `);
      assert(
        midFlight.every((disabled) => disabled === true),
        `buttons not all disabled mid-flight: ${JSON.stringify(midFlight)}`
      );
      await waitForOperation("supervisorRuns.approveGate");
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const after = await evalJs(`
      (() => {
        const buttons = [...document.querySelectorAll(
          '[data-testid="needs-attention-item"] button'
        )];
        return buttons.filter((button) => !button.disabled).length;
      })()
    `);
      assert(after > 0, "buttons never re-enabled after the action settled");
      const ops = await recordedOperations();
      const approve = ops
        .filter((op) => op.path === "supervisorRuns.approveGate")
        .pop();
      assert(
        approve.input.runId === "run-approve" &&
          approve.input.gateId === "gate-1",
        `approveGate payload mismatch: ${JSON.stringify(approve.input)}`
      );
      await screenshot("11-pending-then-settled");
      return {
        midFlightDisabled: midFlight,
        approveGatePayload: approve.input,
      };
    }
  );

  await step("B7 rejected action shows a visible error", async () => {
    await navigateAndWait(
      `${baseUrl}/runs?runId=run-approve`,
      '[data-testid="needs-attention-panel"]'
    );
    // Configure only after the navigation: loadURL re-runs the preload and
    // resets all mock config.
    const reason = "Revision conflict: run advanced past revision 4";
    await configureMock("rejections", "supervisorRuns.rejectGate", reason);
    const clicked = await clickButtonInItem(
      '[data-testid="needs-attention-item"][data-kind="gate"]',
      "Reject"
    );
    assert(clicked, "gate Reject button missing");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const visible = await evalJs(`
      document.body.textContent.includes(${JSON.stringify(`Reject gate failed: ${reason}`)})
    `);
    assert(visible, "rejected action error message is not visible anywhere");
    await screenshot("12-rejected-action-visible-error");
    return { visibleError: `Reject gate failed: ${reason}` };
  });

  const ops = await recordedOperations();
  // ---- Phase C: narrow chat surface + evidence honesty (actual renderer) --
  // Same defect pair the fixture scenarios cover, verified on the real app
  // shell. The Supervisos runs surface lives in the collapsible chat rail
  // ("hidden md:block", w-72/xl:w-80), so the rail is opened through its real
  // toggle and widths stay at md+ where the rail actually renders — the rail
  // column itself is the real narrow container. Every step asserts rail
  // visibility first so a collapsed rail can never make a check pass
  // vacuously.
  const chatMeasureScript = `(() => {
    const doc = document.documentElement;
    const viewport = { w: doc.clientWidth, h: doc.clientHeight };
    const tol = 1;
    const section = document.querySelector('[aria-label="Supervised runs"]');
    const list = document.querySelector('[data-testid="chat-run-list"]');
    const aside = document.querySelector('aside[aria-label="Supervisos"]');
    const asideRect = aside ? aside.getBoundingClientRect() : null;
    const offscreenControls = [];
    if (section && asideRect) {
      // The runs surface owns its controls relative to the rail column that
      // contains them; whether the shell places that column fully inside the
      // viewport is shell-level layout (recorded as rail, asserted nowhere).
      for (const el of section.querySelectorAll("button, input, a")) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (
          rect.right > asideRect.right + tol ||
          rect.left < asideRect.left - tol
        ) {
          offscreenControls.push({
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute("aria-label") || el.textContent || "")
              .trim()
              .slice(0, 40),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          });
        }
      }
    }
    return {
      viewport,
      documentScroll: { sw: doc.scrollWidth, cw: doc.clientWidth },
      rail: asideRect
        ? {
            left: Math.round(asideRect.left),
            right: Math.round(asideRect.right),
            w: Math.round(asideRect.width),
            visible: asideRect.width > 0,
          }
        : null,
      section: section
        ? { sw: section.scrollWidth, cw: section.clientWidth }
        : null,
      list: list ? { sw: list.scrollWidth, cw: list.clientWidth } : null,
      cards: [...document.querySelectorAll('[data-testid="chat-run-card"]')].map(
        (card) => ({ sw: card.scrollWidth, cw: card.clientWidth })
      ),
      offscreenControls,
    };
  })()`;

  async function resizeContent(width, height) {
    win.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  /**
   * Destroy and reopen the window at an exact content size. Resizing an
   * existing window before navigation leaves the app shell with a row sized
   * to the viewport instead of viewport-minus-sidebar (recorded as a C7
   * observation), so width changes go through fresh windows instead.
   */
  async function recreateWindow(width, height) {
    if (win) {
      win.destroy();
      win = null;
    }
    createMainWindow(width, height);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  function setTheme(theme) {
    return evalJs(
      `document.documentElement.classList.${theme === "dark" ? "add" : "remove"}("dark"); true`
    );
  }

  /** Open the collapsible Supervisos rail through its real header toggle. */
  async function openSupervisosRail() {
    const state = await evalJs(`(() => {
      const toggle = document.querySelector('button[aria-label="Open Supervisos"]');
      if (toggle) {
        toggle.click();
        return "clicked";
      }
      const aside = document.querySelector('aside[aria-label="Supervisos"]');
      if (aside && aside.getBoundingClientRect().width > 0) {
        return "already-open";
      }
      return "toggle-missing";
    })()`);
    assert(state !== "toggle-missing", "Open Supervisos toggle not found");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const visible = await evalJs(
        `(() => {
          const aside = document.querySelector('aside[aria-label="Supervisos"]');
          if (!aside) return false;
          const rect = aside.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })()`
      );
      if (visible) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Supervisos rail did not become visible after toggle");
  }

  async function assertNoHorizontalOverflow(label) {
    const metrics = await evalJs(chatMeasureScript);
    assert(
      metrics.rail?.visible && metrics.rail.w >= 250,
      `${label}: Supervisos rail not visible (rail: ${JSON.stringify(metrics.rail)}) — measurement would be vacuous`
    );
    assert(
      metrics.documentScroll.sw <= metrics.documentScroll.cw + 1,
      `${label}: document scrollWidth ${metrics.documentScroll.sw} exceeds clientWidth ${metrics.documentScroll.cw}`
    );
    for (const [name, box] of [
      ["section", metrics.section],
      ["list", metrics.list],
    ]) {
      assert(
        box && box.sw <= box.cw + 1,
        `${label}: ${name} scrollWidth ${box ? box.sw : "missing"} exceeds clientWidth ${box ? box.cw : "?"}`
      );
    }
    metrics.cards.forEach((card, index) => {
      assert(
        card.sw <= card.cw + 1 && card.cw > 0,
        `${label}: card ${index} scrollWidth ${card.sw} vs clientWidth ${card.cw}`
      );
    });
    assert(
      metrics.offscreenControls.length === 0,
      `${label}: controls outside the rail column: ${JSON.stringify(metrics.offscreenControls)}\nshell: ${JSON.stringify(
        await evalJs(`(() => {
        const aside = document.querySelector('aside[aria-label="Supervisos"]');
        const chatCol = aside ? aside.previousElementSibling : null;
        const row = aside ? aside.parentElement : null;
        const rectOf = (el) => el ? { left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width) } : null;
        return {
          htmlClass: document.documentElement.className,
          innerWidth: window.innerWidth,
          aside: rectOf(aside),
          asideClass: aside ? aside.className : null,
          chatCol: rectOf(chatCol),
          row: rectOf(row),
        };
      })()`)
      )}`
    );
    return metrics;
  }

  await step(
    "C1 completed run shows evidence-honest verification in the chat surface",
    async () => {
      await resizeContent(1100, 900);
      await navigateAndWait(
        `${baseUrl}/?chatId=chat-main`,
        '[data-testid="chat-run-list"]'
      );
      await openSupervisosRail();
      const cardCount = await evalJs(
        "document.querySelectorAll('[data-testid=\"chat-run-card\"]').length"
      );
      assert(cardCount === 3, `expected 3 scoped chat runs, got ${cardCount}`);
      const notes = await evalJs(`
        [...document.querySelectorAll('[data-testid="chat-run-verification"]')].map(
          (note) => ({
            state: note.getAttribute("data-verification-state"),
            text: (note.textContent || "").trim(),
          })
        )
      `);
      assert(
        notes.length === 1,
        `expected exactly one verification note, got ${notes.length}`
      );
      const note = notes[0];
      assert(
        note.state === "incomplete",
        `state should be incomplete (1 passed + 1 resultless check), got ${note.state}`
      );
      assert(
        note.text.includes(
          "Aggregate verification incomplete (1 passed, 1 without a result)"
        ),
        `note does not describe the recorded evidence: ${note.text}`
      );
      assert(
        note.text.includes("1 criterion accepted or waived by your review"),
        `note does not identify the user-resolved criterion: ${note.text}`
      );
      const listText = await evalJs(
        "document.querySelector('[data-testid=\"chat-run-list\"]').textContent"
      );
      assert(
        !(
          listText.includes("Aggregate verification complete") ||
          listText.includes("Aggregate verification passed")
        ),
        `chat surface claims unearned verification: ${listText.slice(0, 200)}`
      );
      await screenshot("14-chat-verification-honest");
      return note;
    }
  );

  await step(
    "C2 narrow rail layouts keep controls inside their column",
    async () => {
      const measurements = [];
      // Layout assertions are relative to the rail column that owns the runs
      // surface (the original defect was controls clipped by their own
      // container's right edge). 800/1100/1360 cover md+ widths; where the
      // shell places the rail inside the viewport is shell-level layout,
      // recorded in the metrics and observed in C7.
      for (const width of [800, 1100, 1360]) {
        for (const theme of ["light", "dark"]) {
          await recreateWindow(width, 820);
          await navigateAndWait(
            `${baseUrl}/?chatId=chat-main`,
            '[data-testid="chat-run-list"]'
          );
          await openSupervisosRail();
          await setTheme(theme);
          await new Promise((resolve) => setTimeout(resolve, 250));
          const metrics = await assertNoHorizontalOverflow(
            `${width}px rail ${theme}`
          );
          await screenshot(`rail-${width}-${theme}`);
          measurements.push({
            width,
            theme,
            railWidth: metrics.rail.w,
            document: metrics.documentScroll,
            list: metrics.list,
            section: metrics.section,
            cardCount: metrics.cards.length,
            offscreenControls: metrics.offscreenControls.length,
          });
        }
      }
      return { measurements };
    }
  );

  await step(
    "C3 narrow surface: typed decision note accepted with recorded payload",
    async () => {
      // 1100 keeps the open rail fully inside the viewport at the shell
      // level (see C2 comment); the narrow container under test is the
      // rail's own 288px column.
      await recreateWindow(1100, 820);
      await navigateAndWait(
        `${baseUrl}/?chatId=chat-main`,
        '[data-testid="chat-run-list"]'
      );
      await openSupervisosRail();
      const note = "Checked the docs myself; accept";
      const itemSelector =
        '[data-testid="chat-run-attention-item"][data-kind="decision"]';
      const typed = await setInputValue(`${itemSelector} input`, note);
      assert(typed, "decision draft input not found on the chat card");
      await evalJs(
        `document.querySelector(${JSON.stringify(itemSelector)}).scrollIntoView({ block: "center" }); true`
      );
      const bounds = await evalJs(`(() => {
        const button = [...document.querySelectorAll('${itemSelector} button')]
          .find((candidate) => (candidate.textContent || "").trim() === "Accept criterion");
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        const aside = document.querySelector('aside[aria-label="Supervisos"]');
        const asideRect = aside ? aside.getBoundingClientRect() : null;
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          railLeft: asideRect ? Math.round(asideRect.left) : null,
          railRight: asideRect ? Math.round(asideRect.right) : null,
        };
      })()`);
      assert(
        bounds,
        "Accept criterion button missing on the chat decision item"
      );
      assert(
        bounds.railLeft !== null &&
          bounds.left >= bounds.railLeft - 1 &&
          bounds.right <= bounds.railRight + 1,
        `Accept criterion button outside the rail column: ${JSON.stringify(bounds)}`
      );
      const clicked = await clickButtonInItem(itemSelector, "Accept criterion");
      assert(clicked, "Accept criterion button did not click");
      const ops = await waitForOperation("supervisorRuns.answerDecision");
      const payload = ops.at(-1).input;
      assert(
        payload.runId === "run-approve" &&
          payload.decisionId === "dec-1" &&
          payload.criterionResolution === "accept" &&
          payload.answer === note &&
          payload.expectedRevision === 4,
        `narrow accept payload mismatch: ${JSON.stringify(payload)}`
      );
      await screenshot("15-narrow-accept-payload");
      return {
        payload,
        buttonBounds: bounds,
        shell: await evalJs(`(() => {
          const aside = document.querySelector('aside[aria-label="Supervisos"]');
          const chatCol = aside ? aside.previousElementSibling : null;
          const sidebarLink = document.querySelector('a[href="/runs"]');
          const rectOf = (el) => {
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { left: Math.round(rect.left), right: Math.round(rect.right), w: Math.round(rect.width) };
          };
          return { rail: rectOf(aside), chatCol: rectOf(chatCol), sidebarLink: rectOf(sidebarLink) };
        })()`),
      };
    }
  );
  await step(
    "C4 narrow surface: worker pill navigates to the exact worker chat",
    async () => {
      const clicked = await evalJs(`(() => {
        const button = document.querySelector('button[aria-label="Open worker chat for worker-b2"]');
        if (!button) return false;
        button.scrollIntoView({ block: "center" });
        const rect = button.getBoundingClientRect();
        const aside = document.querySelector('aside[aria-label="Supervisos"]');
        const asideRect = aside ? aside.getBoundingClientRect() : null;
        if (
          !asideRect ||
          rect.left < asideRect.left - 1 ||
          rect.right > asideRect.right + 1
        ) {
          return "outside-rail";
        }
        button.click();
        return true;
      })()`);
      assert(clicked === true, `worker pill click failed: ${clicked}`);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const url = await currentUrl();
      assert(
        url.includes("/?chatId=chat-worker-b2"),
        `worker pill navigated to ${url}, expected /?chatId=chat-worker-b2`
      );
      await screenshot("16-narrow-worker-chat-route");
      return { navigatedTo: url };
    }
  );

  await step(
    "C5 narrow surface: pending authority action disables card buttons mid-flight",
    async () => {
      await navigateAndWait(
        `${baseUrl}/?chatId=chat-main`,
        '[data-testid="chat-run-list"]'
      );
      await openSupervisosRail();
      // Configure only after the navigation: loadURL re-runs the preload and
      // resets all mock config.
      await configureMock("delayMs", "supervisorRuns.answerDecision", 1200);
      const clicked = await clickButtonInItem(
        '[data-testid="chat-run-attention-item"][data-kind="decision"]',
        "Accept criterion"
      );
      assert(clicked, "Accept criterion button missing for pending check");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const midFlight = await evalJs(
        `[...document.querySelectorAll('[data-testid="chat-run-attention-item"] button')].map((button) => button.disabled)`
      );
      assert(
        midFlight.length > 0 &&
          midFlight.every((disabled) => disabled === true),
        `attention buttons not all disabled mid-flight: ${JSON.stringify(midFlight)}`
      );
      await waitForOperation("supervisorRuns.answerDecision");
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const acceptEnabled = await evalJs(`(() => {
        const item = document.querySelector(
          '[data-testid="chat-run-attention-item"][data-kind="decision"]'
        );
        const button = [...item.querySelectorAll("button")].find(
          (candidate) => (candidate.textContent || "").trim() === "Accept criterion"
        );
        return button ? !button.disabled : null;
      })()`);
      assert(
        acceptEnabled === true,
        "Accept criterion never re-enabled after settling"
      );
      await screenshot("17-narrow-pending-settled");
      return { midFlightDisabledCount: midFlight.length };
    }
  );

  await step(
    "C6 narrow surface: rejected decision answer shows a visible error",
    async () => {
      await navigateAndWait(
        `${baseUrl}/?chatId=chat-main`,
        '[data-testid="chat-run-list"]'
      );
      await openSupervisosRail();
      const reason = "Decision locked: run already finalized (fixture)";
      await configureMock(
        "rejections",
        "supervisorRuns.answerDecision",
        reason
      );
      const clicked = await clickButtonInItem(
        '[data-testid="chat-run-attention-item"][data-kind="decision"]',
        "Accept criterion"
      );
      assert(clicked, "Accept criterion button missing for rejection check");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const visible = await evalJs(
        `document.body.textContent.includes(${JSON.stringify(`Answer decision failed: ${reason}`)})`
      );
      assert(visible, "rejected decision answer error is not visible anywhere");
      await screenshot("18-narrow-rejection-visible-error");
      return { visibleError: `Answer decision failed: ${reason}` };
    }
  );

  // Observation only, not one of the two defects: at 800px the shell's chat
  // column keeps a ~513px min-content width, so the open rail lands partly
  // or fully outside the viewport (with the sidebar docked the rail sits
  // entirely beyond the right edge). No harness sequencing changes this —
  // it is shell-level layout, not the runs surface. Recorded here with full
  // geometry so the behavior is visible in evidence; no assertion, no fix
  // in this bounded change.
  await step("C7 records shell narrow-width layout observations", async () => {
    const railProbe = `(() => {
      const aside = document.querySelector('aside[aria-label="Supervisos"]');
      const chatCol = aside ? aside.previousElementSibling : null;
      const sidebarLink = document.querySelector('a[href="/runs"]');
      const rectOf = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          w: Math.round(rect.width),
        };
      };
      return {
        rail: rectOf(aside),
        viewportW: document.documentElement.clientWidth,
        chatCol: rectOf(chatCol),
        sidebarLink: rectOf(sidebarLink),
      };
    })()`;
    await recreateWindow(800, 820);
    await navigateAndWait(
      `${baseUrl}/?chatId=chat-main`,
      '[data-testid="chat-run-list"]'
    );
    await openSupervisosRail();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const firstLoadAt800 = await evalJs(railProbe);
    await navigateAndWait(
      `${baseUrl}/?chatId=chat-main`,
      '[data-testid="chat-run-list"]'
    );
    await openSupervisosRail();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const secondLoadAt800 = await evalJs(railProbe);
    return {
      note: "Pre-existing shell-level first-load layout behavior, outside the two dispatched defects. Rail left/right vs viewport width shows whether the open rail sits inside the viewport.",
      firstLoadAt800,
      secondLoadAt800,
    };
  });

  await recreateWindow(1360, 900);

  const evidence = {
    generatedAt: new Date().toISOString(),
    appSurface: "actual renderer (index.html -> main.tsx -> TanStack router)",
    transport: "isolated mocked window.eragearDesktop bridge (fixture data)",
    steps: stepResults,
    consoleMessages,
    recordedOperations: ops,
  };
  fs.writeFileSync(
    path.join(outDir, "interaction-evidence.json"),
    JSON.stringify(evidence, null, 2)
  );
  const failed = stepResults.filter((result) => !result.ok);
  log(`steps: ${stepResults.length}, failed: ${failed.length}`);
  log(
    `console errors: ${consoleMessages.filter((entry) => entry.level >= 3).length}`
  );
  await screenshot("13-final-state");
  app.exit(failed.length > 0 ? 1 : 0);
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error("[run-center-interactions] fatal:", error);
    app.exit(2);
  });
