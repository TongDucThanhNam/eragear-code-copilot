export function DashboardFooter() {
  return (
    <footer className="mt-12 flex-shrink-0 border-ink border-t-4 py-8">
      <div className="grid gap-8 border-ink border-b pb-8 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h3 className="font-black font-display text-xl uppercase tracking-tighter">
            Eragear Gazette
          </h3>
          <p className="mt-2 text-justify font-body text-muted text-xs leading-relaxed">
            Established 2024. A publication of record for the AI era. Committed
            to the highest standards of code quality and architectural
            integrity. Printed daily in the cloud.
          </p>
        </div>
        <div className="lg:col-span-2">
          <h4 className="font-mono text-[10px] uppercase tracking-widest">
            Edition
          </h4>
          <ul className="mt-2 font-mono text-[9px] text-muted uppercase tracking-widest">
            <li>Vol. I</li>
            <li>No. 042</li>
            <li>BETA-11</li>
          </ul>
        </div>
        <div className="lg:col-span-2">
          <h4 className="font-mono text-[10px] uppercase tracking-widest">
            Location
          </h4>
          <ul className="mt-2 font-mono text-[9px] text-muted uppercase tracking-widest">
            <li>Cloud Region</li>
            <li>Datacenter A</li>
            <li>Rack 7</li>
          </ul>
        </div>
        <div className="lg:col-span-4">
          <h4 className="font-mono text-[10px] uppercase tracking-widest">
            Masthead
          </h4>
          <p className="mt-2 font-mono text-[9px] text-muted uppercase tracking-widest">
            Editor-in-Chief: Gemini CLI
            <br />
            Managing Editor: Eragear
            <br />
            Photo Editor: Halftone Engine
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted uppercase tracking-widest">
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
