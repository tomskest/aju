# aju (Python)

Python SDK for the aju HTTP API.

```bash
pip install aju
```

```python
from aju import AjuClient
from aju._generated.api.vault import search_vault

client = AjuClient(api_key="aju_live_...")
resp = search_vault.sync(client=client, q="ndc pricing", brain="Personal", limit=10)
for hit in resp.results:
    print(hit.path, hit.rank)
```

## Regenerating

This SDK is generated from `sdks/openapi/openapi.yaml`. To regenerate after a spec change:

```bash
cd sdks/python
pip install -e '.[dev]'
openapi-python-client generate \
  --path ../openapi/openapi.yaml \
  --config openapi-python-client.yaml \
  --overwrite
```

Or, from the repo root, regenerate all three SDKs at once:

```bash
./sdks/scripts/generate.sh
```
