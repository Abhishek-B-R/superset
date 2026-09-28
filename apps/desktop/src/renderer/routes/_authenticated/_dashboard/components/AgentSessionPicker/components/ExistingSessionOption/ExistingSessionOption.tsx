import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";

export function ExistingSessionOption({
	binding,
	compact = false,
}: {
	binding: TerminalAgentBinding;
	compact?: boolean;
}) {
	const iconSrc = usePresetIcon(binding.agentId);
	return (
		<span className="inline-flex min-w-0 items-center gap-2">
			{iconSrc ? (
				<img
					src={iconSrc}
					alt=""
					className="size-3.5 shrink-0"
					draggable={false}
				/>
			) : null}
			<span className="truncate">{binding.agentId}</span>
			{!compact && (
				<span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
					· {binding.terminalId.slice(0, 6)}
				</span>
			)}
		</span>
	);
}
