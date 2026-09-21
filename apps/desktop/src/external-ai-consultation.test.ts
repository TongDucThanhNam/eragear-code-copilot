import { describe, expect, test } from "bun:test";
import {
  createExternalAiConsultationHandler,
  type ExternalAiConsultationProvider,
  externalAiConsultationUrl,
  isExternalAiConsultationProvider,
} from "./external-ai-consultation.js";

describe("external AI consultation launcher", () => {
  test.each([
    ["chatgpt", "https://chatgpt.com/"],
    ["gemini", "https://gemini.google.com/app"],
  ] as const)("maps %s to a fixed prompt-free URL", (provider, expectedUrl) => {
    const url = new URL(externalAiConsultationUrl(provider));

    expect(url.toString()).toBe(expectedUrl);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  test.each([
    "claude",
    "https://chatgpt.com/",
    null,
    {},
    { provider: "chatgpt" },
  ])("rejects non-enum input %#", (provider) => {
    expect(isExternalAiConsultationProvider(provider)).toBe(false);
  });

  test("opens only for the trusted main renderer", async () => {
    const mainWindow = {};
    const trustedSender = {};
    const openedUrls: string[] = [];
    const handler = createExternalAiConsultationHandler({
      getMainWindow: () => mainWindow,
      getWindowFromSender: (event) =>
        event.sender === trustedSender ? mainWindow : {},
      openExternal(url) {
        openedUrls.push(url);
        return Promise.resolve();
      },
    });

    await handler({ sender: trustedSender }, "chatgpt");

    expect(openedUrls).toEqual(["https://chatgpt.com/"]);
  });

  test("rejects an untrusted sender before opening the browser", async () => {
    const mainWindow = {};
    let openCalls = 0;
    const handler = createExternalAiConsultationHandler({
      getMainWindow: () => mainWindow,
      getWindowFromSender: () => ({}),
      openExternal() {
        openCalls += 1;
        return Promise.resolve();
      },
    });

    await expect(handler({ sender: {} }, "gemini")).rejects.toThrow(
      "must originate from the main renderer"
    );
    expect(openCalls).toBe(0);
  });

  test("rejects requests after the main window is gone", async () => {
    let openCalls = 0;
    const handler = createExternalAiConsultationHandler({
      getMainWindow: () => null,
      getWindowFromSender: () => ({}),
      openExternal() {
        openCalls += 1;
        return Promise.resolve();
      },
    });

    await expect(handler({ sender: {} }, "chatgpt")).rejects.toThrow(
      "must originate from the main renderer"
    );
    expect(openCalls).toBe(0);
  });

  test("rejects arbitrary provider payloads without opening a URL", async () => {
    const mainWindow = {};
    let openedUrl = "";
    const handler = createExternalAiConsultationHandler({
      getMainWindow: () => mainWindow,
      getWindowFromSender: () => mainWindow,
      openExternal(url) {
        openedUrl = url;
        return Promise.resolve();
      },
    });

    await expect(
      handler({ sender: {} }, { provider: "chatgpt", prompt: "secret" })
    ).rejects.toThrow("Unsupported external AI consultation provider");
    expect(openedUrl).toBe("");
  });

  test("provider type remains exactly the supported enum", () => {
    const providers: ExternalAiConsultationProvider[] = ["chatgpt", "gemini"];
    expect(providers.every(isExternalAiConsultationProvider)).toBe(true);
  });
});
