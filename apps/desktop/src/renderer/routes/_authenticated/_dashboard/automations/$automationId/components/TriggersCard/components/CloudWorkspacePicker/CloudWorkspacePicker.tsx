import { Trans, useLingui } from "@lingui/react/macro";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { cn } from "@superset/ui/utils";
import { useState } from "react";
import { HiCheck } from "react-icons/hi2";
import { LuCloud, LuPlus, LuTriangleAlert } from "react-icons/lu";
import { PickerTrigger } from "renderer/components/PickerTrigger";

interface CloudWorkspacePickerProps {
	/** Only the caller's own: a run wakes a box with its creator's credentials. */
	workspaces: { id: string; name: string }[] | undefined;
	value: string | null;
	onChange: (cloudWorkspaceId: string | null) => void;
	className?: string;
	disabled?: boolean;
}

export function CloudWorkspacePicker({
	workspaces,
	value,
	onChange,
	className,
	disabled,
}: CloudWorkspacePickerProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const selected = value
		? (workspaces?.find((row) => row.id === value) ?? null)
		: null;
	const resolving = !!value && workspaces === undefined;
	// The run replaces a gone pin with a new workspace and re-pins, so this
	// only lasts until the next run.
	const missing = !!value && !selected && !resolving;
	const label = selected
		? selected.name
		: resolving
			? t({
					message: "Loading…",
				})
			: missing
				? t({
						message: "Workspace not found",
					})
				: t({
						message: "New workspace",
					});

	return (
		<Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
			<PopoverTrigger asChild>
				<PickerTrigger
					disabled={disabled}
					className={cn(missing && "text-amber-500", className)}
					icon={
						missing ? (
							<LuTriangleAlert className="size-4 shrink-0" />
						) : selected || resolving ? (
							<LuCloud className="size-4 shrink-0" />
						) : (
							<LuPlus className="size-4 shrink-0" />
						)
					}
					label={label}
				/>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="top"
				sideOffset={8}
				className="w-60 p-0"
			>
				<Command>
					<CommandInput
						placeholder={t({
							message: "Search workspaces...",
						})}
					/>
					<CommandList>
						<CommandGroup>
							<CommandItem
								value="__new__"
								onSelect={() => {
									onChange(null);
									setOpen(false);
								}}
							>
								<LuPlus className="size-4" />
								<span>
									<Trans>New workspace</Trans>
								</span>
								{!value && <HiCheck className="ml-auto size-4" />}
							</CommandItem>
							{(workspaces ?? []).map((workspace) => (
								<CommandItem
									key={workspace.id}
									value={workspace.name}
									onSelect={() => {
										onChange(workspace.id);
										setOpen(false);
									}}
								>
									<LuCloud className="size-4" />
									<span className="truncate">{workspace.name}</span>
									{workspace.id === value && (
										<HiCheck className="ml-auto size-4" />
									)}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
