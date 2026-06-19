import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { getRequiredAuthContext, getRequiredUserId } from "./auth-helpers";
import type { TRPCContext } from "./context";

function createContext(auth: TRPCContext["auth"]): Pick<TRPCContext, "auth"> {
  return { auth };
}

describe("tRPC auth helpers", () => {
  test("returns the required auth context", () => {
    const auth: NonNullable<TRPCContext["auth"]> = {
      type: "local",
      userId: "user-1",
    };

    expect(getRequiredAuthContext(createContext(auth))).toBe(auth);
  });

  test("returns the required user id", () => {
    expect(
      getRequiredUserId(createContext({ type: "apiKey", userId: "user-1" }))
    ).toBe("user-1");
  });

  test("throws the standard unauthorized tRPC error when auth is missing", () => {
    expect(() => getRequiredAuthContext(createContext(null))).toThrow(
      TRPCError
    );

    try {
      getRequiredUserId(createContext(null));
      throw new Error("Expected unauthorized error");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("UNAUTHORIZED");
    }
  });
});
