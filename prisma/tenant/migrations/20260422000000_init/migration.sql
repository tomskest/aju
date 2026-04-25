-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "brains" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'org',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_access" (
    "id" TEXT NOT NULL,
    "brain_id" TEXT NOT NULL,
    "user_id" TEXT,
    "agent_id" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_documents" (
    "id" TEXT NOT NULL,
    "brain_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "frontmatter" JSONB,
    "doc_type" TEXT,
    "doc_status" TEXT,
    "tags" TEXT[],
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "directory" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "wikilinks" TEXT[],
    "file_modified" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "brain_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL DEFAULT 'wikilink',
    "link_text" TEXT NOT NULL,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_change_log" (
    "id" TEXT NOT NULL,
    "brain_id" TEXT NOT NULL,
    "document_id" TEXT,
    "path" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "changed_by" TEXT,
    "actor_type" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_files" (
    "id" TEXT NOT NULL,
    "brain_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "extracted_text" TEXT,
    "text_hash" TEXT,
    "metadata" JSONB,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brains_name_idx" ON "brains"("name");

-- CreateIndex
CREATE INDEX "brain_access_user_id_idx" ON "brain_access"("user_id");

-- CreateIndex
CREATE INDEX "brain_access_agent_id_idx" ON "brain_access"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_access_brain_id_user_id_key" ON "brain_access"("brain_id", "user_id");

-- CreateIndex
CREATE INDEX "agent_status_idx" ON "agent"("status");

-- CreateIndex
CREATE INDEX "vault_documents_brain_id_idx" ON "vault_documents"("brain_id");

-- CreateIndex
CREATE INDEX "vault_documents_section_idx" ON "vault_documents"("section");

-- CreateIndex
CREATE INDEX "vault_documents_doc_type_idx" ON "vault_documents"("doc_type");

-- CreateIndex
CREATE INDEX "vault_documents_doc_status_idx" ON "vault_documents"("doc_status");

-- CreateIndex
CREATE INDEX "vault_documents_directory_idx" ON "vault_documents"("directory");

-- CreateIndex
CREATE UNIQUE INDEX "vault_documents_brain_id_path_key" ON "vault_documents"("brain_id", "path");

-- CreateIndex
CREATE INDEX "document_links_brain_id_idx" ON "document_links"("brain_id");

-- CreateIndex
CREATE INDEX "document_links_source_id_idx" ON "document_links"("source_id");

-- CreateIndex
CREATE INDEX "document_links_target_id_idx" ON "document_links"("target_id");

-- CreateIndex
CREATE INDEX "document_links_link_type_idx" ON "document_links"("link_type");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_source_id_target_id_link_text_key" ON "document_links"("source_id", "target_id", "link_text");

-- CreateIndex
CREATE INDEX "vault_change_log_brain_id_idx" ON "vault_change_log"("brain_id");

-- CreateIndex
CREATE INDEX "vault_change_log_source_created_at_idx" ON "vault_change_log"("source", "created_at");

-- CreateIndex
CREATE INDEX "vault_change_log_created_at_idx" ON "vault_change_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vault_files_s3_key_key" ON "vault_files"("s3_key");

-- CreateIndex
CREATE INDEX "vault_files_brain_id_idx" ON "vault_files"("brain_id");

-- CreateIndex
CREATE INDEX "vault_files_category_idx" ON "vault_files"("category");

-- CreateIndex
CREATE INDEX "vault_files_mime_type_idx" ON "vault_files"("mime_type");

-- CreateIndex
CREATE INDEX "vault_files_created_at_idx" ON "vault_files"("created_at");

-- AddForeignKey
ALTER TABLE "brain_access" ADD CONSTRAINT "brain_access_brain_id_fkey" FOREIGN KEY ("brain_id") REFERENCES "brains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_access" ADD CONSTRAINT "brain_access_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_documents" ADD CONSTRAINT "vault_documents_brain_id_fkey" FOREIGN KEY ("brain_id") REFERENCES "brains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_brain_id_fkey" FOREIGN KEY ("brain_id") REFERENCES "brains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "vault_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "vault_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_change_log" ADD CONSTRAINT "vault_change_log_brain_id_fkey" FOREIGN KEY ("brain_id") REFERENCES "brains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_change_log" ADD CONSTRAINT "vault_change_log_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "vault_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_files" ADD CONSTRAINT "vault_files_brain_id_fkey" FOREIGN KEY ("brain_id") REFERENCES "brains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

