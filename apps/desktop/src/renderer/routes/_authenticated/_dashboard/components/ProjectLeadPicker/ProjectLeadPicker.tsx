import { Trans } from "@lingui/react/macro";
import { AvatarStack } from "@superset/ui/atoms/AvatarStack";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import type { ReactNode } from "react";
import { LuCheck, LuCircleUser } from "react-icons/lu";

interface Person {
	id: string;
	name: string;
	image: string | null;
}

interface ProjectLeadPickerProps {
	people: Person[];
	value: string | null;
	onChange: (userId: string | null) => void;
	children: ReactNode;
}

export function ProjectLeadPicker({
	people,
	value,
	onChange,
	children,
}: ProjectLeadPickerProps) {
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="max-h-[50vh] w-56 overflow-y-auto p-1"
			>
				<DropdownMenuItem onSelect={() => onChange(null)}>
					<LuCircleUser className="size-4 text-muted-foreground" />
					<span className="flex-1">
						<Trans>No lead</Trans>
					</span>
					{value === null && <LuCheck className="size-3.5" />}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{people.map((person) => (
					<DropdownMenuItem
						key={person.id}
						onSelect={() => onChange(person.id)}
					>
						<AvatarStack
							people={[person]}
							size={16}
							surfaceClassName="bg-popover"
							outlineClassName="outline-transparent"
						/>
						<span className="min-w-0 flex-1 truncate">{person.name}</span>
						{person.id === value && <LuCheck className="size-3.5" />}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
