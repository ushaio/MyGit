package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// TerminalSessionState is one terminal tab remembered across launches: where it
// ran, which shell it used and the command it was started with.
type TerminalSessionState struct {
	Project string `json:"Project,omitempty"`
	Path    string `json:"Path"`
	Label   string `json:"Label,omitempty"`
	Profile string `json:"Profile,omitempty"`
	Command string `json:"Command,omitempty"`
}

// TerminalSessionLayout is the set of terminals that were open when the app last
// closed, together with the active tab index and the page that was showing.
// Active is -1 when no tab was active.
type TerminalSessionLayout struct {
	Tabs   []TerminalSessionState `json:"Tabs,omitempty"`
	Active int                    `json:"Active"`
	Page   string                 `json:"Page,omitempty"`
}

// maxTerminalSessionTabs caps how many tabs a saved layout may carry so a
// corrupt or hand-edited file cannot ask the app to spawn an absurd number of
// shells on the next launch.
const maxTerminalSessionTabs = 64

func cleanTerminalSessionLayout(layout TerminalSessionLayout) TerminalSessionLayout {
	tabs := make([]TerminalSessionState, 0, len(layout.Tabs))
	for _, tab := range layout.Tabs {
		tab.Project = strings.TrimSpace(tab.Project)
		tab.Path = strings.TrimSpace(tab.Path)
		tab.Label = strings.TrimSpace(tab.Label)
		tab.Profile = strings.TrimSpace(tab.Profile)
		tab.Command = strings.TrimSpace(tab.Command)
		if tab.Path == "" && tab.Project == "" {
			continue
		}
		tabs = append(tabs, tab)
		if len(tabs) >= maxTerminalSessionTabs {
			break
		}
	}
	if layout.Page != "git" && layout.Page != "terminal" {
		layout.Page = ""
	}
	if layout.Active < 0 || layout.Active >= len(tabs) {
		layout.Active = -1
	}
	layout.Tabs = tabs
	return layout
}

// LastSession returns the terminals saved when the app last closed. An empty
// layout (no tabs) means there is nothing to offer for restore.
func (s *TerminalService) LastSession() (TerminalSessionLayout, error) {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	if s.sessionPath == "" {
		return TerminalSessionLayout{Active: -1}, nil
	}
	data, err := os.ReadFile(s.sessionPath)
	if errors.Is(err, os.ErrNotExist) {
		return TerminalSessionLayout{Active: -1}, nil
	}
	if err != nil {
		return TerminalSessionLayout{}, fmt.Errorf("read terminal session: %w", err)
	}
	var layout TerminalSessionLayout
	if err := json.Unmarshal(data, &layout); err != nil {
		// A corrupt file must never stop the app from opening; start empty.
		return TerminalSessionLayout{Active: -1}, nil
	}
	return cleanTerminalSessionLayout(layout), nil
}

// SaveSession stores the open terminals so the next launch can offer to restore
// them. An empty layout clears the file instead of leaving a stale one behind.
func (s *TerminalService) SaveSession(layout TerminalSessionLayout) error {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	layout = cleanTerminalSessionLayout(layout)
	if s.sessionPath == "" {
		return nil
	}
	if len(layout.Tabs) == 0 {
		return s.clearSessionLocked()
	}
	return s.writeSessionLocked(layout)
}

// ClearSession forgets the saved terminals, used when the user declines to
// restore them.
func (s *TerminalService) ClearSession() error {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	return s.clearSessionLocked()
}

func (s *TerminalService) writeSessionLocked(layout TerminalSessionLayout) error {
	if err := os.MkdirAll(filepath.Dir(s.sessionPath), 0o755); err != nil {
		return fmt.Errorf("create terminal session directory: %w", err)
	}
	data, err := json.MarshalIndent(layout, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.sessionPath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return fmt.Errorf("write terminal session: %w", err)
	}
	if err := os.Rename(temporary, s.sessionPath); err != nil {
		return fmt.Errorf("replace terminal session: %w", err)
	}
	return nil
}

func (s *TerminalService) clearSessionLocked() error {
	if s.sessionPath == "" {
		return nil
	}
	if err := os.Remove(s.sessionPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear terminal session: %w", err)
	}
	return nil
}
