import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { HarnessFactory } from "@superset/chat-runtime";
import { createAcpAdapter } from "@superset/chat-runtime";

/**
 * ACP adapter npm packages, keyed by the harness id the chat runtime uses.
 * These are the same packages Zed's external-agent registry serves.
 */
const ACP_PACKAGES: Record<string, string> = {
	"claude-acp": "@agentclientprotocol/claude-agent-acp",
	"codex-acp": "@agentclientprotocol/codex-acp",
};

function resolveAdapterEntry(packageName: string): string {
	const moduleRequire = createRequire(import.meta.url);
	const pkgJson = moduleRequire.resolve(`${packageName}/package.json`);
	return join(dirname(pkgJson), "dist/index.js");
}

function acpEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		// Packaged builds ship no `node` on PATH; Electron runs the script when
		// this is set, and plain-node hosts ignore it.
		ELECTRON_RUN_AS_NODE: "1",
	};
	// Ambient keys must never override the user's own agent login — the whole
	// point is to reuse the CLI's stored credentials, not bill an API key.
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	return env;
}

/**
 * A HarnessFactory that spawns an ACP adapter subprocess and bridges it into
 * the chat runtime. Returns null when the adapter package is not installed, so
 * the registry simply omits that harness rather than crashing the host.
 */
export function acpHarnessFactory(harness: string): HarnessFactory | null {
	const packageName = ACP_PACKAGES[harness];
	if (!packageName) return null;

	let entry: string;
	try {
		entry = resolveAdapterEntry(packageName);
	} catch {
		return null;
	}

	return (options) =>
		createAcpAdapter({
			command: process.execPath,
			args: [entry],
			cwd: options.cwd,
			env: acpEnv(),
		});
}

export function acpHarnessEntries(): [string, HarnessFactory][] {
	const entries: [string, HarnessFactory][] = [];
	for (const harness of Object.keys(ACP_PACKAGES)) {
		const factory = acpHarnessFactory(harness);
		if (factory) entries.push([harness, factory]);
	}
	return entries;
}
