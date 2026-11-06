//go:build windows

package services

import (
	"fmt"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"os/exec"
)

// launchInstaller starts a detached PowerShell helper that waits for MyGit to
// exit and then runs the installer. Starting it from this process directly
// would fail because Windows cannot overwrite the running executable.
func (s *AppService) launchInstaller(path string) error {
	quoted := "'" + strings.ReplaceAll(path, "'", "''") + "'"
	var command string
	if strings.EqualFold(filepath.Ext(path), ".msi") {
		command = fmt.Sprintf(
			"Start-Sleep -Seconds 2; Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i',%s",
			quoted,
		)
	} else {
		command = fmt.Sprintf(
			"Start-Sleep -Seconds 2; Start-Process -FilePath %s",
			quoted,
		)
	}
	helper := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle", "Hidden",
		"-Command", command,
	)
	helper.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x00000008 | 0x00000200, // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
	}
	if err := helper.Start(); err != nil {
		return fmt.Errorf("could not start the installer: %w", err)
	}
	// Give the helper a moment to detach before the process disappears.
	go func() {
		time.Sleep(400 * time.Millisecond)
		s.Quit()
	}()
	return nil
}
