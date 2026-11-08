package workspace

import (
	"context"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
)

func gitCommand(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, output)
	}
}

// A repository mirrored on several hosts must be listed under every platform
// tab, and its origin keeps the lead for the row icon.
func TestRepositorySourcesCollectEveryRemoteHost(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	repository(t, repo)
	gitCommand(t, repo, "remote", "add", "origin", "git@github.com:owner/repo.git")
	gitCommand(t, repo, "remote", "add", "gitee", "https://gitee.com/owner/repo.git")
	gitCommand(t, repo, "remote", "add", "code", "https://gitcode.com/owner/repo.git")
	gitCommand(t, repo, "remote", "add", "mirror", "git@github.com:mirror/repo.git")
	gitCommand(t, repo, "remote", "add", "other", "https://gitlab.com/owner/repo.git")

	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddRoot(root); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	projects := s.Projects()
	if len(projects) != 1 {
		t.Fatalf("projects: %+v", projects)
	}
	if want := []string{"github", "gitee", "gitcode"}; !slices.Equal(projects[0].Sources, want) {
		t.Fatalf("sources: %v, want %v", projects[0].Sources, want)
	}
	if projects[0].Source != "github" {
		t.Fatalf("primary source: %q, want github", projects[0].Source)
	}
}

// Without an origin the first known source leads, so a Gitee-only mirror still
// gets a row icon.
func TestRepositorySourceFallsBackWhenOriginIsUnknown(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	repository(t, repo)
	gitCommand(t, repo, "remote", "add", "origin", "https://gitlab.com/owner/repo.git")
	gitCommand(t, repo, "remote", "add", "gitee", "git@gitee.com:owner/repo.git")

	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddRoot(root); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	projects := s.Projects()
	if len(projects) != 1 || !slices.Equal(projects[0].Sources, []string{"gitee"}) || projects[0].Source != "gitee" {
		t.Fatalf("projects: %+v", projects)
	}
}
