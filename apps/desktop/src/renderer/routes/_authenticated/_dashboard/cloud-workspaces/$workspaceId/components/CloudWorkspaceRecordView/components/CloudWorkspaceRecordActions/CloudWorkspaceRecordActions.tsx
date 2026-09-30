import { Trans, useLingui } from "@lingui/react/macro";
import { useFormat } from "@superset/i18n/react";
import { Button } from "@superset/ui/button";
import { ButtonGroup } from "@superset/ui/button-group";
import { LuArrowRight, LuHash, LuLink } from "react-icons/lu";
import { RecordIconButton } from "renderer/routes/_authenticated/_dashboard/components/RecordIconButton";
import { CloudWorkspaceRecordMenu } from "./components/CloudWorkspaceRecordMenu";

interface CloudWorkspaceRecordActionsProps {
	archivedAt: Date | null;
	now: Date;
	onOpenWorkspace: () => void;
	onCopyLink: () => void;
	onCopyId: () => void;
	onSaveAsEnvironment?: () => void;
	onDelete: () => void;
}

export function CloudWorkspaceRecordActions({
	archivedAt,
	now,
	onOpenWorkspace,
	onCopyLink,
	onCopyId,
	onSaveAsEnvironment,
	onDelete,
}: CloudWorkspaceRecordActionsProps) {
	const { t } = useLingui();
	const { formatCompactRelativeTime } = useFormat();
	return (
		<>
			<ButtonGroup>
				<RecordIconButton
					label={t({ message: "Copy link" })}
					onClick={onCopyLink}
				>
					<LuLink className="size-3.5" />
				</RecordIconButton>
				<RecordIconButton
					label={t({ message: "Copy Workspace ID" })}
					onClick={onCopyId}
				>
					<LuHash className="size-3.5" />
				</RecordIconButton>
				{!archivedAt && (
					<CloudWorkspaceRecordMenu
						onSaveAsEnvironment={onSaveAsEnvironment}
						onDelete={onDelete}
					/>
				)}
			</ButtonGroup>
			{archivedAt ? (
				<span className="text-xs text-muted-foreground">
					<Trans>Archived · {formatCompactRelativeTime(archivedAt, now)}</Trans>
				</span>
			) : (
				<Button variant="outline" size="sm" onClick={onOpenWorkspace}>
					<Trans>Go to workspace</Trans>
					<LuArrowRight className="size-3.5" />
				</Button>
			)}
		</>
	);
}
