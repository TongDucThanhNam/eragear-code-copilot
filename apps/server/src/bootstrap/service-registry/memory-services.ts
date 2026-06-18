import { MemoryService } from "@/modules/memory";
import {
  LocalAdeMemoryAdapter,
  type LocalAdeMemorySource,
} from "@/modules/memory/di";
import type { MemoryUseCases } from "@/modules/use-cases";

export function createMemoryUseCases(
  localAde: LocalAdeMemorySource
): MemoryUseCases {
  return {
    memory: new MemoryService(new LocalAdeMemoryAdapter(localAde)),
  };
}
