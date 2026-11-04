package services

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"mygit-wails3/internal/gitrepo"
)

type fileHost interface {
	openVersion(name string, data []byte) error
	saveVersion(name string, data []byte) error
}

//wails:ignore
func (s *RepositoryService) AttachFiles(host fileHost) { s.files = host }

// ExportFile reads the exact revision shown, including binary and large files.
func (s *RepositoryService) ExportFile(req FileRequest, operation string) error {
	if s.files == nil {
		return errors.New("desktop file services are unavailable")
	}
	if operation != "open" && operation != "save" {
		return errors.New("choose open or save")
	}
	if !filepath.IsLocal(filepath.FromSlash(req.File)) {
		return errors.New("invalid repository-relative path")
	}
	lock := s.lock(req.Request.Path)
	lock.RLock()
	changes, err := s.changes(req.Request)
	var data []byte
	if err == nil {
		index := slices.IndexFunc(changes.Files, func(f gitrepo.FileChange) bool {
			return f.Path == req.File && (req.Request.Mode != "changes" || f.Area == req.Area)
		})
		if index < 0 {
			err = errors.New("file no longer appears in this view")
		} else {
			file := changes.Files[index]
			if file.Status == 'U' {
				data, err = s.git.WorktreeFile(changes.Top, file.Path)
			} else {
				var before, after []byte
				before, after, err = s.git.FileVersions(changes, file)
				data = after
				if file.Status == 'D' {
					data = before
				}
			}
		}
	}
	lock.RUnlock()
	if err != nil {
		return err
	}
	name := filepath.Base(filepath.FromSlash(req.File))
	if operation == "save" {
		return s.files.saveVersion(name, data)
	}
	return s.files.openVersion(name, data)
}

func (s *RepositoryService) Patch(path, revision string, stash bool) (string, error) {
	if err := safeRef(revision); err != nil {
		return "", err
	}
	lock := s.lock(path)
	lock.RLock()
	defer lock.RUnlock()
	if stash {
		data, err := s.git.StashPatch(path, revision)
		return string(data), err
	}
	data, err := s.git.CommitPatch(path, revision)
	return string(data), err
}

func (s *DesktopService) saveVersion(name string, data []byte) error {
	if s.app == nil {
		return errors.New("desktop is not ready")
	}
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	path, err := s.app.Dialog.SaveFile().SetFilename(name).PromptForSingleSelection()
	if err != nil || path == "" {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
func (s *DesktopService) openVersion(name string, data []byte) error {
	dir, err := os.MkdirTemp("", "mygit-version-*")
	if err != nil {
		return err
	}
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0600); err != nil {
		_ = os.RemoveAll(dir)
		return err
	}
	s.mu.Lock()
	s.previews = append(s.previews, dir)
	s.mu.Unlock()
	return s.OpenPath(path)
}
func (s *DesktopService) ServiceShutdown() error {
	s.mu.Lock()
	paths := s.previews
	s.previews = nil
	s.mu.Unlock()
	var failures []error
	for _, path := range paths {
		if err := os.RemoveAll(path); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
