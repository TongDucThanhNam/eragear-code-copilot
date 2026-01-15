import { z } from "zod";

export const RunnerEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("run_start"),
		runId: z.string(),
		todoPath: z.string(),
		projectRoot: z.string(),
		ts: z.number(),
	}),
	z.object({
		type: z.literal("task_start"),
		runId: z.string(),
		taskId: z.string(),
		taskText: z.string(),
		index: z.number(),
		total: z.number(),
		ts: z.number(),
	}),
	z.object({
		type: z.literal("agent_chunk"),
		runId: z.string(),
		taskId: z.string(),
		text: z.string(),
		ts: z.number(),
	}),
	z.object({
		type: z.literal("tool_call"),
		runId: z.string(),
		taskId: z.string(),
		toolCallId: z.string(),
		name: z.string(),
		args: z.unknown(),
		ts: z.number(),
	}),
	z.object({
		type: z.literal("tool_result"),
		runId: z.string(),
		taskId: z.string(),
		toolCallId: z.string(),
		status: z.enum(["in_progress", "completed", "failed"]),
		output: z.unknown().optional(),
		ts: z.number(),
	}),
	z.object({
		type: z.literal("task_done"),
		runId: z.string(),
		taskId: z.string(),
		ok: z.boolean(),
		logPath: z.string(),
		ts: z.number(),
	}),
	z.object({
		type: z.literal("run_done"),
		runId: z.string(),
		ok: z.boolean(),
		ts: z.number(),
	}),
	z.object({
		type: z.literal("error"),
		runId: z.string().optional(),
		taskId: z.string().optional(),
		message: z.string(),
		detail: z.unknown().optional(),
		ts: z.number(),
	}),
]);

export type RunnerEvent = z.infer<typeof RunnerEventSchema>;
