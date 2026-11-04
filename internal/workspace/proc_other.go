//go:build !windows

package workspace

import "os/exec"

// hideConsole does nothing where starting a command opens no console window.
func hideConsole(*exec.Cmd) {}
