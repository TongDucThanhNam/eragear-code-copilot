import {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";
import type { ToolingUseCases } from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createToolingUseCases(
  deps: ServiceRegistryDependencies
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
