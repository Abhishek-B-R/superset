import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";

const HARNESS_BY_AGENT: Record<string, string> = {
	claude: "claude-acp",
	codex: "codex-acp",
};

const NEW_HARNESSES = ["claude-acp", "codex-acp"] as const;

type Attachable = { harness: string; sessionId: string; agentId: string; terminalId: string };

function attachable(bindings: TerminalAgentBinding[]): Attachable[] {
	const seen = new Set<string>();
	const rows: Attachable[] = [];
	for (const binding of bindings) {
		const harness = HARNESS_BY_AGENT[binding.agentId];
		if (!harness || !binding.agentSessionId || binding.endedAt) continue;
		if (seen.has(binding.agentSessionId)) continue;
		seen.add(binding.agentSessionId);
		rows.push({
			harness,
			sessionId: binding.agentSessionId,
			agentId: binding.agentId,
			terminalId: binding.terminalId,
		});
	}
	return rows;
}

export function AcpStartView({
	bindings,
	onAttach,
	onNew,
}: {
	bindings: TerminalAgentBinding[];
	onAttach: (harness: string, resumeSessionId: string) => void;
	onNew: (harness: string) => void;
}) {
	const rows = attachable(bindings);

	return (
		<div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-6">
			<section className="flex flex-col gap-2">
				<h2 className="text-sm font-medium">
					<Trans>Attach to a running agent</Trans>
				</h2>
				{rows.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						<Trans>
							No running Claude or Codex sessions in this workspace. Start one in a
							terminal, or begin a new session below.
						</Trans>
					</p>
				) : (
					<ul className="flex flex-col gap-1">
						{rows.map((row) => (
							<li
								className="flex items-center justify-between rounded-md border border-border px-3 py-2"
								key={row.sessionId}
							>
								<span className="flex flex-col">
									<span className="text-sm font-medium">{row.agentId}</span>
									<span className="font-mono text-xs text-muted-foreground">
										{row.sessionId.slice(0, 8)}
									</span>
								</span>
								<Button
									onClick={() => onAttach(row.harness, row.sessionId)}
									size="sm"
									variant="secondary"
								>
									<Trans>Attach</Trans>
								</Button>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-2">
				<h2 className="text-sm font-medium">
					<Trans>New session</Trans>
				</h2>
				<div className="flex flex-wrap gap-2">
					{NEW_HARNESSES.map((harness) => (
						<Button
							key={harness}
							onClick={() => onNew(harness)}
							size="sm"
							variant="outline"
						>
							{harness}
						</Button>
					))}
				</div>
			</section>
		</div>
	);
}
