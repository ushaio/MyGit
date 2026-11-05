package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

func repository(t *testing.T, dir string) {
	t.Helper()
	cmd := exec.Command("git", "init", "-q", "-b", "main", dir)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("init: %v %s", err, output)
	}
}
func TestDiscoveryAndStateRoundTrip(t *testing.T) {
	root, config := t.TempDir(), t.TempDir()
	repo := filepath.Join(root, "group", "项目 with spaces")
	repository(t, repo)
	nested := filepath.Join(repo, "nested")
	repository(t, nested)
	s, err := NewStore(config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddRoot(root); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddRoot(root); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if projects := s.Projects(); len(projects) != 1 || projects[0].Path != repo {
		t.Fatalf("projects: %+v", projects)
	}
	if _, err := s.SetProject(repo, "pinned", "true"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetGroup("tools", "Tools"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetProject(repo, "group", "tools"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Select(repo, repo); err != nil {
		t.Fatal(err)
	}
	if err := s.SetDraft(repo, "A draft\n\nDetails"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	loaded, err := NewStore(config)
	if err != nil {
		t.Fatal(err)
	}
	st := loaded.Snapshot()
	if len(st.Roots) != 1 || st.Selected != repo || st.Drafts[repo] != "A draft\n\nDetails" || !loaded.Projects()[0].Pinned || loaded.Projects()[0].Group != "tools" {
		t.Fatalf("state: %+v", st)
	}
	if _, err := loaded.SetProject(repo, "removed", "true"); err != nil {
		t.Fatal(err)
	}
	if len(loaded.Projects()) != 0 {
		t.Fatal("removed repository remains visible")
	}
	if _, err := os.Stat(filepath.Join(repo, ".git")); err != nil {
		t.Fatal("removing a project touched its repository")
	}
	if _, err := loaded.RestoreProjects(); err != nil {
		t.Fatal(err)
	}
	if len(loaded.Projects()) != 1 {
		t.Fatal("restore did not restore the repository")
	}
	if _, err := loaded.SetGroup("tools", ""); err != nil {
		t.Fatal(err)
	}
	if loaded.Projects()[0].Group != "" {
		t.Fatal("group membership was not cleared")
	}
}
func TestRemovedRootRetainsMetadata(t *testing.T) {
	root := t.TempDir()
	repository(t, root)
	s, _ := NewStore(t.TempDir())
	s.AddRoot(root)
	s.Refresh(context.Background())
	s.SetProject(root, "pinned", "true")
	if _, err := s.RemoveRoot(root); err != nil {
		t.Fatal(err)
	}
	if len(s.Projects()) != 0 {
		t.Fatal("removed root remains visible")
	}
	s.AddRoot(root)
	s.Refresh(context.Background())
	if !s.Projects()[0].Pinned {
		t.Fatal("root metadata was discarded")
	}
}
func TestFailedSaveDoesNotPublishState(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "file")
	if err := os.WriteFile(blocker, []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocker, "workspace.json")
	if err := s.SetDraft("test", "must not appear"); err == nil {
		t.Fatal("save unexpectedly succeeded")
	}
	if s.Snapshot().Drafts["test"] != "" {
		t.Fatal("failed save changed in-memory state")
	}
}
func TestConcurrentDraftWritesAreIndependent(t *testing.T) {
	s, _ := NewStore(t.TempDir())
	var wg sync.WaitGroup
	for _, key := range []string{"one", "two", "three"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.SetDraft(key, key); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	st := s.Snapshot()
	for _, key := range []string{"one", "two", "three"} {
		if st.Drafts[key] != key {
			t.Fatalf("draft lost: %+v", st.Drafts)
		}
	}
	st.Drafts["one"] = "external mutation"
	if s.Snapshot().Drafts["one"] != "one" {
		t.Fatal("snapshot aliases internal state")
	}
}
func TestCanceledScanDoesNotPublish(t *testing.T) {
	root := t.TempDir()
	repository(t, root)
	s, _ := NewStore(t.TempDir())
	s.AddRoot(root)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.Refresh(ctx); err == nil {
		t.Fatal("canceled scan succeeded")
	}
	if len(s.Projects()) != 0 {
		t.Fatal("canceled scan published projects")
	}
}
func TestWorktreeParsingPreservesPaths(t *testing.T) {
	output := "worktree /tmp/project with spaces\x00HEAD abc123\x00branch refs/heads/main\x00\x00worktree /tmp/side\x00HEAD abc456\x00detached\x00locked reason\x00\x00"
	items, err := parseWorktrees(output)
	if err != nil || len(items) != 2 || items[0].Path != "/tmp/project with spaces" || !items[0].Main || !items[1].Detached || !items[1].Locked {
		t.Fatalf("worktrees: %+v %v", items, err)
	}
}

func TestUnreadableFolderKeepsProjects(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("needs a directory the test process may not read")
	}
	good, mixed := t.TempDir(), t.TempDir()
	first, second := filepath.Join(good, "a"), filepath.Join(mixed, "b")
	repository(t, first)
	repository(t, second)
	blocked := filepath.Join(mixed, "blocked")
	if err := os.MkdirAll(blocked, 0o700); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("icacls", blocked, "/deny", "*S-1-1-0:(OI)(CI)(RX)").CombinedOutput(); err != nil {
		t.Skipf("cannot deny access: %v %s", err, output)
	}
	t.Cleanup(func() { _ = exec.Command("icacls", blocked, "/remove:d", "*S-1-1-0").Run() })
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddRoot(good); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddRoot(mixed); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(context.Background()); err == nil {
		t.Fatal("an unreadable folder was not reported")
	}
	// The folder next to the unreadable one keeps its repository.
	found := map[string]bool{}
	for _, project := range s.Projects() {
		found[project.Path] = true
	}
	if !found[first] || !found[second] {
		t.Fatalf("projects: %+v", s.Projects())
	}
}

func TestPreferencesKeepAISettings(t *testing.T) {
	config := t.TempDir()
	s, err := NewStore(config)
	if err != nil {
		t.Fatal(err)
	}
	preferences := s.Snapshot().Preferences
	preferences.AIURL, preferences.AIKey = "  https://api.example.com/v1  ", " sk-test "
	preferences.AIModel = "  deepseek-chat "
	if _, err := s.SetPreferences(preferences); err != nil {
		t.Fatal(err)
	}
	loaded, err := NewStore(config)
	if err != nil {
		t.Fatal(err)
	}
	saved := loaded.Snapshot().Preferences
	if saved.AIURL != "https://api.example.com/v1" || saved.AIKey != "sk-test" || saved.AIModel != "deepseek-chat" {
		t.Fatalf("preferences: %+v", saved)
	}
	preferences.AIURL = "api.example.com"
	if _, err := s.SetPreferences(preferences); err == nil {
		t.Fatal("an AI address without a scheme was accepted")
	}
}

func TestDataDirectoryHoldsTheWorkspaceFile(t *testing.T) {
	config := t.TempDir()
	s, err := NewStore(config)
	if err != nil {
		t.Fatal(err)
	}
	if s.Dir() != filepath.Clean(config) {
		t.Fatalf("data directory: %s", s.Dir())
	}
	if err := s.SetDraft("README", "keep me"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir(), "workspace.json")); err != nil {
		t.Fatal("the data directory does not hold the workspace file")
	}
}
