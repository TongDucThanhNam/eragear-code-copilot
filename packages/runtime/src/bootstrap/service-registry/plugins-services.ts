import { PluginsService } from "#runtime/modules/plugins";
import {
  LocalAdePluginsAdapter,
  type LocalAdePluginsSource,
} from "#runtime/modules/plugins/di";
import type { PluginsUseCases } from "#runtime/modules/use-cases";

export function createPluginsUseCases(
  localAde: LocalAdePluginsSource
): PluginsUseCases {
  return {
    plugins: new PluginsService(new LocalAdePluginsAdapter(localAde)),
  };
}
