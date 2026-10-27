ALTER TABLE "investigations" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_input_tokens_check" CHECK ("investigations"."input_tokens" is null or "investigations"."input_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_output_tokens_check" CHECK ("investigations"."output_tokens" is null or "investigations"."output_tokens" >= 0);