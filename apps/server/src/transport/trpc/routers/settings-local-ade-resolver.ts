import { getRequiredUserId } from "../auth-helpers";
import type { TRPCContext } from "../context";

type SettingsLocalAdeService = TRPCContext["useCases"]["settings"]["localAde"];

type SettingsLocalAdeHandler<TInput, TResult> = (
  service: SettingsLocalAdeService,
  userId: string,
  input: TInput
) => Promise<TResult> | TResult;

interface SettingsLocalAdeResolverArgs<TInput> {
  ctx: TRPCContext;
  input: TInput;
}

export function resolveSettingsLocalAde<TInput, TResult>(
  handler: SettingsLocalAdeHandler<TInput, TResult>
) {
  return async ({
    ctx,
    input,
  }: SettingsLocalAdeResolverArgs<TInput>): Promise<TResult> => {
    const service = ctx.useCases.settings.localAde;
    return await handler(service, getRequiredUserId(ctx), input);
  };
}
