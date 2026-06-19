import { MemoryService } from "#runtime/modules/memory";
import {
  LocalAdeMemoryAdapter,
  type LocalAdeMemorySource,
} from "#runtime/modules/memory/di";
import type { MemoryUseCases } from "#runtime/modules/use-cases";

export function createMemoryUseCases(
  localAde: LocalAdeMemorySource
): MemoryUseCases {
  return {
    memory: new MemoryService(new LocalAdeMemoryAdapter(localAde)),
  };
}
