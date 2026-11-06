package services

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"mygit-wails3/internal/workspace"
)

// CloneResult tells the frontend which folder was actually cloned and hands
// back the refreshed workspace so the new project can be shown and selected.
type CloneResult struct {
	State workspace.State
	Path  string
}

var clonePercentPattern = regexp.MustCompile(`(\d{1,3})%`)

// Clone runs `git clone` into a target folder and adds the result as a
// workspace root. Git's progress lines are streamed to the UI as
// "clone:progress" events so the dialog can show the log and a percentage bar
// while the clone runs.
func (s *WorkspaceService) Clone(url, target string) (CloneResult, error) {
	url = strings.TrimSpace(url)
	target = strings.TrimSpace(target)
	if url == "" {
		return CloneResult{}, errors.New("enter the repository address")
	}
	if target == "" {
		return CloneResult{}, errors.New("choose a target folder")
	}
	absolute, err := filepath.Abs(target)
	if err != nil {
		return CloneResult{}, fmt.Errorf("invalid target folder: %w", err)
	}
	destination, err := cloneDestination(absolute, url)
	if err != nil {
		return CloneResult{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	if err := s.runClone(ctx, url, destination); err != nil {
		return CloneResult{}, err
	}

	if _, err := s.store.AddRoot(destination); err != nil {
		return CloneResult{}, err
	}
	// Scan so the sidebar shows the new project. A scan failure must not undo
	// a clone that already finished: the root is saved either way.
	_, _ = s.store.Refresh(context.Background())
	state, err := s.store.Select(destination, "")
	if err != nil {
		return CloneResult{}, err
	}
	return CloneResult{State: state, Path: destination}, nil
}

// cloneDestination picks where git should create the repository. An existing
// empty folder is filled directly; a non-empty folder (or a selected parent)
// gets a subfolder named after the repository.
func cloneDestination(target, url string) (string, error) {
	info, err := os.Stat(target)
	switch {
	case err == nil && info.IsDir():
		entries, err := os.ReadDir(target)
		if err != nil {
			return "", fmt.Errorf("cannot read the target folder: %w", err)
		}
		if len(entries) > 0 {
			return filepath.Join(target, repositoryName(url)), nil
		}
		return target, nil
	case err == nil:
		return "", errors.New("the target is not a folder")
	case os.IsNotExist(err):
		return target, nil
	default:
		return "", err
	}
}

// repositoryName derives a folder name from a clone URL: the last path (or
// scp-style) segment, without a trailing ".git".
func repositoryName(url string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(url), "/")
	base := trimmed
	if index := strings.LastIndexAny(trimmed, "/:"); index >= 0 {
		base = trimmed[index+1:]
	}
	base = strings.TrimSuffix(base, ".git")
	if base == "" {
		return "repository"
	}
	return base
}

func (s *WorkspaceService) runClone(ctx context.Context, url, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return fmt.Errorf("could not prepare the target folder: %w", err)
	}
	cmd := exec.CommandContext(ctx, "git", "clone", "--progress", "--", url, destination)
	cmd.Dir = filepath.Dir(destination)
	cmd.Env = gitEnv()
	hideConsole(cmd)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not run git: %w", err)
	}

	s.emitCloneProgress("Cloning repository…", -1)
	lines := make(chan string, 64)
	go func() {
		defer close(lines)
		streamCloneOutput(stderr, func(line string) { lines <- line })
	}()
	go func() { _, _ = io.Copy(io.Discard, stdout) }()

	tail := make([]string, 0, 48)
	for line := range lines {
		tail = append(tail, line)
		if len(tail) > 48 {
			tail = tail[1:]
		}
		s.emitCloneProgress(line, parseClonePercent(line))
	}

	if err := cmd.Wait(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return errors.New("clone timed out, check the network and try again")
		}
		if detail := lastCloneLine(tail); detail != "" {
			return fmt.Errorf("clone failed: %s", detail)
		}
		return fmt.Errorf("clone failed: %w", err)
	}
	s.emitCloneProgress("Done", 100)
	return nil
}

// streamCloneOutput splits git's progress output on both newlines and carriage
// returns, since git rewrites a single line with "\r" while objects transfer.
func streamCloneOutput(reader io.Reader, emit func(string)) {
	buffered := bufio.NewReader(reader)
	var current strings.Builder
	for {
		b, err := buffered.ReadByte()
		if err != nil {
			break
		}
		if b == '\n' || b == '\r' {
			if current.Len() > 0 {
				emit(current.String())
				current.Reset()
			}
			continue
		}
		current.WriteByte(b)
	}
	if current.Len() > 0 {
		emit(current.String())
	}
}

func parseClonePercent(line string) int {
	match := clonePercentPattern.FindStringSubmatch(line)
	if match == nil {
		return -1
	}
	value := 0
	_, _ = fmt.Sscanf(match[1], "%d", &value)
	if value < 0 {
		value = 0
	}
	if value > 100 {
		value = 100
	}
	return value
}

func lastCloneLine(lines []string) string {
	for index := len(lines) - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		// Drop bare progress counters; a real error ("fatal:", "error:") is
		// what the user needs to read.
		if line == "" || clonePercentPattern.MatchString(line) {
			continue
		}
		return line
	}
	if len(lines) > 0 {
		return strings.TrimSpace(lines[len(lines)-1])
	}
	return ""
}

func (s *WorkspaceService) emitCloneProgress(line string, percent int) {
	if s.window == nil {
		return
	}
	s.window.EmitEvent("clone:progress", map[string]any{
		"line":    line,
		"percent": percent,
	})
}
