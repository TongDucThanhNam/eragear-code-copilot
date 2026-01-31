export function DashboardFooter() {
  return (
    <footer class="mt-auto flex-shrink-0 border-ink border-t-2 py-3">
      <div class="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted uppercase tracking-widest">
        <p>© Eragear • ACP Client v1.0</p>
        <p class="hidden sm:block">
          Printed in the Cloud • All Sessions Reserved
        </p>
        <p>
          Fig. 1.0 —{" "}
          {new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </footer>
  );
}
