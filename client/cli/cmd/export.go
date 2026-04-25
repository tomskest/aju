package cmd

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

func copyResponse(res *http.Response, dst io.Writer) (int64, error) {
	return io.Copy(dst, res.Body)
}

// Export downloads the full account export JSON from /api/me/export.
// Default output is ./aju-export-<YYYY-MM-DD>.json; override with -o/--output.
func Export(args []string) error {
	fs := flag.NewFlagSet("export", flag.ContinueOnError)
	output := fs.String("output", "", "write export JSON to this path (default ./aju-export-<date>.json)")
	outputShort := fs.String("o", "", "short form of --output")
	setLeafUsage(fs, leafHelp{
		Summary: "Download a portable JSON export of your data.",
		Usage:   "aju export [-o <path>]",
		Long:    "Includes profile, owned brains, all documents (markdown), and file metadata. File binaries aren't inlined — fetch them via 'aju files read <key> --mode content'.",
		Examples: []string{
			"aju export",
			"aju export -o ~/backup/aju-$(date +%Y%m%d).json",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	// Call the export endpoint and capture the raw JSON body — we don't
	// need to unmarshal anything, we just save the bytes to disk verbatim.
	res, err := client.RawGet("/api/me/export")
	if err != nil {
		return printFriendlyErr(err)
	}
	defer res.Body.Close()

	path := *output
	if path == "" {
		path = *outputShort
	}
	if path == "" {
		path = fmt.Sprintf("aju-export-%s.json", time.Now().UTC().Format("2006-01-02"))
	}

	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer f.Close()

	n, err := copyResponse(res, f)
	if err != nil {
		os.Remove(path)
		return fmt.Errorf("write export: %w", err)
	}

	fmt.Printf("Wrote %s (%d bytes).\n", path, n)
	fmt.Println("Includes: profile, owned brains, all documents (markdown), file metadata.")
	fmt.Println("File binaries are not inlined — fetch them with `aju files read <key> --mode content`.")
	return nil
}
