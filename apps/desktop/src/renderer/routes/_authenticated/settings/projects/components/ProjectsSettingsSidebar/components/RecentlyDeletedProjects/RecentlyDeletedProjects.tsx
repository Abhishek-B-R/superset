import { Plural, Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { useHostUrls } from "renderer/hooks/host-service/useHostTargetUrl";
import { useKnownHosts } from "renderer/hooks/known-hosts/useKnownHosts";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useProjectDeletionHosts } from "renderer/routes/_authenticated/hooks/useProjectDeletionHosts";
import { useRestoreProject } from "renderer/routes/_authenticated/hooks/useRestoreProject";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { mergeDeletedProjects } from "./RecentlyDeletedProjects.utils";

const DAY_MS = 24 * 60 * 60 * 1000;

export function RecentlyDeletedProjects() {
	const { machineId } = useLocalHostService();
	const { hosts } = useKnownHosts();
	const hostIds = [
		...new Set([
			...(machineId ? [machineId] : []),
			...hosts.filter((host) => host.isOnline).map((host) => host.machineId),
		]),
	];
	const reachable = useHostUrls(hostIds).filter(
		(host): host is { hostId: string; url: string; isLocal: boolean } =>
			host.url !== null,
	);
	const results = useQueries({
		queries: reachable.map((host) => ({
			queryKey: ["deleted-projects", host.hostId],
			queryFn: () =>
				getHostServiceClientByUrl(host.url).project.listDeleted.query(),
		})),
	});
	const deleted = mergeDeletedProjects(
		reachable.map((host, index) => ({
			hostId: host.hostId,
			url: host.url,
			rows: results[index]?.data ?? [],
		})),
	);
	const permissions = useProjectDeletionHosts(hostIds);
	const restoreProject = useRestoreProject();
	const [restoringId, setRestoringId] = useState<string | null>(null);

	if (deleted.length === 0) return null;
	return (
		<div className="border-t pt-3">
			<h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				<Trans>Recently deleted</Trans>
			</h2>
			<ul className="flex flex-col gap-1">
				{deleted.map((project) => {
					const restorableUrls = project.hosts
						.filter((host) => permissions.hostIds.includes(host.hostId))
						.map((host) => host.url);
					const daysLeft = Math.max(
						0,
						Math.ceil((project.purgeAt - Date.now()) / DAY_MS),
					);
					return (
						<li
							key={project.id}
							className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate">{project.name}</span>
								<span className="block text-xs text-muted-foreground">
									<Plural
										value={daysLeft}
										one="# day left"
										other="# days left"
									/>
								</span>
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={restorableUrls.length === 0 || restoringId !== null}
								onClick={async () => {
									setRestoringId(project.id);
									await restoreProject({
										projectId: project.id,
										projectName: project.name,
										hostUrls: restorableUrls,
									});
									setRestoringId(null);
								}}
							>
								<Trans>Restore</Trans>
							</Button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
