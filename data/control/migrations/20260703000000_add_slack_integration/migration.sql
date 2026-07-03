-- CreateTable
CREATE TABLE "slack_installation" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "bot_user_id" TEXT NOT NULL,
    "bot_token_enc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "installed_by_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_channel_binding" (
    "id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "brain_id" TEXT NOT NULL,
    "brain_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mention',
    "tool_policy" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_channel_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "binding_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "thread_ts" TEXT,
    "slack_event_id" TEXT NOT NULL,
    "requested_by_slack_user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "tool_calls" JSONB,
    "error" TEXT,
    "reply_ts" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_spend_limit" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "monthly_cost_cents" INTEGER NOT NULL DEFAULT 2000,
    "hard_stop" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_spend_limit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slack_installation_team_id_idx" ON "slack_installation"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_installation_organization_id_team_id_key" ON "slack_installation"("organization_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_channel_binding_installation_id_channel_id_key" ON "slack_channel_binding"("installation_id", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_slack_event_id_key" ON "agent_run"("slack_event_id");

-- CreateIndex
CREATE INDEX "agent_run_organization_id_created_at_idx" ON "agent_run"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_run_binding_id_created_at_idx" ON "agent_run"("binding_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "integration_spend_limit_organization_id_key" ON "integration_spend_limit"("organization_id");

-- AddForeignKey
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_binding" ADD CONSTRAINT "slack_channel_binding_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "slack_installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_spend_limit" ADD CONSTRAINT "integration_spend_limit_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

