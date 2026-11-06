package services

import (
	"context"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"mygit-wails3/internal/workspace"
)

type WorkspaceService struct {
	store  *workspace.Store
	window *application.WebviewWindow
}

func NewWorkspaceService(store *workspace.Store) *WorkspaceService {
	return &WorkspaceService{store: store}
}

// AttachWindow gives the service a window to emit clone progress on. Cloning
// happens before any repository exists, so the workspace service owns it.
//
//wails:ignore
func (s *WorkspaceService) AttachWindow(window *application.WebviewWindow) {
	s.window = window
}
func (s *WorkspaceService) State() workspace.State { return s.store.Snapshot() }

// DataPath names the folder holding the workspace file, creating it first so
// opening the location works on a fresh profile.
func (s *WorkspaceService) DataPath() (string, error) {
	dir := s.store.Dir()
	return dir, os.MkdirAll(dir, 0700)
}
func (s *WorkspaceService) Refresh(ctx context.Context) (workspace.State, error) {
	return s.store.Refresh(ctx)
}
func (s *WorkspaceService) AddFolder(path string) (workspace.State, error) {
	return s.store.AddRoot(path)
}
func (s *WorkspaceService) RemoveFolder(path string) (workspace.State, error) {
	return s.store.RemoveRoot(path)
}
func (s *WorkspaceService) UpdateProject(path, property, value string) (workspace.State, error) {
	return s.store.SetProject(path, property, value)
}
func (s *WorkspaceService) RestoreProjects() (workspace.State, error) {
	return s.store.RestoreProjects()
}
func (s *WorkspaceService) SetProjectOrder(scope string, paths []string) (workspace.State, error) {
	return s.store.SetProjectOrder(scope, paths)
}
func (s *WorkspaceService) SetGroup(id, name string) (workspace.State, error) {
	return s.store.SetGroup(id, name)
}
func (s *WorkspaceService) Select(project, worktree string) (workspace.State, error) {
	return s.store.Select(project, worktree)
}
func (s *WorkspaceService) SaveDraft(path, message string) error {
	return s.store.SetDraft(path, message)
}
func (s *WorkspaceService) SetPreferences(p workspace.Preferences) (workspace.State, error) {
	return s.store.SetPreferences(p)
}
func (s *WorkspaceService) PinRef(path, ref string, pin bool) (workspace.State, error) {
	return s.store.PinRef(path, ref, pin)
}
