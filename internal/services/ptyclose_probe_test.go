package services

import (
	"os/exec"
	"testing"
	"time"

	"github.com/charmbracelet/x/xpty"
)

// Temporary probe: measure how long closing a ConPTY takes when a child
// process is still attached to the console after the shell was killed.
func TestProbePtyCloseWithChild(t *testing.T) {
	shell := findWindowsPowerShell()
	if shell == "" {
		t.Skip("no powershell")
	}
	pty, err := xpty.NewPty(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(shell, "-NoLogo")
	cmd.Dir = t.TempDir()
	if err := pty.Start(cmd); err != nil {
		t.Fatal(err)
	}
	go func() {
		buf := make([]byte, 16*1024)
		for {
			if _, err := pty.Read(buf); err != nil {
				return
			}
		}
	}()
	time.Sleep(1500 * time.Millisecond)
	if _, err := pty.Write([]byte("ping -t 127.0.0.1\r")); err != nil {
		t.Fatal(err)
	}
	time.Sleep(3 * time.Second)

	start := time.Now()
	if err := cmd.Process.Kill(); err != nil {
		t.Logf("kill: %v", err)
	}
	t.Logf("kill took %v", time.Since(start))

	start = time.Now()
	err = pty.Close()
	t.Logf("close took %v (err=%v)", time.Since(start), err)
}
