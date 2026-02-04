import type { DeviceSessionItem } from "@/presentation/dashboard/dashboard-data";
import { formatDateTime, isDeviceSessionActive } from "../utils";

interface DeviceSessionRowProps {
  item: DeviceSessionItem;
  onActivateDeviceSession: (token: string) => void;
  onRevokeDeviceSession: (token: string) => void;
}

export function DeviceSessionRow({
  item,
  onActivateDeviceSession,
  onRevokeDeviceSession,
}: DeviceSessionRowProps) {
  const ua = item.session.userAgent ?? "Unknown device";
  const ip = item.session.ipAddress ?? "Unknown IP";
  const createdAt = formatDateTime(item.session.createdAt);
  const expiresAt = formatDateTime(item.session.expiresAt);
  const tokenPreview = item.session.token.slice(0, 6);

  const isActive = isDeviceSessionActive(item);

  return (
    <div
      className={`flex flex-col gap-0 border-[#111111] border-b px-4 py-4 transition-all duration-200 md:flex-row md:items-center md:justify-between md:py-5 ${
        isActive
          ? "bg-white"
          : "hard-shadow-hover bg-[#F9F9F7] hover:bg-[#F5F5F5]"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`flex shrink-0 items-center gap-2 ${
              isActive
                ? "border-l-2 border-l-[#CC0000] pl-3"
                : "border-l-2 border-l-[#E5E5E0] pl-3"
            }`}
          >
            <span className="font-mono text-[#737373] text-[10px] uppercase tracking-[0.1em]">
              {isActive ? "● Active" : "○ Inactive"}
            </span>
          </div>
          <span className="font-bold font-serif text-[#111111] text-lg md:text-xl">
            {item.user.name}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 font-mono text-[#737373] text-xs md:flex-row md:items-baseline md:gap-2 md:text-[11px]">
          <div className="md:border-[#E5E5E0] md:border-r md:pr-2">
            <span className="font-sans text-sm">{ua}</span>
          </div>
          <div className="md:border-[#E5E5E0] md:border-r md:pr-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em]">
              IP: {ip}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-sans text-sm">Created: {createdAt}</span>
            <span className="text-[#E5E5E0]">•</span>
            <span className="font-sans text-sm">Expires: {expiresAt}</span>
          </div>
        </div>
        <div className="mt-1 border-[#111111] border-l pl-2 font-mono text-[#737373] text-[10px]">
          Token: {tokenPreview}…
        </div>
      </div>
      <div className="mt-4 flex min-w-0 shrink-0 gap-2 md:mt-0">
        <button
          className={`min-h-[40px] border-2 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] transition-all duration-200 ease-out ${
            isActive
              ? "cursor-default border-[#111111] bg-[#111111] text-[#F9F9F7]"
              : "border-[#111111] bg-transparent text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7]"
          }`}
          disabled={isActive}
          onClick={() => onActivateDeviceSession(item.session.token)}
          type="button"
        >
          {isActive ? "Active" : "Activate"}
        </button>
        <button
          className="min-h-[40px] border-2 border-[#CC0000] bg-transparent px-4 py-2 font-mono text-[#CC0000] text-[10px] uppercase tracking-[0.1em] transition-all duration-200 hover:bg-[#CC0000] hover:text-[#F9F9F7]"
          onClick={() => onRevokeDeviceSession(item.session.token)}
          type="button"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}
