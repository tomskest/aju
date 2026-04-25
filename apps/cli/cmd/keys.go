package cmd

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/tomskest/aju/cli/internal/config"
	"github.com/tomskest/aju/cli/internal/httpx"
)

// keyOrg mirrors the pinned-org payload embedded in GET /api/keys and
// POST /api/keys responses.
type keyOrg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// keySummary mirrors a single entry in GET /api/keys.
type keySummary struct {
	ID             string   `json:"id"`
	Prefix         string   `json:"prefix"`
	Name           string   `json:"name"`
	Scopes         []string `json:"scopes"`
	CreatedAt      string   `json:"createdAt"`
	LastUsedAt     string   `json:"lastUsedAt"`
	ExpiresAt      string   `json:"expiresAt"`
	RevokedAt      string   `json:"revokedAt"`
	OrganizationID string   `json:"organizationId"`
	Organization   *keyOrg  `json:"organization"`
}

// keysListResp mirrors GET /api/keys.
type keysListResp struct {
	Keys []keySummary `json:"keys"`
}

// keysCreateReq is the body for POST /api/keys.
type keysCreateReq struct {
	Name           string   `json:"name"`
	Scopes         []string `json:"scopes,omitempty"`
	ExpiresInDays  *int     `json:"expiresInDays,omitempty"`
	OrganizationID string   `json:"organizationId,omitempty"`
}

// keysCreateResp mirrors POST /api/keys.
type keysCreateResp struct {
	Key       keySummary `json:"key"`
	Plaintext string     `json:"plaintext"`
	Warning   string     `json:"warning"`
}

// RunKeys dispatches the `aju keys` sub-subcommands.
func RunKeys(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		HelpKeys()
		if len(args) < 1 {
			return ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "list":
		return KeysList(args[1:])
	case "create":
		return KeysCreate(args[1:])
	case "revoke":
		return KeysRevoke(args[1:])
	case "update":
		return KeysUpdate(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown keys subcommand: %s\n\n", args[0])
		HelpKeys()
		return ErrSilent
	}
}

// KeysList prints the caller's API keys in tabular form.
func KeysList(args []string) error {
	fs := flag.NewFlagSet("keys list", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "List your API keys. Tab-separated: prefix, name, org, scopes, last used, status.",
		Usage:   "aju keys list",
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp keysListResp
	if err := client.Get("/api/keys", &resp); err != nil {
		return printFriendlyErr(err)
	}

	if len(resp.Keys) == 0 {
		fmt.Fprintln(os.Stderr, "No keys. Run `aju keys create <name>` to mint one.")
		return nil
	}
	for _, k := range resp.Keys {
		fmt.Printf(
			"%s\t%s\t%s\t%s\t%s\t%s\n",
			k.Prefix,
			k.Name,
			keyOrgLabel(k),
			strings.Join(k.Scopes, ","),
			formatLastUsed(k.LastUsedAt),
			keyStatus(k),
		)
	}
	return nil
}

// keyOrgLabel renders the pinned-org column in `keys list`. Falls back to
// the literal "unpinned" for keys that somehow lack an org (shouldn't
// happen for newly-minted keys, but legacy rows may).
func keyOrgLabel(k keySummary) string {
	if k.Organization != nil && k.Organization.Slug != "" {
		return k.Organization.Slug
	}
	if k.OrganizationID != "" {
		return k.OrganizationID
	}
	return "unpinned"
}

// KeysCreate mints a new scoped key and prints the plaintext exactly once.
func KeysCreate(args []string) error {
	fs := flag.NewFlagSet("keys create", flag.ContinueOnError)
	scopesFlag := fs.String("scopes", "read,write", "comma-separated scopes: read, write, admin")
	expiresDays := fs.Int("expires-days", 0, "days until the key expires (0 = no expiry)")
	orgFlag := fs.String("org", "", "slug or id of the org to pin this key to (defaults to active org)")
	setLeafUsage(fs, leafHelp{
		Summary: "Mint a new personal API key pinned to a specific organization.",
		Usage:   "aju keys create <name> [--org <slug>] [--scopes read,write] [--expires-days 90]",
		Long: `The plaintext key is printed ONCE in this call's output. Save it — the
server never reveals it again. Without --org the key is pinned to the
active organization. Pinning is mandatory: unpinned keys are rejected.`,
		Examples: []string{
			"aju keys create laptop",
			"aju keys create prod-ci --org crewpoint --scopes read --expires-days 365",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju keys create <name> [--scopes read,write] [--expires-days 90] [--org <slug>]")
	}
	name := strings.TrimSpace(fs.Arg(0))
	if name == "" {
		return errors.New("name required")
	}

	scopes := parseScopesFlag(*scopesFlag)
	if len(scopes) == 0 {
		return errors.New("at least one scope is required (read, write, or admin)")
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	// Resolve the target org. Server accepts a cuid; user may have typed a
	// slug. Hit /api/orgs once and match by id-or-slug.
	orgID, err := resolveOrgTarget(client, strings.TrimSpace(*orgFlag))
	if err != nil {
		return err
	}

	body := keysCreateReq{Name: name, Scopes: scopes, OrganizationID: orgID}
	if *expiresDays > 0 {
		d := *expiresDays
		body.ExpiresInDays = &d
	}

	var resp keysCreateResp
	if err := client.Post("/api/keys", body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if resp.Plaintext == "" {
		return fmt.Errorf("server returned empty plaintext")
	}

	// Give the user a hard visual break so the one-time secret doesn't get
	// lost in a scrollback wall. Keep the banner ASCII-only.
	fmt.Println()
	fmt.Println("================================================================")
	fmt.Println("  New API key — copy this now, it will not be shown again:")
	fmt.Println("================================================================")
	fmt.Println()
	fmt.Printf("  %s\n", resp.Plaintext)
	fmt.Println()
	fmt.Println("----------------------------------------------------------------")
	fmt.Printf("  prefix:  %s\n", resp.Key.Prefix)
	fmt.Printf("  name:    %s\n", resp.Key.Name)
	fmt.Printf("  scopes:  %s\n", strings.Join(resp.Key.Scopes, ","))
	if resp.Key.Organization != nil {
		fmt.Printf("  org:     %s (%s)\n", resp.Key.Organization.Name, resp.Key.Organization.Slug)
	} else if resp.Key.OrganizationID != "" {
		fmt.Printf("  org:     %s\n", resp.Key.OrganizationID)
	}
	if resp.Key.ExpiresAt != "" {
		fmt.Printf("  expires: %s\n", shortDate(resp.Key.ExpiresAt))
	} else {
		fmt.Println("  expires: never")
	}
	fmt.Println("----------------------------------------------------------------")
	if resp.Warning != "" {
		fmt.Println(resp.Warning)
	} else {
		fmt.Println("Save this key somewhere safe. If lost, revoke and create a new one.")
	}
	return nil
}

// KeysRevoke marks a key as revoked. `idOrPrefix` may be either the full key
// id (returned by `keys list --json` eventually) or the 12-char prefix users
// see in the table. Prefix mode resolves via a list call before revoking.
func KeysRevoke(args []string) error {
	fs := flag.NewFlagSet("keys revoke", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "skip the interactive confirmation")
	setLeafUsage(fs, leafHelp{
		Summary: "Revoke an API key by id or prefix.",
		Usage:   "aju keys revoke <id-or-prefix> [--yes]",
		Long:    "Always prints the resolved key (prefix + name) in the confirmation prompt so you can't revoke the wrong one by accident.",
		Examples: []string{
			"aju keys revoke ak_live_12",
			"aju keys revoke ak_live_12 --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju keys revoke <id-or-prefix> [--yes]")
	}
	target := strings.TrimSpace(fs.Arg(0))
	if target == "" {
		return errors.New("id or prefix required")
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	// Always list first so we can (a) resolve prefixes to ids, (b) let the
	// user see exactly what they're about to revoke during the confirm step.
	var list keysListResp
	if err := client.Get("/api/keys", &list); err != nil {
		return printFriendlyErr(err)
	}

	resolved, err := resolveKey(list.Keys, target)
	if err != nil {
		return err
	}

	if resolved.RevokedAt != "" {
		fmt.Printf("Already revoked: %s (%s)\n", resolved.Prefix, resolved.Name)
		return nil
	}

	if !*yes {
		fmt.Printf("Revoke key %s (%s)? [y/N] ", resolved.Prefix, resolved.Name)
		reader := bufio.NewReader(os.Stdin)
		line, _ := reader.ReadString('\n')
		line = strings.ToLower(strings.TrimSpace(line))
		if line != "y" && line != "yes" {
			fmt.Println("Cancelled.")
			return nil
		}
	}

	if err := client.Do("DELETE", "/api/keys/"+resolved.ID, nil, nil); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Revoked %s (%s)\n", resolved.Prefix, resolved.Name)
	return nil
}

// resolveOrgTarget maps `--org <slug-or-id>` (or empty) to an organization
// id the server will accept. Empty means "use the active org"; we fetch
// /api/orgs and pick the activeOrganizationId, falling back to the sole
// membership if only one exists. A non-empty input is matched against
// both id and slug of every org the caller belongs to.
func resolveOrgTarget(client *httpx.Client, orgFlag string) (string, error) {
	var list orgsListResp
	if err := client.Get("/api/orgs", &list); err != nil {
		return "", fmt.Errorf("fetch orgs: %w", err)
	}

	if orgFlag == "" {
		if list.ActiveOrganizationID != "" {
			return list.ActiveOrganizationID, nil
		}
		if len(list.Orgs) == 1 {
			return list.Orgs[0].ID, nil
		}
		slugs := make([]string, 0, len(list.Orgs))
		for _, o := range list.Orgs {
			slugs = append(slugs, o.Slug)
		}
		return "", fmt.Errorf(
			"no active organization — pass --org with one of: %s",
			strings.Join(slugs, ", "),
		)
	}

	for _, o := range list.Orgs {
		if o.ID == orgFlag || o.Slug == orgFlag {
			return o.ID, nil
		}
	}
	slugs := make([]string, 0, len(list.Orgs))
	for _, o := range list.Orgs {
		slugs = append(slugs, o.Slug)
	}
	return "", fmt.Errorf(
		"no org matching %q — your orgs: %s",
		orgFlag,
		strings.Join(slugs, ", "),
	)
}

// resolveKey tries exact id match first, then falls back to prefix match.
// Ambiguous prefixes are rejected so we never revoke the wrong key.
func resolveKey(keys []keySummary, target string) (keySummary, error) {
	// Exact id.
	for _, k := range keys {
		if k.ID == target {
			return k, nil
		}
	}
	// Exact prefix.
	var matches []keySummary
	for _, k := range keys {
		if k.Prefix == target || strings.HasPrefix(k.Prefix, target) {
			matches = append(matches, k)
		}
	}
	if len(matches) == 0 {
		return keySummary{}, fmt.Errorf("no key matching %q", target)
	}
	if len(matches) > 1 {
		return keySummary{}, fmt.Errorf("prefix %q matches %d keys — be more specific or pass the id", target, len(matches))
	}
	return matches[0], nil
}

// parseScopesFlag splits --scopes into a clean list. Empty entries from
// accidental double commas are dropped; duplicates are preserved because the
// server dedupes.
func parseScopesFlag(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		v := strings.ToLower(strings.TrimSpace(p))
		if v == "" {
			continue
		}
		out = append(out, v)
	}
	return out
}

// keyStatus returns a short status word: active | revoked | expired.
func keyStatus(k keySummary) string {
	if k.RevokedAt != "" {
		return "revoked"
	}
	if k.ExpiresAt != "" {
		if t, err := time.Parse(time.RFC3339, k.ExpiresAt); err == nil {
			if !t.After(time.Now()) {
				return "expired"
			}
		}
	}
	return "active"
}

// formatLastUsed is a compact "never" / ISO date / "today" renderer.
func formatLastUsed(s string) string {
	if s == "" {
		return "never"
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		if len(s) >= 10 {
			return s[:10]
		}
		return s
	}
	days := int(time.Since(t).Hours() / 24)
	if days <= 0 {
		return "today"
	}
	if days == 1 {
		return "1d ago"
	}
	if days < 30 {
		return fmt.Sprintf("%dd ago", days)
	}
	return t.Format("2006-01-02")
}

// KeysUpdate reconciles the caller's org memberships against their local
// CLI profiles. For every org that lacks a profile with a key pinned to it,
// we prompt the user to mint one: a new API key bound to that org plus a
// new profile that stores the plaintext. Interactive by default; --yes
// accepts every prompt with default answers.
//
// Typical flow after joining a new org:
//
//	$ aju orgs list
//	...prints an org marked "-" in the key column...
//	$ aju keys update
//	1 org missing a local key:
//	  crewpoint-134ii6 — Crewpoint
//
//	Create a key for Crewpoint (crewpoint-134ii6)? [Y/n]
//	Profile name [crewpoint-134ii6]: crewpoint
//	✓ crewpoint-134ii6 → profile "crewpoint"
//
//	1 created, 0 skipped.
//	Switch with `aju profiles use <name>`.
func KeysUpdate(args []string) error {
	fs := flag.NewFlagSet("keys update", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "skip prompts; create every missing org's key with the org slug as the profile name")
	setLeafUsage(fs, leafHelp{
		Summary: "Reconcile local profiles against org memberships. Mint a key per missing org.",
		Usage:   "aju keys update [--yes]",
		Long: `For every org you're a member of that doesn't have a local profile with a
matching key, this prompts to create one. Typical flow after joining a new
org — it saves you a manual 'aju keys create' + 'aju profiles use' dance.`,
		Examples: []string{
			"aju keys update",
			"aju keys update --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var list orgsListResp
	if err := client.Get("/api/orgs", &list); err != nil {
		return printFriendlyErr(err)
	}

	bindings, err := resolveProfileBindings(client, cfg, &list)
	if err != nil {
		return printFriendlyErr(err)
	}

	var missing []orgSummary
	for _, o := range list.Orgs {
		if _, ok := bindings[o.Slug]; !ok {
			missing = append(missing, o)
		}
	}

	if len(missing) == 0 {
		fmt.Println("All orgs have a local key.")
		return nil
	}

	noun := "org"
	if len(missing) > 1 {
		noun = "orgs"
	}
	fmt.Printf("%d %s missing a local key:\n", len(missing), noun)
	for _, o := range missing {
		fmt.Printf("  %s — %s\n", o.Slug, o.Name)
	}
	fmt.Println()

	reader := bufio.NewReader(os.Stdin)
	created, skipped := 0, 0

	for _, o := range missing {
		if !*yes {
			fmt.Printf("Create a key for %s (%s)? [Y/n] ", o.Name, o.Slug)
			answer, _ := reader.ReadString('\n')
			ans := strings.ToLower(strings.TrimSpace(answer))
			if ans != "" && ans != "y" && ans != "yes" {
				skipped++
				continue
			}
		}

		profileName := o.Slug
		if !*yes {
			fmt.Printf("Profile name [%s]: ", o.Slug)
			answer, _ := reader.ReadString('\n')
			if v := strings.TrimSpace(answer); v != "" {
				profileName = v
			}
		}

		if _, exists := cfg.Profiles[profileName]; exists {
			fmt.Fprintf(os.Stderr,
				"profile %q already exists — skipping. Remove it with `aju profiles remove %s` or re-run with a different name.\n",
				profileName, profileName)
			skipped++
			continue
		}

		body := keysCreateReq{
			Name:           fmt.Sprintf("cli (%s)", o.Slug),
			Scopes:         []string{"read", "write"},
			OrganizationID: o.ID,
		}
		var resp keysCreateResp
		if err := client.Post("/api/keys", body, &resp); err != nil {
			fmt.Fprintf(os.Stderr, "failed to create key for %s: %v\n", o.Slug, err)
			skipped++
			continue
		}
		if resp.Plaintext == "" {
			fmt.Fprintf(os.Stderr, "server returned no plaintext for %s — skipping\n", o.Slug)
			skipped++
			continue
		}

		if cfg.Profiles == nil {
			cfg.Profiles = map[string]*config.Profile{}
		}
		// Carry over the current profile's server URL so cross-org keys
		// point at the same aju host the user already uses.
		cfg.Profiles[profileName] = &config.Profile{
			Server: cfg.Profile().Server,
			Key:    resp.Plaintext,
			Org:    o.Slug,
		}
		if err := config.Save(cfg); err != nil {
			return err
		}
		fmt.Printf("✓ %s → profile %q\n", o.Slug, profileName)
		created++
	}

	fmt.Println()
	fmt.Printf("%d created, %d skipped.\n", created, skipped)
	if created > 0 {
		fmt.Println("Switch with `aju profiles use <name>`.")
	}
	return nil
}
