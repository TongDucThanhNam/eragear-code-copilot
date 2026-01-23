import type { SessionRuntimePort } from "../../../shared/types/ports";

export class RespondPermissionService {
  constructor(private sessionRuntime: SessionRuntimePort) {}

  execute(input: { chatId: string; requestId: string; decision: string }) {
    const session = this.sessionRuntime.get(input.chatId);
    if (!session) {
      throw new Error("Chat not found");
    }

    const pending = session.pendingPermissions.get(input.requestId);
    if (!pending) {
      throw new Error("Permission request not found or already handled");
    }

    let optionId = input.decision === "allow" ? "allow-once" : "reject-once";

    const options = Array.isArray(pending.options)
      ? (pending.options as any[])
      : [];
    if (options.length > 0) {
      const exactMatch = options.find(
        (opt: any) => opt.optionId === input.decision
      );

      if (exactMatch) {
        optionId = exactMatch.optionId;
      } else {
        const isAllow = input.decision === "allow";
        const keywords = isAllow
          ? ["allow", "yes", "confirm", "approve"]
          : ["reject", "no", "cancel", "blockdeny", ""];

        const heuristicMatch = options.find((opt: any) => {
          const id = String(opt.optionId || opt.kind || "").toLowerCase();
          const name = String(opt.name || "").toLowerCase();

          if (isAllow) {
            if (id === "allow" || id === "allow_once") {
              return true;
            }
            return keywords.some(
              (keyword) => id.includes(keyword) || name.includes(keyword)
            );
          }

          return keywords.some(
            (keyword) => id.includes(keyword) || name.includes(keyword)
          );
        });

        if (heuristicMatch) {
          optionId = heuristicMatch.optionId;
        }
      }
    }

    pending.resolve({ outcome: { outcome: "selected", optionId } });
    session.pendingPermissions.delete(input.requestId);
    return { ok: true };
  }
}
