DROP INDEX `DailySummary_sentiment_idx`;--> statement-breakpoint
DROP INDEX `DailySummary_schemaVersion_idx`;--> statement-breakpoint
ALTER TABLE `DailySummary` DROP COLUMN `structuredContent`;--> statement-breakpoint
ALTER TABLE `DailySummary` DROP COLUMN `schemaVersion`;--> statement-breakpoint
ALTER TABLE `DailySummary` DROP COLUMN `sentiment`;--> statement-breakpoint
ALTER TABLE `DailySummary` DROP COLUMN `topicsList`;--> statement-breakpoint
ALTER TABLE `DailySummary` DROP COLUMN `entityList`;--> statement-breakpoint
ALTER TABLE `DailySummary` DROP COLUMN `articleCount`;--> statement-breakpoint
ALTER TABLE `PromptTemplate` ADD `appId` text DEFAULT 'briefings';--> statement-breakpoint
CREATE INDEX `PromptTemplate_appId_idx` ON `PromptTemplate` (`appId`);