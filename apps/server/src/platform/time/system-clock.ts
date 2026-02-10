import type { ClockPort } from "@/shared/ports/clock.port";

export const systemClock: ClockPort = {
  nowMs(): number {
    return Date.now();
  },
};
