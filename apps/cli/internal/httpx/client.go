// Package httpx provides a thin HTTP wrapper for calling the aju.sh API.
package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultTimeout bounds the round-trip time of every request.
const DefaultTimeout = 30 * time.Second

// Version is stamped into the x-aju-cli-version header. main.go sets it at
// startup so httpx can advertise the CLI build without an import cycle.
var Version = "dev"

// Error categories surfaced by the client. Callers can type-assert to *Error
// and inspect Kind to distinguish network errors from HTTP or decode errors.
type ErrorKind int

const (
	// ErrNetwork covers DNS, TCP, TLS, or timeout failures — anything before
	// an HTTP response is received.
	ErrNetwork ErrorKind = iota + 1
	// ErrHTTP covers a non-2xx response from the server.
	ErrHTTP
	// ErrDecode covers JSON encode/decode failures on either direction.
	ErrDecode
)

// Error is the typed error returned by Client methods.
type Error struct {
	Kind    ErrorKind
	Status  int    // populated when Kind == ErrHTTP
	Message string // human-readable summary
	Body    string // raw server body when Kind == ErrHTTP (may be truncated)
	Err     error  // wrapped cause (for errors.Is/Unwrap)
}

func (e *Error) Error() string { return e.Message }

func (e *Error) Unwrap() error { return e.Err }

// IsAuth reports whether err represents an authentication failure (401/403).
func IsAuth(err error) bool {
	var e *Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Kind == ErrHTTP && (e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden)
}

// IsNetwork reports whether err represents a connectivity failure.
func IsNetwork(err error) bool {
	var e *Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Kind == ErrNetwork
}

// Client wraps net/http with JSON encode/decode and Bearer auth.
type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

// New returns a Client with a sensible default timeout.
func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		HTTP: &http.Client{
			Timeout: DefaultTimeout,
		},
	}
}

// Do performs a request and decodes the JSON response into out (may be nil).
// Errors are typed — see *Error, IsAuth, IsNetwork.
func (c *Client) Do(method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return &Error{Kind: ErrDecode, Message: fmt.Sprintf("encode request body: %v", err), Err: err}
		}
		reader = bytes.NewReader(buf)
	}

	fullURL := path
	if !strings.HasPrefix(path, "http://") && !strings.HasPrefix(path, "https://") {
		fullURL = c.BaseURL + path
	}

	req, err := http.NewRequest(method, fullURL, reader)
	if err != nil {
		return &Error{Kind: ErrNetwork, Message: fmt.Sprintf("build request: %v", err), Err: err}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-aju-cli-version", Version)
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return &Error{Kind: ErrNetwork, Message: fmt.Sprintf("network: %v", err), Err: err}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return &Error{Kind: ErrNetwork, Message: fmt.Sprintf("read response: %v", err), Err: err}
	}

	if resp.StatusCode >= 400 {
		snippet := strings.TrimSpace(string(raw))
		if len(snippet) > 256 {
			snippet = snippet[:256] + "..."
		}
		return &Error{
			Kind:    ErrHTTP,
			Status:  resp.StatusCode,
			Message: fmt.Sprintf("http %d: %s", resp.StatusCode, snippet),
			Body:    snippet,
		}
	}

	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &Error{Kind: ErrDecode, Message: fmt.Sprintf("decode response: %v", err), Err: err}
	}
	return nil
}

// Get is a convenience wrapper for GET requests.
func (c *Client) Get(path string, out any) error {
	return c.Do(http.MethodGet, path, nil, out)
}

// RawGet performs a GET and returns the raw *http.Response for the caller
// to stream or decode however they want. Unlike Do/Get, this does not
// read the body eagerly — the caller MUST close resp.Body. Useful for
// large exports or binary content.
func (c *Client) RawGet(path string) (*http.Response, error) {
	fullURL := path
	if !strings.HasPrefix(path, "http://") && !strings.HasPrefix(path, "https://") {
		fullURL = c.BaseURL + path
	}
	req, err := http.NewRequest(http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, &Error{Kind: ErrNetwork, Message: fmt.Sprintf("build request: %v", err), Err: err}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-aju-cli-version", Version)
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, &Error{Kind: ErrNetwork, Message: fmt.Sprintf("network: %v", err), Err: err}
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 256 {
			snippet = snippet[:256] + "..."
		}
		return nil, &Error{
			Kind:    ErrHTTP,
			Status:  resp.StatusCode,
			Message: fmt.Sprintf("http %d: %s", resp.StatusCode, snippet),
			Body:    snippet,
		}
	}
	return resp, nil
}

// Post is a convenience wrapper for POST requests.
func (c *Client) Post(path string, body, out any) error {
	return c.Do(http.MethodPost, path, body, out)
}

// GetJSON performs a GET with query parameters, decoding the response into out.
// Empty-valued params are skipped so callers can pass zero values without
// polluting the query string.
func (c *Client) GetJSON(path string, params url.Values, out any) error {
	target := path
	if len(params) > 0 {
		filtered := url.Values{}
		for k, vs := range params {
			for _, v := range vs {
				if v == "" {
					continue
				}
				filtered.Add(k, v)
			}
		}
		if enc := filtered.Encode(); enc != "" {
			if strings.Contains(target, "?") {
				target += "&" + enc
			} else {
				target += "?" + enc
			}
		}
	}
	return c.Get(target, out)
}

// PostJSON posts a JSON body and decodes the response into out.
func (c *Client) PostJSON(path string, body any, out any) error {
	return c.Post(path, body, out)
}
