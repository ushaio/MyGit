package services

import (
	"errors"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"mygit-wails3/internal/workspace"
)

// AppService carries the state the window close button, the confirm dialog and
// the system tray share: the remembered close behaviour and a flag that lets an
// explicit quit bypass the close hook.
type AppService struct {
	store      *workspace.Store
	app        *application.App
	window     *application.WebviewWindow
	forceClose atomic.Bool

	// The last release CheckUpdate resolved, so downloading can reuse the
	// exact asset list the user was shown instead of hitting GitHub twice.
	updateMu     sync.Mutex
	latestUpdate UpdateInfo
	hasUpdate    bool
}

func NewAppService(store *workspace.Store) *AppService { return &AppService{store: store} }

//wails:ignore
func (s *AppService) Attach(app *application.App, window *application.WebviewWindow) {
	s.app = app
	s.window = window
}

// ForceCloseRequested reports whether an explicit quit is in progress, so the
// window close hook lets the window go instead of prompting again.
//
//wails:ignore
func (s *AppService) ForceCloseRequested() bool { return s.forceClose.Load() }

// ResolveClose applies the answer chosen in the close-confirmation dialog.
// When remember is set the choice is persisted and the reminder is turned off.
// It returns the updated workspace state so the frontend stays in sync with the
// new preference.
func (s *AppService) ResolveClose(action string, remember bool) (workspace.State, error) {
	if action != "minimize" && action != "exit" {
		return workspace.State{}, errors.New("invalid close action")
	}
	state := s.store.Snapshot()
	if remember {
		updated, err := s.store.RememberCloseAction(action)
		if err != nil {
			return workspace.State{}, err
		}
		state = updated
	}
	if action == "minimize" {
		if s.window != nil {
			s.window.Hide()
		}
		return state, nil
	}
	s.forceClose.Store(true)
	return state, nil
}

// Quit exits the application regardless of the remembered close behaviour.
//
//wails:ignore
func (s *AppService) Quit() {
	s.forceClose.Store(true)
	if s.app != nil {
		s.app.Quit()
	}
}

// ShowWindow brings a hidden window back to the foreground. Unlike the tray's
// built-in attached-window helper it does not reposition the window, so the
// window returns to wherever the user last left it.
//
//wails:ignore
func (s *AppService) ShowWindow() {
	if s.window != nil {
		if s.window.IsMinimised() {
			s.window.UnMinimise()
		}
		s.window.Show().Focus()
	}
}
