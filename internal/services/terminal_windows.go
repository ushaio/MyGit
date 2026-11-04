package services

import "os/exec"

func configureTerminal(*exec.Cmd)      {}
func stopTerminal(cmd *exec.Cmd) error { return cmd.Process.Kill() }
