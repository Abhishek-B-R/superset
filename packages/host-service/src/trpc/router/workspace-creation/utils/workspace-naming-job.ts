import { deriveWorkspaceTitleFromPrompt } from "@superset/shared/workspace-launch";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { workspaces } from "../../../../db/schema";
import { getLocalProject } from "../../../../projects/local-project-store";
import type { HostServiceContext } from "../../../../types";
import {
	getLocalWorkspace,
	updateLocalWorkspace,
} from "../../../../workspaces/local-workspace-store";
import {
	commitWorkspaceTitleJob,
	hasWorkspaceTitleJob,
	queueWorkspaceTitleJob,
} from "../../../../workspaces/workspace-title-jobs";
import { gitStatusStore } from "../../git/utils/git-status-store";
import {
	type GeneratedWorkspaceNames,
	generateWorkspaceNamesFromPrompt,
	resolveGeneratedBranchName,
	trimTitle,
} from "./ai-workspace-names";
import { listBranchNames } from "./list-branch-names";
import { findGitHubReferences, resolveNamingLinks } from "./naming-links";
import { deduplicateBranchName } from "./sanitize-branch";

const MAX_NAMING_ATTEMPTS = 3;

export interface NamingDecision {
	/** Title to apply now; null keeps the current one. */
	title: string | null;
	/** Generated branch name to rename the automatic branch to; null keeps it. */
	branchName: string | null;
	/** Keep the row eligible for another attempt. */
	pending: boolean;
	/** Names never came and no attempt will follow. */
	gaveUp: boolean;
}

/** The naming policy, free of I/O so its cases read as a table. */
export function decideNaming(input: {
	names: GeneratedWorkspaceNames | null;
	/** null: the branch probe failed, so nothing is known about the branch. */
	canRenameBranch: boolean | null;
	/** 1-based number of the attempt being decided. */
	attempt: number;
	prompt: string;
	hasAgent: boolean;
	hasAgentReply: boolean;
}): NamingDecision {
	const { names, canRenameBranch, attempt, hasAgent, hasAgentReply } = input;
	const moreAttempts = hasAgent && attempt < MAX_NAMING_ATTEMPTS;
	if (!names?.title || canRenameBranch === null) {
		return {
			title:
				attempt === 1
					? trimTitle(deriveWorkspaceTitleFromPrompt(input.prompt)) || null
					: null,
			branchName: null,
			pending: moreAttempts,
			gaveUp: !moreAttempts,
		};
	}
	// A vague prompt gets its guessed title now and a refinement with the
	// agent's first reply on the next turn; the branch waits for that pass.
	const refine = names.vague === true && !hasAgentReply && moreAttempts;
	return {
		title: names.title,
		branchName:
			canRenameBranch && !refine && names.branchName ? names.branchName : null,
		pending: refine,
		gaveUp: false,
	};
}

function pendingRow(ctx: HostServiceContext, workspaceId: string) {
	const row = getLocalWorkspace(ctx.db, workspaceId);
	return row && row.archivedAt == null && row.autoNamingPrompt
		? { ...row, autoNamingPrompt: row.autoNamingPrompt }
		: null;
}

async function canRenameAutomaticBranch(
	ctx: HostServiceContext,
	worktreePath: string,
	branch: string,
): Promise<boolean> {
	const git = await ctx.git(worktreePath, { timeout: { block: 750 } });
	const [head, upstream, remoteBranches] = await Promise.all([
		git.raw(["branch", "--show-current"]),
		git.raw(["for-each-ref", "--format=%(upstream)", `refs/heads/${branch}`]),
		git.raw(["for-each-ref", "--format=%(refname)", "refs/remotes"]),
	]);
	return (
		head.trim() === branch &&
		!upstream.trim() &&
		!remoteBranches
			.split("\n")
			.some((ref) => ref.replace(/^refs\/remotes\/[^/]+\//, "") === branch)
	);
}

/**
 * Runs one naming attempt for a workspace whose name is still automatic
 * (`autoNamingPrompt` set). Creation queues the first attempt; hook events
 * and host boot queue the rest (`continueWorkspaceNaming`,
 * `resumeInterruptedWorkspaceNaming`). Every write re-checks the row, so a
 * user rename in the meantime always wins.
 */
export function scheduleWorkspaceNaming(
	ctx: HostServiceContext,
	workspaceId: string,
	{ agentReply }: { agentReply?: string } = {},
): void {
	queueWorkspaceTitleJob(ctx.db, workspaceId, async (isCurrent, signal) => {
		const row = pendingRow(ctx, workspaceId);
		if (!row) return;
		const prompt = row.autoNamingPrompt;
		const agent = row.autoNamingAgent ?? undefined;
		const project = row.projectId
			? getLocalProject(ctx.db, row.projectId)
			: undefined;
		const links = agent
			? await resolveNamingLinks(
					ctx,
					findGitHubReferences(
						prompt,
						project?.repoOwner && project.repoName
							? { owner: project.repoOwner, name: project.repoName }
							: null,
					),
				)
			: undefined;
		if (!isCurrent()) return;
		const names = await generateWorkspaceNamesFromPrompt(
			prompt,
			agent ? { db: ctx.db, agent } : undefined,
			project?.namingInstructions,
			signal,
			false,
			{ agentReply, links },
		);
		if (!isCurrent()) return;
		const current = pendingRow(ctx, workspaceId);
		if (!current) return;

		const oldBranch = current.autoNamingBranch;
		const branchStillAutomatic =
			!!project && !!oldBranch && current.branch === oldBranch;
		// A failed probe (git lock, hung index) says nothing about the branch,
		// so the attempt counts as failed and the next turn tries again.
		const canRenameBranch =
			branchStillAutomatic && names?.branchName
				? await canRenameAutomaticBranch(
						ctx,
						current.worktreePath,
						oldBranch,
					).catch((error) => {
						console.warn("[workspace-title] branch probe failed", error);
						return null;
					})
				: false;
		if (!isCurrent() || !pendingRow(ctx, workspaceId)) return;

		const attempt = current.autoNamingAttempts + 1;
		const decision = decideNaming({
			names,
			canRenameBranch,
			attempt,
			prompt,
			hasAgent: !!agent,
			hasAgentReply: !!agentReply,
		});
		const state = decision.pending
			? { prompt, attempts: attempt, branch: oldBranch, agent: agent ?? null }
			: { prompt: null, attempts: attempt, branch: null, agent: null };
		if (decision.gaveUp && agent) {
			ctx.eventBus.broadcastWorkspaceNamingFailed({
				workspaceId,
				name: decision.title ?? current.name,
				occurredAt: Date.now(),
			});
		}
		if (decision.branchName && decision.title && project && oldBranch) {
			try {
				await renameAutomaticBranch(ctx, {
					workspaceId,
					worktreePath: current.worktreePath,
					repoPath: project.repoPath,
					oldBranch,
					branchName: decision.branchName,
					title: decision.title,
					state,
					isCurrent,
				});
				return;
			} catch (error) {
				console.warn("[workspace-title] branch rename failed", error);
			}
		}
		if (!isCurrent() || !pendingRow(ctx, workspaceId)) return;
		updateLocalWorkspace(ctx, workspaceId, {
			...(decision.title ? { name: decision.title } : {}),
			autoNaming: state,
		});
	});
}

async function renameAutomaticBranch(
	ctx: HostServiceContext,
	input: {
		workspaceId: string;
		worktreePath: string;
		repoPath: string;
		oldBranch: string;
		branchName: string;
		title: string;
		state: {
			prompt: string | null;
			attempts: number;
			branch: string | null;
			agent: string | null;
		};
		isCurrent: () => boolean;
	},
): Promise<void> {
	const { workspaceId, oldBranch, isCurrent } = input;
	const slash = oldBranch.lastIndexOf("/");
	const { prefixedCandidate } = resolveGeneratedBranchName({
		candidate: `${input.branchName}-${workspaceId.slice(0, 8)}`,
		branchPrefix: slash > 0 ? oldBranch.slice(0, slash) : undefined,
		oldBranchName: oldBranch,
	});
	const branches = await listBranchNames(ctx, input.repoPath);
	if (!isCurrent()) return;
	const target = deduplicateBranchName(
		prefixedCandidate,
		branches.filter((branch) => branch !== oldBranch),
	);
	await commitWorkspaceTitleJob(ctx.db, workspaceId, async () => {
		if (!isCurrent() || !pendingRow(ctx, workspaceId)) return;
		const git = await ctx.git(input.worktreePath, { timeout: { block: 750 } });
		await git.raw(["branch", "-m", oldBranch, target]);
		gitStatusStore.recordChange(workspaceId, undefined);
		updateLocalWorkspace(ctx, workspaceId, {
			name: input.title,
			branch: target,
			autoNaming: input.state,
		});
	});
}

/**
 * Hook-driven follow-ups to the attempt creation queued: a Start covers a
 * host that restarted before that attempt ran, and each Stop retries a
 * failed or vague attempt with the agent's reply. A Stop during a running
 * attempt queues behind it, so a quick first turn's reply still counts.
 */
export function continueWorkspaceNaming(
	ctx: HostServiceContext,
	workspaceId: string,
	event: { eventType: string; agentReply?: string },
): void {
	const row = getLocalWorkspace(ctx.db, workspaceId);
	if (!row?.autoNamingPrompt || row.archivedAt != null) return;
	if (event.eventType === "Start") {
		if (row.autoNamingAttempts > 0 || hasWorkspaceTitleJob(ctx.db, workspaceId))
			return;
	} else if (event.eventType !== "Stop") return;
	scheduleWorkspaceNaming(ctx, workspaceId, { agentReply: event.agentReply });
}

/**
 * Host boot: a previous process may have died in the middle of a
 * workspace's creation-time attempt, and nothing retries an attempt that
 * never counted until an agent event arrives — which a workspace whose
 * agent never launched will never get.
 */
export function resumeInterruptedWorkspaceNaming(
	ctx: HostServiceContext,
): void {
	const rows = ctx.db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(
			and(
				isNull(workspaces.archivedAt),
				isNotNull(workspaces.autoNamingPrompt),
				eq(workspaces.autoNamingAttempts, 0),
			),
		)
		.all();
	for (const row of rows) scheduleWorkspaceNaming(ctx, row.id);
}
