import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import type {
  SupervisorManagerInboxItem,
  SupervisorRunClientUpdate,
} from "@eragear-code-copilot/shared";

const TELEGRAM_BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;

export interface TelegramManagerConfig {
  botToken: string;
  decisionKey: string;
  timezone: string;
  chatId?: string;
  updateOffset?: number;
  lastDigestDate?: string;
  lastDigestAt?: string;
  notifiedRevisions?: Record<string, number>;
  pendingPlanChange?: {
    runId: string;
    revision: number;
    requestedAt: string;
  };
}

export interface TelegramPairingRecord {
  codeHash: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface TelegramManagerSecretStorePort {
  loadConfig(userId: string): Promise<TelegramManagerConfig | null>;
  saveConfig(userId: string, config: TelegramManagerConfig): Promise<void>;
  loadPairing(userId: string): Promise<TelegramPairingRecord | null>;
  savePairing(userId: string, pairing: TelegramPairingRecord): Promise<void>;
}

export interface TelegramManagerRunsPort {
  list(input: {
    userId: string;
    includeTerminal: boolean;
  }): Promise<SupervisorRunClientUpdate[]>;
  approvePlan(input: {
    userId: string;
    runId: string;
    planVersion: number;
    planHash: string;
    expectedRevision: number;
  }): Promise<void>;
  requestPlanChanges(input: {
    userId: string;
    runId: string;
    requestedChanges: string;
    expectedRevision: number;
  }): Promise<void>;
  pause(runId: string, userId: string): Promise<void>;
  resume(runId: string, userId: string): Promise<void>;
  cancel(runId: string, userId: string): Promise<void>;
}

export interface TelegramManagerInboxPort {
  list(input: { userId: string }): Promise<SupervisorManagerInboxItem[]>;
  answer(input: {
    userId: string;
    runId: string;
    decisionId: string;
    answer: string;
    expectedRevision: number;
  }): Promise<void>;
}

export interface TelegramManagerApiPort {
  getUpdates(input: {
    botToken: string;
    offset?: number;
    signal?: AbortSignal;
  }): Promise<TelegramInboundUpdate[]>;
  sendMessage(input: {
    botToken: string;
    chatId: string;
    text: string;
    buttons?: Array<{ text: string; callbackData: string }>;
  }): Promise<void>;
  answerCallback(input: {
    botToken: string;
    callbackQueryId: string;
    text: string;
  }): Promise<void>;
}

export interface TelegramInboundUpdate {
  updateId: number;
  message?: { chatId: string; text?: string };
  callback?: { id: string; chatId: string; data: string };
}

type TelegramRunAction =
  | "approve_plan"
  | "request_changes"
  | "pause"
  | "resume"
  | "cancel";
const TELEGRAM_PAIRING_CODE_PATTERN = /^\d{6}$/;

interface CallbackCandidate {
  run: SupervisorRunClientUpdate;
  action: TelegramRunAction;
}

export class TelegramManagerBridgeService {
  private readonly secrets: TelegramManagerSecretStorePort;
  private readonly runs: TelegramManagerRunsPort;
  private readonly inbox: TelegramManagerInboxPort;
  private readonly api: TelegramManagerApiPort;
  private readonly now: () => Date;

  constructor(
    secrets: TelegramManagerSecretStorePort,
    runs: TelegramManagerRunsPort,
    inbox: TelegramManagerInboxPort,
    api: TelegramManagerApiPort,
    now: () => Date = () => new Date()
  ) {
    this.secrets = secrets;
    this.runs = runs;
    this.inbox = inbox;
    this.api = api;
    this.now = now;
  }

  async configure(input: {
    userId: string;
    botToken: string;
    timezone: string;
  }): Promise<{ configured: true; paired: boolean; timezone: string }> {
    const existing = await this.secrets.loadConfig(input.userId);
    const config: TelegramManagerConfig = {
      ...(existing ?? {}),
      botToken: input.botToken.trim(),
      timezone: input.timezone.trim(),
      decisionKey:
        existing?.decisionKey ?? randomBytes(32).toString("base64url"),
    };
    if (!TELEGRAM_BOT_TOKEN_PATTERN.test(config.botToken)) {
      throw new Error("Telegram bot token is invalid.");
    }
    assertTimezone(config.timezone);
    await this.secrets.saveConfig(input.userId, config);
    return {
      configured: true,
      paired: Boolean(config.chatId),
      timezone: config.timezone,
    };
  }

  async status(userId: string): Promise<{
    configured: boolean;
    paired: boolean;
    timezone?: string;
  }> {
    const config = await this.secrets.loadConfig(userId);
    return config
      ? {
          configured: true,
          paired: Boolean(config.chatId),
          timezone: config.timezone,
        }
      : { configured: false, paired: false };
  }

  async beginPairing(userId: string): Promise<{
    code: string;
    expiresAt: string;
  }> {
    if (!(await this.secrets.loadConfig(userId))) {
      throw new Error("Configure the Telegram bot token before pairing.");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(
      this.now().getTime() + 10 * 60 * 1000
    ).toISOString();
    await this.secrets.savePairing(userId, {
      codeHash: hashPairingCode(code),
      expiresAt,
    });
    return { code, expiresAt };
  }

  async acceptPairingCode(input: {
    userId: string;
    chatId: string;
    code: string;
  }): Promise<boolean> {
    const [config, pairing] = await Promise.all([
      this.secrets.loadConfig(input.userId),
      this.secrets.loadPairing(input.userId),
    ]);
    if (
      !(config && pairing) ||
      pairing.consumedAt ||
      new Date(pairing.expiresAt).getTime() <= this.now().getTime() ||
      !safeEqual(pairing.codeHash, hashPairingCode(input.code.trim()))
    ) {
      return false;
    }
    const consumedAt = this.now().toISOString();
    await this.secrets.saveConfig(input.userId, {
      ...config,
      chatId: input.chatId,
    });
    await this.secrets.savePairing(input.userId, { ...pairing, consumedAt });
    return true;
  }

  async callbackButtons(input: {
    userId: string;
    run: SupervisorRunClientUpdate;
  }): Promise<Array<{ text: string; callbackData: string }>> {
    const config = await this.requirePairedConfig(input.userId);
    return callbackCandidates([input.run]).map((candidate) => ({
      text: actionLabel(candidate.action),
      callbackData: createCallbackToken(config, candidate),
    }));
  }

  async handleCallback(input: {
    userId: string;
    chatId: string;
    callbackData: string;
  }): Promise<{ applied: boolean; reason: string }> {
    const config = await this.requirePairedConfig(input.userId);
    if (config.chatId !== input.chatId) {
      return { applied: false, reason: "chat_not_paired" };
    }
    const runs = await this.runs.list({
      userId: input.userId,
      includeTerminal: true,
    });
    const candidate = callbackCandidates(runs).find((item) =>
      safeEqual(createCallbackToken(config, item), input.callbackData)
    );
    if (!candidate) {
      return { applied: false, reason: "expired_or_replayed" };
    }
    const { run, action } = candidate;
    if (action === "approve_plan") {
      if (!run.plan) {
        return { applied: false, reason: "plan_missing" };
      }
      await this.runs.approvePlan({
        userId: input.userId,
        runId: run.runId,
        planVersion: run.plan.version,
        planHash: run.plan.hash,
        expectedRevision: run.revision,
      });
    } else if (action === "request_changes") {
      await this.secrets.saveConfig(input.userId, {
        ...config,
        pendingPlanChange: {
          runId: run.runId,
          revision: run.revision,
          requestedAt: this.now().toISOString(),
        },
      });
    } else {
      await this.runs[action](run.runId, input.userId);
    }
    return { applied: true, reason: action };
  }

  async handleFreeFormReply(input: {
    userId: string;
    chatId: string;
    text: string;
  }): Promise<{ applied: boolean; reason: string }> {
    const config = await this.requirePairedConfig(input.userId);
    if (config.chatId !== input.chatId) {
      return { applied: false, reason: "chat_not_paired" };
    }
    if (config.pendingPlanChange) {
      const pending = config.pendingPlanChange;
      const runs = await this.runs.list({
        userId: input.userId,
        includeTerminal: true,
      });
      const run = runs.find(
        (candidate) =>
          candidate.runId === pending.runId &&
          candidate.revision === pending.revision &&
          candidate.status === "awaiting_approval"
      );
      await this.secrets.saveConfig(input.userId, {
        ...config,
        pendingPlanChange: undefined,
      });
      if (!run) {
        return { applied: false, reason: "plan_change_request_expired" };
      }
      await this.runs.requestPlanChanges({
        userId: input.userId,
        runId: run.runId,
        requestedChanges: input.text.trim(),
        expectedRevision: run.revision,
      });
      return { applied: true, reason: "plan_changes_requested" };
    }
    const decisions = await this.inbox.list({ userId: input.userId });
    if (decisions.length !== 1) {
      return {
        applied: false,
        reason:
          decisions.length === 0 ? "no_open_decision" : "ambiguous_decision",
      };
    }
    const decision = decisions[0];
    if (!decision) {
      return { applied: false, reason: "no_open_decision" };
    }
    await this.inbox.answer({
      userId: input.userId,
      runId: decision.runId,
      decisionId: decision.decisionId,
      answer: input.text.trim(),
      expectedRevision: decision.revision,
    });
    return { applied: true, reason: "decision_answered" };
  }

  async pollOnce(userId: string, signal?: AbortSignal): Promise<number> {
    const config = await this.secrets.loadConfig(userId);
    if (!config) {
      return 0;
    }
    const updates = await this.api.getUpdates({
      botToken: config.botToken,
      ...(config.updateOffset !== undefined
        ? { offset: config.updateOffset }
        : {}),
      ...(signal ? { signal } : {}),
    });
    let offset = config.updateOffset ?? 0;
    for (const update of updates) {
      offset = Math.max(offset, update.updateId + 1);
      await this.handleInboundUpdate(userId, config, update);
    }
    if (offset !== config.updateOffset) {
      const latest = (await this.secrets.loadConfig(userId)) ?? config;
      await this.secrets.saveConfig(userId, {
        ...latest,
        updateOffset: offset,
      });
    }
    await this.sendDigestIfDue(userId);
    return updates.length;
  }

  async notifyRunUpdate(
    userId: string,
    run: SupervisorRunClientUpdate
  ): Promise<void> {
    const config = await this.secrets.loadConfig(userId);
    if (!config?.chatId) {
      return;
    }
    if ((config.notifiedRevisions?.[run.runId] ?? -1) >= run.revision) {
      return;
    }
    const shouldNotify =
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "needs_user" ||
      run.decisions.some((decision) => decision.status === "open");
    if (!shouldNotify) {
      return;
    }
    await this.api.sendMessage({
      botToken: config.botToken,
      chatId: config.chatId,
      text: formatRunNotification(run),
      buttons: await this.callbackButtons({ userId, run }),
    });
    await this.secrets.saveConfig(userId, {
      ...config,
      notifiedRevisions: capRevisionMap({
        ...(config.notifiedRevisions ?? {}),
        [run.runId]: run.revision,
      }),
    });
  }

  private async handleInboundUpdate(
    userId: string,
    config: TelegramManagerConfig,
    update: TelegramInboundUpdate
  ): Promise<void> {
    if (update.callback) {
      const result = await this.handleCallback({
        userId,
        chatId: update.callback.chatId,
        callbackData: update.callback.data,
      });
      await this.api.answerCallback({
        botToken: config.botToken,
        callbackQueryId: update.callback.id,
        text: result.applied ? "Applied" : "Expired or unavailable",
      });
      return;
    }
    const text = update.message?.text?.trim();
    const chatId = update.message?.chatId;
    if (!(text && chatId)) {
      return;
    }
    if (!config.chatId && TELEGRAM_PAIRING_CODE_PATTERN.test(text)) {
      const paired = await this.acceptPairingCode({
        userId,
        chatId,
        code: text,
      });
      await this.api.sendMessage({
        botToken: config.botToken,
        chatId,
        text: paired
          ? "Eragear pairing complete."
          : "Pairing code is invalid or expired.",
      });
      return;
    }
    const result = await this.handleFreeFormReply({ userId, chatId, text });
    await this.api.sendMessage({
      botToken: config.botToken,
      chatId,
      text: result.applied
        ? "Decision answer recorded."
        : "Reply was not applied because there is not exactly one open decision.",
    });
  }

  private async sendDigestIfDue(userId: string): Promise<void> {
    const config = await this.secrets.loadConfig(userId);
    if (!config?.chatId) {
      return;
    }
    const local = localDateParts(this.now(), config.timezone);
    if (local.hour !== 9 || config.lastDigestDate === local.date) {
      return;
    }
    const runs = await this.runs.list({ userId, includeTerminal: true });
    const lastDigestAt = config.lastDigestAt;
    const changed = lastDigestAt
      ? runs.some((run) => run.updatedAt > lastDigestAt)
      : runs.length > 0;
    const active = runs.filter(
      (run) => !["completed", "failed", "cancelled"].includes(run.status)
    );
    if (!(changed || active.length > 0)) {
      return;
    }
    await this.api.sendMessage({
      botToken: config.botToken,
      chatId: config.chatId,
      text: `Eragear portfolio: ${active.length} active, ${runs.filter((run) => run.status === "needs_user").length} need attention, ${runs.filter((run) => run.status === "waiting_capacity").length} waiting capacity.`,
    });
    await this.secrets.saveConfig(userId, {
      ...config,
      lastDigestDate: local.date,
      lastDigestAt: this.now().toISOString(),
    });
  }

  private async requirePairedConfig(
    userId: string
  ): Promise<TelegramManagerConfig> {
    const config = await this.secrets.loadConfig(userId);
    if (!config?.chatId) {
      throw new Error("Telegram is not paired for this user.");
    }
    return config;
  }
}

function callbackCandidates(
  runs: SupervisorRunClientUpdate[]
): CallbackCandidate[] {
  return runs.flatMap((run) => {
    const candidates: CallbackCandidate[] = [];
    if (run.status === "awaiting_approval" && run.plan) {
      candidates.push({ run, action: "approve_plan" });
      candidates.push({ run, action: "request_changes" });
    }
    if (["queued", "running", "waiting_capacity"].includes(run.status)) {
      candidates.push({ run, action: "pause" });
    }
    if (run.status === "paused") {
      candidates.push({ run, action: "resume" });
    }
    if (!["completed", "failed", "cancelled"].includes(run.status)) {
      candidates.push({ run, action: "cancel" });
    }
    return candidates;
  });
}

function createCallbackToken(
  config: TelegramManagerConfig,
  candidate: CallbackCandidate
): string {
  const planIdentity = candidate.run.plan
    ? `${candidate.run.plan.version}:${candidate.run.plan.hash}`
    : "-";
  return createHmac("sha256", Buffer.from(config.decisionKey, "base64url"))
    .update(
      [
        config.chatId,
        candidate.run.runId,
        candidate.run.revision,
        candidate.action,
        planIdentity,
      ].join("|")
    )
    .digest("base64url")
    .slice(0, 32);
}

function hashPairingCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("Telegram digest timezone is invalid.");
  }
}

function localDateParts(
  now: Date,
  timezone: string
): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

function actionLabel(action: TelegramRunAction): string {
  return {
    approve_plan: "Approve plan",
    request_changes: "Request changes",
    pause: "Pause",
    resume: "Resume",
    cancel: "Cancel",
  }[action];
}

function formatRunNotification(run: SupervisorRunClientUpdate): string {
  if (run.status === "completed") {
    return `Goal ${run.runId} completed${run.finalCommitSha ? ` at ${run.finalCommitSha.slice(0, 12)}` : ""}.`;
  }
  const open = run.decisions.find((decision) => decision.status === "open");
  return open
    ? `Goal ${run.runId} needs a decision: ${open.prompt}`
    : `Goal ${run.runId} changed to ${run.status}.`;
}

function capRevisionMap(
  values: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(Object.entries(values).slice(-200));
}
