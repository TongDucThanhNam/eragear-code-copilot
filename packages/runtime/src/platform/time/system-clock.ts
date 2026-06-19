import type { ClockPort } from "#runtime/shared/ports/clock.port";

export const systemClock: ClockPort = {
  nowMs(): number {
    return Date.now();
  },
};
