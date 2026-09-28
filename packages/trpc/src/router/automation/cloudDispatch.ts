import { db } from "@superset/db/client";
import { cloudWorkspaces, environments, members } from "@superset/db/schema";
import { CLOUD_AGENT_PROMPT_MAX_LENGTH } from "@superset/shared/cloud-agent-launch";
import { SUPERSET_USER_ID_HEADER } from "@superset/shared/host-routing";
import { and, eq } from "drizzle-orm";
import { assertCloudAccess } from "../../lib/cloud-guards";
import {
	environmentRepositoryRows,
	primaryRepository,
	SandboxUnavailableError,
	sandboxHostSecretFor,
} from "../../lib/sandbox";
import { startCloudWorkspace } from "../cloud-workspace/start";
import {
	markSandboxUnavailable,
	wakeCloudWorkspace,
} from "../cloud-workspace/wake";
import type { DispatchableAutomation } from "./dispatch";
import { hostServiceMutation } from "./relay-client";
import {
	type AgentRunResult,
	nonForkPullRequest,
	previousRunTerminal,
	RunFailure,
	type RunWorkspace,
	replacePin,
} from "./run";

/** Inside the dispatch functions' 60 s, so a slow box fails the run instead of stranding it. */
export const CLOUD_DISPATCH_DEADLINE_MS = 30_000;

const STRANDED_PROVISIONING_MS = 10 * 60_000;

type CloudWorkspaceRow = typeof cloudWorkspaces.$inferSelect;

/**
 * Runs the agent in the pinned cloud workspace, woken and reached directly (a sandbox is never on
 * the relay). With no pin, or a pin that is gone, a new workspace starts and becomes the pin.
 */
export function runInCloud(args: {
	automation: DispatchableAutomation;
	prompt: string;
	event: {
		provider: string;
		repositoryId: string | null;
		payload: unknown;
	} | null;
	placed: (workspace: RunWorkspace | null) => void;
}): Promise<AgentRunResult | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new RunFailure(
						`the cloud workspace should have started but did not answer within ${CLOUD_DISPATCH_DEADLINE_MS / 1000} seconds`,
						"cloud_not_ready",
					),
				),
			CLOUD_DISPATCH_DEADLINE_MS,
		);
	});
	return Promise.race([startRun(args), deadline]).finally(() =>
		clearTimeout(timer),
	);
}

async function startRun({
	automation,
	prompt,
	event,
	placed,
}: Parameters<typeof runInCloud>[0]): Promise<AgentRunResult | null> {
	await assertOwnerMayUseCloud(automation);

	if (automation.cloudWorkspaceId) {
		placed({ cloudWorkspaceId: automation.cloudWorkspaceId });
	}
	const pinned = automation.cloudWorkspaceId
		? await reachablePin(automation.cloudWorkspaceId)
		: null;
	if (pinned) {
		const continueTerminalId = automation.continueAgentSession
			? await previousRunTerminal(automation.id, {
					cloudWorkspaceId: pinned.row.id,
				})
			: undefined;
		const headers = {
			authorization: `Bearer ${await sandboxHostSecretFor(pinned.row.id)}`,
			[SUPERSET_USER_ID_HEADER]: automation.ownerUserId,
		};
		// Listing the agents adds the built-in ones. Without this, `agents.run` fails
		// on a box that never ran an agent.
		await fetch(`${pinned.hostTarget}/trpc/settings.agentConfigs.list`, {
			headers,
			signal: AbortSignal.timeout(10_000),
		});
		return hostServiceMutation<
			{
				workspaceId: string;
				agent: string;
				prompt: string;
				continueTerminalId?: string;
			},
			AgentRunResult
		>({ baseUrl: pinned.hostTarget, headers }, "agents.run", {
			workspaceId: pinned.row.id,
			agent: automation.agent,
			prompt,
			...(continueTerminalId ? { continueTerminalId } : {}),
		});
	}

	placed(null);
	if (!automation.environmentId) {
		throw new RunFailure(
			"the automation has no environment to start a cloud workspace from",
			"cloud_environment_unusable",
		);
	}
	if (prompt.length > CLOUD_AGENT_PROMPT_MAX_LENGTH) {
		throw new RunFailure(
			`the prompt is ${prompt.length} characters; a new cloud workspace takes at most ${CLOUD_AGENT_PROMPT_MAX_LENGTH}`,
			null,
		);
	}
	const created = await startCloudWorkspace({
		organizationId: automation.organizationId,
		userId: automation.ownerUserId,
		environmentId: automation.environmentId,
		name: automation.name.slice(0, 200),
		branch: event
			? await pullRequestBranch(event, automation.environmentId)
			: undefined,
		launch: { agent: automation.agent, prompt },
	});
	placed({ cloudWorkspaceId: created.id });
	if (automation.cloudWorkspaceId) {
		await replacePin(
			automation.id,
			{ cloudWorkspaceId: automation.cloudWorkspaceId },
			created.id,
		);
	}
	return null;
}

/** Both can change after the automation was saved. */
async function assertOwnerMayUseCloud(
	automation: DispatchableAutomation,
): Promise<void> {
	const [membership] = await db
		.select({ id: members.id })
		.from(members)
		.where(
			and(
				eq(members.userId, automation.ownerUserId),
				eq(members.organizationId, automation.organizationId),
			),
		)
		.limit(1);
	if (!membership) {
		throw new RunFailure(
			"the automation's owner is no longer a member of this organization",
			"cloud_access_denied",
		);
	}
	await assertCloudAccess({ userId: automation.ownerUserId, session: null });
}

/** The pinned cloud workspace, awake, or null when it is gone. */
async function reachablePin(
	cloudWorkspaceId: string,
): Promise<{ row: CloudWorkspaceRow; hostTarget: string } | null> {
	const row = await db.query.cloudWorkspaces.findFirst({
		where: eq(cloudWorkspaces.id, cloudWorkspaceId),
	});
	if (!row || row.status === "deleted" || row.status === "failed") {
		return null;
	}
	if (row.status === "provisioning") {
		if (Date.now() - row.createdAt.getTime() > STRANDED_PROVISIONING_MS) {
			return null;
		}
		throw new RunFailure(
			"the pinned cloud workspace is still provisioning",
			"cloud_not_ready",
		);
	}
	try {
		return { row, hostTarget: await wakeCloudWorkspace(row) };
	} catch (error) {
		if (!(error instanceof SandboxUnavailableError)) throw error;
		await markSandboxUnavailable(row, error);
		return null;
	}
}

/** The event's pull request branch, only when the event is about the environment's primary repository. */
async function pullRequestBranch(
	event: { provider: string; repositoryId: string | null; payload: unknown },
	environmentId: string,
): Promise<string | undefined> {
	const pullRequest = nonForkPullRequest(event);
	if (!pullRequest?.headRef || event.repositoryId === null) return undefined;
	const environment = await db.query.environments.findFirst({
		where: eq(environments.id, environmentId),
		columns: { hooksRepositoryId: true },
	});
	const primary = primaryRepository(
		await environmentRepositoryRows(environmentId),
		environment?.hooksRepositoryId,
	);
	return primary?.repoId === event.repositoryId
		? pullRequest.headRef
		: undefined;
}
