import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type CodingPlanSubscriptionState,
  CodingPlanSubscriptionStateSchema,
} from "../application/contracts/coding-plan-subscription.contract";
import type {
  CodingPlanSubscriptionRepositoryPort,
  CodingPlanSubscriptionStoreSnapshot,
  MutableCodingPlanSubscriptionStoreSnapshot,
} from "../application/ports/coding-plan-subscription-repository.port";

const DOCUMENT_VERSION = 1;

const CodingPlanSubscriptionFileSchema = z.object({
  version: z.literal(DOCUMENT_VERSION),
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

  async read<T>(
    reader: (snapshot: CodingPlanSubscriptionStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    return await reader(toStoreSnapshot(file));
  }

  async mutate<T>(
    mutator: (
      snapshot: MutableCodingPlanSubscriptionStoreSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    const snapshot = toMutableStoreSnapshot(file);
    const result = await mutator(snapshot);
    await this.writeFile(fromMutableStoreSnapshot(snapshot));
    return result;
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
        return { version: DOCUMENT_VERSION, subscriptionsByUserId: {} };
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

function toStoreSnapshot(
  file: CodingPlanSubscriptionFile
): CodingPlanSubscriptionStoreSnapshot {
  return {
    subscriptionsByUserId: cloneSubscriptionsByUserId(
      file.subscriptionsByUserId
    ),
  };
}

function toMutableStoreSnapshot(
  file: CodingPlanSubscriptionFile
): MutableCodingPlanSubscriptionStoreSnapshot {
  return {
    subscriptionsByUserId: cloneSubscriptionsByUserId(
      file.subscriptionsByUserId
    ),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableCodingPlanSubscriptionStoreSnapshot
): CodingPlanSubscriptionFile {
  return CodingPlanSubscriptionFileSchema.parse({
    version: DOCUMENT_VERSION,
    subscriptionsByUserId: cloneSubscriptionsByUserId(
      snapshot.subscriptionsByUserId
    ),
  });
}

function cloneSubscriptionsByUserId(
  subscriptionsByUserId: Readonly<Record<string, CodingPlanSubscriptionState>>
): Record<string, CodingPlanSubscriptionState> {
  return Object.fromEntries(
    Object.entries(subscriptionsByUserId).map(([userId, subscription]) => [
      userId,
      cloneSubscription(subscription),
    ])
  );
}

function cloneSubscription(
  subscription: CodingPlanSubscriptionState
): CodingPlanSubscriptionState {
  return {
    ...subscription,
    entitlements: subscription.entitlements.map((entitlement) => ({
      ...entitlement,
    })),
  };
}
