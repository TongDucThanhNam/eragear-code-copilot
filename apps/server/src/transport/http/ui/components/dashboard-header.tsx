export function DashboardHeader() {
  return (
    <header class="mb-4 flex-shrink-0 border-ink border-b-4 py-4">
      <div class="mb-2 flex items-center justify-between border-ink border-b pb-2">
        <p class="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
          Vol. 1 No. 1 • Agent Control Protocol
        </p>
        <p class="hidden font-mono text-[10px] text-muted uppercase tracking-[0.2em] sm:block">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      <div class="flex items-end justify-between gap-4">
        <div>
          <h1 class="font-black font-display text-5xl leading-[0.85] tracking-tighter md:text-6xl lg:text-7xl">
            Eragear
          </h1>
          <p class="mt-1 font-mono text-xs uppercase tracking-[0.3em]">
            Server Dashboard
          </p>
        </div>

        <div class="hidden items-center gap-2 sm:flex">
          <span class="inline-block h-2 w-2 animate-pulse bg-green-500" />
          <span class="font-mono text-[10px] uppercase tracking-widest">
            Server Online
          </span>
        </div>
      </div>
    </header>
  );
}
