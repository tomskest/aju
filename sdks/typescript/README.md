# @aju/sdk

TypeScript SDK for the aju HTTP API.

```bash
npm install @aju/sdk
```

```ts
import { createAjuClient, api } from "@aju/sdk";

const client = createAjuClient({ apiKey: process.env.AJU_API_KEY! });

const { data, error } = await api.searchVault({
  client,
  query: { q: "ndc pricing", brain: "Personal", limit: 10 },
});

if (error) throw new Error(error.error);
console.log(data.results);
```

## Regenerating

This SDK is generated from `sdks/openapi/openapi.yaml`. To regenerate after a spec change:

```bash
cd sdks/typescript
npm install
npm run generate
npm run build
```

Or, from the repo root, regenerate all three SDKs at once:

```bash
./sdks/scripts/generate.sh
```
