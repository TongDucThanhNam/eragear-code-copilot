import { z } from "zod";
import { collectProjectContext, getGitDiff, readFileWithinRoot } from "../../services/code-processor";
import { chats } from "../../session/events";
import { publicProcedure, router } from "../base";

export const codeRouter = router({
	getProjectContext: publicProcedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			const projectRoot = session.projectRoot;
			const scanRoot = session.cwd || projectRoot;

			return collectProjectContext(scanRoot);
		}),

	getGitDiff: publicProcedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			return getGitDiff(session.projectRoot);
		}),

	getFileContent: publicProcedure
		.input(z.object({ chatId: z.string(), path: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			const content = await readFileWithinRoot(session.projectRoot, input.path);
			return { content };
		}),
});
