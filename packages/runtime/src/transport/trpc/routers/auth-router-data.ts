import type { AuthContext } from "../context";

export interface AuthMeUser {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
  image: string | null;
}

export interface AuthMeResponse {
  user: AuthMeUser | null;
}

function createLocalDesktopUser(auth: AuthContext): AuthMeUser {
  return {
    id: auth.userId,
    email: null,
    username: "local",
    name: "Local Desktop",
    image: null,
  };
}

export function createAuthMeResponse(
  auth: AuthContext,
  user: AuthMeUser | null
): AuthMeResponse {
  if (user) {
    return { user };
  }

  return {
    user: auth.type === "local" ? createLocalDesktopUser(auth) : null,
  };
}
