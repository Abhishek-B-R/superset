import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import { PageHeader } from "../PageHeader";
import { WindowChromeScope } from "../WindowChromeScope";

interface RecordLayoutProps {
	header: ReactNode;
	headerEnd?: ReactNode;
	/** Narrow windows keep it on the main header's row. Without one, the side column runs to the top. */
	sideHeader?: ReactNode;
	side: ReactNode;
	children: ReactNode;
}

export function RecordLayout({
	header,
	headerEnd,
	sideHeader,
	side,
	children,
}: RecordLayoutProps) {
	const hasSideHeader = sideHeader !== undefined;
	return (
		<div className="@container flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
			<div
				className={cn(
					"grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto] content-start overflow-auto @min-[900px]:grid-cols-[minmax(0,1fr)_372px] @min-[900px]:grid-rows-[auto_minmax(0,1fr)] @min-[900px]:content-stretch @min-[900px]:overflow-hidden",
					hasSideHeader
						? "[grid-template-areas:'header_side-header'_'main_main'_'side_side'] @min-[900px]:[grid-template-areas:'header_side-header'_'main_side']"
						: "[grid-template-areas:'header_header'_'main_main'_'side_side'] @min-[900px]:[grid-template-areas:'header_side'_'main_side']",
				)}
			>
				<PageHeader
					start={header}
					end={headerEnd}
					className="sticky top-0 z-10 min-w-0 bg-background text-[13px] [grid-area:header]"
				/>
				{hasSideHeader && (
					<WindowChromeScope enabled={false}>
						<PageHeader
							end={sideHeader}
							className="sticky top-0 z-10 min-w-0 bg-background [grid-area:side-header] @min-[900px]:border-l @min-[900px]:border-border"
							contentClassName="gap-3 pl-0"
						/>
					</WindowChromeScope>
				)}
				<main className="min-w-0 pt-5 pr-10 pb-10 pl-8 [grid-area:main] @min-[900px]:overflow-auto">
					{children}
				</main>
				<div className="relative min-w-0 border-t border-border [grid-area:side] @min-[900px]:overflow-auto @min-[900px]:border-t-0 @min-[900px]:border-l">
					{!hasSideHeader && (
						<div className="drag absolute inset-x-0 top-0 hidden h-9 @min-[900px]:block" />
					)}
					{side}
				</div>
			</div>
		</div>
	);
}
