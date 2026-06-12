import { UpdateTrafficProxyConfigInputSchema } from "@/modules/traffic-proxy";
import { protectedProcedure, router } from "../base";

export const trafficProxyRouter = router({
  getStatus: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.trafficProxy.trafficProxy.getStatus();
  }),

  updateConfig: protectedProcedure
    .input(UpdateTrafficProxyConfigInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.trafficProxy.trafficProxy.updateConfig(input);
    }),
});
