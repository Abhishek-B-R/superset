import { useCallback, useEffect, useRef } from "react";
import { useTerminalAgentBindings } from "renderer/hooks/host-service/useTerminalAgentBindings";
import type { AcpChatPaneData } from "../../../../types";
import { SessionView } from "../ChatV3Pane/components/SessionView";
import { useSessionClient } from "../ChatV3Pane/hooks/useSessionClient";
import { AcpStartView } from "./components/AcpStartView";

/**
 * Chat pane backed by an ACP agent. A new session spawns a fresh
 * claude-acp/codex-acp adapter; attaching resumes the agent's own session
 * (the one running in a terminal) by its captured session id.
 */
export function AcpChatPane({
	attach,
	onDataChange,
	sessionId,
	workspaceId,
}: {
	workspaceId: string;
	sessionId: string | null;
	attach?: AcpChatPaneData["attach"];
	onDataChange: (data: AcpChatPaneData) => void;
}) {
	const { client, wiring } = useSessionClient(sessionId);
	const bindings = useTerminalAgentBindings(workspaceId);

	const start = useCallback(
		async (harness: string, resumeSessionId?: string) => {
			const created = await wiring.transport.createSession({
				commandId: crypto.randomUUID(),
				workspaceId,
				harness,
				...(resumeSessionId
					? { resume: { harnessSessionId: resumeSessionId } }
					: {}),
			});
			// Clear the attach hint so a remount does not re-create the session.
			onDataChange({ sessionId: created.sessionId });
		},
		[wiring.transport, workspaceId, onDataChange],
	);

	// Hand-off from the terminal header: resume the running agent once.
	const attachedRef = useRef(false);
	useEffect(() => {
		if (sessionId || !attach || attachedRef.current) return;
		attachedRef.current = true;
		void start(attach.harness, attach.agentSessionId);
	}, [sessionId, attach, start]);

	if (!client || !sessionId) {
		if (attach) return null; // resuming; SessionView mounts once the id lands
		return (
			<AcpStartView
				bindings={[...bindings.values()]}
				onAttach={(harness, resumeSessionId) => void start(harness, resumeSessionId)}
				onNew={(harness) => void start(harness)}
			/>
		);
	}

	return (
		<SessionView
			client={client}
			key={sessionId}
			onFirstPromptSent={NOOP}
			pendingFirstPrompt={null}
			sessionId={sessionId}
		/>
	);
}

function NOOP() {}
