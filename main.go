package main

import (
	"embed"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/icons"
	"mygit-wails3/internal/services"
	"mygit-wails3/internal/workspace"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/windows/icon.ico
var trayIcon []byte

func main() {
	dir := os.Getenv("MYGIT_WAILS3_DATA_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal(err)
		}
		dir = filepath.Join(home, ".mygit-wails3")
	}
	store, err := workspace.NewStore(dir)
	if err != nil {
		log.Fatal(err)
	}
	desktop := services.NewDesktopService()
	repository := services.NewRepositoryService(store)
	repository.AttachFiles(desktop)
	appService := services.NewAppService(store)
	frontend, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	app := application.New(application.Options{
		Name: "MyGit", Description: "A worktree-centered Git workspace",
		Services: []application.Service{
			application.NewService(services.NewWorkspaceService(store)),
			application.NewService(repository),
			application.NewService(desktop),
			application.NewService(appService),
			application.NewService(services.NewAIService(store)),
			application.NewService(services.NewTerminalService(dir)),
		},
		Assets: application.AssetOptions{Handler: application.AssetFileServerFS(frontend)},
		Mac:    application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	desktop.Attach(app)
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "mygit", Title: "MyGit", Width: 1320, Height: 840, MinWidth: 960, MinHeight: 640,
		URL: "/", DevToolsEnabled: !production, DefaultContextMenuDisabled: false,
		BackgroundColour: application.NewRGB(248, 250, 252),
	})
	appService.Attach(app, window)
	// The close button never destroys the window directly: depending on the
	// saved preference it either asks the frontend, hides to the tray, or —
	// when an explicit quit is in progress — lets the window close for real.
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if appService.ForceCloseRequested() {
			return
		}
		prefs := store.Snapshot().Preferences
		if prefs.CloseConfirm {
			e.Cancel()
			window.Show().Focus()
			window.EmitEvent("app:close-request")
			return
		}
		if prefs.CloseAction == "exit" {
			return
		}
		e.Cancel()
		window.Hide()
	})
	tray := app.SystemTray.New()
	switch runtime.GOOS {
	case "darwin":
		tray.SetTemplateIcon(icons.SystrayMacTemplate)
	case "windows":
		tray.SetIcon(trayIcon)
	default:
		tray.SetIcon(icons.SystrayLight)
	}
	tray.SetTooltip("MyGit")
	trayMenu := app.NewMenu()
	trayMenu.Add("显示 MyGit").OnClick(func(*application.Context) { appService.ShowWindow() })
	trayMenu.Add("退出程序").OnClick(func(*application.Context) { appService.Quit() })
	tray.SetMenu(trayMenu)
	// Left-clicking the tray icon toggles the window. We deliberately do NOT use
	// tray.AttachWindow: Wails' attached-window click handler calls
	// positionWindow before Show(), which snaps the window to the screen corner
	// nearest the tray instead of restoring where it was. Toggling visibility
	// ourselves leaves the window's remembered position untouched.
	tray.OnClick(func() {
		// A minimised window is technically still visible, so restore it rather
		// than hiding it when the user clicks the tray icon.
		if window.IsMinimised() {
			window.UnMinimise()
			window.Show().Focus()
			return
		}
		if window.IsVisible() {
			window.Hide()
			return
		}
		window.Show().Focus()
	})
	menu := app.NewMenu()
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
	}
	menu.AddRole(application.EditMenu)
	view := menu.AddSubmenu("View")
	if !production {
		view.Add("Developer tools").OnClick(func(*application.Context) { window.OpenDevTools() })
	}
	menu.AddRole(application.WindowMenu)
	app.Menu.Set(menu)
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
