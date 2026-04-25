import { NextResponse } from "next/server";
import { storageFor } from "@/lib/tenant";
import { resolveBrain, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

export const GET = authedTenantRoute(
  async ({ req, tx, organizationId, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;

    const key = req.nextUrl.searchParams.get("key");
    if (!key) {
      return NextResponse.json(
        { error: "Missing required parameter: key" },
        { status: 400 },
      );
    }

    const mode = req.nextUrl.searchParams.get("mode") || "metadata";

    const file = await tx.vaultFile.findFirst({
      where: { s3Key: key, brainId: brain.brainId },
    });

    if (!file) {
      return NextResponse.json(
        { error: `File not found: ${key}` },
        { status: 404 },
      );
    }

    if (mode === "url") {
      const storage = await storageFor(organizationId);
      const url = await storage.presignGet(key);
      return { ...file, downloadUrl: url };
    }

    if (mode === "content") {
      const storage = await storageFor(organizationId);
      const buffer = await storage.get(key);
      const base64Content = buffer.toString("base64");
      return { ...file, base64Content };
    }

    // Default: metadata
    return file;
  },
);
