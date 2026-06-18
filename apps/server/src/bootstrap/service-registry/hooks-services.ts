import { HooksService } from "@/modules/hooks";
import {
  LocalAdeHooksAdapter,
  type LocalAdeHooksSource,
} from "@/modules/hooks/di";
import type { HooksUseCases } from "@/modules/use-cases";

export function createHooksUseCases(
  localAde: LocalAdeHooksSource
): HooksUseCases {
  return {
    hooks: new HooksService(new LocalAdeHooksAdapter(localAde)),
  };
}
