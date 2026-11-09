package services

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

func configureTerminal(cmd *exec.Cmd, profile TerminalProfile) error {
	if profile.Kind == "wsl" {
		path, err := filepath.Abs(cmd.Dir)
		if err != nil {
			return fmt.Errorf("resolve WSL terminal directory: %w", err)
		}
		// Let WSL translate the Windows path using the distribution's own mount
		// configuration. A separate argument also preserves spaces and shell syntax.
		cmd.Args = append(cmd.Args, "--cd", path)
		cmd.Dir = path
	}
	return nil
}

func stopTerminal(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	kill := exec.CommandContext(ctx, "taskkill.exe", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F")
	hideConsole(kill)
	if err := kill.Run(); err == nil {
		return nil
	}
	// If taskkill is unavailable or cannot terminate the tree, still stop the
	// shell. Its waiter closes the PTY off the UI thread after the shell exits.
	if err := cmd.Process.Kill(); err != nil {
		return err
	}
	return errors.New("taskkill failed to terminate the terminal process tree")
}

// terminalProfiles lists the shells commonly installed on Windows in the order
// the sidebar shows them. Missing shells stay in the list so the UI can show
// them disabled instead of hiding a familiar option.
func terminalProfiles() []TerminalProfile {
	specs := []struct {
		id    string
		label string
		kind  string
		args  []string
		find  func() string
	}{
		{id: "cmd", label: "Command Prompt", kind: "cmd", find: findCommandPrompt},
		{id: "powershell", label: "Windows PowerShell", kind: "powershell", args: []string{"-NoLogo"}, find: findWindowsPowerShell},
		{id: "pwsh", label: "PowerShell 7", kind: "pwsh", args: []string{"-NoLogo"}, find: findPowerShell7},
		{id: "gitbash", label: "Git Bash", kind: "bash", args: []string{"--login", "-i"}, find: findGitBash},
		{id: "wsl", label: "WSL", kind: "wsl", find: findWSL},
	}
	profiles := make([]TerminalProfile, 0, len(specs))
	for _, spec := range specs {
		shell := spec.find()
		profiles = append(profiles, TerminalProfile{
			ID:        spec.id,
			Label:     spec.label,
			Shell:     shell,
			Args:      spec.args,
			Detail:    shell,
			Kind:      spec.kind,
			Available: shell != "",
			Default:   spec.id == "powershell",
		})
	}
	return profiles
}

func executable(names ...string) string {
	for _, name := range names {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	return ""
}

func firstExisting(paths ...string) string {
	for _, path := range paths {
		if path == "" {
			continue
		}
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

func findCommandPrompt() string {
	if path := firstExisting(os.Getenv("COMSPEC")); path != "" {
		return path
	}
	if path := executable("cmd.exe"); path != "" {
		return path
	}
	return firstExisting(filepath.Join(os.Getenv("SystemRoot"), "System32", "cmd.exe"))
}

func findWindowsPowerShell() string {
	if path := executable("powershell.exe"); path != "" {
		return path
	}
	return firstExisting(filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
}

func findPowerShell7() string {
	if path := executable("pwsh.exe"); path != "" {
		return path
	}
	roots := []string{os.Getenv("ProgramW6432"), os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")}
	paths := make([]string, 0, len(roots))
	seen := map[string]bool{}
	for _, root := range roots {
		if root == "" || seen[root] {
			continue
		}
		seen[root] = true
		paths = append(paths, filepath.Join(root, "PowerShell", "7", "pwsh.exe"))
	}
	return firstExisting(paths...)
}

func findGitBash() string {
	candidates := make([]string, 0, 6)
	if git := executable("git.exe", "git"); git != "" {
		root := filepath.Dir(filepath.Dir(git))
		candidates = append(candidates,
			filepath.Join(root, "bin", "bash.exe"),
			filepath.Join(root, "usr", "bin", "bash.exe"),
		)
	}
	for _, root := range []string{os.Getenv("ProgramW6432"), os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if root == "" {
			continue
		}
		candidates = append(candidates, filepath.Join(root, "Git", "bin", "bash.exe"))
	}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		candidates = append(candidates, filepath.Join(local, "Programs", "Git", "bin", "bash.exe"))
	}
	return firstExisting(candidates...)
}

func findWSL() string {
	shell := executable("wsl.exe")
	if shell == "" {
		return ""
	}
	// Windows can ship wsl.exe without any usable distribution. Listing does
	// not boot a distribution or trigger first-run setup, and must not hang UI.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, shell, "--list", "--quiet")
	hideConsole(cmd)
	if !hasWSLDistributions(cmd.Output()) {
		return ""
	}
	return shell
}

func hasWSLDistributions(output []byte, err error) bool {
	if err != nil {
		return false
	}
	// Redirected wsl.exe output is normally UTF-16LE (often without a BOM).
	// Also accept UTF-8 for versions that emit it.
	text := string(output)
	if bytes.Contains(output, []byte{0}) || bytes.HasPrefix(output, []byte{0xff, 0xfe}) {
		units := make([]uint16, len(output)/2)
		for index := range units {
			units[index] = binary.LittleEndian.Uint16(output[index*2:])
		}
		text = string(utf16.Decode(units))
	}
	return strings.TrimSpace(strings.TrimPrefix(text, "\ufeff")) != ""
}
