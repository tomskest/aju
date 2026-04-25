import { createHash } from "crypto";

export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<string | null> {
  if (mimeType === "application/pdf") {
    try {
      // pdf-parse uses `export =` (CJS) — dynamic import wraps it in { default }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
      const result = await pdfParse(buffer);
      return result.text || null;
    } catch (err) {
      console.error("PDF text extraction failed:", err);
      return null;
    }
  }

  if (mimeType.startsWith("text/")) {
    return buffer.toString("utf-8");
  }

  return null;
}

export function computeTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
