package cmd

import (
	"flag"
	"fmt"
	"strings"
)

// leafHelp declares the shape of a single leaf command's help block. Keep
// fields short — this text is the user's entire mental model of the command.
type leafHelp struct {
	// Summary is the one-line description of what the command does. Rendered
	// first, above the usage line.
	Summary string
	// Usage is the full invocation line, positionals and optional flag
	// placeholders included. Must start with `aju ` so the block is
	// copy-pasteable.
	Usage string
	// Long is an optional paragraph (or two) of prose that goes between the
	// usage line and the flags. Use for anything that won't fit in Summary —
	// gotchas, auth context, pipe conventions. Leave empty when the usage
	// line is self-explanatory.
	Long string
	// Examples are rendered under an "Examples:" header, one per line, with a
	// two-space indent. Prefer runnable, self-contained invocations.
	Examples []string
}

// setLeafUsage installs a custom fs.Usage that prints a branded, consistent
// help block whenever the user passes --help / -h / help on a leaf command.
// Keep this the ONLY formatter for leaf help so the shape stays predictable.
//
// fs.Usage is also invoked by the stdlib flag package when the user passes
// an invalid flag; in that case they see the same block, which is fine.
func setLeafUsage(fs *flag.FlagSet, h leafHelp) {
	fs.Usage = func() {
		out := fs.Output()
		if h.Summary != "" {
			fmt.Fprintln(out, h.Summary)
			fmt.Fprintln(out)
		}
		if h.Usage != "" {
			fmt.Fprintln(out, "Usage:")
			fmt.Fprintf(out, "  %s\n", h.Usage)
		}
		if h.Long != "" {
			fmt.Fprintln(out)
			fmt.Fprintln(out, strings.TrimRight(h.Long, "\n"))
		}

		// Only render the Flags section when the command actually defined
		// flags. Otherwise we'd print an empty "Flags:" header, which reads
		// as a bug to anyone scanning the output.
		hasFlags := false
		fs.VisitAll(func(*flag.Flag) { hasFlags = true })
		if hasFlags {
			fmt.Fprintln(out)
			fmt.Fprintln(out, "Flags:")
			fs.PrintDefaults()
		}

		if len(h.Examples) > 0 {
			fmt.Fprintln(out)
			fmt.Fprintln(out, "Examples:")
			for _, ex := range h.Examples {
				fmt.Fprintf(out, "  %s\n", ex)
			}
		}
	}
}
