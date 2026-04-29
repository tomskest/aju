import { notFound } from "next/navigation";
import { tenantDbFor } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import { withBrainContext } from "@/lib/tenant";
import { renderMarkdown, resolveWikilinksToMarkdown } from "@/lib/vault";
import BrainExplorer from "@/components/app/brain/BrainExplorer";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ name: string; path?: string[] }>;
  searchParams: Promise<{ missing?: string }>;
};

type DocSummary = {
  id: string;
  path: string;
  title: string;
};

type DocFull = DocSummary & {
  content: string;
  contentHash: string;
  rendered: string;
  updatedAt: string;
  wordCount: number;
  validation: {
    status: string;
    provenance: string;
    validatedAt: string | null;
    validatedBy: string | null;
  };
};

export default async function BrainPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const brainName = decodeURIComponent(params.name);
  const docPath = params.path?.map(decodeURIComponent).join("/") ?? null;
  const missingHint = searchParams.missing
    ? decodeURIComponent(searchParams.missing)
    : null;

  const user = await currentUser();
  if (!user) notFound();

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  const tenant = await tenantDbFor(organizationId);

  // Resolve the brain by name. Owners of the org see every brain in the
  // tenant DB; non-owners need a BrainAccess row.
  const brain = await tenant.brain.findFirst({
    where: { name: brainName },
    select: { id: true, name: true, type: true },
  });
  if (!brain) notFound();

  const access = await tenant.brainAccess.findUnique({
    where: { brainId_userId: { brainId: brain.id, userId: user.id } },
    select: { role: true },
  });
  if (!access) notFound();

  const canWrite = access.role === "owner" || access.role === "editor";
  // Validation gate. Mirror src/lib/vault/brain.ts canValidate(): personal
  // brains are owner-only for validation, org brains follow canWrite.
  const canValidate =
    brain.type === "personal"
      ? access.role === "owner"
      : access.role === "owner" || access.role === "editor";

  // Build the sidebar list + (if a path is given) load the focused doc.
  // Done inside withBrainContext so RLS scopes the queries to this brain.
  // Brain switching is handled by the leftmost rail in (brain)/layout, so
  // we don't need to fetch the user's full brain list here.
  const { docs, currentDoc } = await withBrainContext(
    tenant,
    [brain.id],
    async (tx) => {
      const docRows = await tx.vaultDocument.findMany({
        where: { brainId: brain.id },
        select: { id: true, path: true, title: true },
        orderBy: { path: "asc" },
      });

      let current: DocFull | null = null;
      if (docPath) {
        const row = await tx.vaultDocument.findFirst({
          where: { brainId: brain.id, path: docPath },
          select: {
            id: true,
            path: true,
            title: true,
            content: true,
            contentHash: true,
            wordCount: true,
            updatedAt: true,
            provenance: true,
            validationStatus: true,
            validatedAt: true,
            validatedBy: true,
          },
        });
        if (row) {
          const knownPaths = docRows.map((d) => d.path);
          // The page header already renders the title and frontmatter
          // shouldn't show in prose — strip both before resolving wikilinks
          // and rendering. Editor view still gets the full raw content.
          const displayBody = stripFrontmatterAndLeadingH1(
            row.content,
            row.title,
          );
          const md = resolveWikilinksToMarkdown(
            displayBody,
            knownPaths,
            brain.name,
            row.path,
          );
          current = {
            id: row.id,
            path: row.path,
            title: row.title,
            content: row.content,
            contentHash: row.contentHash,
            rendered: renderMarkdown(md),
            wordCount: row.wordCount,
            updatedAt: row.updatedAt.toISOString(),
            validation: {
              status: row.validationStatus,
              provenance: row.provenance,
              validatedAt: row.validatedAt?.toISOString() ?? null,
              validatedBy: row.validatedBy,
            },
          };
        }
      }

      return {
        docs: docRows as DocSummary[],
        currentDoc: current,
      };
    },
  );

  return (
    <BrainExplorer
      brainName={brain.name}
      brainType={brain.type}
      canWrite={canWrite}
      canValidate={canValidate}
      docs={docs}
      currentDoc={currentDoc}
      currentPath={docPath}
      missingHint={missingHint}
    />
  );
}

/**
 * Strip the frontmatter block and a leading `# Title` line so the prose
 * view doesn't double up with the page header. Only removes the H1 when
 * it matches the doc's stored title (case-insensitive, trimmed) — if a
 * doc happens to start with a different H1, leave it alone.
 */
function stripFrontmatterAndLeadingH1(content: string, title: string): string {
  let body = content;

  if (body.startsWith("---\n")) {
    const end = body.indexOf("\n---", 4);
    if (end !== -1) {
      const closer = body.indexOf("\n", end + 4);
      body = closer === -1 ? "" : body.slice(closer + 1);
    }
  }

  body = body.replace(/^\s+/, "");

  const h1 = body.match(/^#\s+(.+?)\s*(?:\n|$)/);
  if (h1 && h1[1].trim().toLowerCase() === title.trim().toLowerCase()) {
    body = body.slice(h1[0].length).replace(/^\s+/, "");
  }

  return body;
}
