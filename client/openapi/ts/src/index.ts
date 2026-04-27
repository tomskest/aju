import { createClient, createConfig } from "@hey-api/client-fetch";
import type { Client } from "@hey-api/client-fetch";

export * from "./generated/types.gen.js";
export * as api from "./generated/sdk.gen.js";
export { client as defaultClient } from "./generated/client.gen.js";
export {
  updateWithRebase,
  type ApplyEdit,
  type UpdateWithRebaseOptions,
  type UpdateWithRebaseResult,
} from "./rebase.js";

export type AjuClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

/**
 * Create a pre-authenticated aju API client.
 *
 * ```ts
 * import { createAjuClient, api } from "@aju/sdk";
 *
 * const client = createAjuClient({ apiKey: process.env.AJU_API_KEY! });
 * const { data, error } = await api.searchVault({
 *   client,
 *   query: { q: "ndc pricing", limit: 10 },
 * });
 * ```
 */
export function createAjuClient(opts: AjuClientOptions): Client {
  return createClient(
    createConfig({
      baseUrl: opts.baseUrl ?? "https://aju.sh",
      fetch: opts.fetch,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
      },
    }),
  );
}
