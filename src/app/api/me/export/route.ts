import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantDbFor } from "@/lib/db";
import { currentAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportedBrain = {
  id: string;
  name: string;
  type: string;
  organizationId: string;
  createdAt: Date;
  documents: Array<{
    path: string;
    title: string;
    frontmatter: unknown;
    tags: string[];
    wikilinks: string[];
    content: string;
    docType: string | null;
    docStatus: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  files: Array<{
    s3Key: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    category: string | null;
    tags: string[];
    extractedText: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

/**
 * GET /api/me/export
 *
 * Portable data export for the signed-in user. Returns a single JSON
 * document containing the user's profile, every brain the user owns,
 * all documents (full markdown + frontmatter + tags + wikilinks), and
 * file metadata with presigned download URLs.
 *
 * Promise to users: this endpoint stays stable and usable for as long
 * as the service exists. It is the mechanism that makes "your data is
 * yours" a real commitment — not a marketing line.
 */
export async function GET(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { user } = auth;

  // Brain/BrainAccess live in per-tenant DBs — one DB per org. Walk the
  // user's memberships, open the tenant client for each, and gather owner
  // brains from there. We intentionally export only brains the user
  // personally owns; shared team-brain content belongs to the org, not to
  // an individual export.
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id },
    select: { organizationId: true },
  });

  const brains: ExportedBrain[] = [];
  for (const m of memberships) {
    let tenant;
    try {
      tenant = await tenantDbFor(m.organizationId);
    } catch (err) {
      console.error(
        `[me-export] skipping org ${m.organizationId}: tenant unavailable`,
        err,
      );
      continue;
    }
    const ownerAccess = await tenant.brainAccess.findMany({
      where: { userId: user.id, role: "owner" },
      include: {
        brain: {
          include: {
            documents: {
              orderBy: { path: "asc" },
            },
            files: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                s3Key: true,
                filename: true,
                mimeType: true,
                sizeBytes: true,
                category: true,
                tags: true,
                extractedText: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    for (const a of ownerAccess) {
      brains.push({
        id: a.brain.id,
        name: a.brain.name,
        type: a.brain.type,
        organizationId: m.organizationId,
        createdAt: a.brain.createdAt,
        documents: a.brain.documents.map((d) => ({
          path: d.path,
          title: d.title,
          frontmatter: d.frontmatter,
          tags: d.tags,
          wikilinks: d.wikilinks,
          content: d.content,
          docType: d.docType,
          docStatus: d.docStatus,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
        files: a.brain.files.map((f) => ({
          s3Key: f.s3Key,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          category: f.category,
          tags: f.tags,
          extractedText: f.extractedText,
          metadata: f.metadata,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          // NOTE: binary file contents are not inlined in the JSON export.
          // Fetch via /api/vault/files/read?key=<s3Key>&mode=url to get a
          // presigned download URL, or use `aju files read <key> --mode content`.
        })),
      });
    }
  }

  const exportedAt = new Date().toISOString();

  const payload = {
    exportedAt,
    format: "aju-export-v1",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      grandfatheredAt: user.grandfatheredAt,
      planTier: user.planTier,
      createdAt: user.createdAt,
    },
    brains,
  };

  return NextResponse.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="aju-export-${exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
