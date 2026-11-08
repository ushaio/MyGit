//go:build windows

package services

import (
	"os/exec"
	"testing"
)

func TestHideConsolePreventsConsoleWindow(t *testing.T) {
	cmd := exec.Command("taskkill.exe")
	hideConsole(cmd)

	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow was not enabled")
	}
	const createNoWindow = 0x08000000
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatal("CREATE_NO_WINDOW was not enabled")
	}
}
