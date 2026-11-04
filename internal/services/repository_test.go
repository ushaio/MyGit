package services

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mygit-wails3/internal/gitrepo"
	"mygit-wails3/internal/workspace"
)

func testGit(t *testing.T, path string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", path}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+filepath.Join(t.TempDir(), "no-config"), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}
func testService(t *testing.T) (*RepositoryService, string) {
	t.Helper()
	path := t.TempDir()
	testGit(t, path, "init", "-q", "-b", "main")
	for key, value := range map[string]string{"user.name": "Test", "user.email": "test@example.com", "core.autocrlf": "false", "core.hooksPath": filepath.Join(t.TempDir(), "no-hooks"), "commit.gpgSign": "false"} {
		testGit(t, path, "config", key, value)
	}
	write(t, path, "a.txt", "one\nold\ntail\n")
	testGit(t, path, "add", ".")
	testGit(t, path, "commit", "-qm", "initial")
	store, err := workspace.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return NewRepositoryService(store), path
}
func write(t *testing.T, path, file, text string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(path, file), []byte(text), 0644); err != nil {
		t.Fatal(err)
	}
}
func fileRequest(path, file string, area gitrepo.Area) FileRequest {
	return FileRequest{Request: ChangeRequest{Path: path, Mode: "changes"}, File: file, Area: area}
}

func TestStageSelectedLinesPreservesWorkingFile(t *testing.T) {
	s, path := testService(t)
	write(t, path, "a.txt", "one\nnew\nadded\ntail\n")
	req := fileRequest(path, "a.txt", gitrepo.AreaUnstaged)
	content, err := s.File(req)
	if err != nil {
		t.Fatal(err)
	}
	selected := []int{}
	for i, line := range content.Lines {
		if line.Kind == "delete" || line.Kind == "add" && line.Text == "new\n" {
			selected = append(selected, i)
		}
	}
	if err := s.ApplyLines(LineSelection{Request: req, Token: content.Token, Lines: selected}); err != nil {
		t.Fatal(err)
	}
	data, err := s.git.IndexFile(path, "a.txt")
	if err != nil || string(data) != "one\nnew\ntail\n" {
		t.Fatalf("index: %q %v", data, err)
	}
	data, _ = os.ReadFile(filepath.Join(path, "a.txt"))
	if string(data) != "one\nnew\nadded\ntail\n" {
		t.Fatalf("worktree changed: %q", data)
	}
	staged := fileRequest(path, "a.txt", gitrepo.AreaStaged)
	content, err = s.File(staged)
	if err != nil {
		t.Fatal(err)
	}
	selected = nil
	for i, line := range content.Lines {
		if line.Kind != "context" {
			selected = append(selected, i)
		}
	}
	if err := s.ApplyLines(LineSelection{Request: staged, Token: content.Token, Lines: selected}); err != nil {
		t.Fatal(err)
	}
	data, _ = s.git.IndexFile(path, "a.txt")
	if string(data) != "one\nold\ntail\n" {
		t.Fatalf("unstage: %q", data)
	}
}
func TestStaleLineSelectionIsRejected(t *testing.T) {
	s, path := testService(t)
	write(t, path, "a.txt", "one\nnew\ntail\n")
	req := fileRequest(path, "a.txt", gitrepo.AreaUnstaged)
	content, _ := s.File(req)
	write(t, path, "a.txt", "one\nchanged again\ntail\n")
	if err := s.ApplyLines(LineSelection{Request: req, Token: content.Token, Lines: []int{1}}); err == nil || !strings.Contains(err.Error(), "file changed") {
		t.Fatalf("stale selection: %v", err)
	}
	if got := testGit(t, path, "diff", "--cached"); got != "" {
		t.Fatalf("stale selection changed index: %s", got)
	}
}
func TestDestructiveActionsRequireConfirmation(t *testing.T) {
	s, path := testService(t)
	write(t, path, "a.txt", "modified\n")
	for _, a := range []Action{{Path: path, Kind: "discard", Area: gitrepo.AreaUnstaged, Files: []string{"a.txt"}}, {Path: path, Kind: "reset", Ref: "HEAD", Mode: "hard"}, {Path: path, Kind: "delete-branch", Ref: "other"}} {
		if err := s.Execute(context.Background(), a); err == nil || !strings.Contains(err.Error(), "confirmation") {
			t.Fatalf("unconfirmed %s: %v", a.Kind, err)
		}
	}
	data, _ := os.ReadFile(filepath.Join(path, "a.txt"))
	if string(data) != "modified\n" {
		t.Fatal("unconfirmed operation modified a file")
	}
}
func TestWholeFileAndCommitFlow(t *testing.T) {
	s, path := testService(t)
	write(t, path, "new file.txt", "hello\n")
	if err := s.Execute(context.Background(), Action{Path: path, Kind: "stage", Area: gitrepo.AreaUnstaged, Files: []string{"new file.txt"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.store.SetDraft(path, "add file"); err != nil {
		t.Fatal(err)
	}
	if err := s.Execute(context.Background(), Action{Path: path, Kind: "commit", Message: "add file"}); err != nil {
		t.Fatal(err)
	}
	if got := testGit(t, path, "log", "-1", "--format=%s"); got != "add file" {
		t.Fatal(got)
	}
	if s.store.Snapshot().Drafts[path] != "" {
		t.Fatal("draft remained after commit")
	}
	if status, err := s.Snapshot(context.Background(), path); err != nil || len(status.Changes.Files) != 0 {
		t.Fatalf("status: %+v %v", status, err)
	}
}
func TestBrowseWorktreeDoesNotCheckout(t *testing.T) {
	s, path := testService(t)
	other := filepath.Join(t.TempDir(), "other")
	testGit(t, path, "worktree", "add", "-qb", "feature", other)
	if _, err := s.Snapshot(context.Background(), other); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.Select(path, other); err != nil {
		t.Fatal(err)
	}
	if branch := testGit(t, path, "branch", "--show-current"); branch != "main" {
		t.Fatal("browsing changed the main branch")
	}
	if branch := testGit(t, other, "branch", "--show-current"); branch != "feature" {
		t.Fatal("browsing changed the linked worktree branch")
	}
}
func TestHistoryPaginationSearchAndReflog(t *testing.T) {
	s, path := testService(t)
	for _, message := range []string{"second", "third", "fourth"} {
		testGit(t, path, "commit", "--allow-empty", "-qm", message)
	}
	page, err := s.History(context.Background(), HistoryRequest{Path: path, Limit: 2})
	if err != nil || len(page.Commits) != 2 || !page.HasMore || page.Commits[0].Subject != "fourth" {
		t.Fatalf("first page: %+v %v", page, err)
	}
	page, err = s.History(context.Background(), HistoryRequest{Path: path, Limit: 2, Offset: 2})
	if err != nil || len(page.Commits) != 2 || page.HasMore || page.Commits[1].Subject != "initial" {
		t.Fatalf("second page: %+v %v", page, err)
	}
	page, err = s.History(context.Background(), HistoryRequest{Path: path, Query: "third"})
	if err != nil || len(page.Commits) != 1 || page.Commits[0].Subject != "third" {
		t.Fatalf("search: %+v %v", page, err)
	}
	page, err = s.History(context.Background(), HistoryRequest{Path: path, Reflog: true})
	if err != nil || len(page.Commits) < 4 {
		t.Fatalf("reflog: %+v %v", page, err)
	}
	seen := map[string]bool{}
	for _, commit := range page.Commits {
		if seen[commit.Hash] {
			t.Fatal("duplicate reflog commits")
		}
		seen[commit.Hash] = true
	}
}
func TestEmptyAndBareRepositories(t *testing.T) {
	s, path := testService(t)
	empty := t.TempDir()
	testGit(t, empty, "init", "-qb", "main")
	if r, err := s.Snapshot(context.Background(), empty); err != nil || len(r.Changes.Files) != 0 {
		t.Fatalf("empty status: %+v %v", r, err)
	}
	if page, err := s.History(context.Background(), HistoryRequest{Path: empty}); err != nil || len(page.Commits) != 0 {
		t.Fatalf("empty history: %+v %v", page, err)
	}
	bare := filepath.Join(t.TempDir(), "bare.git")
	testGit(t, path, "clone", "--bare", path, bare)
	if r, err := s.Snapshot(context.Background(), bare); err != nil || !r.Bare {
		t.Fatalf("bare: %+v %v", r, err)
	}
}
func TestRepositoryPathValidationAndBusyWrite(t *testing.T) {
	s, path := testService(t)
	if _, err := s.File(fileRequest(path, "../outside", gitrepo.AreaUnstaged)); err == nil {
		t.Fatal("path escape accepted")
	}
	if err := s.Execute(context.Background(), Action{Path: path, Kind: "branch", Name: "--help", Ref: "HEAD"}); err == nil {
		t.Fatal("option accepted as name")
	}
	lock := s.lock(path)
	lock.Lock()
	if err := s.Execute(context.Background(), Action{Path: path, Kind: "branch", Name: "new", Ref: "HEAD"}); err == nil || !strings.Contains(err.Error(), "running") {
		lock.Unlock()
		t.Fatalf("busy write: %v", err)
	}
	lock.Unlock()
}
