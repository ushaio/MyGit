//go:build !windows

package services

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func configureTerminal(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}
}
func stopTerminal(cmd *exec.Cmd) error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }

// terminalProfiles lists the login shells available on this machine. The
// user's $SHELL comes first and is the default; duplicates are collapsed so
// /bin/bash does not appear twice when $SHELL is bash.
func terminalProfiles() []TerminalProfile {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	candidates := []struct {
		id    string
		label string
		kind  string
		shell string
	}{
		{id: "default", label: "Default shell", kind: "shell", shell: shell},
		{id: "bash", label: "Bash", kind: "bash", shell: "/bin/bash"},
		{id: "zsh", label: "Zsh", kind: "zsh", shell: "/bin/zsh"},
		{id: "fish", label: "fish", kind: "fish", shell: "/usr/bin/fish"},
	}
	profiles := make([]TerminalProfile, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		path := candidate.shell
		if !filepath.IsAbs(path) {
			if resolved, err := exec.LookPath(path); err == nil {
				path = resolved
			}
		}
		if seen[path] {
			continue
		}
		seen[path] = true
		profiles = append(profiles, TerminalProfile{
			ID:        candidate.id,
			Label:     candidate.label,
			Shell:     path,
			Args:      []string{"-l"},
			Detail:    path,
			Kind:      candidate.kind,
			Available: terminalExists(path),
			Default:   candidate.id == "default",
		})
	}
	return profiles
}

func terminalExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
