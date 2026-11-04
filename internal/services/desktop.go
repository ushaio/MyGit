package services

import (
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopService struct {
	app      *application.App
	mu       sync.Mutex
	previews []string
}

func NewDesktopService() *DesktopService { return &DesktopService{} }

//wails:ignore
func (s *DesktopService) Attach(app *application.App) { s.app = app }
func (s *DesktopService) ChooseFolder() (string, error) {
	if s.app == nil {
		return "", errors.New("desktop is not ready")
	}
	return s.app.Dialog.OpenFile().SetTitle("Add project folder").CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
}
func (s *DesktopService) CopyText(text string) error {
	if s.app == nil || !s.app.Clipboard.SetText(text) {
		return errors.New("could not copy text to the clipboard")
	}
	return nil
}
func (s *DesktopService) OpenPath(path string) error {
	if s.app == nil {
		return errors.New("desktop is not ready")
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	return s.app.Browser.OpenFile(path)
}
func (s *DesktopService) OpenURL(address string) error {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || u.Scheme != "https" && u.Scheme != "http" {
		return errors.New("invalid web address")
	}
	return s.app.Browser.OpenURL(address)
}
func (s *DesktopService) Reveal(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		cmd = exec.Command("explorer.exe", "/select,"+path)
	default:
		return s.OpenPath(filepath.Dir(path))
	}
	return cmd.Start()
}
func (s *DesktopService) OpenTool(path, tool string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	var cmd *exec.Cmd
	switch tool {
	case "terminal":
		switch runtime.GOOS {
		case "darwin":
			cmd = exec.Command("open", "-a", "Terminal", path)
		case "windows":
			cmd = exec.Command("cmd.exe", "/c", "start", "", "/d", path, "powershell.exe", "-NoLogo")
		default:
			cmd = exec.Command("x-terminal-emulator", "--working-directory="+path)
		}
	case "code":
		cmd = exec.Command("code", "--", path)
	case "cursor":
		cmd = exec.Command("cursor", "--", path)
	default:
		return errors.New("unsupported tool")
	}
	cmd.Dir = path
	return cmd.Start()
}
func (s *DesktopService) SaveText(name, text string) error {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	path, err := s.app.Dialog.SaveFile().SetFilename(name).PromptForSingleSelection()
	if err != nil || path == "" {
		return err
	}
	return os.WriteFile(path, []byte(text), 0644)
}
