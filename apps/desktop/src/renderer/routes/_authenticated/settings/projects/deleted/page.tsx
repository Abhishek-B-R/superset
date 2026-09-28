import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useProjectDeletionHosts } from "renderer/routes/_authenticated/hooks/useProjectDeletionHosts";
import { useRestoreProject } from "renderer/routes/_authenticated/hooks/useRestoreProject";
import { useDeletedProjects } from "../hooks/useDeletedProjects";
import { DeletedProjectRow } from "./components/DeletedProjectRow";

export const Route = createFileRoute(
	"/_authenticated/settings/projects/deleted/",
)({ component: DeletedProjectsPage });

function DeletedProjectsPage() {
	const { deleted, hostIds, hostName, isLoading } = useDeletedProjects();
	const permissions = useProjectDeletionHosts(hostIds);
	const restoreProject = useRestoreProject();
	const [restoringId, setRestoringId] = useState<string | null>(null);
	const memberName = (userId: string | null) =>
		permissions.organizationMembers.find((member) => member.userId === userId)
			?.user.name ?? null;

	return (
		<div className="mx-auto w-full max-w-4xl select-text p-6">
			<header className="mb-6">
				<h2 className="text-xl font-semibold">
					<Trans>Recently deleted</Trans>
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					<Trans>
						Deleted projects can be restored for 30 days, with the workspaces
						that were deleted with them. After that they are removed; the
						repository folder and worktrees with uncommitted changes stay on
						disk.
					</Trans>
				</p>
			</header>
			{deleted.length === 0 ? (
				isLoading ? null : (
					<p className="text-sm text-muted-foreground">
						<Trans>No projects were deleted in the last 30 days.</Trans>
					</p>
				)
			) : (
				<ul className="divide-y border-y">
					{deleted.map((project) => {
						const restorableUrls = project.hosts
							.filter((host) => permissions.hostIds.includes(host.hostId))
							.map((host) => host.url);
						return (
							<DeletedProjectRow
								key={project.id}
								project={project}
								deviceNames={project.hosts
									.map((host) => hostName(host.hostId) ?? host.hostId)
									.join(", ")}
								deletedBy={memberName(project.deletedByUserId)}
								canRestore={restorableUrls.length > 0}
								isRestoring={restoringId === project.id}
								onRestore={async () => {
									setRestoringId(project.id);
									await restoreProject({
										projectId: project.id,
										projectName: project.name,
										hostUrls: restorableUrls,
									});
									setRestoringId(null);
								}}
							/>
						);
					})}
				</ul>
			)}
		</div>
	);
}
