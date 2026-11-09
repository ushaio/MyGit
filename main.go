package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

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
	workspaceService := services.NewWorkspaceService(store)
	frontend, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	app := application.New(application.Options{
		Name: "MyGit", Description: "MyGit",
		// Only one MyGit instance may run at a time. A second launch is refused
		// by the platform lock and instead hands control back to the running
		// instance via OnSecondInstanceLaunch: we restore its window to the
		// foreground, then the second process exits (see Wails single_instance).
		SingleInstance: probeSingleInstance(appService),
		Services: []application.Service{
			application.NewService(workspaceService),
			application.NewService(repository),
			application.NewService(desktop),
			application.NewService(appService),
			application.NewService(services.NewAIService(store)),
			application.NewService(services.NewWorkflowService()),
			application.NewService(services.NewTerminalService(dir)),
		},
		Assets: application.AssetOptions{Handler: application.AssetFileServerFS(frontend)},
		Mac:    application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		// Wails v3.0.0 can crash inside the Go runtime's own exit path on
		// Windows (wailsapp/wails#6375) and then hang as a zombie process with
		// the window still on screen. Services, windows and trays are already
		// torn down when PostShutdown runs, so end the process from there
		// instead of returning from main and letting the runtime take that path.
		PostShutdown: func() { os.Exit(0) },
	})
	desktop.Attach(app)
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "mygit", Title: "MyGit", Width: 1320, Height: 840, MinWidth: 960, MinHeight: 640,
		URL: "/", DevToolsEnabled: !production, DefaultContextMenuDisabled: false,
		BackgroundColour: application.NewRGB(248, 250, 252),
	})
	appService.Attach(app, window)
	workspaceService.AttachWindow(window)
	// TEMPORARY quit-freeze probe. Remove once the hang is understood.
	if addr := os.Getenv("MYGIT_PPROF"); addr != "" {
		http.HandleFunc("/debug/quit", func(w http.ResponseWriter, r *http.Request) {
			log.Println("probe: /debug/quit")
			go func() {
				appService.Quit()
				log.Println("probe: Quit returned")
			}()
			_, _ = w.Write([]byte("quitting\n"))
		})
		http.HandleFunc("/debug/quitmain", func(w http.ResponseWriter, r *http.Request) {
			log.Println("probe: /debug/quitmain")
			application.InvokeSync(func() {
				log.Println("probe: quitmain on main thread")
				appService.Quit()
				log.Println("probe: quitmain Quit returned")
			})
			_, _ = w.Write([]byte("quit on main thread\n"))
		})
		http.HandleFunc("/debug/hide", func(w http.ResponseWriter, r *http.Request) {
			log.Println("probe: /debug/hide")
			window.Hide()
			_, _ = w.Write([]byte("hidden\n"))
		})
		http.HandleFunc("/debug/minimise", func(w http.ResponseWriter, r *http.Request) {
			log.Println("probe: /debug/minimise")
			window.Minimise()
			_, _ = w.Write([]byte("minimised\n"))
		})
		http.HandleFunc("/debug/close", func(w http.ResponseWriter, r *http.Request) {
			log.Println("probe: /debug/close")
			go func() {
				window.Close()
				log.Println("probe: Close returned")
			}()
			_, _ = w.Write([]byte("closing\n"))
		})
		http.HandleFunc("/debug/resolve", func(w http.ResponseWriter, r *http.Request) {
			action := r.URL.Query().Get("action")
			log.Println("probe: /debug/resolve", action)
			go func() {
				_, err := appService.ResolveClose(action, false)
				log.Printf("probe: ResolveClose returned err=%v", err)
			}()
			_, _ = w.Write([]byte("resolving\n"))
		})
		go func() { log.Println("pprof:", http.ListenAndServe(addr, nil)) }()
	}
	if raw := os.Getenv("MYGIT_QUIT_AFTER"); raw != "" {
		if ms, convErr := strconv.Atoi(raw); convErr == nil {
			time.AfterFunc(time.Duration(ms)*time.Millisecond, func() {
				log.Println("probe: quit timer fired")
				appService.Quit()
				log.Println("probe: Quit returned")
			})
		}
	}
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

// probeSingleInstance is TEMPORARY: lets the quit-freeze probe run alongside a
// stuck instance. Remove with the rest of the probe code.
func probeSingleInstance(appService *services.AppService) *application.SingleInstanceOptions {
	if os.Getenv("MYGIT_NO_SINGLE") != "" {
		return nil
	}
	return &application.SingleInstanceOptions{
		UniqueID: "com.ushaio.mygit",
		OnSecondInstanceLaunch: func(application.SecondInstanceData) {
			appService.ShowWindow()
		},
	}
}
