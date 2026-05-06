package cmd

import (
	"bytes"
	_ "embed"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/template"

	"github.com/tomskest/aju/client/cli/internal/config"
	"github.com/tomskest/aju/client/cli/internal/httpx"
)

// skillBodyTemplate is the SKILL.md Go text/template rendered by
// `aju skill install claude`. Source lives in skill_body.md alongside this file —
// edit it there.
//
//go:embed skill_body.md
var skillBodyTemplate string

type skillBrain struct {
	Name          string
	Type          string
	Role          string
	DocumentCount int
}

// skillProfile is one (profile → org → brains) row in the rendered skill.
// Each non-empty local profile holds a key pinned to a single org server-side,
// so the routing table written into SKILL.md can tell Claude exactly which
// `--profile <name>` flag targets which org and which brains live there.
type skillProfile struct {
	Name      string
	OrgName   string
	OrgSlug   string
	OrgType   string // "personal" | "team"
	IsActive  bool
	IsDefault bool
	Brains    []skillBrain
}

type skillContext struct {
	UserName          string
	UserEmail         string
	ActiveBrain       string
	Brains            []skillBrain
	BrainNames        string // comma-joined quoted list for the description
	FirstBrainExample string

	// Multi-profile context. Each entry maps one local profile to its
	// pinned org and the brains visible inside that org. Empty for callers
	// without an authenticated config, in which case the template falls
	// back to the single-brain shape above.
	Profiles       []skillProfile
	ActiveProfile  string
	DefaultProfile string
}

// skillTarget represents one tool aju can register itself with.
// Adding support for a new tool (cursor, cline, continue, …) is
// a matter of appending a new entry to skillTargets below.
type skillTarget struct {
	name    string // command-line identifier (e.g. "claude")
	label   string // human-readable label (e.g. "Claude Code")
	summary string // one-liner for `aju skill list`
	path    func() (string, error)
	render  func(ctx skillContext) (string, error)
}

var skillTargets = map[string]skillTarget{
	"claude": {
		name:    "claude",
		label:   "Claude Code",
		summary: "writes SKILL.md to ~/.claude/skills/aju/",
		path:    claudeSkillPath,
		render:  renderSkillBody,
	},
}

func skillTargetNames() []string {
	names := make([]string, 0, len(skillTargets))
	for k := range skillTargets {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

type skillMeResp struct {
	Identity string `json:"identity,omitempty"`
	Email    string `json:"email,omitempty"`
	Name     string `json:"name,omitempty"`
	UserID   string `json:"userId,omitempty"`
	Role     string `json:"role,omitempty"`
}

// buildSkillContext fetches the caller's identity and accessible brains
// so the skill template can be personalised. Returns sensible defaults if
// the caller isn't authenticated or the server is unreachable.
func buildSkillContext() (skillContext, error) {
	ctx := skillContext{
		UserName:    "you",
		ActiveBrain: "brain",
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return ctx, nil
	}

	var me skillMeResp
	if err := client.Get("/api/auth/me", &me); err == nil {
		switch {
		case me.Name != "":
			ctx.UserName = me.Name
		case me.Email != "":
			if at := strings.IndexByte(me.Email, '@'); at > 0 {
				ctx.UserName = me.Email[:at]
			} else {
				ctx.UserName = me.Email
			}
		}
		ctx.UserEmail = me.Email
	}

	var brains brainsListResp
	if err := client.Get("/api/brains", &brains); err == nil {
		for _, b := range brains.Brains {
			ctx.Brains = append(ctx.Brains, skillBrain{
				Name:          b.Name,
				Type:          b.Type,
				Role:          b.Role,
				DocumentCount: b.DocumentCount,
			})
		}
	}

	if cfg != nil && cfg.Profile().Brain != "" {
		ctx.ActiveBrain = cfg.Profile().Brain
	} else if len(ctx.Brains) > 0 {
		ctx.ActiveBrain = ctx.Brains[0].Name
	}

	if len(ctx.Brains) > 0 {
		quoted := make([]string, 0, len(ctx.Brains))
		for _, b := range ctx.Brains {
			quoted = append(quoted, `"`+b.Name+`"`)
		}
		ctx.BrainNames = strings.Join(quoted, ", ")
		ctx.FirstBrainExample = ctx.Brains[0].Name
	}

	if cfg != nil {
		ctx.ActiveProfile = cfg.Active
		ctx.DefaultProfile = cfg.DefaultProfile
		ctx.Profiles = collectSkillProfiles(cfg)
	}

	return ctx, nil
}

// collectSkillProfiles walks every locally-stored profile with a non-empty
// API key, hits /api/orgs and /api/brains with that key, and returns the
// resolved (profile → org → brains) view used to render the skill's routing
// table. Best-effort: a single profile failing to resolve does not bubble
// up — its row is dropped from the output and other profiles still render.
func collectSkillProfiles(cfg *config.Config) []skillProfile {
	if cfg == nil {
		return nil
	}
	names := cfg.ProfileNames()
	out := make([]skillProfile, 0, len(names))
	for _, name := range names {
		p := cfg.Profiles[name]
		if p == nil || p.Key == "" {
			continue
		}
		server := p.Server
		if server == "" {
			server = config.DefaultServer
		}
		client := httpx.New(server, p.Key)

		sp := skillProfile{
			Name:      name,
			IsActive:  name == cfg.Active,
			IsDefault: name == cfg.DefaultProfile,
		}

		var orgs orgsListResp
		if err := client.Get("/api/orgs", &orgs); err == nil {
			if target := pickPinnedOrg(orgs.Orgs, orgs.ActiveOrganizationID, p.Org); target != nil {
				sp.OrgName = target.Name
				sp.OrgSlug = target.Slug
				sp.OrgType = "team"
				if target.IsPersonal {
					sp.OrgType = "personal"
				}
			}
		}

		var brains brainsListResp
		if err := client.Get("/api/brains", &brains); err == nil {
			for _, b := range brains.Brains {
				sp.Brains = append(sp.Brains, skillBrain{
					Name:          b.Name,
					Type:          b.Type,
					Role:          b.Role,
					DocumentCount: b.DocumentCount,
				})
			}
		}

		out = append(out, sp)
	}
	return out
}

// pickPinnedOrg picks the org a profile binds to. Preference order: the
// profile's locally-recorded slug (set at auto-provision time), then the
// server's active-org cookie (legacy unpinned keys), then the user's
// personal org, then the only org if there is exactly one.
func pickPinnedOrg(orgs []orgSummary, activeID, profileSlug string) *orgSummary {
	if profileSlug != "" {
		for i := range orgs {
			if orgs[i].Slug == profileSlug {
				return &orgs[i]
			}
		}
	}
	if activeID != "" {
		for i := range orgs {
			if orgs[i].ID == activeID {
				return &orgs[i]
			}
		}
	}
	for i := range orgs {
		if orgs[i].IsPersonal {
			return &orgs[i]
		}
	}
	if len(orgs) == 1 {
		return &orgs[0]
	}
	return nil
}

// renderSkillBody executes the embedded template against the given context.
// This is the Claude Code renderer; future targets (cursor, cline, …) can
// provide their own via skillTarget.render.
func renderSkillBody(ctx skillContext) (string, error) {
	tmpl, err := template.New("skill").Parse(skillBodyTemplate)
	if err != nil {
		return "", fmt.Errorf("parse skill template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, ctx); err != nil {
		return "", fmt.Errorf("render skill template: %w", err)
	}
	return buf.String(), nil
}

func claudeSkillPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "skills", "aju", "SKILL.md"), nil
}

// resolveSkillTarget resolves a target name from args, defaulting to "claude"
// for backwards compatibility when no target is given.
func resolveSkillTarget(args []string) (skillTarget, []string, error) {
	name := "claude"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		name = args[0]
		rest = args[1:]
	} else if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "No target specified; defaulting to `claude`. Run `aju skill list` to see supported tools.")
	}
	t, ok := skillTargets[name]
	if !ok {
		return skillTarget{}, nil, fmt.Errorf("unknown skill target %q — run `aju skill list` to see supported tools", name)
	}
	return t, rest, nil
}

// SkillInstall installs the aju skill into a target tool's config directory.
//
//	aju skill install claude          # writes ~/.claude/skills/aju/SKILL.md
//	aju skill install                 # back-compat alias for claude
func SkillInstall(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Install the aju skill into a target tool's config directory.

Usage:
  aju skill install [<tool>] [--force]

Arguments:
  <tool>    supported target (e.g. 'claude'). Defaults to 'claude' when omitted.

Flags:
  --force   overwrite an existing skill file

Examples:
  aju skill install
  aju skill install claude
  aju skill install claude --force
`)
		return nil
	}
	target, rest, err := resolveSkillTarget(args)
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("skill install "+target.name, flag.ContinueOnError)
	force := fs.Bool("force", false, "overwrite an existing skill file")
	if err := parseFlags(fs, rest); err != nil {
		return err
	}

	ctx, _ := buildSkillContext()
	body, err := target.render(ctx)
	if err != nil {
		return err
	}

	path, err := target.path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create skill dir: %w", err)
	}
	if _, err := os.Stat(path); err == nil && !*force {
		fmt.Fprintf(os.Stderr, "Skill already exists at %s. Pass --force to overwrite.\n", path)
		return nil
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return fmt.Errorf("write skill: %w", err)
	}

	fmt.Printf("Installed %s skill at %s\n", target.label, path)
	if ctx.UserEmail == "" {
		fmt.Fprintf(os.Stderr, "Note: not signed in — skill installed with generic placeholders. Run `aju login` then `aju skill install %s --force` to personalise.\n", target.name)
	} else {
		fmt.Printf("Personalised for %s", ctx.UserName)
		if ctx.UserEmail != "" {
			fmt.Printf(" (%s)", ctx.UserEmail)
		}
		fmt.Printf(" · active brain: %s", ctx.ActiveBrain)
		if len(ctx.Brains) > 1 {
			fmt.Printf(" · %d brains total", len(ctx.Brains))
		}
		fmt.Println(".")
		fmt.Printf("Re-run `aju skill install %s --force` after changing brains to refresh.\n", target.name)
	}
	return nil
}

// SkillRemove deletes the installed skill for a target (and empty parent dir).
//
//	aju skill remove claude
//	aju skill remove             # back-compat alias for claude
func SkillRemove(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Remove the installed aju skill from a target tool.

Usage:
  aju skill remove [<tool>]

Arguments:
  <tool>    supported target (e.g. 'claude'). Defaults to 'claude' when omitted.

Examples:
  aju skill remove
  aju skill remove claude
`)
		return nil
	}
	target, _, err := resolveSkillTarget(args)
	if err != nil {
		return err
	}

	path, err := target.path()
	if err != nil {
		return err
	}

	removed := false
	if _, err := os.Stat(path); err == nil {
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("remove skill file: %w", err)
		}
		removed = true
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat skill file: %w", err)
	}

	dir := filepath.Dir(path)
	if entries, err := os.ReadDir(dir); err == nil && len(entries) == 0 {
		_ = os.Remove(dir)
	}

	if removed {
		fmt.Printf("Removed %s skill at %s\n", target.label, path)
	} else {
		fmt.Printf("No %s skill installed.\n", target.label)
	}
	return nil
}

// SkillList prints the tools aju can install a skill into.
func SkillList(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`List all skill targets aju can install into.

Usage:
  aju skill list
`)
		return nil
	}
	fmt.Println("Supported skill targets:")
	for _, name := range skillTargetNames() {
		t := skillTargets[name]
		fmt.Printf("  %-10s  %s — %s\n", t.name, t.label, t.summary)
	}
	fmt.Println()
	fmt.Println("Install: aju skill install <target>")
	fmt.Println("Remove:  aju skill remove <target>")
	return nil
}
