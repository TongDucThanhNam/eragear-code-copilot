import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type RunnerEvent =
	| { type: "run_start"; runId: string }
	| {
			type: "task_start";
			taskId: string;
			taskText: string;
			index: number;
			total: number;
	  }
	| { type: "agent_chunk"; taskId: string; text: string }
	| { type: "task_done"; taskId: string; ok: boolean; logPath: string }
	| { type: "run_done"; runId: string; ok: boolean }
	| { type: "error"; message: string };

export const Route = createFileRoute("/runner")({
	component: RunnerPage,
});

function RunnerPage() {
	const [runId, setRunId] = React.useState<string | null>(null);
	const [events, setEvents] = React.useState<RunnerEvent[]>([]);
	const [log, setLog] = React.useState<string>("");

	async function startRun() {
		setEvents([]);
		setLog("");

		const res = await fetch("/api/runs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				projectRoot: ".", // This will be handled by server logic to mean "repo root"
				todoPath: "todo.md",
				agentCmd: "opencode",
				agentArgs: "acp",
			}),
		});

		const data = await res.json();
		setRunId(data.runId);

		const es = new EventSource(`/api/runs/${data.runId}/events`);
		es.onmessage = (msg) => {
			try {
				const ev = JSON.parse(msg.data) as RunnerEvent;
				setEvents((prev) => [...prev, ev]);
				if (ev.type === "agent_chunk") setLog((prev) => prev + ev.text);
			} catch {
				// ignore
			}
		};
		es.addEventListener("ready", () => {
			// optional
		});
	}

	async function stopRun() {
		if (!runId) return;
		await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
	}

	return (
		<div className="p-6 space-y-4">
			<div className="flex gap-2">
				<Button onClick={startRun}>Run</Button>
				<Button variant="secondary" onClick={stopRun} disabled={!runId}>
					Stop
				</Button>
			</div>

			<Card className="p-4">
				<div className="text-sm font-medium">Live log</div>
				<pre className="mt-2 text-xs whitespace-pre-wrap max-h-96 overflow-auto bg-muted p-2 rounded">
					{log}
				</pre>
			</Card>

			<Card className="p-4">
				<div className="text-sm font-medium">Events</div>
				<pre className="mt-2 text-xs whitespace-pre-wrap max-h-60 overflow-auto bg-muted p-2 rounded">
					{events.map((e, i) => `${i + 1}. ${JSON.stringify(e)}\n`).join("")}
				</pre>
			</Card>
		</div>
	);
}
