package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
)

// Node and Worktree are transport types shared by the Wails service.
type Node = projectNode
type Worktree = worktree

type Group struct {
	ID   string
	Name string
}
type Preferences struct {
	Theme        string
	Language     string
	Editor       string
	Wrap         bool
	SidebarWidth int
	// DefaultView is the workbench tab MyGit opens with: "git" shows the Git
	// view, "terminal" shows the terminal view and starts a terminal when the
	// selected project has none. Older workspace files fall back to "git".
	DefaultView string
	// AIURL, AIKey, AIModel and AICommitPrompt configure the AI service MyGit
	// asks for help. The key is written only to the local workspace file, which
	// the user owns. An empty AICommitPrompt means the built-in prompt.
	AIURL          string
	AIKey          string
	AIModel        string
	AICommitPrompt string
	// CloseAction is what the window close button does when the confirmation
	// reminder is off: "minimize" hides the window to the system tray, "exit"
	// quits the app. CloseConfirm keeps the reminder on, so the user is asked
	// again; the dialog's "remember" choice clears it.
	CloseAction  string
	CloseConfirm bool
}
type State struct {
	Version     int
	Roots       []string
	Trees       []*Node
	Groups      []Group
	Selected    string
	Worktrees   map[string]string
	Drafts      map[string]string
	PinnedRefs  map[string][]string
	AutoFetch   map[string][]string
	// ProjectOrder remembers the manual drag order of a sidebar section: the key
	// is "pinned" or a group id, the value is the project paths in display order.
	// Sections without an entry keep their default alphabetical order.
	ProjectOrder map[string][]string
	Preferences  Preferences
}

type Store struct {
	mu         sync.Mutex
	path       string
	state      State
	generation uint64
	cancel     context.CancelFunc
}

func NewStore(dir string) (*Store, error) {
	s := &Store{path: filepath.Join(dir, "workspace.json")}
	s.state = State{Version: 1, Roots: []string{}, Trees: []*Node{}, Groups: []Group{}, Worktrees: map[string]string{}, Drafts: map[string]string{}, PinnedRefs: map[string][]string{}, AutoFetch: map[string][]string{}, ProjectOrder: map[string][]string{}, Preferences: Preferences{Theme: "system", Language: "zh-CN", Wrap: true, SidebarWidth: 232, DefaultView: "git", CloseAction: "minimize", CloseConfirm: true}}
	data, err := os.ReadFile(s.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err := json.Unmarshal(data, &s.state); err != nil {
			return nil, fmt.Errorf("read workspace: %w", err)
		}
		if s.state.Version != 1 {
			return nil, fmt.Errorf("unsupported workspace version: %d", s.state.Version)
		}
	}
	if s.state.Worktrees == nil {
		s.state.Worktrees = map[string]string{}
	}
	if s.state.Drafts == nil {
		s.state.Drafts = map[string]string{}
	}
	if s.state.PinnedRefs == nil {
		s.state.PinnedRefs = map[string][]string{}
	}
	if s.state.AutoFetch == nil {
		s.state.AutoFetch = map[string][]string{}
	}
	if s.state.ProjectOrder == nil {
		s.state.ProjectOrder = map[string][]string{}
	}
	// Older workspace files predate the close-button preference; keep the
	// reminder on and default to hiding to the tray instead of quitting.
	if s.state.Preferences.CloseAction == "" {
		s.state.Preferences.CloseAction = "minimize"
	}
	if s.state.Preferences.CloseAction != "minimize" && s.state.Preferences.CloseAction != "exit" {
		s.state.Preferences.CloseAction = "minimize"
	}
	// Likewise, workspaces saved before the default-view preference existed
	// (or with an unknown value) open on the Git view.
	if s.state.Preferences.DefaultView != "git" && s.state.Preferences.DefaultView != "terminal" {
		s.state.Preferences.DefaultView = "git"
	}
	return s, nil
}

// Dir names the folder that holds the workspace file, so the app can show the
// user where its local data lives.
func (s *Store) Dir() string { return filepath.Dir(s.path) }

func clone(state State) State {
	data, _ := json.Marshal(state)
	var result State
	_ = json.Unmarshal(data, &result)
	return result
}

func (s *Store) Snapshot() State { s.mu.Lock(); defer s.mu.Unlock(); return clone(s.state) }

func (s *Store) update(edit func(*State) error) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := clone(s.state)
	if err := edit(&next); err != nil {
		return State{}, err
	}
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return State{}, err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return State{}, err
	}
	file, err := os.CreateTemp(filepath.Dir(s.path), ".workspace-*")
	if err != nil {
		return State{}, err
	}
	name := file.Name()
	defer os.Remove(name)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, s.path)
	}
	if err != nil {
		return State{}, fmt.Errorf("save workspace: %w", err)
	}
	s.state = next
	return clone(next), nil
}

func (s *Store) AddRoot(path string) (State, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return State{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return State{}, err
	}
	if !info.IsDir() {
		return State{}, errors.New("choose a directory")
	}
	return s.update(func(st *State) error {
		for _, root := range st.Roots {
			if sameDirectory(root, path) {
				return nil
			}
		}
		st.Roots = append(st.Roots, filepath.Clean(path))
		return nil
	})
}

func (s *Store) RemoveRoot(path string) (State, error) {
	s.mu.Lock()
	s.generation++
	if s.cancel != nil {
		s.cancel()
	}
	s.mu.Unlock()
	return s.update(func(st *State) error {
		st.Roots = slices.DeleteFunc(st.Roots, func(root string) bool { return root == path })
		// Keep cached nodes so adding the folder back restores metadata.
		return nil
	})
}

func walk(nodes []*Node, visit func(*Node)) {
	for _, node := range nodes {
		if node != nil {
			visit(node)
			walk(node.Children, visit)
		}
	}
}

func (s *Store) Projects() []*Node {
	st := s.Snapshot()
	var projects []*Node
	for _, tree := range st.Trees {
		if tree == nil || !slices.Contains(st.Roots, tree.Path) {
			continue
		}
		walk([]*Node{tree}, func(node *Node) {
			if node.Repository && !node.Removed {
				projects = append(projects, node)
			}
		})
	}
	slices.SortFunc(projects, func(a, b *Node) int { return strings.Compare(strings.ToLower(a.Path), strings.ToLower(b.Path)) })
	return projects
}

func (s *Store) Refresh(ctx context.Context) (State, error) {
	s.mu.Lock()
	s.generation++
	generation := s.generation
	if s.cancel != nil {
		s.cancel()
	}
	ctx, s.cancel = context.WithCancel(ctx)
	roots := slices.Clone(s.state.Roots)
	s.mu.Unlock()
	found := map[string]*Node{}
	var failures []error
	for _, root := range roots {
		tree, err := scanProjects(ctx, root)
		if ctx.Err() != nil {
			return State{}, ctx.Err()
		}
		if err != nil {
			failures = append(failures, err)
		}
		if tree == nil {
			// The root itself could not be scanned, so it has nothing to
			// publish; the folders that did scan keep their projects.
			if err != nil {
				continue
			}
			tree = &Node{Path: root}
		}
		tree.Root = true
		found[root] = tree
	}
	// One unreadable folder, such as a stale junction or a directory the user
	// may not open, must not hide the repositories found next to it: the
	// partial tree is published and the failure is reported on its own.
	if extra := len(failures) - 3; extra > 0 {
		failures = append(failures[:3:3], fmt.Errorf("and %d more folders could not be read", extra))
	}
	s.mu.Lock()
	stale := generation != s.generation
	s.mu.Unlock()
	if stale {
		return State{}, context.Canceled
	}
	state, err := s.update(func(st *State) error {
		if generation != s.generation {
			return context.Canceled
		}
		old := map[string]*Node{}
		walk(st.Trees, func(n *Node) { old[n.Path] = n })
		for root, tree := range found {
			walk([]*Node{tree}, func(n *Node) {
				if prev := old[n.Path]; prev != nil {
					n.Pinned, n.Removed, n.Group, n.Open, n.Icon = prev.Pinned, prev.Removed, prev.Group, prev.Open, prev.Icon
				}
			})
			index := slices.IndexFunc(st.Trees, func(n *Node) bool { return n != nil && n.Path == root })
			if index >= 0 {
				st.Trees[index] = tree
			} else {
				st.Trees = append(st.Trees, tree)
			}
		}
		return nil
	})
	if err != nil {
		return State{}, err
	}
	return state, errors.Join(failures...)
}

func (s *Store) SetProject(path, property, value string) (State, error) {
	return s.update(func(st *State) error {
		found := false
		walk(st.Trees, func(n *Node) {
			if n.Path != path {
				return
			}
			found = true
			switch property {
			case "pinned":
				n.Pinned = value == "true"
			case "removed":
				n.Removed = value == "true"
			case "group":
				n.Group = value
			case "open":
				n.Open = value == "true"
			case "icon":
				n.Icon = value
			}
		})
		if !found {
			return errors.New("project no longer exists")
		}
		return nil
	})
}

func (s *Store) RestoreProjects() (State, error) {
	return s.update(func(st *State) error { walk(st.Trees, func(n *Node) { n.Removed = false }); return nil })
}

// SetProjectOrder records the display order of one sidebar section. Paths that
// are empty or repeated are dropped so a stale drop cannot corrupt the list.
func (s *Store) SetProjectOrder(scope string, paths []string) (State, error) {
	return s.update(func(st *State) error {
		if st.ProjectOrder == nil {
			st.ProjectOrder = map[string][]string{}
		}
		cleaned := make([]string, 0, len(paths))
		seen := map[string]bool{}
		for _, path := range paths {
			if path == "" || seen[path] {
				continue
			}
			seen[path] = true
			cleaned = append(cleaned, path)
		}
		st.ProjectOrder[scope] = cleaned
		return nil
	})
}
func (s *Store) SetGroup(id, name string) (State, error) {
	return s.update(func(st *State) error {
		index := slices.IndexFunc(st.Groups, func(g Group) bool { return g.ID == id })
		if name == "" {
			if index >= 0 {
				st.Groups = slices.Delete(st.Groups, index, index+1)
			}
			walk(st.Trees, func(n *Node) {
				if n.Group == id {
					n.Group = ""
				}
			})
			return nil
		}
		if index >= 0 {
			st.Groups[index].Name = name
		} else {
			st.Groups = append(st.Groups, Group{ID: id, Name: name})
		}
		return nil
	})
}
func (s *Store) Select(project, worktree string) (State, error) {
	return s.update(func(st *State) error {
		st.Selected = project
		if worktree != "" {
			st.Worktrees[project] = worktree
		}
		return nil
	})
}
func (s *Store) SetDraft(path, message string) error {
	_, err := s.update(func(st *State) error { st.Drafts[path] = message; return nil })
	return err
}
func (s *Store) SetPreferences(p Preferences) (State, error) {
	p.AIURL, p.AIKey = strings.TrimSpace(p.AIURL), strings.TrimSpace(p.AIKey)
	p.AIModel = strings.TrimSpace(p.AIModel)
	p.AICommitPrompt = strings.TrimSpace(p.AICommitPrompt)
	if p.AIURL != "" && !validAIURL(p.AIURL) {
		return State{}, errors.New("enter an http(s) AI address")
	}
	switch p.CloseAction {
	case "minimize", "exit":
	case "":
		p.CloseAction = "minimize"
	default:
		return State{}, errors.New("invalid close action")
	}
	switch p.DefaultView {
	case "git", "terminal":
	case "":
		p.DefaultView = "git"
	default:
		return State{}, errors.New("invalid default view")
	}
	return s.update(func(st *State) error {
		if p.Theme != "system" && p.Theme != "light" && p.Theme != "dark" {
			return errors.New("invalid theme")
		}
		st.Preferences = p
		return nil
	})
}
func validAIURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

// RememberCloseAction stores the choice made in the close-confirmation dialog
// and turns the reminder off, so the same action is reused on the next close.
func (s *Store) RememberCloseAction(action string) (State, error) {
	if action != "minimize" && action != "exit" {
		return State{}, errors.New("invalid close action")
	}
	return s.update(func(st *State) error {
		st.Preferences.CloseAction = action
		st.Preferences.CloseConfirm = false
		return nil
	})
}
func (s *Store) PinRef(path, name string, pin bool) (State, error) {
	return s.update(func(st *State) error {
		refs := st.PinnedRefs[path]
		refs = slices.DeleteFunc(refs, func(ref string) bool { return ref == name })
		if pin {
			refs = append(refs, name)
		}
		st.PinnedRefs[path] = refs
		return nil
	})
}
func ListWorktrees(ctx context.Context, path string) ([]Worktree, error) {
	return listWorktrees(ctx, path)
}
