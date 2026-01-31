import type { DashboardStats } from "@/transport/http/ui/dashboard-data";
import { formatUptime } from "../utils";

interface OverviewStatsProps {
  stats: DashboardStats;
}

export function OverviewStats({ stats }: OverviewStatsProps) {
  return (
    <section class="sticky top-0 border-2 border-ink bg-ink p-6 text-paper shadow-news">
      <div class="mb-4 flex items-center gap-2">
        <span class="h-px flex-1 bg-paper/30" />
        <span class="font-mono text-[10px] text-paper/70 uppercase tracking-[0.3em]">
          At a Glance
        </span>
        <span class="h-px flex-1 bg-paper/30" />
      </div>

      <h2 class="mb-6 text-center font-black font-display text-3xl uppercase tracking-wide">
        Overview
      </h2>

      <div class="grid grid-cols-2 border border-paper/30">
        <div class="border-paper/30 border-r border-b p-4 text-center">
          <div class="font-black font-display text-4xl leading-none">
            {stats.totalProjects || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Projects
          </div>
        </div>
        <div class="border-paper/30 border-b p-4 text-center">
          <div class="font-black font-display text-4xl leading-none">
            {stats.totalSessions || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Sessions
          </div>
        </div>
        <div
          class="border-paper/30 border-r border-b p-4 text-center"
          style={{ backgroundColor: "#CC0000" }}
        >
          <div class="font-black font-display text-4xl leading-none">
            {stats.activeSessions || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] uppercase tracking-widest opacity-90">
            Active Now
          </div>
        </div>
        <div class="border-paper/30 border-b p-4 text-center">
          <div class="font-black font-display text-4xl leading-none">
            {stats.recentSessions24h || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Last 24h
          </div>
        </div>
        <div class="col-span-2 p-4 text-center">
          <div class="font-medium font-mono text-2xl tracking-tight">
            {formatUptime(stats.serverUptime)}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Server Uptime
          </div>
        </div>
      </div>

      <div class="py-4 text-center font-serif text-paper/30 text-xl tracking-[1em]">
        ✦ ✧ ✦
      </div>

      <div class="border-paper/30 border-t pt-4 text-center">
        <p class="font-mono text-[10px] text-paper/50 uppercase tracking-widest">
          This Week
        </p>
        <p class="mt-2 font-bold font-display text-2xl">
          {stats.weeklySessions || 0}
        </p>
        <p class="mt-1 font-mono text-[10px] text-paper/50 uppercase tracking-widest">
          Sessions Completed
        </p>
      </div>
    </section>
  );
}
