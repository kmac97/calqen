CREATE TYPE "public"."agent_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('calqen', 'architect', 'builder', 'verifier', 'researcher');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('plan_approval', 'deletion', 'deployment', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('plan', 'diff', 'test_results', 'research', 'log');--> statement-breakpoint
CREATE TYPE "public"."execution_target" AS ENUM('orchestrator', 'runner');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."runner_status" AS ENUM('online', 'offline', 'busy');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('draft', 'classifying', 'awaiting_clarification', 'classified', 'planning', 'planned', 'awaiting_approval', 'queued', 'in_progress', 'verifying', 'completed', 'failed', 'cancelled', 'needs_human_review');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('feature', 'research', 'debug', 'review');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_type" "agent_type" NOT NULL,
	"provider" text NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"model_used" text,
	"status" "agent_run_status" DEFAULT 'pending' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer,
	"raw_prompt" text,
	"raw_output" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"plan_version" integer NOT NULL,
	"scope_hash" text NOT NULL,
	"detail" text,
	"files_to_delete" text[] DEFAULT '{}'::text[] NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"type" "artifact_type" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"agent_run_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"github_repo" text NOT NULL,
	"github_default_branch" text DEFAULT 'main' NOT NULL,
	"local_path" text,
	"stack" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"platform" text NOT NULL,
	"status" "runner_status" DEFAULT 'offline' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"files_affected" text[] DEFAULT '{}'::text[] NOT NULL,
	"proposed_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contains_deletions" boolean DEFAULT false NOT NULL,
	"risks" text[] DEFAULT '{}'::text[] NOT NULL,
	"test_plan" text NOT NULL,
	"scope_hash" text NOT NULL,
	"estimated_tokens" integer,
	"created_by" text DEFAULT 'architect-agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_plans_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"raw_input" text NOT NULL,
	"goal" text,
	"constraints" text[] DEFAULT '{}'::text[] NOT NULL,
	"acceptance_criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"risk_level" "risk_level" DEFAULT 'medium' NOT NULL,
	"task_type" "task_type" DEFAULT 'feature' NOT NULL,
	"execution_target" "execution_target" DEFAULT 'runner' NOT NULL,
	"status" "task_status" DEFAULT 'draft' NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"resume_stage" text,
	"budget_usd" numeric(10, 4) DEFAULT '2.00' NOT NULL,
	"spent_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"assigned_runner_id" uuid,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"orchestrator_lease_id" uuid,
	"orchestrator_lease_expires_at" timestamp with time zone,
	"branch_name" text,
	"worktree_path" text,
	"telegram_chat_id" bigint NOT NULL,
	"telegram_message_id" integer,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_conversations" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"awaiting_task_id" uuid NOT NULL,
	"expected_reply_type" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"task_id" uuid,
	"message_type" text NOT NULL,
	"content" text NOT NULL,
	"reply_to_message_id" integer,
	"dedupe_key" text,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivery_lease_id" uuid,
	"delivery_lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "telegram_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_runner_id_runners_id_fk" FOREIGN KEY ("assigned_runner_id") REFERENCES "public"."runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_awaiting_task_id_tasks_id_fk" FOREIGN KEY ("awaiting_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_task_id_idx" ON "agent_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "audit_events_task_id_idx" ON "audit_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_token_hash_idx" ON "runners" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_telegram_chat_id_idx" ON "tasks" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE INDEX "tasks_execution_target_status_idx" ON "tasks" USING btree ("execution_target","status");--> statement-breakpoint
CREATE INDEX "tasks_assigned_runner_id_idx" ON "tasks" USING btree ("assigned_runner_id");--> statement-breakpoint
CREATE INDEX "tasks_orchestrator_lease_id_idx" ON "tasks" USING btree ("orchestrator_lease_id");--> statement-breakpoint
CREATE INDEX "telegram_outbox_status_idx" ON "telegram_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "telegram_outbox_chat_id_idx" ON "telegram_outbox" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "telegram_outbox_delivery_lease_id_idx" ON "telegram_outbox" USING btree ("delivery_lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_pending_per_task" ON "approvals" ("task_id") WHERE status = 'pending';