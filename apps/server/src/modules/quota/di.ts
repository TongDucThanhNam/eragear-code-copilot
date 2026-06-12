import type { QuotaProviderAdapter } from "./application/ports/quota-provider.port";
import { MiniMaxQuotaAdapter } from "./infra/minimax-quota.adapter";
import { OpenAIChatGPTQuotaAdapter } from "./infra/openai-chatgpt-quota.adapter";
import { ZaiQuotaAdapter } from "./infra/zai-quota.adapter";

export function createQuotaProviderAdapters(): QuotaProviderAdapter[] {
  return [
    new MiniMaxQuotaAdapter(),
    new ZaiQuotaAdapter(),
    new OpenAIChatGPTQuotaAdapter(),
  ];
}
