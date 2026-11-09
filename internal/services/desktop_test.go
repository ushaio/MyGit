package services

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestToolAvailableRejectsUnsupportedTools(t *testing.T) {
	s := &DesktopService{}
	for _, tool := range []string{"", "terminal", "unknown", "../code"} {
		if s.ToolAvailable(tool) {
			t.Fatalf("unsupported tool %q is available", tool)
		}
	}
}

func TestWindowsEditorDetection(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows editor installation layout")
	}
	for _, test := range []struct {
		name, tool, relative string
		shim                 bool
	}{
		{"user install outside PATH", "code", "Programs/Microsoft VS Code/Code.exe", false},
		{"system install outside PATH", "code", "Microsoft VS Code/Code.exe", false},
		{"cursor install", "cursor", "Programs/Cursor/Cursor.exe", false},
		{"CLI shim resolves native executable", "code", "Portable Editor/Code.exe", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			for _, key := range []string{"PATH", "LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"} {
				t.Setenv(key, "")
			}
			t.Setenv("LOCALAPPDATA", root)
			s := &DesktopService{}
			if s.ToolAvailable(test.tool) {
				t.Fatal("missing installation reported as available")
			}
			binary := filepath.Join(root, filepath.FromSlash(test.relative))
			if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(binary, []byte("fixture"), 0o644); err != nil {
				t.Fatal(err)
			}
			if test.shim {
				bin := filepath.Join(filepath.Dir(binary), "bin")
				if err := os.MkdirAll(bin, 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(bin, "code.cmd"), []byte("@echo off\r\n"), 0o644); err != nil {
					t.Fatal(err)
				}
				t.Setenv("PATH", bin)
			}
			if got := findEditor(test.tool); got != binary {
				t.Fatalf("findEditor(%q) = %q, want %q", test.tool, got, binary)
			}
			if !s.ToolAvailable(test.tool) {
				t.Fatal("installed editor unavailable")
			}
		})
	}
}
