package cmd

import (
	"flag"
	"fmt"
	"net/url"
	"os"
)

// Validation API response shapes. Match src/app/api/vault/validate/route.ts
// and src/app/api/vault/validation/status/route.ts.

type validationDetail struct {
	Status          string `json:"status"`
	Provenance      string `json:"provenance"`
	ValidatedAt     string `json:"validatedAt,omitempty"`
	ValidatedBy     string `json:"validatedBy,omitempty"`
	ValidatedHash   string `json:"validatedHash,omitempty"`
	DisqualifiedAt  string `json:"disqualifiedAt,omitempty"`
	DisqualifiedBy  string `json:"disqualifiedBy,omitempty"`
}

type validationLogEntry struct {
	ID            string `json:"id"`
	FromStatus    string `json:"fromStatus"`
	ToStatus      string `json:"toStatus"`
	ContentHashAt string `json:"contentHashAt"`
	Source        string `json:"source"`
	ChangedBy     string `json:"changedBy,omitempty"`
	ActorType     string `json:"actorType,omitempty"`
	Reason        string `json:"reason,omitempty"`
	CreatedAt     string `json:"createdAt"`
}

type validationStatusDetailResponse struct {
	ID          string               `json:"id,omitempty"`
	Path        string               `json:"path"`
	ContentHash string               `json:"contentHash,omitempty"`
	Validation  validationDetail     `json:"validation"`
	RecentLog   []validationLogEntry `json:"recentLog"`
}

type validationStatusBrainResponse struct {
	Brain        string `json:"brain"`
	Total        int    `json:"total"`
	Counts       struct {
		Validated    int `json:"validated"`
		Unvalidated  int `json:"unvalidated"`
		Stale        int `json:"stale"`
		Disqualified int `json:"disqualified"`
	} `json:"counts"`
	ByProvenance struct {
		Human    int `json:"human"`
		Agent    int `json:"agent"`
		Ingested int `json:"ingested"`
	} `json:"byProvenance"`
}

// runValidate is the shared implementation for validate / mark-stale /
// disqualify / clear-validation. Each top-level command translates its
// name into a target status and forwards here.
func runValidate(name string, status string, args []string) error {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	reason := fs.String("reason", "", "optional reason recorded in validation history")
	jsonOut := fs.Bool("json", false, "print raw JSON response")
	setLeafUsage(fs, leafHelp{
		Summary: validateUsageSummary(name),
		Usage:   fmt.Sprintf("aju %s <path> [--brain <name>] [--reason <text>] [--json]", name),
		Examples: []string{
			fmt.Sprintf("aju %s topics/ndc-parity.md", name),
			fmt.Sprintf("aju %s topics/ndc-parity.md --reason \"confirmed in design review\"", name),
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return fmt.Errorf("usage: aju %s <path> [--brain <name>] [--reason <text>]", name)
	}
	path := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	body := map[string]any{
		"path":   path,
		"status": status,
		"source": "aju-cli",
	}
	if r := *reason; r != "" {
		body["reason"] = r
	}

	target := "/api/vault/validate"
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		body["brain"] = b
		target += "?brain=" + url.QueryEscape(b)
	}

	var resp map[string]any
	if err := client.PostJSON(target, body, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}
	fmt.Printf("%s %s → %s\n", actionVerb(status), path, status)
	return nil
}

func validateUsageSummary(name string) string {
	switch name {
	case "validate":
		return "Mark a doc as validated — verifies the content as a trustworthy fact."
	case "mark-stale":
		return "Mark a doc as stale — was true once but the source has shifted."
	case "disqualify":
		return "Mark a doc as disqualified — wrong/false; excluded from default search."
	case "clear-validation":
		return "Reset a doc to unvalidated. Drops prior validation/disqualification pointers."
	default:
		return "Set a doc's validation state."
	}
}

func actionVerb(status string) string {
	switch status {
	case "validated":
		return "Validated"
	case "stale":
		return "Marked stale:"
	case "disqualified":
		return "Disqualified"
	case "unvalidated":
		return "Cleared validation on"
	default:
		return "Set"
	}
}

// Validate is `aju validate <path>`.
func Validate(args []string) error {
	return runValidate("validate", "validated", args)
}

// MarkStale is `aju mark-stale <path>`.
func MarkStale(args []string) error {
	return runValidate("mark-stale", "stale", args)
}

// Disqualify is `aju disqualify <path>`.
func Disqualify(args []string) error {
	return runValidate("disqualify", "disqualified", args)
}

// ClearValidation is `aju clear-validation <path>`.
func ClearValidation(args []string) error {
	return runValidate("clear-validation", "unvalidated", args)
}

// DispatchValidation is `aju validation <subcommand>`. Currently only
// `validation status` exists; future entries (e.g. `validation history`)
// plug in here without crowding the top-level CLI.
func DispatchValidation(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		printValidationHelp()
		if len(args) < 1 {
			return ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "status":
		return ValidationStatus(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown validation subcommand: %s\n\n", args[0])
		printValidationHelp()
		return ErrSilent
	}
}

func printValidationHelp() {
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  aju validation status <path>           # one doc + recent history")
	fmt.Fprintln(os.Stderr, "  aju validation status --brain <name>   # brain-wide breakdown")
}

// ValidationStatus is `aju validation status [<path>] [--brain <name>] [--json]`.
//
// With a positional path: per-doc status + recent log entries.
// Without: brain-wide breakdown by status and provenance, used by ops to
// audit how much of a brain has been validated.
func ValidationStatus(args []string) error {
	fs := flag.NewFlagSet("validation status", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "Show validation status for a doc or a brain-wide breakdown.",
		Usage:   "aju validation status [<path>] [--brain <name>] [--json]",
		Examples: []string{
			"aju validation status topics/ndc-parity.md",
			"aju validation status                           # active brain breakdown",
			"aju validation status --brain Acme --json",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	addBrain(params, resolveBrainFlag(*brain, cfg))
	hasPath := fs.NArg() >= 1
	if hasPath {
		params.Set("path", fs.Arg(0))
	}

	if hasPath {
		var resp validationStatusDetailResponse
		if err := client.GetJSON("/api/vault/validation/status", params, &resp); err != nil {
			return printFriendlyErr(err)
		}
		if *jsonOut {
			return printJSON(&resp)
		}
		printValidationDetail(&resp)
		return nil
	}

	var resp validationStatusBrainResponse
	if err := client.GetJSON("/api/vault/validation/status", params, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if *jsonOut {
		return printJSON(&resp)
	}
	printValidationBrainSummary(&resp)
	return nil
}

func printValidationDetail(resp *validationStatusDetailResponse) {
	fmt.Printf("path:        %s\n", resp.Path)
	fmt.Printf("status:      %s\n", resp.Validation.Status)
	fmt.Printf("provenance:  %s\n", resp.Validation.Provenance)
	if resp.Validation.ValidatedAt != "" {
		fmt.Printf("validatedAt: %s", resp.Validation.ValidatedAt)
		if resp.Validation.ValidatedBy != "" {
			fmt.Printf("  by %s", resp.Validation.ValidatedBy)
		}
		fmt.Println()
	}
	if resp.Validation.DisqualifiedAt != "" {
		fmt.Printf("disqualified: %s", resp.Validation.DisqualifiedAt)
		if resp.Validation.DisqualifiedBy != "" {
			fmt.Printf("  by %s", resp.Validation.DisqualifiedBy)
		}
		fmt.Println()
	}
	if resp.ContentHash != "" {
		fmt.Printf("contentHash: %s\n", resp.ContentHash)
	}
	if len(resp.RecentLog) > 0 {
		fmt.Println()
		fmt.Println("recent history:")
		for _, e := range resp.RecentLog {
			line := fmt.Sprintf("  %s  %-12s → %-12s  via %s",
				e.CreatedAt, e.FromStatus, e.ToStatus, e.Source)
			if e.ChangedBy != "" {
				line += "  (" + e.ChangedBy + ")"
			}
			if e.Reason != "" {
				line += "  — " + e.Reason
			}
			fmt.Println(line)
		}
	}
}

func printValidationBrainSummary(resp *validationStatusBrainResponse) {
	fmt.Printf("brain: %s  total: %d\n", resp.Brain, resp.Total)
	fmt.Println("status:")
	fmt.Printf("  validated:    %d\n", resp.Counts.Validated)
	fmt.Printf("  unvalidated:  %d\n", resp.Counts.Unvalidated)
	fmt.Printf("  stale:        %d\n", resp.Counts.Stale)
	fmt.Printf("  disqualified: %d\n", resp.Counts.Disqualified)
	fmt.Println("provenance:")
	fmt.Printf("  human:    %d\n", resp.ByProvenance.Human)
	fmt.Printf("  agent:    %d\n", resp.ByProvenance.Agent)
	fmt.Printf("  ingested: %d\n", resp.ByProvenance.Ingested)
}

