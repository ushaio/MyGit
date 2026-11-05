package services

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"mygit-wails3/internal/gitrepo"
)

type Action struct {
	Path, Kind, Ref, Name, Value, Message, Remote                                         string
	Files                                                                                 []string
	Area                                                                                  gitrepo.Area
	Confirm, Force, Keep, Untracked, NoCommit, Rebase, Autostash, UpdateRefs, Track, Tags bool
	Parent                                                                                int
	Mode                                                                                  string
	Plan                                                                                  []gitrepo.RebaseCommit
}

// Execute accepts product operations, never arbitrary Git command lines.
func (s *RepositoryService) Execute(ctx context.Context, a Action) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	for _, value := range []string{a.Ref, a.Name, a.Remote, a.Value} {
		if err := safeRef(value); err != nil {
			return err
		}
	}
	for _, file := range a.Files {
		if !filepath.IsLocal(filepath.FromSlash(file)) {
			return errors.New("invalid repository-relative path")
		}
	}
	if slices.Contains([]string{"discard", "reset", "delete-branch", "delete-tag", "delete-remote-branch", "delete-remote-tag", "delete-remote", "drop-stash", "restore-file", "abort", "resolve", "remove-worktree", "interactive-rebase"}, a.Kind) || a.Force || a.Kind == "commit" && a.Mode == "amend" {
		if !a.Confirm {
			return errors.New("this operation requires confirmation")
		}
	}
	queue := s.lane(a.Path)
	if serialKinds[a.Kind] && !queue.claim(a.Kind) {
		return errors.New("another operation is running in this worktree")
	}
	if serialKinds[a.Kind] {
		defer queue.release(a.Kind)
	}
	network := remoteKinds[a.Kind]
	wait := indexWait
	if network {
		wait = networkWait
	}
	release, err := queue.pick(network).acquire(ctx, a.Kind, wait)
	if err != nil {
		return err
	}
	defer release()
	g := s.git
	files := []gitrepo.FileChange{}
	if slices.Contains([]string{"stage", "unstage", "discard", "stash-files"}, a.Kind) {
		changes, err := g.WorktreeStatus(a.Path)
		if err != nil {
			return err
		}
		for _, f := range changes.Files {
			if f.Area == a.Area && (len(a.Files) == 0 || slices.Contains(a.Files, f.Path)) {
				files = append(files, f)
			}
		}
		if len(files) == 0 {
			return errors.New("no matching changes remain; refresh the repository")
		}
		if len(a.Files) > 0 && len(files) != len(a.Files) {
			return errors.New("selected files changed; refresh the repository")
		}
	}
	switch a.Kind {
	case "stage":
		return g.Stage(a.Path, files...)
	case "unstage":
		return g.Unstage(a.Path, files...)
	case "discard":
		if a.Area != gitrepo.AreaUnstaged {
			return errors.New("unstage changes before discarding")
		}
		return g.Discard(a.Path, files...)
	case "commit":
		if strings.TrimSpace(a.Message) == "" {
			return errors.New("enter a commit message")
		}
		var err error
		if a.Mode == "amend" {
			err = g.AmendCommit(a.Path, a.Message)
		} else {
			err = g.Commit(a.Path, a.Message)
		}
		if err != nil {
			return err
		}
		if err := s.store.SetDraft(a.Path, ""); err != nil {
			return fmt.Errorf("commit recorded, but draft could not be cleared: %w", err)
		}
		if a.Mode == "push" {
			if err := s.push(a); err != nil {
				return fmt.Errorf("commit recorded, but push failed: %w", err)
			}
			return nil
		}
		return nil
	case "fetch":
		if a.Remote == "" {
			return g.Fetch(a.Path)
		}
		return g.FetchRemote(a.Path, a.Remote)
	case "pull":
		remote, branch := a.Remote, a.Ref
		if remote == "" || branch == "" {
			t, err := g.Tracking(a.Path)
			if err != nil {
				return err
			}
			remote, branch, _ = strings.Cut(t.Upstream, "/")
		}
		if remote == "" || branch == "" {
			return errors.New("choose a remote branch or configure an upstream")
		}
		return g.Pull(a.Path, gitrepo.PullOptions{Remote: remote, Branch: branch, Rebase: a.Rebase, Stash: a.Autostash})
	case "push":
		return s.push(a)
	case "stash":
		return g.SaveStash(a.Path, a.Message, a.Untracked)
	case "stash-files":
		return g.SaveStashFiles(a.Path, a.Message, files)
	case "apply-stash":
		return g.ApplyStash(a.Path, a.Ref, !a.Keep)
	case "drop-stash":
		return g.DropStash(a.Path, a.Ref)
	case "rename-stash":
		_, err := g.RenameStash(a.Path, a.Ref, a.Message)
		return err
	case "checkout":
		if a.Ref == "" {
			return errors.New("choose a revision or branch")
		}
		o := gitrepo.CheckoutOptions{Changes: gitrepo.KeepChanges}
		if a.Mode == "branch" {
			o.Branch = a.Ref
		} else if a.Name != "" {
			o.Branch, o.Start, o.Track = a.Name, a.Ref, a.Track
		} else {
			o.Start = a.Ref
		}
		if a.Autostash {
			o.Changes = gitrepo.StashChanges
		}
		return g.Checkout(a.Path, o)
	case "branch":
		return g.CreateBranch(a.Path, a.Name, fallback(a.Ref, "HEAD"))
	case "tag":
		return g.CreateTag(a.Path, a.Name, fallback(a.Ref, "HEAD"), a.Message)
	case "rename-branch":
		return g.RenameBranch(a.Path, a.Ref, a.Name)
	case "track":
		return g.SetUpstream(a.Path, a.Ref, a.Value)
	case "delete-branch":
		return g.DeleteBranch(a.Path, a.Ref, a.Force)
	case "delete-tag":
		return g.DeleteTag(a.Path, a.Ref)
	case "delete-remote-branch":
		return g.DeleteRemoteBranch(a.Path, a.Remote, a.Ref)
	case "delete-remote-tag":
		return g.DeleteRemoteTag(a.Path, a.Remote, a.Ref)
	case "push-tag":
		return g.PushTag(a.Path, a.Remote, a.Ref)
	case "add-remote":
		return g.AddRemote(a.Path, a.Name, a.Value)
	case "edit-remote":
		if a.Name != "" && a.Name != a.Ref {
			if err := g.RenameRemote(a.Path, a.Ref, a.Name); err != nil {
				return err
			}
		}
		return g.SetRemoteURL(a.Path, fallback(a.Name, a.Ref), a.Value)
	case "delete-remote":
		return g.DeleteRemote(a.Path, a.Ref)
	case "merge":
		return g.Merge(a.Path, a.Ref, gitrepo.IntegrateOptions{NoFastForward: a.Mode == "no-ff", Squash: a.Mode == "squash", NoCommit: a.NoCommit, Stash: a.Autostash})
	case "rebase":
		return g.Rebase(a.Path, a.Ref, gitrepo.IntegrateOptions{Stash: a.Autostash, UpdateRefs: a.UpdateRefs})
	case "interactive-rebase":
		return g.InteractiveRebase(a.Path, a.Ref, a.Plan, a.Autostash)
	case "reset":
		if a.Mode != "soft" && a.Mode != "mixed" && a.Mode != "hard" {
			return errors.New("choose soft, mixed or hard reset")
		}
		return g.Reset(a.Path, a.Ref, gitrepo.ResetMode(a.Mode))
	case "cherry-pick":
		return g.CherryPick(a.Path, a.Ref, gitrepo.CherryPickOptions{Commit: !a.NoCommit, AppendOrigin: true, Parent: a.Parent})
	case "revert":
		return g.Revert(a.Path, a.Ref, gitrepo.RevertOptions{Commit: !a.NoCommit, Parent: a.Parent})
	case "continue":
		return g.ContinueOperation(a.Path)
	case "abort":
		return g.AbortOperation(a.Path)
	case "resolve":
		if len(a.Files) != 1 || a.Mode != "ours" && a.Mode != "theirs" {
			return errors.New("choose one conflicted file and a side")
		}
		side := gitrepo.ConflictOurs
		if a.Mode == "theirs" {
			side = gitrepo.ConflictTheirs
		}
		return g.ResolveConflict(a.Path, a.Files[0], side)
	case "restore-file":
		if len(a.Files) != 1 {
			return errors.New("choose a file")
		}
		return g.RestoreFile(a.Path, a.Ref, a.Files[0])
	case "worktree":
		if a.Value == "" || a.Ref == "" {
			return errors.New("choose a directory and revision")
		}
		o := gitrepo.CheckoutOptions{Branch: a.Ref}
		if a.Name != "" {
			o.Branch, o.Start = a.Name, a.Ref
		} else if a.Mode == "detached" {
			o.Branch, o.Start = "", a.Ref
		}
		return g.AddWorktree(a.Path, a.Value, o)
	case "remove-worktree":
		if a.Value == "" {
			return errors.New("choose a worktree")
		}
		_, err := g.Run(a.Path, "worktree", "remove", "--", a.Value)
		return err
	default:
		return fmt.Errorf("unknown operation: %s", a.Kind)
	}
}
func fallback(value, other string) string {
	if value == "" {
		return other
	}
	return value
}
func (s *RepositoryService) push(a Action) error {
	t, err := s.git.Tracking(a.Path)
	if err != nil {
		return err
	}
	branch, remote, to := fallback(a.Ref, t.Branch), a.Remote, a.Value
	if remote == "" {
		remote, _, _ = strings.Cut(t.Upstream, "/")
		if remote == "" {
			urls, err := s.git.RemoteURLs(a.Path)
			if err != nil {
				return err
			}
			if _, ok := urls["origin"]; ok {
				remote = "origin"
			} else if len(urls) == 1 {
				for name := range urls {
					remote = name
				}
			}
		}
	}
	return s.git.PushBranch(a.Path, gitrepo.PushOptions{Branch: branch, Remote: remote, To: fallback(to, branch), Force: a.Force, Tags: a.Tags})
}
