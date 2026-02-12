import type { ToolingServiceFactory } from "@/modules/service-factories";
import {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createToolingServices(
  deps: ServiceRegistryDependencies
): ToolingServiceFactory {
  const codeContextService = new CodeContextService(
    deps.gitAdapter,
    deps.sessionRuntime
  );
  const respondPermissionService = new RespondPermissionService(
    deps.sessionRuntime
  );

  return {
    codeContext: () => codeContextService,
    respondPermission: () => respondPermissionService,
  };
}
