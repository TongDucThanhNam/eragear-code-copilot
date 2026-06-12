import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type CodingPlanSubscriptionState,
  CodingPlanSubscriptionStateSchema,
} from "../application/contracts/coding-plan-subscription.contract";
import type { CodingPlanSubscriptionRepositoryPort } from "../application/ports/coding-plan-subscription-repository.port";

const CodingPlanSubscriptionFileSchema = z.object({
  version: z.literal(1),
  subscriptionsByUserId: z.record(
    z.string(),
    CodingPlanSubscriptionStateSchema
  ),
});

type CodingPlanSubscriptionFile = z.infer<
  typeof CodingPlanSubscriptionFileSchema
>;

interface CodingPlanSubscriptionFileRepositoryDeps {
  filePath: () => string;
}

export class CodingPlanSubscriptionFileRepository
  implements CodingPlanSubscriptionRepositoryPort
{
  private readonly filePath: () => string;

  constructor(deps: CodingPlanSubscriptionFileRepositoryDeps) {
    this.filePath = deps.filePath;
  }

  async getSubscription(
    userId: string
  ): Promise<CodingPlanSubscriptionState | null> {
    const file = await this.readFile();
    return file.subscriptionsByUserId[userId] ?? null;
  }

  async saveSubscription(
    subscription: CodingPlanSubscriptionState
  ): Promise<CodingPlanSubscriptionState> {
    const file = await this.readFile();
    file.subscriptionsByUserId[subscription.userId] = subscription;
    await this.writeFile(file);
    return subscription;
  }

  private async readFile(): Promise<CodingPlanSubscriptionFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return CodingPlanSubscriptionFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        String((error as { code?: unknown }).code) === "ENOENT"
      ) {
        return { version: 1, subscriptionsByUserId: {} };
      }
      throw error;
    }
  }

  private async writeFile(file: CodingPlanSubscriptionFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}
