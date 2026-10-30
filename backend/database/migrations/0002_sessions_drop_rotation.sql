DROP INDEX "sessions_family_idx";--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "family_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "revoked_at";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "replaced_by_id";