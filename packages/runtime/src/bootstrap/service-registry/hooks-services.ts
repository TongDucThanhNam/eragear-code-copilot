import { HooksService } from "#runtime/modules/hooks";
import {
  LocalAdeHooksAdapter,
  type LocalAdeHooksSource,
} from "#runtime/modules/hooks/di";
import type { HooksUseCases } from "#runtime/modules/use-cases";

export function createHooksUseCases(
  localAde: LocalAdeHooksSource
): HooksUseCases {
  return {
    hooks: new HooksService(new LocalAdeHooksAdapter(localAde)),
  };
}
