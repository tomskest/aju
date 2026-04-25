import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { tenantDbFor } from "../src/lib/db";
import {
  generateEmbeddings,
  prepareDocumentText,
  prepareFileText,
  toVectorLiteral,
} from "../src/lib/embeddings";

const control = new PrismaClient();
const BATCH_SIZE = 100;

async function backfillDocuments(
  tenant: PrismaClientTenant,
  orgId: string,
): Promise<number> {
  const docs = await tenant.$queryRawUnsafe<
    Array<{ id: string; title: string; tags: string[]; content: string }>
  >(
    `SELECT id, title, tags, content FROM vault_documents WHERE embedding IS NULL`,
  );

  if (docs.length === 0) {
    console.log(`  [${orgId}] documents: all embeddings up to date`);
    return 0;
  }

  console.log(`  [${orgId}] documents: ${docs.length} missing embeddings`);

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const texts = batch.map((d) =>
      prepareDocumentText(d.title, d.tags, d.content),
    );

    const embeddings = await generateEmbeddings(texts);

    for (let j = 0; j < batch.length; j++) {
      const vector = toVectorLiteral(embeddings[j]);
      await tenant.$executeRawUnsafe(
        `UPDATE vault_documents SET embedding = $1::vector WHERE id = $2`,
        vector,
        batch[j].id,
      );
    }

    console.log(
      `  [${orgId}] documents: ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length} done`,
    );
  }
  return docs.length;
}

async function backfillFiles(
  tenant: PrismaClientTenant,
  orgId: string,
): Promise<number> {
  const files = await tenant.$queryRawUnsafe<
    Array<{
      id: string;
      filename: string;
      tags: string[];
      extracted_text: string;
    }>
  >(
    `SELECT id, filename, tags, extracted_text FROM vault_files WHERE embedding IS NULL AND extracted_text IS NOT NULL`,
  );

  if (files.length === 0) {
    console.log(`  [${orgId}] files: all embeddings up to date`);
    return 0;
  }

  console.log(`  [${orgId}] files: ${files.length} missing embeddings`);

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const texts = batch.map((f) =>
      prepareFileText(f.filename, f.tags, f.extracted_text),
    );

    const embeddings = await generateEmbeddings(texts);

    for (let j = 0; j < batch.length; j++) {
      const vector = toVectorLiteral(embeddings[j]);
      await tenant.$executeRawUnsafe(
        `UPDATE vault_files SET embedding = $1::vector WHERE id = $2`,
        vector,
        batch[j].id,
      );
    }

    console.log(
      `  [${orgId}] files: ${Math.min(i + BATCH_SIZE, files.length)}/${files.length} done`,
    );
  }
  return files.length;
}

async function main() {
  console.log("Starting embedding backfill across all active tenants...\n");

  const tenants = await control.tenant.findMany({
    where: { status: "active" },
    select: { organizationId: true },
  });

  if (tenants.length === 0) {
    console.log("No active tenants. Nothing to do.");
    return;
  }

  let totalDocs = 0;
  let totalFiles = 0;
  let failed = 0;

  for (const t of tenants) {
    console.log(`\nTenant ${t.organizationId}:`);
    try {
      const tenant = await tenantDbFor(t.organizationId);
      totalDocs += await backfillDocuments(tenant, t.organizationId);
      totalFiles += await backfillFiles(tenant, t.organizationId);
    } catch (err) {
      failed++;
      console.error(`  [${t.organizationId}] failed:`, err);
    }
  }

  console.log(
    `\nBackfill complete. tenants=${tenants.length} failed=${failed} docs=${totalDocs} files=${totalFiles}`,
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => control.$disconnect());
