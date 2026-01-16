import { z } from "zod";
import { chats } from "../../session/events";
import { publicProcedure, router } from "../base";

export const toolRouter = router({
	respondToPermissionRequest: publicProcedure
		.input(
			z.object({
				chatId: z.string(),
				requestId: z.string(),
				decision: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) {
				throw new Error("Chat not found");
			}

			const pending = session.pendingPermissions.get(input.requestId);
			if (!pending) {
				throw new Error("Permission request not found or already handled");
			}

			console.log(
				`[tRPC] Responding to permission request ${input.requestId}: ${input.decision}`,
			);
			console.log(
				`[tRPC] Available options:`,
				JSON.stringify(pending.options, null, 2),
			);

			let optionId = input.decision === "allow" ? "allow-once" : "reject-once";

			if (pending.options && Array.isArray(pending.options)) {
				if (pending.options.length > 0) {
					const exactMatch = pending.options.find(
						(opt: any) =>
							(opt.optionId || opt.id) === input.decision ||
							opt.id === input.decision,
					);

					if (exactMatch) {
						optionId = exactMatch.optionId || exactMatch.id;
						console.log(
							`[tRPC] Exact match mapped ${input.decision} to option ${optionId}`,
						);
					} else {
						const isAllow = input.decision === "allow";
						const keywords = isAllow
							? ["allow", "yes", "confirm", "approve"]
							: ["reject", "no", "deny", "cancel", "block"];

						const heuristicMatch = pending.options.find((opt: any) => {
							const id = String(
								opt.optionId || opt.id || opt.kind || "",
							).toLowerCase();
							const label = String(
								opt.name || opt.title || opt.label || "",
							).toLowerCase();

							if (isAllow) {
								if (id === "allow" || id === "allow_once") return true;
								return keywords.some(
									(keyword) => id.includes(keyword) || label.includes(keyword),
								);
							}

							return keywords.some(
								(keyword) => id.includes(keyword) || label.includes(keyword),
							);
						});

						if (heuristicMatch) {
							optionId = heuristicMatch.optionId || heuristicMatch.id;
							console.log(
								`[tRPC] Heuristic mapped ${input.decision} to option ${optionId}`,
							);
						} else {
							console.warn(
								`[tRPC] Could not safely map ${input.decision} to available options:`,
								pending.options,
							);
						}
					}
				}
			}

			pending.resolve({ outcome: { outcome: "selected", optionId } });
			console.log(`[tRPC] Resolved permission with optionId: ${optionId}`);

			session.pendingPermissions.delete(input.requestId);
			return { ok: true };
		}),
});
