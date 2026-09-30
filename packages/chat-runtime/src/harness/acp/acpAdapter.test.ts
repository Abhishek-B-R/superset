import { describe, expect, it } from "bun:test";
import type { AdapterEvent } from "../types";
import { AcpAdapter } from "./acpAdapter";
import type { AcpTransport, AcpTransportHandlers } from "./rpcClient";

/**
 * A scripted ACP agent: auto-responds to initialize/session_new, and for
 * session/prompt delivers a canned stream of session/update notifications
 * before returning the stop reason. Captures client->agent frames for
 * assertions.
 */
class FakeAcpAgent {
	readonly sent: Array<Record<string, unknown>> = [];
	private handlers!: AcpTransportHandlers;

	transport(handlers: AcpTransportHandlers): AcpTransport {
		this.handlers = handlers;
		return {
			send: (line) => this.onSend(line),
			close: async () => undefined,
		};
	}

	private deliver(frame: Record<string, unknown>): void {
		this.handlers.onLine(JSON.stringify(frame));
	}

	private respond(id: number, result: unknown): void {
		this.deliver({ jsonrpc: "2.0", id, result });
	}

	private notify(sessionId: string, update: Record<string, unknown>): void {
		this.deliver({
			jsonrpc: "2.0",
			method: "session/update",
			params: { sessionId, update },
		});
	}

	/** Ask the agent to request a permission mid-turn; returns the request id. */
	requestPermission(sessionId: string, toolCallId: string): number {
		const id = 9001;
		this.deliver({
			jsonrpc: "2.0",
			id,
			method: "session/request_permission",
			params: {
				sessionId,
				toolCall: { toolCallId, title: "Run tests" },
				options: [
					{ optionId: "allow", name: "Allow", kind: "allow_once" },
					{ optionId: "reject", name: "Reject", kind: "reject_once" },
				],
			},
		});
		return id;
	}

	lastPermissionResponse(): Record<string, unknown> | undefined {
		return this.sent.find((f) => f.id === 9001);
	}

	private onSend(line: string): void {
		const frame = JSON.parse(line) as {
			id?: number;
			method?: string;
			params?: Record<string, unknown>;
		};
		this.sent.push(frame as Record<string, unknown>);
		if (frame.id === undefined || frame.method === undefined) return;

		queueMicrotask(() => {
			if (frame.method === "initialize") {
				this.respond(frame.id as number, { protocolVersion: 1 });
			} else if (frame.method === "session/new") {
				this.respond(frame.id as number, { sessionId: "sess-1" });
			} else if (frame.method === "session/load") {
				// ACP returns null after replaying history; adapter keeps the id.
				this.respond(frame.id as number, null);
			} else if (frame.method === "session/prompt") {
				this.notify("sess-1", {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hello" },
				});
				this.notify("sess-1", {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: " world" },
				});
				this.notify("sess-1", {
					sessionUpdate: "tool_call",
					toolCallId: "tc-1",
					title: "Read file",
					kind: "read",
					status: "completed",
					content: [{ type: "content", content: { type: "text", text: "ok" } }],
				});
				this.respond(frame.id as number, { stopReason: "end_turn" });
			}
		});
	}
}

async function collect(iterable: AsyncIterable<AdapterEvent>, into: AdapterEvent[]) {
	for await (const event of iterable) into.push(event);
}

async function flush(times = 8): Promise<void> {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("AcpAdapter", () => {
	it("bootstraps, streams a turn, and maps items", async () => {
		const agent = new FakeAcpAgent();
		let counter = 0;
		const adapter = new AcpAdapter({
			command: "fake",
			createTransport: (_opts, handlers) => agent.transport(handlers),
			now: () => 1000,
			mintId: () => `id-${++counter}`,
		});

		const events: AdapterEvent[] = [];
		void collect(adapter.start({ cwd: "/work" }), events);
		await flush();

		adapter.prompt([{ type: "text", text: "hi" }]);
		await flush();

		const sessions = events.filter((e) => e.kind === "session");
		expect(sessions.map((e) => (e.kind === "session" ? e.session.status : null))).toContain("idle");

		const items = events.filter((e) => e.kind === "item").map((e) => (e.kind === "item" ? e.item : null));
		// The item is re-emitted with full text when the text stream flushes.
		const agentMessages = items.filter((i) => i?.kind === "agent_message");
		const agentMessage = agentMessages[agentMessages.length - 1];
		expect(agentMessage && "text" in agentMessage ? agentMessage.text : "").toBe("Hello world");

		const toolCall = items.find((i) => i?.kind === "tool_call");
		expect(toolCall && "toolKind" in toolCall ? toolCall.toolKind : "").toBe("read");

		const textDeltas = events.filter((e) => e.kind === "delta");
		expect(textDeltas.length).toBe(2);

		const turns = events.filter((e) => e.kind === "turn").map((e) => (e.kind === "turn" ? e.turn.status : null));
		expect(turns).toContain("running");
		expect(turns).toContain("completed");

		// initialize + session/new + session/prompt all went out.
		expect(agent.sent.map((f) => f.method)).toEqual([
			"initialize",
			"session/new",
			"session/prompt",
		]);

		await adapter.dispose();
	});

	it("never emits an item with an empty turnId (history replay before any turn)", async () => {
		const agent = new FakeAcpAgent();
		let counter = 0;
		const adapter = new AcpAdapter({
			command: "fake",
			createTransport: (_opts, handlers) => agent.transport(handlers),
			now: () => 1,
			mintId: () => `id-${++counter}`,
		});
		const events: AdapterEvent[] = [];
		void collect(adapter.start({ cwd: "/work" }), events);
		await flush();

		// Simulate the agent replaying a message with no prompt turn in flight.
		(agent as unknown as { deliver: (f: Record<string, unknown>) => void }).deliver({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "sess-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "old reply" },
				},
			},
		});
		await flush();

		const itemTurnIds = events
			.filter((e) => e.kind === "item")
			.map((e) => (e.kind === "item" ? e.turnId : ""));
		expect(itemTurnIds.length).toBeGreaterThan(0);
		expect(itemTurnIds.every((id) => id.length > 0)).toBe(true);

		await adapter.dispose();
	});

	it("resumes an existing agent session via session/load", async () => {
		const agent = new FakeAcpAgent();
		const adapter = new AcpAdapter({
			command: "fake",
			createTransport: (_opts, handlers) => agent.transport(handlers),
			now: () => 1,
			mintId: () => "x",
		});
		const events: AdapterEvent[] = [];
		void collect(
			adapter.start({ cwd: "/work", resume: { harnessSessionId: "sess-1" } }),
			events,
		);
		await flush();

		expect(agent.sent.map((f) => f.method)).toContain("session/load");
		await adapter.dispose();
	});

	it("surfaces a permission request and forwards the selected option", async () => {
		const agent = new FakeAcpAgent();
		let counter = 0;
		const adapter = new AcpAdapter({
			command: "fake",
			createTransport: (_opts, handlers) => agent.transport(handlers),
			now: () => 1,
			mintId: () => `id-${++counter}`,
		});
		const events: AdapterEvent[] = [];
		void collect(adapter.start({ cwd: "/work" }), events);
		await flush();
		adapter.prompt([{ type: "text", text: "run" }]);
		await flush();

		agent.requestPermission("sess-1", "tc-1");
		await flush();

		const approval = events
			.filter((e) => e.kind === "item")
			.map((e) => (e.kind === "item" ? e.item : null))
			.find((i) => i?.kind === "approval_request");
		expect(approval?.id).toBe("approval:tc-1");

		adapter.respondToApproval("approval:tc-1", { type: "option", optionId: "allow" });
		await flush();

		const response = agent.lastPermissionResponse();
		expect(response?.result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });

		await adapter.dispose();
	});
});
