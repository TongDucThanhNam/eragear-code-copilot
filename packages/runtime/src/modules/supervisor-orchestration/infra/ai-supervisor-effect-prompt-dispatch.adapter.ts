import type { SendMessageService } from "#runtime/modules/ai";
import { WorkflowEffectUncertainError } from "#runtime/modules/workflow";
import type { SupervisorEffectPromptDispatchPort } from "../application/ports/supervisor-effect-prompt-dispatch.port";

/**
 * Raw ACP prompt adapter used only by claimed workflow effect handlers.
 * Durable authority, prompt text, and prompt hash are validated by the
 * workflow runtime and coordinators before this adapter is reached. Bounded
 * workflow correlation is persisted with the prompt as a namespaced annotation.
 * Once SendMessageService is entered, every thrown error is conservatively an
 * unknown ACP acknowledgement rather than a retryable dispatch failure.
 */
export class AiSupervisorEffectPromptDispatchAdapter
  implements SupervisorEffectPromptDispatchPort
{
  private readonly sendMessage: Pick<SendMessageService, "execute">;

  constructor(sendMessage: Pick<SendMessageService, "execute">) {
    this.sendMessage = sendMessage;
  }

  async execute(
    input: Parameters<SupervisorEffectPromptDispatchPort["execute"]>[0]
  ): Promise<{ turnId: string }> {
    const workflowCorrelation = {
      effectId: input.workflow.effectId,
      authorityId: input.workflow.authorityId,
      runId: input.workflow.runId,
      owner: input.workflow.owner,
      ...(input.workflow.workItemId
        ? { workItemId: input.workflow.workItemId }
        : {}),
      ...(input.workflow.attemptId
        ? { attemptId: input.workflow.attemptId }
        : {}),
      promptHash: input.workflow.promptHash,
    };
    try {
      const result = await this.sendMessage.execute({
        userId: input.userId,
        chatId: input.chatId,
        text: input.text,
        source: input.source,
        textAnnotations: {
          "eragear.workflow": workflowCorrelation,
        },
      });
      return { turnId: result.turnId };
    } catch (error) {
      const uncertain = new WorkflowEffectUncertainError({
        code: "ACP_PROMPT_ACK_UNCERTAIN",
        chatId: input.chatId,
        ...workflowCorrelation,
      });
      Object.defineProperty(uncertain, "cause", {
        configurable: true,
        value: error,
      });
      throw uncertain;
    }
  }
}
