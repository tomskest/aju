package cmd

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/tomskest/aju/cli/internal/config"
	"github.com/tomskest/aju/cli/internal/httpx"
)

// orgSummary mirrors a single entry in GET /api/orgs.
type orgSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	IsPersonal  bool   `json:"isPersonal"`
	Role        string `json:"role"`
	MemberCount int    `json:"memberCount"`
	BrainCount  int    `json:"brainCount"`
}

// orgsListResp mirrors GET /api/orgs.
type orgsListResp struct {
	Orgs                 []orgSummary `json:"orgs"`
	ActiveOrganizationID string       `json:"activeOrganizationId"`
}

// orgsCreateResp mirrors POST /api/orgs.
type orgsCreateResp struct {
	Org struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
		Role string `json:"role"`
	} `json:"org"`
}

// orgsSwitchResp mirrors POST /api/orgs/:id/switch.
type orgsSwitchResp struct {
	ActiveOrganizationID string `json:"activeOrganizationId"`
}

// orgMember mirrors a single entry in GET /api/orgs/:id/members.
type orgMember struct {
	UserID     string `json:"userId"`
	Email      string `json:"email"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	InvitedAt  string `json:"invitedAt"`
	AcceptedAt string `json:"acceptedAt"`
}

type orgMembersResp struct {
	Members []orgMember `json:"members"`
}

// orgInvitationResp mirrors POST /api/orgs/:id/invitations.
type orgInvitationResp struct {
	Invitation struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		Role      string `json:"role"`
		ExpiresAt string `json:"expiresAt"`
	} `json:"invitation"`
}

// RunOrgs dispatches the `aju orgs` sub-subcommands.
func RunOrgs(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		HelpOrgs()
		if len(args) < 1 {
			return ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "list":
		return OrgsList(args[1:])
	case "switch":
		return OrgsSwitch(args[1:])
	case "create":
		return OrgsCreate(args[1:])
	case "invite":
		return OrgsInvite(args[1:])
	case "members":
		return OrgsMembers(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown orgs subcommand: %s\n\n", args[0])
		HelpOrgs()
		return ErrSilent
	}
}

// OrgsList prints every org the user belongs to, marking the active one and
// showing which local profile (if any) holds a key that actually resolves
// into each org server-side. When orgs are missing a local key we nudge the
// user toward `aju keys update`.
//
// Columns: marker, slug, name, role, member_count, brain_count, profile|-
func OrgsList(args []string) error {
	fs := flag.NewFlagSet("orgs list", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "List organizations you belong to.",
		Usage:   "aju orgs list",
		Long: `Columns: marker, slug, name, role, members, brains, local-profile.
* marks the active org; the last column shows which local profile's API
key actually resolves into that org. Orgs with no local key get a "-";
fix them with 'aju keys update'.`,
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp orgsListResp
	if err := client.Get("/api/orgs", &resp); err != nil {
		return printFriendlyErr(err)
	}

	if len(resp.Orgs) == 0 {
		fmt.Fprintln(os.Stderr, "No organizations.")
		return nil
	}

	// Source-of-truth binding check: fetch /api/keys, map each local
	// profile's key prefix to its server-side org. Unpinned keys fall back
	// to the personal org (per the server's auth resolution).
	bindings, err := resolveProfileBindings(client, cfg, &resp)
	if err != nil {
		// Don't fail the listing if /api/keys is temporarily unreachable;
		// the binding column just degrades to "?" while the rest renders.
		fmt.Fprintf(os.Stderr, "(could not resolve key bindings: %v)\n", err)
		bindings = map[string]string{}
	}

	missing := 0
	for _, o := range resp.Orgs {
		marker := " "
		if o.ID == resp.ActiveOrganizationID {
			marker = "*"
		}
		keyCol := "-"
		if name, ok := bindings[o.Slug]; ok {
			keyCol = name
		} else {
			missing++
		}
		fmt.Printf("%s\t%s\t%s\t%s\t%d\t%d\t%s\n",
			marker, o.Slug, o.Name, o.Role, o.MemberCount, o.BrainCount, keyCol)
	}

	if missing > 0 {
		noun := "org"
		if missing > 1 {
			noun = "orgs"
		}
		fmt.Fprintf(os.Stderr,
			"\n%d %s without a local key. Run `aju keys update` to mint one per missing org.\n",
			missing, noun)
	}
	return nil
}

// resolveProfileBindings returns a map from org slug to local-profile name
// for every profile whose API key actually resolves into that org
// server-side. Pinned keys use their stored organizationId; unpinned keys
// fall back to the user's personal org (the one flagged isPersonal=true in
// /api/orgs).
//
// This is the source of truth for "can this profile access this org". The
// profile's stored `org` field is display-only and may drift after
// `aju orgs switch`, so we never use it for authz decisions.
func resolveProfileBindings(
	client *httpx.Client,
	cfg *config.Config,
	orgs *orgsListResp,
) (map[string]string, error) {
	var personalSlug string
	idToSlug := map[string]string{}
	for _, o := range orgs.Orgs {
		idToSlug[o.ID] = o.Slug
		if o.IsPersonal {
			personalSlug = o.Slug
		}
	}

	var keys keysListResp
	if err := client.Get("/api/keys", &keys); err != nil {
		return nil, err
	}

	prefixToSlug := map[string]string{}
	for _, k := range keys.Keys {
		if k.RevokedAt != "" {
			continue
		}
		slug := idToSlug[k.OrganizationID] // "" when unpinned
		if slug == "" {
			slug = personalSlug
		}
		if slug != "" {
			prefixToSlug[k.Prefix] = slug
		}
	}

	out := map[string]string{}
	for name, p := range cfg.Profiles {
		if p == nil || p.Key == "" {
			continue
		}
		prefix := p.Key
		if len(prefix) > 12 {
			prefix = prefix[:12]
		}
		slug, ok := prefixToSlug[prefix]
		if !ok {
			continue
		}
		// First profile wins if two profiles share an org; iteration order
		// is arbitrary but at least one annotation row is always correct.
		if _, exists := out[slug]; !exists {
			out[slug] = name
		}
	}
	return out, nil
}

// OrgsSwitch flips the server's active-org cookie to the one matching <slug>.
// For bearer-token callers (the CLI) that cookie is ignored on subsequent
// requests — the API key's server-side binding wins instead. So after the
// server call we verify that the current profile's key actually binds to the
// target org; if not, we warn and refuse to update the display-only local
// pin (which would otherwise lie to `aju orgs list` and friends).
func OrgsSwitch(args []string) error {
	fs := flag.NewFlagSet("orgs switch", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "Switch the server's active-org cookie. Affects web UI; CLI still follows the key.",
		Usage:   "aju orgs switch <slug>",
		Long: `Bearer-token CLI calls resolve against the key's pinned org, not the
server cookie. If the current profile's key doesn't bind to <slug>, the
command warns and points you at the right profile or 'aju keys update'.`,
		Examples: []string{
			"aju orgs switch crewpoint",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju orgs switch <slug>")
	}
	slug := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var list orgsListResp
	if err := client.Get("/api/orgs", &list); err != nil {
		return printFriendlyErr(err)
	}
	id := findOrgIDBySlug(list.Orgs, slug)
	if id == "" {
		return fmt.Errorf("no organization with slug %q", slug)
	}

	var resp orgsSwitchResp
	if err := client.Post("/api/orgs/"+id+"/switch", map[string]any{}, &resp); err != nil {
		return printFriendlyErr(err)
	}

	// Figure out whether the *current profile's key* actually binds into
	// the target org. If yes, mirror the slug locally. If no, explain and
	// leave the local pin alone so the user isn't lied to later.
	bindings, err := resolveProfileBindings(client, cfg, &list)
	if err != nil {
		return printFriendlyErr(err)
	}
	activeProfile := cfg.Active
	if boundProfile, ok := bindings[slug]; ok && boundProfile == activeProfile {
		cfg.Profile().Org = slug
		if err := config.Save(cfg); err != nil {
			return err
		}
		fmt.Printf("Switched to %s\n", slug)
		return nil
	}

	fmt.Printf("Server session switched to %s (affects web UI only).\n", slug)
	fmt.Fprintln(os.Stderr,
		"\nYour current CLI key is not bound to this org, so `aju <vault-op>` calls will still resolve to the key's original org.")
	if otherProfile, ok := bindings[slug]; ok {
		fmt.Fprintf(os.Stderr,
			"A different profile (%q) has a key for %s. Switch to it:\n  aju profiles use %s\n",
			otherProfile, slug, otherProfile)
	} else {
		fmt.Fprintf(os.Stderr,
			"No local profile has a key for %s. Mint one with:\n  aju keys update\n",
			slug)
	}
	return nil
}

// OrgsCreate provisions a new org and auto-switches into it.
func OrgsCreate(args []string) error {
	fs := flag.NewFlagSet("orgs create", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary:  "Create a new organization and auto-switch into it.",
		Usage:    "aju orgs create <name>",
		Examples: []string{"aju orgs create \"Crewpoint\""},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju orgs create <name>")
	}
	name := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp orgsCreateResp
	if err := client.Post("/api/orgs", map[string]any{"name": name}, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if resp.Org.ID == "" {
		return fmt.Errorf("server returned empty org id")
	}
	fmt.Printf("Created %s\n", resp.Org.Slug)

	// Auto-switch. Failure here shouldn't lose the created-message — surface
	// it, but keep the exit code so the caller knows something went wrong.
	var sw orgsSwitchResp
	if err := client.Post("/api/orgs/"+resp.Org.ID+"/switch", map[string]any{}, &sw); err != nil {
		return printFriendlyErr(err)
	}

	cfg.Profile().Org = resp.Org.Slug
	if err := config.Save(cfg); err != nil {
		return err
	}
	return nil
}

// OrgsInvite sends an invitation email for the active org.
func OrgsInvite(args []string) error {
	fs := flag.NewFlagSet("orgs invite", flag.ContinueOnError)
	role := fs.String("role", "member", "invitation role: member|admin|owner")
	setLeafUsage(fs, leafHelp{
		Summary: "Send an email invitation to join the active organization.",
		Usage:   "aju orgs invite <email> [--role member|admin|owner]",
		Examples: []string{
			"aju orgs invite alex@example.com",
			"aju orgs invite alex@example.com --role admin",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju orgs invite <email> [--role member|admin|owner]")
	}
	email := fs.Arg(0)
	if *role != "member" && *role != "admin" && *role != "owner" {
		return fmt.Errorf("invalid --role %q (expected member, admin, or owner)", *role)
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	id, err := activeOrgID(client)
	if err != nil {
		return err
	}

	var resp orgInvitationResp
	body := map[string]any{"email": email, "role": *role}
	if err := client.Post("/api/orgs/"+id+"/invitations", body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Invitation sent to %s\n", email)
	return nil
}

// OrgsMembers prints the member list for the active org.
func OrgsMembers(args []string) error {
	fs := flag.NewFlagSet("orgs members", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "List members of the active organization.",
		Usage:   "aju orgs members",
		Long:    "Columns: email, role, joined-date (pending invites shown as 'YYYY-MM-DD (pending)').",
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	id, err := activeOrgID(client)
	if err != nil {
		return err
	}

	var resp orgMembersResp
	if err := client.Get("/api/orgs/"+id+"/members", &resp); err != nil {
		return printFriendlyErr(err)
	}
	if len(resp.Members) == 0 {
		fmt.Fprintln(os.Stderr, "No members.")
		return nil
	}
	for _, m := range resp.Members {
		fmt.Printf("%s\t%s\t%s\n", m.Email, m.Role, formatJoined(m.AcceptedAt, m.InvitedAt))
	}
	return nil
}

// activeOrgID resolves the active organization id by calling /api/orgs.
// Returns a friendly error when the user has no active org selected yet.
func activeOrgID(client *httpx.Client) (string, error) {
	var list orgsListResp
	if err := client.Get("/api/orgs", &list); err != nil {
		return "", printFriendlyErr(err)
	}
	if list.ActiveOrganizationID == "" {
		return "", errors.New("no active organization — run `aju orgs switch <slug>`")
	}
	return list.ActiveOrganizationID, nil
}

// findOrgIDBySlug does a linear scan — org lists are small, so a map is overkill.
func findOrgIDBySlug(orgs []orgSummary, slug string) string {
	for _, o := range orgs {
		if o.Slug == slug {
			return o.ID
		}
	}
	return ""
}

// formatJoined prefers acceptedAt (real join) and falls back to invitedAt
// (pending) so the "joined" column is always populated. Dates arrive as ISO-8601.
func formatJoined(acceptedAt, invitedAt string) string {
	if acceptedAt != "" {
		return shortDate(acceptedAt)
	}
	if invitedAt != "" {
		return shortDate(invitedAt) + " (pending)"
	}
	return ""
}

// shortDate trims an ISO-8601 timestamp to YYYY-MM-DD. Falls back to the input
// on parse failure so we never lose information to overzealous formatting.
func shortDate(s string) string {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		if len(s) >= 10 {
			return s[:10]
		}
		return s
	}
	return t.Format("2006-01-02")
}
