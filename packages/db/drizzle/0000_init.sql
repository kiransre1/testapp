CREATE TYPE "public"."artifact_kind" AS ENUM('screenshot', 'trace', 'axe', 'console_log', 'network_log', 'discovery', 'report_html', 'report_md', 'report_json', 'fix_packet');--> statement-breakpoint
CREATE TYPE "public"."auth_mode" AS ENUM('none', 'form');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."event_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."finding_category" AS ENUM('observed_failure', 'observed_runtime_symptom', 'automated_standard_result', 'heuristic_observation', 'inferred_risk', 'enhancement_opportunity');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('preflight', 'generate_plan', 'execute_run');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."preflight_status" AS ENUM('queued', 'running', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recommendation_kind" AS ENUM('ux', 'agentic');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'preflighting', 'planning', 'running', 'analysing', 'completed', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scenario_status" AS ENUM('pending', 'running', 'passed', 'failed', 'blocked', 'skipped', 'inconclusive');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('passed', 'failed', 'blocked', 'skipped', 'error');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"preflight_id" uuid,
	"scenario_result_id" uuid,
	"step_result_id" uuid,
	"kind" "artifact_kind" NOT NULL,
	"label" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "brief_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"category" "finding_category" NOT NULL,
	"title" text NOT NULL,
	"severity" "severity" NOT NULL,
	"priority" text NOT NULL,
	"confidence" "confidence" NOT NULL,
	"source" text NOT NULL,
	"scenario_key" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preflights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"status" "preflight_status" DEFAULT 'queued' NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discovery" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "recommendation_kind" NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"target_id" uuid,
	"job_id" uuid,
	"level" "event_level" DEFAULT 'info' NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"rerun_of_run_id" uuid,
	"job_id" uuid,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"config" jsonb NOT NULL,
	"run_prefix" text NOT NULL,
	"provider" text NOT NULL,
	"is_fake" boolean NOT NULL,
	"budget_usage" jsonb,
	"budget_exhausted" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"target_build_label" text,
	"browser" text,
	"viewport" text,
	"analysis_summary" text,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scenario_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"scenario_id" uuid,
	"scenario_key" text NOT NULL,
	"scenario_version" integer NOT NULL,
	"title" text NOT NULL,
	"ordinal" integer NOT NULL,
	"status" "scenario_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"action_count" integer DEFAULT 0 NOT NULL,
	"browser_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"ordinal" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"scenario_result_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"action" text NOT NULL,
	"description" text NOT NULL,
	"status" "step_status" NOT NULL,
	"expected" text,
	"actual" text,
	"error" text,
	"url" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"label" text DEFAULT 'primary' NOT NULL,
	"username_enc" text NOT NULL,
	"password_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"allowed_origins" jsonb NOT NULL,
	"allow_private_network" boolean DEFAULT false NOT NULL,
	"is_staging" boolean NOT NULL,
	"authorization_confirmed_at" timestamp with time zone NOT NULL,
	"allow_disposable_writes" boolean DEFAULT false NOT NULL,
	"prohibited_actions_summary" text DEFAULT '' NOT NULL,
	"forbidden_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forbidden_routes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"build_label" text,
	"seed_reset_notes" text,
	"role_notes" text,
	"start_path" text DEFAULT '/' NOT NULL,
	"auth_mode" "auth_mode" DEFAULT 'none' NOT NULL,
	"login_url" text,
	"username_locator" jsonb,
	"password_locator" jsonb,
	"submit_locator" jsonb,
	"login_success_url_contains" text,
	"login_success_locator" jsonb,
	"discovery_max_pages" integer DEFAULT 8 NOT NULL,
	"discovery_max_depth" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"brief_version_id" uuid,
	"parent_plan_id" uuid,
	"version" integer NOT NULL,
	"status" "plan_status" DEFAULT 'generating' NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"is_fake" boolean NOT NULL,
	"coverage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unsupported_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_usage" jsonb,
	"notes" text DEFAULT '' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_preflight_id_preflights_id_fk" FOREIGN KEY ("preflight_id") REFERENCES "public"."preflights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_scenario_result_id_scenario_results_id_fk" FOREIGN KEY ("scenario_result_id") REFERENCES "public"."scenario_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_step_result_id_step_results_id_fk" FOREIGN KEY ("step_result_id") REFERENCES "public"."step_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_versions" ADD CONSTRAINT "brief_versions_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_plan_version_id_test_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."test_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_plan_version_id_test_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."test_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preflights" ADD CONSTRAINT "preflights_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_plan_version_id_test_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."test_plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_plan_version_id_test_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."test_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_scenario_result_id_scenario_results_id_fk" FOREIGN KEY ("scenario_result_id") REFERENCES "public"."scenario_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_credentials" ADD CONSTRAINT "target_credentials_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_versions" ADD CONSTRAINT "test_plan_versions_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_versions" ADD CONSTRAINT "test_plan_versions_brief_version_id_brief_versions_id_fk" FOREIGN KEY ("brief_version_id") REFERENCES "public"."brief_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brief_versions_target_version_uq" ON "brief_versions" USING btree ("target_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_run_fingerprint_uq" ON "findings" USING btree ("run_id","fingerprint");--> statement-breakpoint
CREATE INDEX "findings_fingerprint_idx" ON "findings" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journeys_plan_key_uq" ON "journeys" USING btree ("plan_version_id","key");--> statement-breakpoint
CREATE INDEX "login_attempts_key_time_idx" ON "login_attempts" USING btree ("key_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_plan_key_uq" ON "personas" USING btree ("plan_version_id","key");--> statement-breakpoint
CREATE INDEX "preflights_target_idx" ON "preflights" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "run_events_target_idx" ON "run_events" USING btree ("target_id","id");--> statement-breakpoint
CREATE INDEX "runs_target_created_idx" ON "runs" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_results_run_key_uq" ON "scenario_results" USING btree ("run_id","scenario_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_plan_key_uq" ON "scenarios" USING btree ("plan_version_id","key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_results_scenario_index_uq" ON "step_results" USING btree ("scenario_result_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "target_credentials_target_label_uq" ON "target_credentials" USING btree ("target_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_project_name_uq" ON "targets" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_target_version_uq" ON "test_plan_versions" USING btree ("target_id","version");