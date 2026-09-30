import { useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { MessageSquare } from "lucide-react";
import { useTerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";

const HARNESS_BY_AGENT: Record<string, string> = {
	claude: "claude-acp",
	codex: "codex-acp",
};

/**
 * Beside the agent name in a terminal header: opens the running Claude/Codex
 * session in the ACP chat pane. Renders nothing until the agent has reported a
 * session id (the value needed to resume it) — so it only appears for an agent
 * that can actually be handed off.
 */
export function AcpChatToggle({
	workspaceId,
	terminalId,
	onOpen,
}: {
	workspaceId: string;
	terminalId: string;
	onOpen: (harness: string, agentSessionId: string) => void;
}) {
	const { t } = useLingui();
	const binding = useTerminalAgentBinding(workspaceId, terminalId);
	const harness = binding?.agentId ? HARNESS_BY_AGENT[binding.agentId] : undefined;
	const agentSessionId = binding?.agentSessionId;

	if (!harness || !agentSessionId || binding?.endedAt) return null;

	const label = t({ message: "Open in ACP chat" });
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => onOpen(harness, agentSessionId)}
					aria-label={label}
					className={cn(
						"rounded p-1 text-muted-foreground/60 transition-colors",
						"hover:bg-secondary hover:text-foreground",
					)}
				>
					<MessageSquare className="size-3.5" />
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}
