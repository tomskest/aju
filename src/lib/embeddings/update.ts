import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import {
  generateEmbedding,
  prepareDocumentText,
  prepareFileText,
  toVectorLiteral,
} from "@/lib/embeddings";

export async function updateDocumentEmbedding(
  tenant: PrismaClientTenant,
  documentId: string,
): Promise<void> {
  const doc = await tenant.vaultDocument.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, tags: true, content: true },
  });
  if (!doc) return;

  const text = prepareDocumentText(doc.title, doc.tags, doc.content);
  const embedding = await generateEmbedding(text);
  const vector = toVectorLiteral(embedding);

  await tenant.$executeRaw`
    UPDATE vault_documents SET embedding = ${vector}::vector WHERE id = ${doc.id}
  `;
}

export async function updateFileEmbedding(
  tenant: PrismaClientTenant,
  fileId: string,
): Promise<void> {
  const file = await tenant.vaultFile.findUnique({
    where: { id: fileId },
    select: { id: true, filename: true, tags: true, extractedText: true },
  });
  if (!file || !file.extractedText) return;

  const text = prepareFileText(file.filename, file.tags, file.extractedText);
  const embedding = await generateEmbedding(text);
  const vector = toVectorLiteral(embedding);

  await tenant.$executeRaw`
    UPDATE vault_files SET embedding = ${vector}::vector WHERE id = ${file.id}
  `;
}
