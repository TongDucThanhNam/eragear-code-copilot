import { useDashboardState } from "@/presentation/dashboard/dashboard-view.context";

const ALERT_BASE =
  "fade-in group relative flex flex-col overflow-hidden border-2 border-ink p-0 text-paper shadow-news transition-all duration-200 hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_var(--ink)] sm:flex-row";

const ALERT_LABEL_BASE =
  "flex min-h-[40px] items-center border-ink border-b-2 bg-ink px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.18em] transition-colors duration-200 sm:min-h-0 sm:w-[180px] sm:border-b-0 sm:border-r-2";

const ALERT_CONTENT_BASE =
  "flex-1 px-4 py-2.5 font-body text-sm leading-relaxed tracking-tight";

export function DashboardAlerts() {
  const { success, notice, errors, requiresRestart } = useDashboardState();

  if (!(success || notice || errors?.general || requiresRestart)) {
    return null;
  }

  return (
    <section
      aria-live="polite"
      className="mt-4 flex flex-col gap-3 sm:mt-5 lg:mt-6"
    >
      {success && (
        <div className={`${ALERT_BASE} bg-[#006400]`}>
          <div className={`${ALERT_LABEL_BASE} group-hover:bg-[#004d00]`}>
            ✓ Success
          </div>
          <div className={ALERT_CONTENT_BASE}>
            {notice || "Settings saved successfully!"}
          </div>
        </div>
      )}

      {notice && !success && (
        <div className={`${ALERT_BASE} bg-[#333333]`}>
          <div className={`${ALERT_LABEL_BASE} group-hover:bg-[#1a1a1a]`}>
            Bulletin
          </div>
          <div className={ALERT_CONTENT_BASE}>{notice}</div>
        </div>
      )}

      {errors?.general && (
        <div className={`${ALERT_BASE} bg-[#CC0000]`}>
          <div className={`${ALERT_LABEL_BASE} group-hover:bg-[#990000]`}>
            ⚠ Error
          </div>
          <div className={ALERT_CONTENT_BASE}>{errors.general}</div>
        </div>
      )}

      {requiresRestart && requiresRestart.length > 0 && (
        <div className={`${ALERT_BASE} bg-[#333333]`}>
          <div className={`${ALERT_LABEL_BASE} group-hover:bg-[#1a1a1a]`}>
            ⚠ Restart Required
          </div>
          <div className={ALERT_CONTENT_BASE}>
            Changes to{" "}
            <strong className="font-bold not-italic">
              {requiresRestart.join(", ")}
            </strong>{" "}
            require server restart.
          </div>
        </div>
      )}
    </section>
  );
}
