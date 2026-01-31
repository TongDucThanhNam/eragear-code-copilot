import type { Settings } from "@/shared/types/settings.types";
import { TabPanel } from "./tab-panel";

interface SettingsTabProps {
  settings: Settings;
  errors?: {
    projectRoots?: string;
    general?: string;
  };
  activeTab: string;
}

export function SettingsTab({ settings, errors, activeTab }: SettingsTabProps) {
  return (
    <TabPanel activeTab={activeTab} scrollable tab="settings">
      <form action="/form/settings" method="post">
        <section class="border-2 border-ink bg-paper shadow-news">
          <div class="flex items-start justify-between border-ink border-b-2 p-6">
            <div>
              <h2 class="font-black font-display text-3xl tracking-tight">
                Project Roots
              </h2>
              <p class="mt-2 font-body text-muted text-sm">
                Sessions can only be opened within these directories
              </p>
            </div>
            <span class="border border-ink px-3 py-1 font-mono text-xs">
              {settings.projectRoots.length} roots
            </span>
          </div>

          <div class="p-6">
            <div class="mb-4">
              <label
                class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                htmlFor="newRoot"
              >
                Add New Root
              </label>
              <div class="flex gap-2">
                <input
                  class="input-underline flex-1"
                  id="newRoot"
                  name="newRoot"
                  placeholder="/path/to/project"
                  type="text"
                />
                <button class="btn btn-secondary min-h-[44px]" type="submit">
                  Add
                </button>
              </div>
              <p class="mt-2 font-mono text-[10px] text-muted italic">
                At least one root path is required.
              </p>
            </div>

            <div class="space-y-2">
              {settings.projectRoots.map((root, index) => (
                <div
                  class="root-item flex items-center gap-3 border border-ink p-3 transition-colors hover:bg-muted/20"
                  key={root}
                >
                  <code class="flex-1 truncate font-mono text-sm">{root}</code>
                  <input
                    name={`projectRoots[${index}]`}
                    type="hidden"
                    value={root}
                  />
                  <button
                    class="btn btn-sm btn-danger min-h-[36px]"
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
              <p class="mt-2 font-mono text-red-700 text-xs">
                {errors.projectRoots}
              </p>
            )}
          </div>
        </section>

        <div class="mt-6 border-ink border-t-2 pt-6 text-center">
          <button
            class="btn btn-primary min-h-[52px] px-10 text-base"
            type="submit"
          >
            Save Settings
          </button>
          <p class="mt-2 font-mono text-[10px] text-muted">
            Changes will take effect immediately
          </p>
        </div>
      </form>
    </TabPanel>
  );
}
