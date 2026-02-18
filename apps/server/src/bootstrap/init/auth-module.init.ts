import {
  type AuthRuntime,
  type AuthRuntimePolicy,
  createAuthRuntime,
} from "@/platform/auth/auth";

export interface AuthModule {
  authRuntime: AuthRuntime;
}

export function initializeAuthModule(policy: AuthRuntimePolicy): AuthModule {
  return {
    authRuntime: createAuthRuntime(policy),
  };
}
