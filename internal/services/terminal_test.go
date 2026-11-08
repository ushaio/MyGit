package services

import (
	"runtime"
	"testing"
	"time"
)

func TestCloseKillsWindowsTerminalProcessTree(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows ConPTY process-tree behavior")
	}
	service := NewTerminalService("")
	id, err := service.Start(t.TempDir(), 80, 24, "powershell")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Write(id, "ping -t 127.0.0.1\r"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1500 * time.Millisecond)

	start := time.Now()
	if err := service.Close(id); err != nil {
		t.Fatalf("close terminal: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("close took too long with an attached child process: %v", elapsed)
	}
}

func TestTerminalProfilesHaveOneAvailableDefault(t *testing.T) {
	profiles := NewTerminalService("").Profiles()
	if len(profiles) == 0 {
		t.Fatal("expected at least one terminal profile")
	}
	seen := map[string]bool{}
	defaults := 0
	for _, profile := range profiles {
		t.Logf("%s (%s) available=%v default=%v shell=%q", profile.ID, profile.Label, profile.Available, profile.Default, profile.Shell)
		if profile.ID == "" || profile.Label == "" {
			t.Fatalf("terminal profile is missing id or label: %#v", profile)
		}
		if seen[profile.ID] {
			t.Fatalf("duplicate terminal profile %q", profile.ID)
		}
		seen[profile.ID] = true
		if profile.Available && profile.Shell == "" {
			t.Fatalf("available profile %q has no shell", profile.ID)
		}
		if profile.Default {
			defaults++
			if !profile.Available {
				t.Fatalf("default profile %q is not available", profile.ID)
			}
		}
	}
	if defaults != 1 {
		t.Fatalf("expected exactly one default profile, got %d", defaults)
	}
}

func TestStartRejectsUnknownTerminalProfile(t *testing.T) {
	service := NewTerminalService("")
	if _, err := service.Start(t.TempDir(), 80, 24, "no-such-shell"); err == nil {
		t.Fatal("expected unknown terminal profile to fail")
	}
}

func TestTerminalCommandsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	project := "C:/projects/alpha"
	service := NewTerminalService(dir)
	stored, err := service.SaveCommands(project, []TerminalCommand{
		{Label: "  Dev server  ", Command: " npm run dev ", Profile: "gitbash", Path: "  C:/tmp/build  "},
		{Label: "Status", Command: "git status", Profile: ""},
	})
	if err != nil {
		t.Fatalf("save terminal commands: %v", err)
	}
	if len(stored) != 2 || stored[0].ID == "" || stored[0].Label != "Dev server" || stored[0].Command != "npm run dev" {
		t.Fatalf("unexpected normalised commands: %#v", stored)
	}
	if stored[0].Path != "C:/tmp/build" || stored[1].Path != "" {
		t.Fatalf("expected working directory to be trimmed and optional, got %#v", stored)
	}
	reloaded, err := NewTerminalService(dir).Commands(project)
	if err != nil {
		t.Fatalf("load terminal commands: %v", err)
	}
	if len(reloaded) != 2 || reloaded[0].ID != stored[0].ID || reloaded[1].Profile != "" || reloaded[0].Path != "C:/tmp/build" {
		t.Fatalf("unexpected reloaded commands: %#v", reloaded)
	}
	// Another project starts empty: commands are bound to their project.
	other, err := NewTerminalService(dir).Commands("C:/projects/beta")
	if err != nil {
		t.Fatalf("load other project commands: %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("expected no commands for another project, got %#v", other)
	}
}

func TestTerminalCommandsRejectEmptyFields(t *testing.T) {
	service := NewTerminalService("")
	if _, err := service.SaveCommands("C:/projects/alpha", []TerminalCommand{{Label: "", Command: "git status"}}); err == nil {
		t.Fatal("expected an empty label to be rejected")
	}
	if _, err := service.SaveCommands("C:/projects/alpha", []TerminalCommand{{Label: "Status", Command: "  "}}); err == nil {
		t.Fatal("expected an empty command to be rejected")
	}
	if _, err := service.SaveCommands("C:/projects/alpha", []TerminalCommand{{Label: "Status", Command: "git status", Profile: "no-such-shell"}}); err == nil {
		t.Fatal("expected an unknown shell to be rejected")
	}
	if _, err := service.SaveCommands("", []TerminalCommand{{Label: "Status", Command: "git status"}}); err == nil {
		t.Fatal("expected a missing project to be rejected")
	}
}

func TestTerminalCommandsWithoutStoreStayInMemory(t *testing.T) {
	project := "C:/projects/alpha"
	service := NewTerminalService("")
	if _, err := service.SaveCommands(project, []TerminalCommand{{Label: "Status", Command: "git status"}}); err != nil {
		t.Fatalf("save in-memory commands: %v", err)
	}
	commands, err := service.Commands(project)
	if err != nil || len(commands) != 1 {
		t.Fatalf("expected one in-memory command, got %#v (%v)", commands, err)
	}
}

func TestTerminalCommonCommandsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	service := NewTerminalService(dir)
	stored, err := service.SaveCommonCommands([]TerminalCommand{
		{Label: "  Log  ", Command: " git log --oneline ", Path: " "},
	})
	if err != nil {
		t.Fatalf("save common commands: %v", err)
	}
	if len(stored) != 1 || stored[0].ID == "" || stored[0].Label != "Log" || stored[0].Path != "" {
		t.Fatalf("unexpected normalised common commands: %#v", stored)
	}
	reloaded, err := NewTerminalService(dir).CommonCommands()
	if err != nil {
		t.Fatalf("load common commands: %v", err)
	}
	if len(reloaded) != 1 || reloaded[0].ID != stored[0].ID {
		t.Fatalf("unexpected reloaded common commands: %#v", reloaded)
	}
	// General commands are not tied to a project: another project sees them too.
	other, err := NewTerminalService(dir).Commands("C:/projects/beta")
	if err != nil {
		t.Fatalf("load project commands: %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("expected the project list to stay empty, got %#v", other)
	}
}

func TestMoveTerminalCommandBetweenLists(t *testing.T) {
	dir := t.TempDir()
	project := "C:/projects/alpha"
	service := NewTerminalService(dir)
	saved, err := service.SaveCommands(project, []TerminalCommand{{Label: "Dev", Command: "npm run dev"}})
	if err != nil {
		t.Fatalf("save project commands: %v", err)
	}
	id := saved[0].ID

	lists, err := service.MoveCommand(project, id, true)
	if err != nil {
		t.Fatalf("move command to common: %v", err)
	}
	if len(lists.Project) != 0 || len(lists.Common) != 1 || lists.Common[0].ID != id {
		t.Fatalf("unexpected lists after moving to common: %#v", lists)
	}
	// The move is persisted for every project, not just this one.
	reloaded, err := NewTerminalService(dir).CommonCommands()
	if err != nil || len(reloaded) != 1 || reloaded[0].ID != id {
		t.Fatalf("expected the command in the persisted common list, got %#v (%v)", reloaded, err)
	}
	if project, err := NewTerminalService(dir).Commands(project); err != nil || len(project) != 0 {
		t.Fatalf("expected the persisted project list to be empty, got %#v (%v)", project, err)
	}

	lists, err = service.MoveCommand(project, id, false)
	if err != nil {
		t.Fatalf("move command back to project: %v", err)
	}
	if len(lists.Common) != 0 || len(lists.Project) != 1 || lists.Project[0].ID != id {
		t.Fatalf("unexpected lists after moving back: %#v", lists)
	}
}

func TestMoveTerminalCommandRejectsUnknown(t *testing.T) {
	service := NewTerminalService("")
	project := "C:/projects/alpha"
	if _, err := service.SaveCommands(project, []TerminalCommand{{Label: "Dev", Command: "npm run dev"}}); err != nil {
		t.Fatalf("save project commands: %v", err)
	}
	if _, err := service.MoveCommand(project, "missing", true); err == nil {
		t.Fatal("expected an unknown command id to be rejected")
	}
	if _, err := service.MoveCommand("", "missing", true); err == nil {
		t.Fatal("expected a missing project to be rejected")
	}
}

func TestMoveTerminalCommandWithoutStoreStaysInMemory(t *testing.T) {
	service := NewTerminalService("")
	project := "C:/projects/alpha"
	saved, err := service.SaveCommands(project, []TerminalCommand{{Label: "Dev", Command: "npm run dev"}})
	if err != nil {
		t.Fatalf("save project commands: %v", err)
	}
	if _, err := service.MoveCommand(project, saved[0].ID, true); err != nil {
		t.Fatalf("move in-memory command: %v", err)
	}
	common, err := service.CommonCommands()
	if err != nil || len(common) != 1 {
		t.Fatalf("expected one in-memory common command, got %#v (%v)", common, err)
	}
	projectList, err := service.Commands(project)
	if err != nil || len(projectList) != 0 {
		t.Fatalf("expected the in-memory project list to be empty, got %#v (%v)", projectList, err)
	}
}

func TestStartLaunchesDefaultTerminalShell(t *testing.T) {
	service := NewTerminalService("")
	ready := false
	for _, profile := range service.Profiles() {
		if profile.Default && profile.Available {
			ready = true
		}
	}
	if !ready {
		t.Skip("no terminal shell is installed")
	}
	id, err := service.Start(t.TempDir(), 80, 24, "")
	if err != nil {
		t.Fatalf("start default shell: %v", err)
	}
	defer service.Close(id)
	deadline := time.Now().Add(10 * time.Second)
	for {
		output, err := service.Read(id, 0)
		if err != nil {
			t.Fatalf("read terminal output: %v", err)
		}
		if output.Data != "" || output.Closed {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("default shell produced no output within 10s")
		}
		time.Sleep(100 * time.Millisecond)
	}
}
