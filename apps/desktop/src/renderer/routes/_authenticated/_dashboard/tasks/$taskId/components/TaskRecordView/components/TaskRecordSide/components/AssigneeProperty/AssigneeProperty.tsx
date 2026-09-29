import { Trans, useLingui } from "@lingui/react/macro";
import { Avatar } from "@superset/ui/atoms/Avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { useMemo, useState } from "react";
import { HiOutlineUserCircle } from "react-icons/hi2";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { useOptimisticActions } from "renderer/routes/_authenticated/hooks/useOptimisticActions";
import type { TaskWithStatus } from "../../../../../../../components/TasksView/hooks/useTasksTable";

interface AssigneePropertyProps {
	task: TaskWithStatus;
}

export function AssigneeProperty({ task }: AssigneePropertyProps) {
	const { t } = useLingui();
	const { tasks: taskActions } = useOptimisticActions();
	const [open, setOpen] = useState(false);

	const { data: members } = cloudTrpc.organization.listMembers.useQuery(
		undefined,
		{ enabled: open },
	);

	const users = useMemo(
		() => (members ?? []).map((member) => member.user),
		[members],
	);

	const handleSelectUser = (userId: string | null) => {
		if (userId === task.assigneeId && !task.assigneeExternalId) {
			setOpen(false);
			return;
		}

		const transaction = taskActions.updateAssignee(task.id, userId);
		if (transaction) {
			setOpen(false);
		}
	};

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="-mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left whitespace-nowrap hover:bg-fill-hover focus-visible:bg-fill-hover focus-visible:outline-none"
				>
					{task.assignee ? (
						<>
							{task.assignee.image ? (
								<img
									src={task.assignee.image}
									alt=""
									className="size-[18px] rounded-full"
								/>
							) : (
								<div className="flex size-[18px] items-center justify-center rounded-full bg-muted text-[10px]">
									{task.assignee.name?.charAt(0).toUpperCase() ?? "?"}
								</div>
							)}
							<span>{task.assignee.name}</span>
						</>
					) : task.assigneeExternalId ? (
						<>
							{task.assigneeAvatarUrl ? (
								<img
									src={task.assigneeAvatarUrl}
									alt=""
									className="size-[18px] rounded-full"
								/>
							) : (
								<div className="flex size-[18px] items-center justify-center rounded-full bg-muted text-[10px]">
									{task.assigneeDisplayName?.charAt(0).toUpperCase() ?? "?"}
								</div>
							)}
							<span>
								{task.assigneeDisplayName ||
									t({
										message: "External",
									})}{" "}
								<span className="text-muted-foreground">
									<Trans>(external)</Trans>
								</span>
							</span>
						</>
					) : (
						<>
							<HiOutlineUserCircle className="size-[18px] text-muted-foreground" />
							<span className="text-muted-foreground">
								<Trans>Unassigned</Trans>
							</span>
						</>
					)}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<div className="max-h-64 overflow-y-auto">
					<DropdownMenuItem
						onSelect={() => handleSelectUser(null)}
						className="flex items-center gap-2"
					>
						<HiOutlineUserCircle className="w-5 h-5 text-muted-foreground shrink-0" />
						<span>
							<Trans>No assignee</Trans>
						</span>
						{!task.assigneeId && !task.assigneeExternalId && (
							<span className="ml-auto text-xs text-muted-foreground">✓</span>
						)}
					</DropdownMenuItem>
					{users.map((user) => (
						<DropdownMenuItem
							key={user.id}
							onSelect={() => handleSelectUser(user.id)}
							className="flex items-center gap-2"
						>
							<Avatar size="xs" fullName={user.name} image={user.image} />
							<div className="flex flex-col">
								<span>{user.name}</span>
								<span className="text-xs text-muted-foreground">
									{user.email}
								</span>
							</div>
							{user.id === task.assigneeId && (
								<span className="ml-auto text-xs text-muted-foreground">✓</span>
							)}
						</DropdownMenuItem>
					))}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
