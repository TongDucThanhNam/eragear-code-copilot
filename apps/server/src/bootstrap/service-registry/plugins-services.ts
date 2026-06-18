import { PluginsService } from "@/modules/plugins";
import {
  LocalAdePluginsAdapter,
  type LocalAdePluginsSource,
} from "@/modules/plugins/di";
import type { PluginsUseCases } from "@/modules/use-cases";

export function createPluginsUseCases(
  localAde: LocalAdePluginsSource
): PluginsUseCases {
  return {
    plugins: new PluginsService(new LocalAdePluginsAdapter(localAde)),
  };
}
