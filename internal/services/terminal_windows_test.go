package services

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

func TestHasWSLDistributions(t *testing.T) {
	utf16LE := func(text string) []byte {
		units := utf16.Encode([]rune(text))
		output := make([]byte, len(units)*2)
		for index, unit := range units {
			binary.LittleEndian.PutUint16(output[index*2:], unit)
		}
		return output
	}
	for _, test := range []struct {
		name   string
		output []byte
		err    error
		want   bool
	}{
		{name: "UTF-16LE without BOM", output: utf16LE("Ubuntu-22.04\r\n"), want: true},
		{name: "UTF-16LE with BOM", output: utf16LE("\ufeffUbuntu\r\nDebian\r\n"), want: true},
		{name: "Unicode distribution", output: utf16LE("开发环境\r\n"), want: true},
		{name: "UTF-8", output: []byte("Ubuntu\r\n"), want: true},
		{name: "UTF-8 with BOM", output: []byte("\ufeffUbuntu\n"), want: true},
		{name: "empty"},
		{name: "whitespace", output: []byte(" \r\n\t")},
		{name: "empty UTF-16LE", output: utf16LE("\r\n")},
		{name: "UTF-16LE BOM only", output: utf16LE("\ufeff")},
		{name: "no distributions error", output: utf16LE("No installed distributions"), err: errors.New("exit status 1")},
		{name: "failed probe with output", output: utf16LE("Ubuntu\r\n"), err: context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := hasWSLDistributions(test.output, test.err); got != test.want {
				t.Fatalf("hasWSLDistributions() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestConfigureWSLTerminalDirectory(t *testing.T) {
	for _, path := range []string{
		`D:\projects\项目 with spaces & $(echo test)'`,
		`\\wsl.localhost\Ubuntu\home\user\project`,
		".",
	} {
		t.Run(path, func(t *testing.T) {
			profile := TerminalProfile{Shell: "wsl.exe", Kind: "wsl"}
			cmd := exec.Command(profile.Shell, profile.Args...)
			cmd.Dir = path
			if err := configureTerminal(cmd, profile); err != nil {
				t.Fatal(err)
			}
			absolute, err := filepath.Abs(path)
			if err != nil {
				t.Fatal(err)
			}
			if want := []string{"wsl.exe", "--cd", absolute}; !reflect.DeepEqual(cmd.Args, want) {
				t.Fatalf("WSL arguments = %#v, want %#v", cmd.Args, want)
			}
			if cmd.Dir != absolute {
				t.Fatalf("WSL working directory = %q, want %q", cmd.Dir, absolute)
			}
		})
	}
}

func TestConfigureWindowsTerminalPreservesOtherShells(t *testing.T) {
	for _, kind := range []string{"cmd", "powershell", "pwsh", "bash"} {
		t.Run(kind, func(t *testing.T) {
			profile := TerminalProfile{Shell: kind + ".exe", Kind: kind, Args: []string{"original-argument"}}
			cmd := exec.Command(profile.Shell, profile.Args...)
			cmd.Dir = `D:\projects\example`
			before := append([]string(nil), cmd.Args...)
			if err := configureTerminal(cmd, profile); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(cmd.Args, before) || cmd.Dir != `D:\projects\example` {
				t.Fatalf("unexpected shell command change: %#v in %q", cmd.Args, cmd.Dir)
			}
		})
	}
}

func TestWSLTerminalCommandRoundTrip(t *testing.T) {
	service := NewTerminalService(t.TempDir())
	project := `D:\projects\example`
	command := TerminalCommand{Label: "Linux status", Command: "git status", Profile: "wsl", Path: `D:\projects\another folder`}
	if _, err := service.SaveCommands(project, []TerminalCommand{command}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveCommonCommands([]TerminalCommand{command}); err != nil {
		t.Fatal(err)
	}
	projectCommands, err := service.Commands(project)
	if err != nil {
		t.Fatal(err)
	}
	commonCommands, err := service.CommonCommands()
	if err != nil {
		t.Fatal(err)
	}
	for _, commands := range [][]TerminalCommand{projectCommands, commonCommands} {
		if len(commands) != 1 || commands[0].Profile != "wsl" || commands[0].Path != command.Path || commands[0].Command != command.Command {
			t.Fatalf("WSL shortcut was not preserved: %#v", commands)
		}
	}
}

func TestStartWSLInShortcutDirectory(t *testing.T) {
	shell := findWSL()
	if shell == "" {
		t.Skip("no installed WSL distribution")
	}
	path := filepath.Join(t.TempDir(), "WSL 项目 & shortcut's")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	probe := exec.CommandContext(ctx, shell, "--cd", path, "--exec", "pwd")
	hideConsole(probe)
	output, err := probe.Output()
	if err != nil {
		t.Fatalf("resolve WSL directory: %v", err)
	}
	want := "__MYGIT_WSL_CWD__" + strings.TrimSpace(string(output))
	service := NewTerminalService("")
	commands, err := service.SaveCommands(path, []TerminalCommand{{
		Label: "Show Linux directory", Profile: "wsl", Path: path,
		Command: `printf '__MYGIT_WSL_CWD__%s\n' "$PWD"`,
	}})
	if err != nil {
		t.Fatal(err)
	}
	shortcut := commands[0]
	id, err := service.Start(shortcut.Path, 120, 30, shortcut.Profile)
	if err != nil {
		t.Fatalf("start WSL terminal: %v", err)
	}
	defer service.Close(id)
	// The UI writes a shortcut immediately after Start returns, before waiting
	// for a prompt. Exercise that same flow while the Linux shell starts.
	if err := service.Write(id, shortcut.Command+"\r"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		output, err := service.Read(id, 0)
		if err != nil {
			t.Fatal(err)
		}
		data, err := base64.StdEncoding.DecodeString(output.Data)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), want) {
			return
		}
		if output.Closed || time.Now().After(deadline) {
			t.Fatalf("WSL shortcut did not print %q; closed=%v, output=%q", want, output.Closed, data)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
