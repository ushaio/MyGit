package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
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
}
type TerminalOutput struct {
	Data   string
	Offset int64
	Closed bool
	Reset  bool
}

func NewTerminalService() *TerminalService {
	return &TerminalService{sessions: map[string]*terminalSession{}}
}
func (s *TerminalService) Start(path string, columns, rows int) (string, error) {
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
	shell := os.Getenv("SHELL")
	args := []string{"-l"}
	if runtime.GOOS == "windows" {
		shell, args = "powershell.exe", []string{"-NoLogo"}
	} else if shell == "" {
		shell = "/bin/sh"
	}
	pty, err := xpty.NewPty(columns, rows)
	if err != nil {
		return "", err
	}
	cmd := exec.Command(shell, args...)
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
		_ = stopTerminal(session.cmd)
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
