package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/charmbracelet/x/xpty"
)

type terminalSession struct {
	mu        sync.Mutex
	writeMu   sync.Mutex
	closeOnce sync.Once
	pty       xpty.Pty
	cmd       *exec.Cmd
	data      []byte
	base      int64
	closed    bool
}
type TerminalService struct {
	mu       sync.Mutex
	sessions map[string]*terminalSession

	commandsMu   sync.Mutex
	commandsPath string
	// commands holds the in-memory fallback (no data directory), keyed by
	// project path. common is the same fallback for shortcuts shared by every
	// project.
	commands map[string][]TerminalCommand
	common   []TerminalCommand

	// sessionMu guards the saved terminal layout written to
	// terminal-sessions.json, the tabs offered for restore on the next launch.
	sessionMu   sync.Mutex
	sessionPath string
}
type TerminalOutput struct {
	Data   string
	Offset int64
	Closed bool
	Reset  bool
}

// TerminalProfile describes one shell the user can launch in a terminal tab.
type TerminalProfile struct {
	ID        string
	Label     string
	Shell     string
	Args      []string
	Detail    string
	Kind      string
	Available bool
	Default   bool
}

// TerminalCommand is a user-maintained shortcut: a command line and the shell
// profile it should be typed into.
type TerminalCommand struct {
	ID      string
	Label   string
	Command string
	Profile string
	// Path is the working directory the shortcut runs in. Empty means "use the
	// project folder". It may point anywhere; the command still belongs to the
	// project it is stored under.
	Path string
}

// TerminalCommandLists is the pair the terminal sidebar shows: the selected
// project's shortcuts and the general shortcuts shared by every project.
type TerminalCommandLists struct {
	Project []TerminalCommand
	Common  []TerminalCommand
}

// terminalCommandFile is the on-disk shape. Projects maps a project path to its
// own shortcut list, so the terminal command sidebar follows the selected
// project. Common is the list shown in every project. Commands is the
// pre-per-project layout; it is migrated into the first project that reads it.
type terminalCommandFile struct {
	Commands []TerminalCommand            `json:"Commands,omitempty"`
	Common   []TerminalCommand            `json:"Common,omitempty"`
	Projects map[string][]TerminalCommand `json:"Projects,omitempty"`
}

// NewTerminalService creates the terminal service. The directory, when set,
// stores the user's shortcut commands in terminal-commands.json.
func NewTerminalService(dir string) *TerminalService {
	service := &TerminalService{
		sessions: map[string]*terminalSession{},
		commands: map[string][]TerminalCommand{},
	}
	if dir != "" {
		service.commandsPath = filepath.Join(dir, "terminal-commands.json")
		service.sessionPath = filepath.Join(dir, "terminal-sessions.json")
	}
	return service
}

// Profiles lists the shells detected on this machine so the terminal sidebar
// can offer a command list. Unavailable profiles stay visible but disabled.
func (s *TerminalService) Profiles() []TerminalProfile {
	return terminalProfileList()
}

func terminalProfileList() []TerminalProfile {
	profiles := terminalProfiles()
	for _, profile := range profiles {
		if profile.Default && profile.Available {
			return profiles
		}
	}
	for index := range profiles {
		profiles[index].Default = false
	}
	for index := range profiles {
		if profiles[index].Available {
			profiles[index].Default = true
			break
		}
	}
	return profiles
}

// Commands returns the shortcut commands saved for a project.
func (s *TerminalService) Commands(project string) ([]TerminalCommand, error) {
	s.commandsMu.Lock()
	defer s.commandsMu.Unlock()
	return s.loadCommands(project)
}

// SaveCommands validates and stores a project's full shortcut command list,
// filling in IDs for new entries. It returns the normalised list so the UI can
// keep the assigned IDs.
func (s *TerminalService) SaveCommands(project string, commands []TerminalCommand) ([]TerminalCommand, error) {
	if strings.TrimSpace(project) == "" {
		return nil, errors.New("terminal commands require a project")
	}
	normalised, err := normaliseTerminalCommands(commands)
	if err != nil {
		return nil, err
	}
	s.commandsMu.Lock()
	defer s.commandsMu.Unlock()
	if err := s.writeCommands(project, normalised); err != nil {
		return nil, err
	}
	return normalised, nil
}

// CommonCommands returns the general shortcuts shown in every project.
func (s *TerminalService) CommonCommands() ([]TerminalCommand, error) {
	s.commandsMu.Lock()
	defer s.commandsMu.Unlock()
	if s.commandsPath == "" {
		return append([]TerminalCommand{}, s.common...), nil
	}
	file, err := s.readCommandFile()
	if err != nil {
		return nil, err
	}
	return append([]TerminalCommand{}, file.Common...), nil
}

// SaveCommonCommands validates and stores the full general shortcut list.
func (s *TerminalService) SaveCommonCommands(commands []TerminalCommand) ([]TerminalCommand, error) {
	normalised, err := normaliseTerminalCommands(commands)
	if err != nil {
		return nil, err
	}
	s.commandsMu.Lock()
	defer s.commandsMu.Unlock()
	if s.commandsPath == "" {
		s.common = normalised
		return normalised, nil
	}
	file, err := s.readCommandFile()
	if err != nil {
		return nil, err
	}
	file.Common = normalised
	if err := s.writeCommandFile(file); err != nil {
		return nil, err
	}
	return normalised, nil
}

// MoveCommand moves one shortcut between a project's list and the general
// list. Both lists are rewritten in the same file write, so a move can never
// leave the command in neither list (or in both).
func (s *TerminalService) MoveCommand(project, id string, toCommon bool) (TerminalCommandLists, error) {
	project = strings.TrimSpace(project)
	if project == "" {
		return TerminalCommandLists{}, errors.New("terminal commands require a project")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return TerminalCommandLists{}, errors.New("terminal command id is required")
	}
	s.commandsMu.Lock()
	defer s.commandsMu.Unlock()

	projects := s.commands
	common := s.common
	var file terminalCommandFile
	if s.commandsPath != "" {
		loaded, err := s.readCommandFile()
		if err != nil {
			return TerminalCommandLists{}, err
		}
		file = loaded
		projects = file.Projects
		common = file.Common
	}

	from, to := projects[project], common
	if !toCommon {
		from, to = common, projects[project]
	}
	index := -1
	for i := range from {
		if from[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return TerminalCommandLists{}, errors.New("terminal command not found")
	}
	moved := from[index]
	remaining := append(from[:index:index], from[index+1:]...)
	next := append(to, moved)
	if toCommon {
		projects[project], common = remaining, next
	} else {
		common, projects[project] = remaining, next
	}

	if s.commandsPath == "" {
		s.commands = projects
		s.common = common
	} else {
		file.Projects = projects
		file.Common = common
		if err := s.writeCommandFile(file); err != nil {
			return TerminalCommandLists{}, err
		}
	}
	return TerminalCommandLists{
		Project: append([]TerminalCommand{}, projects[project]...),
		Common:  append([]TerminalCommand{}, common...),
	}, nil
}

func normaliseTerminalCommands(commands []TerminalCommand) ([]TerminalCommand, error) {
	if len(commands) > 100 {
		return nil, errors.New("too many terminal commands")
	}
	known := map[string]bool{}
	for _, profile := range terminalProfiles() {
		known[profile.ID] = true
	}
	normalised := make([]TerminalCommand, 0, len(commands))
	for _, command := range commands {
		command.Label = strings.TrimSpace(command.Label)
		command.Command = strings.TrimSpace(command.Command)
		command.Profile = strings.TrimSpace(command.Profile)
		command.Path = strings.TrimSpace(command.Path)
		if command.Label == "" {
			return nil, errors.New("terminal command name is required")
		}
		if command.Command == "" {
			return nil, errors.New("terminal command line is required")
		}
		if command.Profile != "" && !known[command.Profile] {
			return nil, fmt.Errorf("unknown terminal shell %q", command.Profile)
		}
		if command.ID == "" {
			command.ID = rand.Text()
		}
		normalised = append(normalised, command)
	}
	return normalised, nil
}

func (s *TerminalService) loadCommands(project string) ([]TerminalCommand, error) {
	if s.commandsPath == "" {
		return append([]TerminalCommand{}, s.commands[project]...), nil
	}
	file, err := s.readCommandFile()
	if err != nil {
		return nil, err
	}
	if list, ok := file.Projects[project]; ok {
		return append([]TerminalCommand{}, list...), nil
	}
	// One-time migration: the old single-file list belongs to the first project
	// that loads it, so existing shortcuts are not lost.
	if project != "" && len(file.Commands) > 0 {
		file.Projects[project] = append([]TerminalCommand{}, file.Commands...)
		file.Commands = nil
		if err := s.writeCommandFile(file); err != nil {
			return nil, err
		}
		return append([]TerminalCommand{}, file.Projects[project]...), nil
	}
	return []TerminalCommand{}, nil
}

func (s *TerminalService) readCommandFile() (terminalCommandFile, error) {
	data, err := os.ReadFile(s.commandsPath)
	if errors.Is(err, os.ErrNotExist) {
		return terminalCommandFile{Projects: map[string][]TerminalCommand{}}, nil
	}
	if err != nil {
		return terminalCommandFile{}, fmt.Errorf("read terminal commands: %w", err)
	}
	var file terminalCommandFile
	if err := json.Unmarshal(data, &file); err != nil {
		return terminalCommandFile{}, fmt.Errorf("parse terminal commands: %w", err)
	}
	if file.Projects == nil {
		file.Projects = map[string][]TerminalCommand{}
	}
	return file, nil
}

func (s *TerminalService) writeCommands(project string, commands []TerminalCommand) error {
	if s.commandsPath == "" {
		if s.commands == nil {
			s.commands = map[string][]TerminalCommand{}
		}
		s.commands[project] = append([]TerminalCommand{}, commands...)
		return nil
	}
	file, err := s.readCommandFile()
	if err != nil {
		return err
	}
	file.Projects[project] = append([]TerminalCommand{}, commands...)
	return s.writeCommandFile(file)
}

func (s *TerminalService) writeCommandFile(file terminalCommandFile) error {
	if err := os.MkdirAll(filepath.Dir(s.commandsPath), 0o755); err != nil {
		return fmt.Errorf("create terminal commands directory: %w", err)
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.commandsPath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return fmt.Errorf("write terminal commands: %w", err)
	}
	if err := os.Rename(temporary, s.commandsPath); err != nil {
		return fmt.Errorf("replace terminal commands: %w", err)
	}
	return nil
}

func resolveTerminalProfile(id string) (TerminalProfile, error) {
	profiles := terminalProfileList()
	if id == "" {
		for _, profile := range profiles {
			if profile.Default && profile.Available {
				return profile, nil
			}
		}
		return TerminalProfile{}, errors.New("no terminal shell is available")
	}
	for _, profile := range profiles {
		if profile.ID != id {
			continue
		}
		if !profile.Available {
			return TerminalProfile{}, fmt.Errorf("terminal shell %q is not installed", profile.Label)
		}
		return profile, nil
	}
	return TerminalProfile{}, fmt.Errorf("unknown terminal shell %q", id)
}

func (s *TerminalService) Start(path string, columns, rows int, profile string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("terminal needs a directory")
	}
	if columns < 20 || columns > 500 || rows < 4 || rows > 300 {
		return "", errors.New("invalid terminal dimensions")
	}
	shell, err := resolveTerminalProfile(profile)
	if err != nil {
		return "", err
	}
	pty, err := xpty.NewPty(columns, rows)
	if err != nil {
		return "", err
	}
	cmd := exec.Command(shell.Shell, shell.Args...)
	cmd.Dir = path
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	configureTerminal(cmd)
	if err := pty.Start(cmd); err != nil {
		_ = pty.Close()
		return "", err
	}
	session := &terminalSession{pty: pty, cmd: cmd}
	id := fmt.Sprintf("%x", rand.Text())
	s.mu.Lock()
	s.sessions[id] = session
	s.mu.Unlock()
	go func() {
		buf := make([]byte, 16*1024)
		for {
			n, err := pty.Read(buf)
			if n > 0 {
				session.mu.Lock()
				session.data = append(session.data, buf[:n]...)
				if len(session.data) > 2<<20 {
					drop := len(session.data) - (1 << 20)
					session.data = append([]byte(nil), session.data[drop:]...)
					session.base += int64(drop)
				}
				session.mu.Unlock()
			}
			if err != nil {
				break
			}
		}
		session.mu.Lock()
		session.closed = true
		session.mu.Unlock()
	}()
	go func() {
		_ = xpty.WaitProcess(context.Background(), cmd)
		_ = session.closePty()
	}()
	return id, nil
}
func (s *TerminalService) session(id string) (*terminalSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session := s.sessions[id]
	if session == nil {
		return nil, errors.New("terminal session is closed")
	}
	return session, nil
}
func (s *TerminalService) Read(id string, offset int64) (TerminalOutput, error) {
	session, err := s.session(id)
	if err != nil {
		return TerminalOutput{}, err
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	end := session.base + int64(len(session.data))
	reset := offset < session.base
	if offset < session.base {
		offset = session.base
	}
	if offset > end {
		offset = end
	}
	return TerminalOutput{Data: base64.StdEncoding.EncodeToString(session.data[offset-session.base:]), Offset: end, Closed: session.closed, Reset: reset}, nil
}
func (s *TerminalService) Write(id, data string) error {
	session, err := s.session(id)
	if err != nil {
		return err
	}
	session.writeMu.Lock()
	defer session.writeMu.Unlock()
	_, err = session.pty.Write([]byte(data))
	return err
}
func (s *TerminalService) Resize(id string, columns, rows int) error {
	if columns < 20 || columns > 500 || rows < 4 || rows > 300 {
		return errors.New("invalid terminal dimensions")
	}
	session, err := s.session(id)
	if err != nil {
		return err
	}
	session.writeMu.Lock()
	defer session.writeMu.Unlock()
	return session.pty.Resize(columns, rows)
}
func (s *TerminalService) Close(id string) error {
	s.mu.Lock()
	session := s.sessions[id]
	delete(s.sessions, id)
	s.mu.Unlock()
	if session == nil {
		return nil
	}
	if session.cmd.Process != nil {
		if err := stopTerminal(session.cmd); err != nil {
			// On Windows, closing a ConPTY with surviving child processes can
			// block. The process waiter closes it after the shell exits.
			return err
		}
	}
	return session.closePty()
}
func (s *TerminalService) ServiceShutdown() error {
	s.mu.Lock()
	ids := make([]string, 0, len(s.sessions))
	for id := range s.sessions {
		ids = append(ids, id)
	}
	s.mu.Unlock()
	for _, id := range ids {
		_ = s.Close(id)
	}
	return nil
}

func (s *terminalSession) closePty() error {
	var err error
	s.closeOnce.Do(func() { err = s.pty.Close() })
	return err
}
