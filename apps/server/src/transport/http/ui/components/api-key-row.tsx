import type { ApiKeyItem } from "@/transport/http/ui/dashboard-data";
import { formatDateTime } from "../utils";

interface ApiKeyRowProps {
  item: ApiKeyItem;
}

export function ApiKeyRow({ item }: ApiKeyRowProps) {
  const name = item.name ?? "Untitled";
  const prefix = item.prefix ?? "";
  const start = item.start ?? "";
  const displayKey = `${prefix}${start}`;
  const expires = item.expiresAt ? formatDateTime(item.expiresAt) : "Never";
  const lastRequest = item.lastRequest
    ? formatDateTime(item.lastRequest)
    : "Never";

  return (
    <div class="hard-shadow-hover flex flex-col gap-0 border-[#111111] border-b px-4 py-4 transition-all duration-200 ease-out hover:bg-[#F5F5F5] md:flex-row md:items-center md:justify-between md:py-5">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-bold font-mono text-[#111111] text-[11px] uppercase tracking-[0.15em]">
            {name}
          </span>
          <span class="border-[#E5E5E0] border-l pl-3 font-mono text-[#737373] text-[10px] uppercase tracking-[0.1em]">
            ID: {item.id.slice(0, 8)}…
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2 font-mono text-[#737373] text-xs">
          <span class="border border-[#E5E5E0] bg-white px-2 py-0.5 font-mono text-[10px]">
            {displayKey}
          </span>
          <span class="text-[#E5E5E0]">•</span>
          <span class="font-sans text-sm">Expires: {expires}</span>
          <span class="text-[#E5E5E0]">•</span>
          <span class="font-sans text-sm">Last used: {lastRequest}</span>
        </div>
      </div>
      <div class="mt-3 flex min-w-0 shrink-0 md:mt-0">
        <form action="/form/admin/api-keys/delete" method="post">
          <input name="keyId" type="hidden" value={item.id} />
          <button
            class="min-h-[40px] border-2 border-[#CC0000] bg-transparent px-4 py-2 font-mono text-[#CC0000] text-[10px] uppercase tracking-[0.1em] transition-all duration-200 ease-out hover:bg-[#CC0000] hover:text-[#F9F9F7]"
            type="submit"
          >
            Revoke Key
          </button>
        </form>
      </div>
    </div>
  );
}
