CREATE TABLE `board` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL
);
