package services

import "testing"

func TestTerminalSessionRoundTrip(t *testing.T) {
	dir := t.TempDir()
	service := NewTerminalService(dir)
	layout := TerminalSessionLayout{
		Tabs: []TerminalSessionState{
			{Project: "C:/projects/alpha", Path: "C:/projects/alpha", Label: "Dev", Profile: "pwsh", Command: "npm run dev"},
			{Project: "C:/projects/beta", Path: "C:/projects/beta"},
		},
		Active: 0,
		Page:   "terminal",
	}
	if err := service.SaveSession(layout); err != nil {
		t.Fatalf("save terminal session: %v", err)
	}
	reloaded, err := NewTerminalService(dir).LastSession()
	if err != nil {
		t.Fatalf("load terminal session: %v", err)
	}
	if len(reloaded.Tabs) != 2 || reloaded.Active != 0 || reloaded.Page != "terminal" {
		t.Fatalf("unexpected reloaded session: %#v", reloaded)
	}
	if reloaded.Tabs[0].Command != "npm run dev" || reloaded.Tabs[1].Project != "C:/projects/beta" {
		t.Fatalf("unexpected reloaded tabs: %#v", reloaded.Tabs)
	}
	if err := service.ClearSession(); err != nil {
		t.Fatalf("clear terminal session: %v", err)
	}
	cleared, err := NewTerminalService(dir).LastSession()
	if err != nil {
		t.Fatalf("load cleared session: %v", err)
	}
	if len(cleared.Tabs) != 0 {
		t.Fatalf("expected a cleared session, got %#v", cleared)
	}
}

func TestTerminalSessionCleanDropsEmptyTabs(t *testing.T) {
	dir := t.TempDir()
	service := NewTerminalService(dir)
	if err := service.SaveSession(TerminalSessionLayout{
		Tabs:   []TerminalSessionState{{Path: "  "}, {Path: " C:/x "}},
		Active: 5,
		Page:   "bogus",
	}); err != nil {
		t.Fatalf("save terminal session: %v", err)
	}
	layout, err := NewTerminalService(dir).LastSession()
	if err != nil {
		t.Fatalf("load terminal session: %v", err)
	}
	if len(layout.Tabs) != 1 || layout.Tabs[0].Path != "C:/x" {
		t.Fatalf("expected the empty tab to be dropped, got %#v", layout.Tabs)
	}
	if layout.Active != -1 || layout.Page != "" {
		t.Fatalf("expected clamped active and empty page, got %#v", layout)
	}
}

func TestTerminalSessionWithoutStore(t *testing.T) {
	service := NewTerminalService("")
	layout, err := service.LastSession()
	if err != nil || len(layout.Tabs) != 0 {
		t.Fatalf("expected an empty in-memory session, got %#v (%v)", layout, err)
	}
	if err := service.SaveSession(TerminalSessionLayout{Tabs: []TerminalSessionState{{Path: "C:/x"}}}); err != nil {
		t.Fatalf("save without a store must be a no-op: %v", err)
	}
}
