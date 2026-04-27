import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { selectPermissionOption } from "./supervisor-permission.service";

describe("selectPermissionOption", () => {
  test("approves with allow_once before any persistent allow option", () => {
    const selection = selectPermissionOption("approve", [
      { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
      { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
    ] satisfies acp.PermissionOption[]);

    expect(selection?.approved).toBe(true);
    expect(selection?.response).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  test("does not approve with only persistent allow options", () => {
    const selection = selectPermissionOption("approve", [
      { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
    ] satisfies acp.PermissionOption[]);

    expect(selection).toBeNull();
  });

  test("rejects by selecting an available reject option", () => {
    const selection = selectPermissionOption("reject", [
      { optionId: "deny-once", kind: "reject_once", name: "Reject once" },
    ] satisfies acp.PermissionOption[]);

    expect(selection?.approved).toBe(false);
    expect(selection?.response).toEqual({
      outcome: { outcome: "selected", optionId: "deny-once" },
    });
  });

  test("falls back to cancelled when rejection has no reject option", () => {
    const selection = selectPermissionOption("reject", [
      { optionId: "inspect", kind: "allow_once", name: "Inspect" },
    ] satisfies acp.PermissionOption[]);

    expect(selection).toEqual({
      response: { outcome: { outcome: "cancelled" } },
      approved: false,
      reason: "cancelled",
    });
  });

  test("defers invalid or unsupported choices to the user", () => {
    expect(selectPermissionOption("defer", [])).toBeNull();
  });
});
