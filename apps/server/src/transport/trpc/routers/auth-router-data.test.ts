import { describe, expect, test } from "bun:test";
import type { AuthContext } from "../context";
import { type AuthMeUser, createAuthMeResponse } from "./auth-router-data";

describe("createAuthMeResponse", () => {
  test("returns an existing user profile unchanged", () => {
    const user: AuthMeUser = {
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One",
      image: "https://example.com/avatar.png",
    };

    expect(
      createAuthMeResponse({ type: "session", userId: "user-1" }, user)
    ).toEqual({ user });
  });

  test("returns local desktop fallback metadata when local auth has no stored user", () => {
    const auth: AuthContext = {
      type: "local",
      userId: "local-desktop-user",
    };

    expect(createAuthMeResponse(auth, null)).toEqual({
      user: {
        id: "local-desktop-user",
        email: null,
        username: "local",
        name: "Local Desktop",
        image: null,
      },
    });
  });

  test("returns null when non-local auth has no readable user", () => {
    expect(
      createAuthMeResponse({ type: "apiKey", userId: "api-user" }, null)
    ).toEqual({ user: null });
  });
});
