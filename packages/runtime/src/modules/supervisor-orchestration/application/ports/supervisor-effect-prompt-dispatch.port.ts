import { CryptoHasher } from "bun";

export interface PreparedSupervisorPrompt {
  effectId: string;
  authorityId: string;
  text: string;
  promptHash: string;
}

export interface SupervisorEffectPromptDispatchPort {
  execute(input: {
    userId: string;
    chatId: string;
    text: string;
    source: "orchestrator";
    workflow: {
      effectId: string;
      authorityId: string;
      runId: string;
      owner: "manager" | "worker";
      workItemId?: string;
      attemptId?: string;
      promptHash: string;
    };
  }): Promise<{ turnId: string }>;
}

export function computeSupervisorPromptHash(text: string): string {
  return CryptoHasher.hash("sha256", text, "hex");
}

export function prepareSupervisorPrompt(input: {
  effectId: string;
  authorityId: string;
  text: string;
}): PreparedSupervisorPrompt {
  return {
    ...input,
    promptHash: computeSupervisorPromptHash(input.text),
  };
}

export function assertPreparedSupervisorPrompt(
  expectedText: string,
  prepared: PreparedSupervisorPrompt
): void {
  const expectedHash = computeSupervisorPromptHash(expectedText);
  if (prepared.text !== expectedText || prepared.promptHash !== expectedHash) {
    throw new Error(
      `Prepared Supervisor prompt does not match its canonical snapshot: ${prepared.effectId}`
    );
  }
}
