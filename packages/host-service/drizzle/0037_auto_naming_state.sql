ALTER TABLE `workspaces` ADD `auto_naming_prompt` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `auto_naming_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `auto_naming_branch` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `auto_naming_agent` text;