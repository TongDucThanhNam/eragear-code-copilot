/**
 * tRPC Router
 *
 * Main tRPC router that merges all feature routers into a unified API.
 * Exports the AppRouter type for client-side type-safe API calls.
 *
 * @module transport/trpc/router
 */

import t, { router } from "./base";
import { acpAuthRouter } from "./routers/acp-auth";
import { agentsRouter } from "./routers/agents";
import { aiRouter } from "./routers/ai";
import { authRouter } from "./routers/auth";
import { botsRouter } from "./routers/bots";
import { codeRouter } from "./routers/code";
import { codingPlanSubscriptionRouter } from "./routers/coding-plan-subscription";
import { commandsRouter } from "./routers/commands";
import { contextUsageRouter } from "./routers/context-usage";
import { crashReportingRouter } from "./routers/crash-reporting";
import { credentialRouter } from "./routers/credential";
import { feedbackRouter } from "./routers/feedback";
import { fileWatcherRouter } from "./routers/file-watcher";
import { gitRouter } from "./routers/git";
import { hooksRouter } from "./routers/hooks";
import { memoryRouter } from "./routers/memory";
import { modelProviderRouter } from "./routers/model-provider";
import { oauthRouter } from "./routers/oauth";
import { outputStyleRouter } from "./routers/output-style";
import { pluginsRouter } from "./routers/plugins";
import { projectRouter } from "./routers/project";
import { promptEnhancementRouter } from "./routers/prompt-enhancement";
import { quotaRouter } from "./routers/quota";
import { remoteControlRouter } from "./routers/remote-control";
import { repoSnapshotIndexingRouter } from "./routers/repo-snapshot-indexing";
import { sessionRouter } from "./routers/session";
import { settingsRouter } from "./routers/settings";
import { settingsSyncRouter } from "./routers/settings-sync";
import { skillsRouter } from "./routers/skills";
import { subagentsRouter } from "./routers/subagents";
import { taskAutoArchiveRouter } from "./routers/task-auto-archive";
import { terminalRouter } from "./routers/terminal";
import { toolRouter } from "./routers/tool";
import { trafficProxyRouter } from "./routers/traffic-proxy";
import { usageStatsRouter } from "./routers/usage-stats";

/**
 * Main application router combining all feature routers
 */
export const appRouter = t.mergeRouters(
  sessionRouter,
  codeRouter,
  projectRouter,
  aiRouter,
  toolRouter,
  router({
    agents: agentsRouter,
    acpAuth: acpAuthRouter,
    auth: authRouter,
    bots: botsRouter,
    codingPlanSubscription: codingPlanSubscriptionRouter,
    commands: commandsRouter,
    contextUsage: contextUsageRouter,
    crashReporting: crashReportingRouter,
    credential: credentialRouter,
    feedback: feedbackRouter,
    fileWatcher: fileWatcherRouter,
    git: gitRouter,
    hooks: hooksRouter,
    memory: memoryRouter,
    modelProvider: modelProviderRouter,
    oauth: oauthRouter,
    outputStyle: outputStyleRouter,
    plugins: pluginsRouter,
    promptEnhancement: promptEnhancementRouter,
    quota: quotaRouter,
    remoteControl: remoteControlRouter,
    repoSnapshotIndexing: repoSnapshotIndexingRouter,
    settings: settingsRouter,
    settingsSync: settingsSyncRouter,
    skills: skillsRouter,
    subagents: subagentsRouter,
    taskAutoArchive: taskAutoArchiveRouter,
    terminal: terminalRouter,
    trafficProxy: trafficProxyRouter,
    usageStats: usageStatsRouter,
  })
);

/** Type definition for the main app router (used by clients) */
export type AppRouter = typeof appRouter;
