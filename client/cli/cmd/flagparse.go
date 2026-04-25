package cmd

import (
	"errors"
	"flag"
	"strings"
)

// parseFlags wraps flag.FlagSet.Parse with intermixed-flag support.
//
// Go's stdlib flag package treats the first non-flag token as the start of
// positional arguments and ignores any flag tokens that follow. GNU getopt
// users expect `cmd <pos> --flag val` to work the same as `cmd --flag val
// <pos>`. We preserve that expectation by pre-shuffling every flag token
// (and its value, for non-boolean flags) ahead of the positionals, then
// handing the cleaned slice to the underlying Parse.
//
// `--help` / `-h` is translated into ErrSilent: fs.Usage has already printed
// the rich help block (via setLeafUsage), so main.exitWith must stay quiet.
//
// Why not pflag or Cobra: single dependency-free binary is a hard
// requirement for `curl install.aju.sh | sh`. A 30-line reorderer beats a
// 100k-line flag library for a CLI this size.
func parseFlags(fs *flag.FlagSet, args []string) error {
	err := fs.Parse(reorderFlags(fs, args))
	if errors.Is(err, flag.ErrHelp) {
		return ErrHelpHandled
	}
	return err
}

// isHelpArg reports whether a single token is a help request. Used by
// subcommand dispatchers (which don't own a FlagSet) and by the handful of
// leaf commands that parse args by hand instead of via flag.FlagSet.
func isHelpArg(s string) bool {
	return s == "help" || s == "--help" || s == "-h" || s == "-help"
}

// anyHelpArg reports whether any token in args is a help request. Useful for
// early exit inside leaf handlers that would otherwise fail on missing
// positionals before the user ever sees the help block.
func anyHelpArg(args []string) bool {
	for _, a := range args {
		if isHelpArg(a) {
			return true
		}
	}
	return false
}

// reorderFlags separates args into (flags, positionals) and returns them
// concatenated as flags-first. Handles:
//   - `--foo=bar` / `-foo=bar` — value embedded, single token.
//   - `--foo bar` / `-foo bar` — two tokens; the second is consumed as
//     the value UNLESS --foo is a boolean flag in fs.
//   - `--` — everything after is forced-positional, even if it starts with
//     a dash (POSIX convention).
func reorderFlags(fs *flag.FlagSet, args []string) []string {
	bools := boolFlagNames(fs)

	var flags, positional []string
	for i := 0; i < len(args); i++ {
		a := args[i]

		// POSIX end-of-flags sentinel.
		if a == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}

		// A bare "-" is a positional (commonly stdin).
		if a == "-" || !strings.HasPrefix(a, "-") {
			positional = append(positional, a)
			continue
		}

		flags = append(flags, a)

		// -foo=value: value is already packed in; nothing to consume next.
		if strings.Contains(a, "=") {
			continue
		}

		// Boolean flags never consume the next token.
		name := strings.TrimLeft(a, "-")
		if bools[name] {
			continue
		}

		// Non-boolean flag: the next token is its value, if present.
		if i+1 < len(args) {
			flags = append(flags, args[i+1])
			i++
		}
	}

	return append(flags, positional...)
}

// boolFlagNames returns the set of boolean flag names registered on fs.
// Boolean flags implement the IsBoolFlag() bool method on their Value, the
// same interface flag.Parse uses internally to decide whether a flag
// consumes the next token.
func boolFlagNames(fs *flag.FlagSet) map[string]bool {
	out := map[string]bool{}
	fs.VisitAll(func(f *flag.Flag) {
		if bf, ok := f.Value.(interface{ IsBoolFlag() bool }); ok && bf.IsBoolFlag() {
			out[f.Name] = true
		}
	})
	return out
}
