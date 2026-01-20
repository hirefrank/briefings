ALTER TABLE `Feed` ADD `isValid` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `Feed` ADD `validationError` text;