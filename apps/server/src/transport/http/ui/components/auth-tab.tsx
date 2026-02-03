import type {
  ApiKeyCreateResponse,
  ApiKeyItem,
  DeviceSessionItem,
} from "@/transport/http/ui/dashboard-data";
import { ApiKeyRow } from "./api-key-row";
import { DeviceSessionRow } from "./device-session-row";
import { TabPanel } from "./tab-panel";

interface AuthTabProps {
  apiKeys: ApiKeyItem[];
  createdApiKey?: ApiKeyCreateResponse;
  deviceSessions: DeviceSessionItem[];
  activeTab: string;
}

export function AuthTab({
  apiKeys,
  createdApiKey,
  deviceSessions,
  activeTab,
}: AuthTabProps) {
  return (
    <TabPanel activeTab={activeTab} scrollable tab="auth">
      {/* API Keys Section */}
      <section className="border border-[#111111] bg-[#F9F9F7]">
        {/* Section Header */}
        <div className="border-[#111111] border-b-[3px] p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-3">
                <span className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.2em]">
                  Section 01
                </span>
                <div className="flex-1 border-[#E5E5E0] border-b" />
              </div>
              <h2 className="font-black font-serif text-4xl leading-[0.9] tracking-tighter md:text-5xl">
                API Keys
              </h2>
              <p className="mt-3 max-w-xl font-body text-[#737373] text-sm leading-relaxed md:text-base">
                Generate and manage authentication credentials for client
                connections
              </p>
            </div>
            <div className="flex min-h-[44px] flex-col items-center gap-2 md:items-end">
              <div className="border-2 border-[#111111] bg-[#F9F9F7] px-4 py-2">
                <span className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                  Total Keys
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="font-bold font-serif text-3xl leading-none">
                    {apiKeys.length}
                  </span>
                  <span className="font-mono text-[#737373] text-xs">/ ∞</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create API Key Form - Inverted Section */}
        <div className="border-[#111111] border-b bg-[#111111] text-[#F9F9F7]">
          <div className="p-6 md:p-8">
            <form
              action="/form/admin/api-keys/create"
              className="grid gap-6 md:grid-cols-3"
              method="post"
            >
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[#E5E5E0] text-[10px] uppercase tracking-[0.15em]">
                  Key Name
                </span>
                <input
                  className="border-[#F9F9F7] border-b-2 bg-transparent px-3 py-2 font-mono text-[#F9F9F7] text-sm placeholder-neutral-500 focus-visible:bg-[#F0F0F0] focus-visible:shadow-1 focus-visible:outline-none"
                  name="name"
                  placeholder="Default"
                  type="text"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[#E5E5E0] text-[10px] uppercase tracking-[0.15em]">
                  Prefix
                </span>
                <input
                  className="border-[#F9F9F7] border-b-2 bg-transparent px-3 py-2 font-mono text-[#F9F9F7] text-sm placeholder-neutral-500 focus-visible:bg-[#F0F0F0] focus-visible:shadow-1 focus-visible:outline-none"
                  name="prefix"
                  placeholder="eg_"
                  type="text"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[#E5E5E0] text-[10px] uppercase tracking-[0.15em]">
                  Expiration
                </span>
                <input
                  className="border-[#F9F9F7] border-b-2 bg-transparent px-3 py-2 font-mono text-[#F9F9F7] text-sm placeholder-neutral-500 focus-visible:bg-[#F0F0F0] focus-visible:shadow-1 focus-visible:outline-none"
                  min="0"
                  name="expiresInDays"
                  placeholder="0 (never)"
                  type="number"
                />
              </label>
              <div className="col-span-full">
                <button
                  className="min-h-[44px] w-full border-2 border-[#CC0000] bg-[#CC0000] px-6 py-3 font-mono text-[#F9F9F7] text-[10px] uppercase tracking-[0.1em] transition-all duration-200 ease-out hover:bg-[#F9F9F7] hover:text-[#CC0000] md:w-auto"
                  type="submit"
                >
                  Generate New Key
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Created Key Alert */}
        {createdApiKey && (
          <div className="border-[#111111] border-b">
            <div className="border-l-4 border-l-[#CC0000] bg-[#CC0000]/5 p-4 md:p-6">
              <div className="mb-3 font-mono text-[#CC0000] text-[10px] uppercase tracking-[0.15em]">
                ⚠️ Security Alert — Save Immediately
              </div>
              <p className="mb-3 font-body text-[#111111] text-sm">
                This API key is displayed only once. Copy it now — it cannot be
                recovered later.
              </p>
              <div className="break-all border-2 border-[#111111] bg-[#F9F9F7] p-4 font-mono text-xs md:text-sm">
                {createdApiKey.key}
              </div>
            </div>
          </div>
        )}

        {/* API Keys List */}
        <div className="min-h-[120px]">
          {apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="mb-4 font-serif text-4xl text-[#E5E5E0]">☐ ☐ ☐</div>
              <div className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                No API Keys Generated
              </div>
              <p className="mt-2 max-w-sm font-body text-[#737373] text-sm">
                Create your first API key above to enable client connections
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#111111]">
              {apiKeys.map((key) => (
                <ApiKeyRow item={key} key={key.id} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Ornamental Divider */}
      <div className="py-8 text-center font-serif text-2xl text-[#E5E5E0] tracking-[0.5em]">
        • • •
      </div>

      {/* Device Sessions Section */}
      <section className="border border-[#111111] bg-[#F9F9F7]">
        {/* Section Header */}
        <div className="border-[#111111] border-b-[3px] p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-3">
                <span className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.2em]">
                  Section 02
                </span>
                <div className="flex-1 border-[#E5E5E0] border-b" />
              </div>
              <h2 className="font-black font-serif text-4xl leading-[0.9] tracking-tighter md:text-5xl">
                Device Sessions
              </h2>
              <p className="mt-3 max-w-xl font-body text-[#737373] text-sm leading-relaxed md:text-base">
                Monitor and manage active login sessions across all devices
              </p>
            </div>
            <div className="flex min-h-[44px] flex-col items-center gap-2 md:items-end">
              <div className="border-2 border-[#111111] bg-[#F9F9F7] px-4 py-2">
                <span className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                  Active
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="font-bold font-serif text-3xl leading-none">
                    {deviceSessions.length}
                  </span>
                  <span className="font-mono text-[#737373] text-xs">sessions</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Status Cards Row - Statistics */}
        <div className="border-[#111111] border-b bg-[#E5E5E0]">
          <div className="grid grid-cols-2 border-[#111111] border-t border-l md:grid-cols-4">
            <div className="border-[#111111] border-r border-b p-4 text-center md:p-6">
              <div className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                Total
              </div>
              <div className="font-bold font-serif text-3xl">
                {deviceSessions.length}
              </div>
            </div>
            <div className="border-[#111111] border-r border-b p-4 text-center md:p-6">
              <div className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                Active
              </div>
              <div className="font-bold font-serif text-3xl text-[#CC0000]">
                {deviceSessions.filter((s) => s.isActive).length}
              </div>
            </div>
            <div className="border-[#111111] border-r border-b p-4 text-center md:p-6">
              <div className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                Expired
              </div>
              <div className="font-bold font-serif text-3xl">
                {deviceSessions.filter((s) => !s.isActive).length}
              </div>
            </div>
            <div className="border-[#111111] border-b p-4 text-center md:p-6">
              <div className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                Status
              </div>
              <div className="font-bold font-serif text-xl">OPR</div>
            </div>
          </div>
        </div>

        {/* Device Sessions List */}
        <div className="min-h-[120px]">
          {deviceSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="mb-4 font-serif text-4xl text-[#E5E5E0]">○ ○ ○</div>
              <div className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.15em]">
                No Active Sessions
              </div>
              <p className="mt-2 max-w-sm font-body text-[#737373] text-sm">
                Login to a device to start tracking sessions
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#111111]">
              {deviceSessions.map((item) => (
                <DeviceSessionRow item={item} key={item.session.token} />
              ))}
            </div>
          )}
        </div>
      </section>
    </TabPanel>
  );
}
