import { randomUUID } from "node:crypto";
import type {
	ApprovalRequest,
	Decision,
	Item,
	Plan,
	SessionState,
	ToolCall,
	ToolContent,
	ToolKind,
	Turn,
	UserContent,
} from "@superset/chat/protocol";
import { EventQueue } from "../eventQueue";
import type { AdapterEvent, HarnessAdapter, HarnessStartOptions } from "../types";
import type {
	AcpNotification,
	AcpServerRequest,
	AcpTransport,
	AcpTransportHandlers,
	SpawnAcpOptions,
} from "./rpcClient";
import { AcpRpcClient, spawnAcpTransport } from "./rpcClient";
import {
	acpContentBlockSchema,
	acpNewSessionResponseSchema,
	acpPlanSchema,
	acpPromptResponseSchema,
	acpRequestPermissionParamsSchema,
	acpSessionNotificationSchema,
	acpSessionUpdateSchema,
	acpToolCallUpdateSchema,
	type AcpContentBlock,
	type AcpToolCallContent,
} from "./wire";

const PROTOCOL_VERSION = 1;

const TOOL_KIND_BY_ACP: Record<string, ToolKind> = {
	read: "read",
	edit: "edit",
	delete: "delete",
	move: "move",
	search: "search",
	execute: "execute",
	think: "think",
	fetch: "fetch",
	switch_mode: "other",
	other: "other",
};

function toolKind(kind: string | undefined): ToolKind {
	return (kind && TOOL_KIND_BY_ACP[kind]) || "other";
}

function toolStatus(status: string | undefined): ToolCall["status"] {
	switch (status) {
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		default:
			return "running";
	}
}

function planEntryStatus(status: string): Plan["entries"][number]["status"] {
	if (status === "in_progress" || status === "completed") return status;
	return "pending";
}

export type AcpAdapterOptions = SpawnAcpOptions & {
	now?: () => number;
	mintId?: () => string;
	createTransport?(
		options: SpawnAcpOptions,
		handlers: AcpTransportHandlers,
	): AcpTransport;
};

type OpenText = {
	itemId: string;
	kind: "agent_message" | "reasoning";
	text: string;
	turnId: string;
};

type PendingApproval = { requestId: number | string; turnId: string; item: ApprovalRequest };

/**
 * Bridges an Agent Client Protocol subprocess (Claude Code / Codex ACP
 * adapters) into the chat runtime. A chat turn maps to one `session/prompt`
 * round trip; ACP `session/update` notifications stream into chat items and
 * deltas; `session/request_permission` becomes an approval item.
 */
export class AcpAdapter implements HarnessAdapter {
	private readonly queue = new EventQueue();
	private readonly toolCalls = new Map<string, ToolCall>();
	private readonly pendingApprovals = new Map<string, PendingApproval>();
	private client: AcpRpcClient | null = null;
	private sessionId: string | null = null;
	private cwd = process.cwd();
	private openText: OpenText | null = null;
	private currentTurn: Turn | null = null;
	private historyTurnId: string | null = null;
	private queuedPrompts: UserContent[][] = [];
	private disposed = false;

	constructor(private readonly options: AcpAdapterOptions) {}

	start(startOptions: HarnessStartOptions): AsyncIterable<AdapterEvent> {
		this.cwd = startOptions.cwd;
		void this.bootstrap(startOptions);
		return this.queue.iterable();
	}

	prompt(content: UserContent[]): void {
		if (!this.client || !this.sessionId) {
			this.queuedPrompts.push(content);
			return;
		}
		void this.runTurn(content);
	}

	cancelTurn(): void {
		if (!this.client || !this.sessionId) return;
		if (this.currentTurn?.status !== "running") return;
		this.client.notify("session/cancel", { sessionId: this.sessionId });
	}

	respondToApproval(approvalId: string, decision: Decision): void {
		const pending = this.pendingApprovals.get(approvalId);
		if (!pending || !this.client) return;
		this.pendingApprovals.delete(approvalId);
		this.client.respond(pending.requestId, this.approvalOutcome(pending, decision));
		this.emitItem(
			{ ...pending.item, status: "answered", decision, completedAtMs: this.now() },
			pending.turnId,
		);
		this.emitSession({ status: "running" });
	}

	setMode(modeId: string): void {
		this.emitSession({ modeId });
		if (this.client && this.sessionId) {
			void this.client
				.request("session/set_mode", { sessionId: this.sessionId, modeId })
				.catch((error: Error) => this.emitNotice("error", error.message));
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.stalePendingApprovals();
		await this.client?.close();
		this.queue.close();
	}

	private async bootstrap(startOptions: HarnessStartOptions): Promise<void> {
		this.emitSession({ status: "starting" });
		try {
			const client = new AcpRpcClient({
				createTransport: (handlers) =>
					(this.options.createTransport ?? spawnAcpTransport)(
						{
							command: this.options.command,
							args: this.options.args,
							cwd: startOptions.cwd,
							env: this.options.env,
						},
						handlers,
					),
				onNotification: (notification) => this.handleNotification(notification),
				onServerRequest: (request) => this.handleServerRequest(request),
				onStderr: () => undefined,
				onDispatchError: (error, method) =>
					this.emitNotice(
						"error",
						`acp ${method} could not be read: ${error instanceof Error ? error.message : String(error)}`,
					),
				onExit: (code) => this.handleExit(code),
			});
			this.client = client;

			await client.request("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				// Do not advertise fs/terminal: the agent falls back to its own
				// Read/Edit/Bash tools, which run headless in the workspace.
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
					terminal: false,
				},
			});

			const response = startOptions.resume
				? await client.request("session/load", {
						sessionId: startOptions.resume.harnessSessionId,
						cwd: startOptions.cwd,
						mcpServers: [],
					})
				: await client.request("session/new", {
						cwd: startOptions.cwd,
						mcpServers: [],
					});

			// session/load returns null after replaying history via session/update.
			const parsed = acpNewSessionResponseSchema.safeParse(response);
			this.sessionId = parsed.success
				? parsed.data.sessionId
				: (startOptions.resume?.harnessSessionId ?? null);

			if (!this.sessionId) {
				this.emitNotice("error", "acp agent returned no session id");
				this.emitSession({ status: "dead" });
				this.queue.close();
				return;
			}

			this.emitSession({
				status: "idle",
				...(parsed.success && parsed.data.modes?.currentModeId
					? { modeId: parsed.data.modes.currentModeId }
					: {}),
				...(parsed.success && parsed.data.modes?.availableModes
					? {
							availableModes: parsed.data.modes.availableModes.map((mode) => ({
								id: mode.id,
								label: mode.name,
							})),
						}
					: {}),
			});

			const queued = this.queuedPrompts.splice(0, this.queuedPrompts.length);
			for (const content of queued) await this.runTurn(content);
		} catch (error) {
			this.emitNotice("error", this.authAwareMessage(error));
			this.emitSession({ status: "dead" });
			this.queue.close();
		}
	}

	private async runTurn(content: UserContent[]): Promise<void> {
		const client = this.client;
		if (!client || !this.sessionId) return;
		const turnId = this.mintId();
		this.emitTurn({ id: turnId, status: "running", startedAtMs: this.now() });
		this.emitSession({ status: "running" });
		try {
			const response = await client.request("session/prompt", {
				sessionId: this.sessionId,
				prompt: this.toAcpPrompt(content),
			});
			this.flushOpenText();
			const stopReason = acpPromptResponseSchema.safeParse(response).data?.stopReason;
			this.emitTurn({
				id: turnId,
				status: stopReason === "cancelled" ? "interrupted" : "completed",
				startedAtMs: this.currentTurn?.startedAtMs ?? this.now(),
				completedAtMs: this.now(),
			});
			if (stopReason === "refusal") this.emitNotice("info", "The agent declined to continue.");
			this.emitSession({ status: "idle" });
		} catch (error) {
			this.flushOpenText();
			this.emitTurn({
				id: turnId,
				status: "failed",
				error: { message: (error as Error).message },
				startedAtMs: this.currentTurn?.startedAtMs ?? this.now(),
				completedAtMs: this.now(),
			});
			this.emitNotice("error", (error as Error).message);
			this.emitSession({ status: "idle" });
		}
	}

	private handleNotification({ method, params }: AcpNotification): void {
		if (method !== "session/update") return;
		const outer = acpSessionNotificationSchema.safeParse(params);
		if (!outer.success) return;
		const update = acpSessionUpdateSchema.safeParse(outer.data.update);
		if (!update.success) return;
		const raw = outer.data.update as { content?: unknown };
		const turnId = this.resolveTurnId();

		switch (update.data.sessionUpdate) {
			case "agent_message_chunk":
				this.appendText("agent_message", this.contentBlock(raw.content), turnId);
				return;
			case "agent_thought_chunk":
				this.appendText("reasoning", this.contentBlock(raw.content), turnId);
				return;
			case "user_message_chunk":
				// Echo of the prompt we already recorded optimistically; ignore.
				return;
			case "tool_call":
			case "tool_call_update":
				this.handleToolCall(outer.data.update, turnId);
				return;
			case "plan":
				this.handlePlan(outer.data.update, turnId);
				return;
			case "current_mode_update":
				if (update.data.currentModeId) this.emitSession({ modeId: update.data.currentModeId });
				return;
			default:
				return;
		}
	}

	private contentBlock(raw: unknown): AcpContentBlock | undefined {
		const parsed = acpContentBlockSchema.safeParse(raw);
		return parsed.success ? parsed.data : undefined;
	}

	private appendText(
		kind: OpenText["kind"],
		content: AcpContentBlock | undefined,
		turnId: string,
	): void {
		const chunk = content?.type === "text" ? (content.text ?? "") : "";
		if (!chunk) return;
		if (!this.openText || this.openText.kind !== kind || this.openText.turnId !== turnId) {
			this.flushOpenText();
			const itemId = `${kind}:${turnId}:${this.mintId()}`;
			this.openText = { itemId, kind, text: "", turnId };
			this.emitItem(this.textItem(this.openText), turnId);
		}
		this.openText.text += chunk;
		this.emit({ kind: "delta", delta: { type: "text", itemId: this.openText.itemId, append: chunk } });
	}

	private flushOpenText(): void {
		if (!this.openText) return;
		const open = this.openText;
		this.openText = null;
		this.emitItem(this.textItem(open), open.turnId);
	}

	private textItem(open: OpenText): Item {
		const base = { id: open.itemId, startedAtMs: this.now(), completedAtMs: this.now() };
		return open.kind === "agent_message"
			? { ...base, kind: "agent_message", text: open.text }
			: { ...base, kind: "reasoning", text: open.text };
	}

	private handleToolCall(raw: unknown, turnId: string): void {
		const parsed = acpToolCallUpdateSchema.safeParse(raw);
		if (!parsed.success) return;
		this.flushOpenText();
		const update = parsed.data;
		const prior = this.toolCalls.get(update.toolCallId);
		const item: ToolCall = {
			id: update.toolCallId,
			kind: "tool_call",
			title: update.title ?? prior?.title ?? "Tool call",
			toolKind: update.kind ? toolKind(update.kind) : (prior?.toolKind ?? "other"),
			toolName: update.kind ?? prior?.toolName ?? "tool",
			status: update.status ? toolStatus(update.status) : (prior?.status ?? "running"),
			content: update.content
				? this.toToolContent(update.content)
				: (prior?.content ?? []),
			...(update.locations ? { locations: update.locations } : prior?.locations ? { locations: prior.locations } : {}),
			startedAtMs: prior?.startedAtMs ?? this.now(),
			...(update.status === "completed" || update.status === "failed"
				? { completedAtMs: this.now() }
				: {}),
			...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
			...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
		};
		this.toolCalls.set(update.toolCallId, item);
		this.emitItem(item, turnId);
	}

	private toToolContent(content: AcpToolCallContent[]): ToolContent[] {
		const mapped: ToolContent[] = [];
		for (const entry of content) {
			if (entry.type === "content" && entry.content?.type === "text") {
				mapped.push({ type: "text", text: entry.content.text ?? "" });
			} else if (entry.type === "diff" && entry.path && entry.newText !== undefined) {
				mapped.push({
					type: "diff",
					path: entry.path,
					oldText: entry.oldText ?? null,
					newText: entry.newText,
				});
			} else if (entry.type === "terminal" && entry.terminalId) {
				mapped.push({ type: "text", text: `[terminal ${entry.terminalId}]` });
			}
		}
		return mapped;
	}

	private handlePlan(raw: unknown, turnId: string): void {
		const parsed = acpPlanSchema.safeParse(raw);
		if (!parsed.success) return;
		this.flushOpenText();
		this.emitItem(
			{
				id: `plan:${turnId}`,
				kind: "plan",
				startedAtMs: this.now(),
				entries: parsed.data.entries.map((entry) => ({
					text: entry.content,
					status: planEntryStatus(entry.status),
				})),
			},
			turnId,
		);
	}

	private handleServerRequest(request: AcpServerRequest): void {
		if (request.method !== "session/request_permission") {
			this.client?.respondWithError(request.id, -32601, `unsupported: ${request.method}`);
			return;
		}
		const parsed = acpRequestPermissionParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			this.client?.respondWithError(request.id, -32602, "invalid permission request");
			return;
		}
		const turnId = this.resolveTurnId();
		const targetItemId = parsed.data.toolCall?.toolCallId ?? null;
		const approvalId = `approval:${targetItemId ?? this.mintId()}`;
		const item: ApprovalRequest = {
			id: approvalId,
			kind: "approval_request",
			targetItemId,
			title: parsed.data.toolCall?.title ?? "Permission required",
			status: "pending",
			startedAtMs: this.now(),
			options: parsed.data.options.map((option) => ({
				optionId: option.optionId,
				label: option.name,
			})),
		};
		this.pendingApprovals.set(approvalId, { requestId: request.id, turnId, item });
		this.emitItem(item, turnId);
		this.emitSession({ status: "awaiting_input" });
	}

	private approvalOutcome(pending: PendingApproval, decision: Decision): unknown {
		if (decision.type === "cancel") return { outcome: { outcome: "cancelled" } };
		if (decision.type === "option") {
			return { outcome: { outcome: "selected", optionId: decision.optionId } };
		}
		// accept / accept_for_session / decline: pick the option whose id best
		// matches the intent, else the first option.
		const reject = decision.type === "decline";
		const options = pending.item.options ?? [];
		const match = options.find((option) =>
			reject
				? /reject|deny|no/i.test(option.optionId) || /reject|deny|no/i.test(option.label)
				: /allow|accept|yes|approve/i.test(option.optionId) ||
					/allow|accept|yes|approve/i.test(option.label),
		);
		const optionId = match?.optionId ?? options[0]?.optionId;
		return optionId
			? { outcome: { outcome: "selected", optionId } }
			: { outcome: { outcome: "cancelled" } };
	}

	private toAcpPrompt(content: UserContent[]): unknown[] {
		const blocks: unknown[] = [];
		let skippedAttachment = false;
		for (const entry of content) {
			if (entry.type === "text") blocks.push({ type: "text", text: entry.text });
			else skippedAttachment = true;
		}
		if (skippedAttachment) {
			this.emitNotice("info", "Attachments are not supported by the ACP harness and were omitted");
		}
		return blocks;
	}

	private handleExit(code: number | null): void {
		if (this.disposed) return;
		this.stalePendingApprovals();
		this.emitNotice("error", `acp agent exited (code ${code ?? "null"})`);
		this.emitSession({ status: "dead" });
		this.queue.close();
	}

	private stalePendingApprovals(): void {
		for (const [approvalId, pending] of [...this.pendingApprovals]) {
			this.pendingApprovals.delete(approvalId);
			this.emitItem(
				{ ...pending.item, status: "stale", completedAtMs: this.now() },
				pending.turnId,
			);
		}
	}

	private authAwareMessage(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (/auth/i.test(message)) {
			return `${message}. Run the agent's login in a terminal (e.g. \`claude /login\`), then reopen this chat.`;
		}
		return message;
	}

	/**
	 * A non-empty turn id for every emitted item — the chat protocol rejects an
	 * empty one. Items that arrive outside a prompt turn (history replayed by
	 * `session/load`, or a notice during bootstrap) are grouped under a single
	 * synthetic "history" turn so they still have a home.
	 */
	private resolveTurnId(): string {
		if (this.currentTurn) return this.currentTurn.id;
		if (!this.historyTurnId) {
			this.historyTurnId = this.mintId();
			this.emitTurn({
				id: this.historyTurnId,
				status: "completed",
				startedAtMs: this.now(),
				completedAtMs: this.now(),
			});
		}
		return this.historyTurnId;
	}

	private emitTurn(turn: Turn): void {
		this.currentTurn = turn;
		this.emit({ kind: "turn", turn });
	}

	private emitItem(item: Item, turnId: string): void {
		this.emit({ kind: "item", item, turnId });
	}

	private emitNotice(
		noticeKind: "info" | "error" | "compaction" | "config_change",
		text?: string,
	): void {
		this.emitItem(
			{
				id: this.mintId(),
				kind: "notice",
				noticeKind,
				startedAtMs: this.now(),
				completedAtMs: this.now(),
				...(text ? { text } : {}),
			},
			this.resolveTurnId(),
		);
	}

	private emitSession(session: Partial<SessionState>): void {
		this.emit({ kind: "session", session });
	}

	private emit(event: AdapterEvent): void {
		this.queue.push(event);
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private mintId(): string {
		return (this.options.mintId ?? randomUUID)();
	}
}

export function createAcpAdapter(options: AcpAdapterOptions): HarnessAdapter {
	return new AcpAdapter(options);
}
