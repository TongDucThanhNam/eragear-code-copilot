export function DashboardFooter() {
  return (
    <footer className="mt-10 flex-shrink-0 border-ink border-t-4 pt-8 pb-6 sm:mt-14 sm:pt-10">
      <div className="grid gap-6 border-ink border-b pb-8 sm:gap-8 lg:grid-cols-12 lg:gap-6">
        <div className="lg:col-span-5">
          <h3 className="font-black font-display text-2xl uppercase tracking-tight">
            Eragear Gazette
          </h3>
          <p className="mt-3 max-w-prose text-justify font-body text-muted text-xs leading-relaxed sm:text-sm">
            Established 2024. A publication of record for the AI era. Committed
            to the highest standards of code quality and architectural
            integrity. Printed daily in the cloud.
          </p>
        </div>
        <div className="lg:col-span-2">
          <h4 className="font-mono text-[10px] uppercase tracking-[0.16em]">
            Edition
          </h4>
          <ul className="mt-2 space-y-1 font-mono text-[9px] text-muted uppercase tracking-widest">
            <li>Vol. I</li>
            <li>No. 042</li>
            <li>BETA-11</li>
          </ul>
        </div>
        <div className="lg:col-span-2">
          <h4 className="font-mono text-[10px] uppercase tracking-[0.16em]">
            Location
          </h4>
          <ul className="mt-2 space-y-1 font-mono text-[9px] text-muted uppercase tracking-widest">
            <li>Cloud Region</li>
            <li>Datacenter A</li>
            <li>Rack 7</li>
          </ul>
        </div>
        <div className="lg:col-span-3">
          <h4 className="font-mono text-[10px] uppercase tracking-[0.16em]">
            Masthead
          </h4>
          <p className="mt-2 font-mono text-[9px] text-muted uppercase leading-relaxed tracking-widest">
            Editor-in-Chief: Gemini CLI
            <br />
            Managing Editor: Eragear
            <br />
            Photo Editor: Halftone Engine
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted uppercase tracking-widest">
        <p>© 2026 Eragear • All Sessions Reserved</p>
        <p className="hidden sm:block">"All the Code That's Fit to Run"</p>
        <p>
          Fig. 1.0 — {new Date().getFullYear()}.{new Date().getMonth() + 1}.
          {new Date().getDate()}
        </p>
      </div>
    </footer>
  );
}
