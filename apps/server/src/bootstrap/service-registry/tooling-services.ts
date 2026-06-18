import {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";
import type { ToolingUseCases } from "@/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type ToolingServiceDependencies = ServiceRegistrySlice<
  "gitAdapter" | "sessionRuntime"
>;

export function createToolingUseCases(
  deps: ToolingServiceDependencies
): ToolingUseCases {
  const codeContextService = new CodeContextService(
    deps.gitAdapter,
    deps.sessionRuntime
  );
  const respondPermissionService = new RespondPermissionService(
    deps.sessionRuntime
  );

  return {
    codeContext: codeContextService,
    respondPermission: respondPermissionService,
  };
}
