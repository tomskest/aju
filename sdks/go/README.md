# aju Go SDK

Go SDK for the aju HTTP API.

```bash
go get github.com/tomskest/aju/sdks/go/ajuclient
```

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/tomskest/aju/sdks/go/ajuclient"
)

func main() {
    c, err := ajuclient.New("aju_live_...")
    if err != nil {
        log.Fatal(err)
    }

    limit := 10
    brain := "Personal"
    resp, err := c.SearchVault(context.Background(), &ajuclient.SearchVaultParams{
        Q:     "ndc pricing",
        Brain: &brain,
        Limit: &limit,
    })
    if err != nil {
        log.Fatal(err)
    }
    defer resp.Body.Close()

    fmt.Println(resp.StatusCode)
}
```

## Regenerating

This SDK is generated from `sdks/openapi/openapi.yaml`. To regenerate after a spec change:

```bash
cd sdks/go/ajuclient
go generate ./...
go build ./...
```

Or, from the repo root, regenerate all three SDKs at once:

```bash
./sdks/scripts/generate.sh
```
