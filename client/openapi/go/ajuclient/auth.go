package ajuclient

import (
	"context"
	"net/http"
)

// DefaultBaseURL is the production aju API endpoint.
const DefaultBaseURL = "https://aju.sh"

// New returns a Client that injects `Authorization: Bearer <apiKey>` on
// every request. Pass additional options (custom http.Client, server URL,
// extra request editors) as needed.
func New(apiKey string, opts ...ClientOption) (*Client, error) {
	base := DefaultBaseURL
	withAuth := WithRequestEditorFn(func(_ context.Context, req *http.Request) error {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		return nil
	})
	opts = append([]ClientOption{withAuth}, opts...)
	return NewClient(base, opts...)
}
