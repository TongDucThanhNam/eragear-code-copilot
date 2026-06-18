import { describe, expect, test } from "bun:test";
import { aiRouter } from "./ai";

describe("aiRouter", () => {
  test("keeps extracted message procedures on the flat AI interface", () => {
    const procedures = aiRouter._def.procedures as Record<string, unknown>;

    expect(procedures.sendMessage).toBeDefined();
    expect(procedures.cancelPrompt).toBeDefined();
    expect(procedures.message).toBeUndefined();
    expect(procedures.aiMessage).toBeUndefined();
  });

  test("keeps extracted config procedures on the flat AI interface", () => {
    const procedures = aiRouter._def.procedures as Record<string, unknown>;

    expect(procedures.setModel).toBeDefined();
    expect(procedures.setMode).toBeDefined();
    expect(procedures.setConfigOption).toBeDefined();
    expect(procedures.config).toBeUndefined();
    expect(procedures.aiConfig).toBeUndefined();
  });

  test("keeps extracted supervisor procedures on the flat AI interface", () => {
    const procedures = aiRouter._def.procedures as Record<string, unknown>;

    expect(procedures.setSupervisorMode).toBeDefined();
    expect(procedures.supervisor).toBeUndefined();
    expect(procedures.aiSupervisor).toBeUndefined();
  });
});
