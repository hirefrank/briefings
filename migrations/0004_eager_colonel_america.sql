CREATE TABLE `PromptTemplate` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`prompt` text NOT NULL,
	`isDefault` integer DEFAULT false NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PromptTemplate_name_unique` ON `PromptTemplate` (`name`);--> statement-breakpoint
CREATE INDEX `PromptTemplate_isDefault_idx` ON `PromptTemplate` (`isDefault`);--> statement-breakpoint
CREATE UNIQUE INDEX `PromptTemplate_name_key` ON `PromptTemplate` (`name`);