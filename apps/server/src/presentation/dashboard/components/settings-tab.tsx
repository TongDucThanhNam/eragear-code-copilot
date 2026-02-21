import type { FormEvent } from "react";
import {
  useDashboardActions,
  useDashboardState,
} from "@/presentation/dashboard/dashboard-view.context";
import { BootAllowlistsPanel } from "./boot-allowlists-panel";
import { TabPanel } from "./tab-panel";

export function SettingsTab() {
  const { settings, errors, activeTab } = useDashboardState();
  const {
    settings: { onSaveSettings },
  } = useDashboardActions();

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    if (submitter?.name) {
      formData.set(submitter.name, submitter.value);
    }
    await onSaveSettings(formData);
  };

  return (
    <TabPanel activeTab={activeTab} scrollable tab="settings">
      <form onSubmit={handleSettingsSubmit}>
        <section className="border-2 border-ink bg-paper shadow-news">
          <div className="flex items-start justify-between border-ink border-b-2 p-6">
            <div>
              <h2 className="font-black font-display text-3xl tracking-tight">
                Project Roots
              </h2>
              <div className="mt-4 text-justify font-body text-muted text-sm leading-relaxed">
                <span className="float-left mt-1 mr-2 font-black font-display text-5xl text-ink leading-[0.8]">
                  S
                </span>
                essions can only be opened within these registered directories.
                By defining explicit root paths, you establish a secure boundary
                for your AI agents, preventing unauthorized access to sensitive
                areas of your filesystem.
              </div>
            </div>
            <span className="border border-ink px-3 py-1 font-mono text-xs">
              {settings.projectRoots.length} roots
            </span>
          </div>

          <div className="p-6">
            <div className="mb-4">
              <label
                className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                htmlFor="newRoot"
              >
                Add New Root
              </label>
              <div className="flex gap-2">
                <input
                  className="input-underline flex-1"
                  id="newRoot"
                  name="newRoot"
                  placeholder="/path/to/project"
                  type="text"
                />
                <button
                  className="btn btn-secondary min-h-[44px]"
                  type="submit"
                >
                  Add
                </button>
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted italic">
                At least one root path is required.
              </p>
            </div>

            <div className="space-y-2">
              {settings.projectRoots.map((root, index) => (
                <div
                  className="root-item flex items-center gap-3 border border-ink p-3 transition-colors hover:bg-muted/20"
                  key={root}
                >
                  <code className="flex-1 truncate font-mono text-sm">
                    {root}
                  </code>
                  <input
                    name={`projectRoots[${index}]`}
                    type="hidden"
                    value={root}
                  />
                  <button
                    className="btn btn-sm btn-danger min-h-[36px]"
                    name="removeRoot"
                    type="submit"
                    value={root}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {errors?.projectRoots && (
              <p className="mt-2 font-mono text-red-700 text-xs">
                {errors.projectRoots}
              </p>
            )}
          </div>
        </section>

        <section className="mt-6 border-2 border-ink bg-paper shadow-news">
          <div className="border-ink border-b-2 p-6">
            <h2 className="font-black font-display text-3xl tracking-tight">
              Runtime Policy
            </h2>
            <p className="mt-2 font-body text-muted text-sm">
              Applied without restart. Boot settings still require process
              restart.
            </p>
          </div>

          <div className="grid gap-4 p-6 md:grid-cols-3">
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                Session Idle Timeout (ms)
              </span>
              <input
                className="input-underline w-full"
                defaultValue={settings.app.sessionIdleTimeoutMs}
                min={1}
                name="app.sessionIdleTimeoutMs"
                step={1}
                type="number"
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                Session List Max Limit
              </span>
              <input
                className="input-underline w-full"
                defaultValue={settings.app.sessionListPageMaxLimit}
                min={1}
                name="app.sessionListPageMaxLimit"
                step={1}
                type="number"
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                Session Messages Max Limit
              </span>
              <input
                className="input-underline w-full"
                defaultValue={settings.app.sessionMessagesPageMaxLimit}
                min={1}
                name="app.sessionMessagesPageMaxLimit"
                step={1}
                type="number"
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                Log Level
              </span>
              <select
                className="input-underline w-full bg-transparent"
                defaultValue={settings.app.logLevel}
                name="app.logLevel"
              >
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                Max Tokens
              </span>
              <input
                className="input-underline w-full"
                defaultValue={settings.app.maxTokens}
                min={1}
                name="app.maxTokens"
                step={1}
                type="number"
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                Default Model
              </span>
              <input
                className="input-underline w-full"
                defaultValue={settings.app.defaultModel}
                name="app.defaultModel"
                placeholder="agent default"
                type="text"
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                ACP Prompt Meta Policy
              </span>
              <select
                className="input-underline w-full bg-transparent"
                defaultValue={settings.app.acpPromptMetaPolicy}
                name="app.acpPromptMetaPolicy"
              >
                <option value="allowlist">allowlist</option>
                <option value="always">always</option>
                <option value="never">never</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
                ACP Prompt Meta Allowlist
              </span>
              <textarea
                className="input-underline min-h-24 w-full bg-transparent"
                defaultValue={settings.app.acpPromptMetaAllowlist.join("\n")}
                name="app.acpPromptMetaAllowlist"
                placeholder="/usr/local/bin/codex&#10;claude-code"
              />
              <p className="mt-2 font-mono text-[10px] text-muted">
                One entry per line (or comma-separated). Used when policy =
                allowlist.
              </p>
            </label>
          </div>
        </section>

        <div className="mt-6 border-ink border-t-2 pt-6 text-center">
          <button
            className="btn btn-primary min-h-[52px] px-10 text-base"
            type="submit"
          >
            Save Settings
          </button>
          <p className="mt-2 font-mono text-[10px] text-muted">
            Changes will take effect immediately
          </p>
        </div>
      </form>
      <BootAllowlistsPanel />
    </TabPanel>
  );
}
