//go:build !windows

package gitrepo

import "os/exec"

func hideConsole(*exec.Cmd) {}
