package services

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"mygit-wails3/internal/gitrepo"
	"mygit-wails3/internal/workspace"
)

type RepositoryService struct {
	git   gitrepo.Git
	store *workspace.Store
	files fileHost
	lanes sync.Map
}

func NewRepositoryService(store *workspace.Store) *RepositoryService {
	return &RepositoryService{git: gitrepo.Git{Env: gitEnv()}, store: store}
}

// gitEnv runs git without prompts or pagers. Anything that would wait for a
// terminal is a bug here: failures have to surface as errors instead.
func gitEnv() []string {
	env := []string{}
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "GIT_") {
			env = append(env, entry)
		}
	}
	return append(env, "GIT_TERMINAL_PROMPT=0", "GIT_PAGER=cat", "GIT_EDITOR=true", "GIT_SEQUENCE_EDITOR=true")
}

// lane is keyed on the resolved real path so two spellings of one worktree
// share one queue.
func (s *RepositoryService) lane(path string) *lane {
	key, err := filepath.Abs(path)
	if err == nil {
		if real, err := filepath.EvalSymlinks(key); err == nil {
			key = real
		}
	} else {
		key = path
	}
	value, _ := s.lanes.LoadOrStore(filepath.Clean(key), newLane())
	return value.(*lane)
}

type Repository struct {
	Path      string
	Bare      bool
	Changes   gitrepo.Changes
	Refs      gitrepo.Refs
	Tracking  gitrepo.Tracking
	Worktrees []workspace.Worktree
	Stashes   []gitrepo.Stash
	Remotes   map[string]string
	Operation gitrepo.Operation
}

// Snapshot takes no lane: reads must never queue behind a five minute fetch.
// Git itself keeps a reader from seeing a torn index, and a value that raced a
// write is one refresh away from correct.
func (s *RepositoryService) Snapshot(ctx context.Context, path string) (Repository, error) {
	if err := ctx.Err(); err != nil {
		return Repository{}, err
	}
	bare, err := s.git.Run(path, "rev-parse", "--is-bare-repository")
	if err != nil {
		return Repository{}, err
	}
	r := Repository{Path: path, Bare: bare == "true", Changes: gitrepo.Changes{Top: path, Files: []gitrepo.FileChange{}}, Worktrees: []workspace.Worktree{}, Stashes: []gitrepo.Stash{}}
	// Every read is independent, and each one starts git; run them together so
	// a refresh costs one startup instead of seven.
	var (
		refsErr, remotesErr, changesErr       error
		trackingErr, worktreesErr, stashesErr error
		operationErr                          error
		wg                                    sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		r.Refs, refsErr = s.git.Refs(path)
	}()
	go func() {
		defer wg.Done()
		r.Remotes, remotesErr = s.git.RemoteURLs(path)
	}()
	wg.Wait()
	if refsErr != nil {
		return Repository{}, refsErr
	}
	if remotesErr != nil {
		return Repository{}, remotesErr
	}
	if r.Bare {
		return r, ctx.Err()
	}
	wg.Add(5)
	go func() {
		defer wg.Done()
		r.Changes, changesErr = s.git.WorktreeStatus(path)
	}()
	go func() {
		defer wg.Done()
		r.Tracking, trackingErr = s.git.Tracking(path)
	}()
	go func() {
		defer wg.Done()
		r.Worktrees, worktreesErr = workspace.ListWorktrees(ctx, path)
	}()
	go func() {
		defer wg.Done()
		r.Stashes, stashesErr = s.git.Stashes(path)
	}()
	go func() {
		defer wg.Done()
		r.Operation, operationErr = s.git.Operation(path)
	}()
	wg.Wait()
	for _, failure := range []error{changesErr, trackingErr, worktreesErr, stashesErr, operationErr} {
		if failure != nil {
			return Repository{}, failure
		}
	}
	return r, ctx.Err()
}

type HistoryRequest struct {
	Path, Query, Ref, File string
	Kind, Offset, Limit    int
	Reflog                 bool
}
type HistoryPage struct {
	Commits []gitrepo.Commit
	HasMore bool
}

func (s *RepositoryService) History(ctx context.Context, req HistoryRequest) (HistoryPage, error) {
	if req.Offset < 0 {
		return HistoryPage{}, errors.New("invalid history offset")
	}
	if req.Limit < 1 || req.Limit > 1000 {
		req.Limit = 200
	}
	if err := safeRef(req.Ref); err != nil {
		return HistoryPage{}, err
	}
	unborn := s.git.Unborn(req.Path)
	if unborn {
		refs, err := s.git.Run(req.Path, "for-each-ref", "--count=1")
		if err != nil {
			return HistoryPage{}, err
		}
		if refs == "" {
			return HistoryPage{Commits: []gitrepo.Commit{}}, nil
		}
	}
	args := []string{"--no-optional-locks", "log", "-z", "--pretty=format:" + historyFormat}
	if req.Reflog {
		args = append(args, "-g", "--all")
	} else {
		args = append(args, "--topo-order", "--date-order", fmt.Sprintf("--skip=%d", req.Offset), fmt.Sprintf("--max-count=%d", req.Limit+1))
		if req.File != "" {
			args = append(args, "--follow", fallback(req.Ref, "HEAD"))
		} else if req.Ref != "" {
			args = append(args, req.Ref)
		} else {
			args = append(args, "--all")
			if !unborn {
				args = append(args, "HEAD")
			}
		}
	}
	if req.Query != "" {
		switch req.Kind {
		case 1:
			args = append(args, "--author="+req.Query, "--regexp-ignore-case")
		case 2:
			req.File = req.Query
		case 3:
			args = append(args, "-S", req.Query)
		default:
			args = append(args, "--grep="+req.Query, "--regexp-ignore-case")
		}
	}
	if req.File != "" {
		args = append(args, "--", req.File)
	}
	commits, err := s.git.ReadLog(req.Path, args...)
	if err != nil {
		return HistoryPage{}, err
	}
	if err := ctx.Err(); err != nil {
		return HistoryPage{}, err
	}
	if req.Reflog {
		seen := map[string]bool{}
		unique := make([]gitrepo.Commit, 0, len(commits))
		for _, commit := range commits {
			if !seen[commit.Hash] {
				seen[commit.Hash] = true
				unique = append(unique, commit)
			}
		}
		commits = unique[min(req.Offset, len(unique)):]
	}
	more := len(commits) > req.Limit
	if more {
		commits = commits[:req.Limit]
	}
	return HistoryPage{Commits: commits, HasMore: more}, nil
}

const historyFormat = "%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x1e)%x1f%s%x1f%b"

type ChangeRequest struct {
	Path, Revision, From, To, File string
	Mode                           string
}

func (s *RepositoryService) changes(req ChangeRequest) (gitrepo.Changes, error) {
	for _, ref := range []string{req.Revision, req.From, req.To} {
		if err := safeRef(ref); err != nil {
			return gitrepo.Changes{}, err
		}
	}
	switch req.Mode {
	case "commit":
		return s.git.CommitChanges(req.Path, req.Revision)
	case "files":
		if req.Revision == "" {
			return s.git.WorktreeFiles(req.Path)
		}
		return s.git.CommitFiles(req.Path, req.Revision)
	case "stash":
		return s.git.StashChanges(req.Path, req.Revision)
	case "compare":
		return s.git.DiffBetween(req.Path, req.From, req.To)
	default:
		return s.git.WorktreeStatus(req.Path)
	}
}
func (s *RepositoryService) Changes(req ChangeRequest) (gitrepo.Changes, error) {
	return s.changes(req)
}

type FileRequest struct {
	Request ChangeRequest
	File    string
	Area    gitrepo.Area
}
type FileContent struct {
	File                    gitrepo.FileChange
	Before, After, Token    string
	Lines                   []gitrepo.Line
	Binary, Truncated       bool
	BeforeImage, AfterImage string
}

func (s *RepositoryService) file(req FileRequest) (FileContent, gitrepo.Changes, error) {
	if !filepath.IsLocal(filepath.FromSlash(req.File)) {
		return FileContent{}, gitrepo.Changes{}, errors.New("invalid repository-relative path")
	}
	changes, err := s.changes(req.Request)
	if err != nil {
		return FileContent{}, changes, err
	}
	index := slices.IndexFunc(changes.Files, func(f gitrepo.FileChange) bool {
		return f.Path == req.File && (req.Request.Mode != "changes" || f.Area == req.Area)
	})
	if index < 0 {
		return FileContent{}, changes, errors.New("file no longer appears in this view; refresh the repository")
	}
	f := changes.Files[index]
	var before, after []byte
	if f.Status == 'U' {
		after, err = s.git.WorktreeFile(changes.Top, f.Path)
	} else {
		before, after, err = s.git.FileVersions(changes, f)
	}
	if err != nil {
		return FileContent{}, changes, err
	}
	content := FileContent{File: f, Lines: []gitrepo.Line{}}
	content.Token = fmt.Sprintf("%x", sha256.Sum256(append(append(slices.Clone(before), 0), after...)))
	content.Binary = slices.Contains(before, byte(0)) || slices.Contains(after, byte(0))
	for i, data := range [][]byte{before, after} {
		mime := http.DetectContentType(data)
		if strings.HasPrefix(mime, "image/") && len(data) <= 8<<20 {
			url := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			if i == 0 {
				content.BeforeImage = url
			} else {
				content.AfterImage = url
			}
			content.Binary = true
		}
	}
	if len(before)+len(after) > 2<<20 {
		content.Truncated = true
		return content, changes, nil
	}
	if !content.Binary {
		content.Before, content.After = string(before), string(after)
		content.Lines = gitrepo.DiffLines(content.Before, content.After)
	}
	return content, changes, nil
}
func (s *RepositoryService) File(req FileRequest) (FileContent, error) {
	content, _, err := s.file(req)
	return content, err
}

type LineSelection struct {
	Request          FileRequest
	Token            string
	Lines            []int
	Discard, Confirm bool
}

func (s *RepositoryService) ApplyLines(req LineSelection) error {
	release, err := s.lane(req.Request.Request.Path).local.acquire(context.Background(), "apply-lines", indexWait)
	if err != nil {
		return err
	}
	defer release()
	if req.Request.Request.Mode != "changes" {
		return errors.New("only current changes can be staged")
	}
	if req.Discard && !req.Confirm {
		return errors.New("discard requires confirmation")
	}
	content, changes, err := s.file(req.Request)
	if err != nil {
		return err
	}
	if content.Token != req.Token {
		return errors.New("file changed since it was loaded; refresh before applying lines")
	}
	if content.Binary || content.Truncated || content.File.Status == 'U' {
		return errors.New("select a complete file for this operation")
	}
	selected := map[int]bool{}
	for _, index := range req.Lines {
		if index < 0 || index >= len(content.Lines) || content.Lines[index].Kind == "context" {
			return errors.New("invalid changed line selection")
		}
		selected[index] = true
	}
	if len(selected) == 0 {
		return errors.New("choose changed lines first")
	}
	all := true
	for i, line := range content.Lines {
		if line.Kind != "context" && !selected[i] {
			all = false
		}
	}
	if all {
		if req.Discard {
			return s.git.Discard(changes.Top, content.File)
		}
		if content.File.Area == gitrepo.AreaStaged {
			return s.git.Unstage(changes.Top, content.File)
		}
		return s.git.Stage(changes.Top, content.File)
	}
	if req.Discard || content.File.Area == gitrepo.AreaStaged {
		inverse := map[int]bool{}
		for i := range content.Lines {
			inverse[i] = !selected[i]
		}
		selected = inverse
	}
	text := []byte(gitrepo.PickText(content.Lines, selected))
	if req.Discard {
		if err := confined(changes.Top, content.File.Path); err != nil {
			return err
		}
		return s.git.DiscardText(changes.Top, content.File.Path, text)
	}
	return s.git.StageText(changes.Top, content.File.Path, text)
}

func (s *RepositoryService) Blame(path, revision, file string) ([]gitrepo.BlameLine, error) {
	if err := safeRef(revision); err != nil {
		return nil, err
	}
	return s.git.Blame(path, revision, file)
}
func (s *RepositoryService) RebasePlan(path, base string) ([]gitrepo.Commit, error) {
	if err := safeRef(base); err != nil {
		return nil, err
	}
	return s.git.RebaseCommits(path, base)
}

func safeRef(ref string) error {
	if strings.HasPrefix(ref, "-") || strings.ContainsRune(ref, 0) {
		return errors.New("invalid revision or name")
	}
	return nil
}
func confined(top, file string) error {
	if !filepath.IsLocal(filepath.FromSlash(file)) {
		return errors.New("invalid file path")
	}
	root, err := filepath.EvalSymlinks(top)
	if err != nil {
		return err
	}
	path, err := filepath.EvalSymlinks(filepath.Join(top, filepath.FromSlash(file)))
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || !filepath.IsLocal(rel) {
		return errors.New("file resolves outside the worktree")
	}
	return nil
}
