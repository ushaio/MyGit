package main

import (
	"embed"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"mygit-wails3/internal/services"
	"mygit-wails3/internal/workspace"
)

//go:embed all:frontend/dist
var assets embed.FS

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
			application.NewService(services.NewTerminalService()),
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
