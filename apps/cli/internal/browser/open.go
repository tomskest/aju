// Package browser opens URLs in the user's default browser.
package browser

import (
	"fmt"
	"os/exec"
	"runtime"
)

// Open tries to open url in the default browser. It returns an error if no
// suitable opener can be found or the command fails.
func Open(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch browser: %w", err)
	}
	// Detach; we don't care about the browser's exit code.
	go func() { _ = cmd.Wait() }()
	return nil
}
