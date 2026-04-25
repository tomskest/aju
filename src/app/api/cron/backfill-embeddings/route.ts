import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantDbFor } from "@/lib/db";
import {
  generateEmbeddings,
  prepareDocumentText,
  prepareFileText,
  toVectorLiteral,
} from "@/lib/embeddings";

const BATCH_SIZE = 100;

/**
 * Cron: backfill embeddings for every active tenant DB.
 *
 * Platform-cron-only endpoint. Triggers a tenant-wide Voyage embedding run,
 * so it's gated by CRON_SECRET rather than the normal API-key auth — a
 * single compromised user key must not be able to fan out into every tenant.
 *
 * Iterates the control-plane tenant table, opens the per-tenant client for
 * each active org, and fills in NULL embeddings for both vault_documents and
 * vault_files. No per-brain scoping any more — each tenant DB is the unit of
 * work, and its RLS-free maintenance path is the expected escape hatch.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "cron_not_configured" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  // Also accept x-cron-secret for platforms that don't pass Authorization.
  const header = req.headers.get("x-cron-secret") ?? "";
  const { timingSafeEqual } = await import("node:crypto");
  const ok =
    (presented &&
      presented.length === cronSecret.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(cronSecret))) ||
    (header &&
      header.length === cronSecret.length &&
      timingSafeEqual(Buffer.from(header), Buffer.from(cronSecret)));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const start = Date.now();
    let docsProcessed = 0;
    let filesProcessed = 0;
    let docsRemaining = 0;
    let filesRemaining = 0;
    const perTenant: Array<{
      organizationId: string;
      docsProcessed: number;
      filesProcessed: number;
      docsRemaining: number;
      filesRemaining: number;
      error?: string;
    }> = [];

    const tenants = await prisma.tenant.findMany({
      where: { status: "active" },
      select: { organizationId: true },
    });

    for (const t of tenants) {
      let tDocs = 0;
      let tFiles = 0;
      let tDocsRem = 0;
      let tFilesRem = 0;
      try {
        const tenant = await tenantDbFor(t.organizationId);

        // Backfill documents
        const docs = await tenant.$queryRaw<
          Array<{ id: string; title: string; tags: string[]; content: string }>
        >`
          SELECT id, title, tags, content FROM vault_documents WHERE embedding IS NULL
        `;

        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
          const batch = docs.slice(i, i + BATCH_SIZE);
          const texts = batch.map((d) =>
            prepareDocumentText(d.title, d.tags, d.content),
          );
          const embeddings = await generateEmbeddings(texts);
          for (let j = 0; j < batch.length; j++) {
            const vector = toVectorLiteral(embeddings[j]);
            const id = batch[j].id;
            await tenant.$executeRaw`
              UPDATE vault_documents SET embedding = ${vector}::vector WHERE id = ${id}
            `;
          }
          tDocs += batch.length;
        }

        // Backfill files
        const files = await tenant.$queryRaw<
          Array<{
            id: string;
            filename: string;
            tags: string[];
            extracted_text: string;
          }>
        >`
          SELECT id, filename, tags, extracted_text
          FROM vault_files
          WHERE embedding IS NULL AND extracted_text IS NOT NULL
        `;

        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          const batch = files.slice(i, i + BATCH_SIZE);
          const texts = batch.map((f) =>
            prepareFileText(f.filename, f.tags, f.extracted_text),
          );
          const embeddings = await generateEmbeddings(texts);
          for (let j = 0; j < batch.length; j++) {
            const vector = toVectorLiteral(embeddings[j]);
            const id = batch[j].id;
            await tenant.$executeRaw`
              UPDATE vault_files SET embedding = ${vector}::vector WHERE id = ${id}
            `;
          }
          tFiles += batch.length;
        }

        // Remaining counts for diagnostic parity with the old response shape.
        tDocsRem = (await tenant.vaultDocument.count()) - tDocs;
        tFilesRem = (await tenant.vaultFile.count()) - tFiles;

        docsProcessed += tDocs;
        filesProcessed += tFiles;
        docsRemaining += tDocsRem;
        filesRemaining += tFilesRem;
        perTenant.push({
          organizationId: t.organizationId,
          docsProcessed: tDocs,
          filesProcessed: tFiles,
          docsRemaining: tDocsRem,
          filesRemaining: tFilesRem,
        });
      } catch (err) {
        console.error(
          `[backfill-embeddings] tenant ${t.organizationId} failed:`,
          err,
        );
        perTenant.push({
          organizationId: t.organizationId,
          docsProcessed: tDocs,
          filesProcessed: tFiles,
          docsRemaining: tDocsRem,
          filesRemaining: tFilesRem,
          error: String(err instanceof Error ? err.message : err),
        });
      }
    }

    const durationMs = Date.now() - start;

    return NextResponse.json({
      ok: true,
      tenants: tenants.length,
      docsProcessed,
      filesProcessed,
      docsSkipped: docsRemaining,
      filesSkipped: filesRemaining,
      perTenant,
      durationMs,
    });
  } catch (error) {
    console.error("Backfill embeddings error:", error);
    return NextResponse.json(
      { error: "Backfill failed", details: String(error) },
      { status: 500 },
    );
  }
}
