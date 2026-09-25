"use strict";
// Standalone Electron entry that captures Run Center fixture harness
// screenshots. Loads a Vite-served harness URL (no app runtime, no ACP
// sessions, no providers) and writes PNGs to RUN_CENTER_VISUALS_OUT_DIR.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Fresh profile per run avoids cache contention with any other Electron copy.
app.setPath(
  "userData",
  path.join(os.tmpdir(), `run-center-visuals-${Date.now()}`)
);
// Keep hardware acceleration: capturePage needs a live display surface. On
// this Windows setup only offscreen windows expose one for capturePage, so
// the single reusable window below runs in offscreen mode and is never
// destroyed mid-run.

const outDir = process.env.RUN_CENTER_VISUALS_OUT_DIR ?? "out";
const scenarios = JSON.parse(process.env.RUN_CENTER_VISUALS_SCENARIOS ?? "[]");
// Optional overflow audit: for each scenario, record scrollWidth/clientWidth
// of key containers plus any element that sticks out of the viewport, and
// write one JSON line per scenario next to the screenshots.
const measure = process.env.RUN_CENTER_VISUALS_MEASURE === "1";

const MEASURE_SCRIPT = `(() => {
  const doc = document.documentElement;
  const viewport = { w: doc.clientWidth, h: doc.clientHeight };
  const offenders = [];
  const tol = 1;
  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const parent = el.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    const sticksOutOfParent =
      parentRect &&
      (rect.right > parentRect.right + tol || rect.left < parentRect.left - tol);
    if (rect.right > viewport.w + tol || rect.left < -tol || sticksOutOfParent) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute("data-testid") ?? undefined,
        cls: String(el.className ?? "").slice(0, 80),
        text: (el.textContent ?? "").trim().slice(0, 40),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        sticksOutOfParent,
      });
    }
  }
  offenders.sort((a, b) => Number(b.sticksOutOfParent) - Number(a.sticksOutOfParent) || b.right - a.right);
  const card = document.querySelector('[data-testid="chat-run-card"]');
  const minContentChain = [];
  if (card) {
    const minContentWidth = (el) => {
      const probe = el.cloneNode(true);
      probe.style.cssText =
        "position:absolute;visibility:hidden;width:min-content;left:-9999px;top:0;margin:0;";
      document.body.appendChild(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return Math.round(width);
    };
    let node = card;
    while (node) {
      minContentChain.push({
        tag: node.tagName.toLowerCase(),
        testid: node.getAttribute ? node.getAttribute("data-testid") : undefined,
        cls: String(node.className ?? "").slice(0, 70),
        minContent: minContentWidth(node),
      });
      let next = null;
      let nextMin = -1;
      for (const child of node.children) {
        const width = minContentWidth(child);
        if (width > nextMin) {
          nextMin = width;
          next = child;
        }
      }
      node = nextMin > viewport.w - 20 ? next : null;
    }
  }
  const container = document.querySelector('[data-testid="chat-narrow-root"]');
  return {
    viewport,
    minContentChain,
    documentScroll: { sw: doc.scrollWidth, cw: doc.clientWidth },
    chatRoot: container
      ? { sw: container.scrollWidth, cw: container.clientWidth }
      : null,
    list: (() => {
      const el = document.querySelector('[data-testid="chat-run-list"]');
      return el ? { sw: el.scrollWidth, cw: el.clientWidth } : null;
    })(),
    cards: [...document.querySelectorAll('[data-testid="chat-run-card"]')].map(
      (card) => ({
        sw: card.scrollWidth,
        cw: card.clientWidth,
        right: Math.round(card.getBoundingClientRect().right),
      })
    ),
    offenders: offenders.slice(0, 12),
  };
})()`;

async function measureOverflow(win, scenario) {
  try {
    const metrics = await win.webContents.executeJavaScript(
      MEASURE_SCRIPT,
      true
    );
    const line =
      `${scenario.name}: doc ${metrics.documentScroll.sw}/${metrics.documentScroll.cw}` +
      (metrics.list ? ` list ${metrics.list.sw}/${metrics.list.cw}` : "");
    console.log(`[run-center-visuals] measure ${line}`);
    if (metrics.offenders.length > 0) {
      console.log(
        `[run-center-visuals] offenders ${JSON.stringify(metrics.offenders)}`
      );
    }
    fs.writeFileSync(
      path.join(outDir, `${scenario.name}.measure.json`),
      JSON.stringify(metrics, null, 2)
    );
  } catch (error) {
    console.warn(`[run-center-visuals] measure failed: ${error}`);
  }
}

const SETTLE_MS = 1800;

function windowFor(scenario) {
  return new BrowserWindow({
    width: scenario.width ?? 1280,
    height: scenario.height ?? 860,
    show: false,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
    },
  });
}

/** Load the scenario URL, retrying up to three times on fresh windows. */
async function loadScenario(currentWin, scenario) {
  let active = currentWin;
  let loaded = false;
  for (let attempt = 1; attempt <= 3 && !loaded; attempt += 1) {
    try {
      if (active.isDestroyed()) {
        active = windowFor(scenario);
      }
      await active.loadURL(scenario.url);
      loaded = true;
    } catch (error) {
      console.warn(
        `[run-center-visuals] load attempt ${attempt} for ${scenario.name} failed: ${error}`
      );
      if (!active.isDestroyed()) {
        active.destroy();
      }
      active = windowFor(scenario);
    }
  }
  if (!loaded) {
    throw new Error(`could not load ${scenario.url}`);
  }
  return active;
}

async function captureAll() {
  fs.mkdirSync(outDir, { recursive: true });
  let win = windowFor(scenarios[0] ?? {});
  try {
    for (const scenario of scenarios) {
      const width = scenario.width ?? 1280;
      const height = scenario.height ?? 860;
      const size = win.getContentBounds();
      if (size.width !== width || size.height !== height) {
        win.setContentSize(width, height);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      win = await loadScenario(win, scenario);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      const image = await win.webContents.capturePage();
      if (image.isEmpty()) {
        throw new Error(`captured an empty frame for ${scenario.name}`);
      }
      fs.writeFileSync(
        path.join(outDir, `${scenario.name}.png`),
        image.toPNG()
      );
      if (measure) {
        await measureOverflow(win, scenario);
      }
      console.log(`[run-center-visuals] captured ${scenario.name}`);
    }
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

async function main() {
  await app.whenReady();
  await captureAll();
  console.log(`[run-center-visuals] wrote ${scenarios.length} screenshots`);
  app.exit(0);
}

main().catch((error) => {
  console.error("[run-center-visuals] failed:", error);
  app.exit(1);
});
