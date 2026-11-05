package services

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// A worktree used to reject a second writer outright, so a fast click became an
// error toast. Writers now queue: the UI never loses a click because one git
// command is still running. Two lanes keep the queue honest — local index work
// waits behind other local work only, so a slow fetch can never block staging.
var (
	indexWait   = 15 * time.Second
	networkWait = 60 * time.Second
)

// remoteKinds reach the network but never write the index, so they run on the
// remote lane and leave staging available while they work. Everything else,
// pull included, touches the index and belongs on the local lane.
var remoteKinds = map[string]bool{
	"fetch": true, "push": true, "push-tag": true,
	"delete-remote-branch": true, "delete-remote-tag": true,
}

// serialKinds must not overlap even when queued: running a second commit or
// merge after the first one finishes would apply the operation twice.
var serialKinds = map[string]bool{
	"commit": true, "merge": true, "rebase": true, "interactive-rebase": true,
	"cherry-pick": true, "revert": true, "continue": true, "abort": true,
}

// serial is a one-slot FIFO gate: waiting senders are served in arrival order.
type serial struct {
	sem   chan struct{}
	mu    sync.Mutex
	kind  string
	since time.Time
}

func newSerial() *serial { return &serial{sem: make(chan struct{}, 1)} }

// acquire blocks until the lane frees up, the wait expires, or ctx ends. The
// returned release must be called exactly once when the operation is done.
func (s *serial) acquire(ctx context.Context, kind string, wait time.Duration) (func(), error) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case s.sem <- struct{}{}:
	case <-timer.C:
		return nil, s.busy()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	s.mu.Lock()
	s.kind, s.since = kind, time.Now()
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		s.kind = ""
		s.mu.Unlock()
		<-s.sem
	}, nil
}

func (s *serial) busy() error {
	s.mu.Lock()
	kind, since := s.kind, s.since
	s.mu.Unlock()
	if kind == "" {
		return errors.New("another operation is running in this worktree")
	}
	return fmt.Errorf("another operation is running in this worktree (%s, %s)", kind, time.Since(since).Round(time.Second))
}

type lane struct {
	local, remote *serial
	mu            sync.Mutex
	claimed       map[string]bool
}

func newLane() *lane { return &lane{local: newSerial(), remote: newSerial(), claimed: map[string]bool{}} }

func (l *lane) pick(network bool) *serial {
	if network {
		return l.remote
	}
	return l.local
}

// claim refuses to queue a second copy of an operation that cannot be applied
// twice. The claim is taken before waiting, so a queued commit blocks another
// commit while still letting an unrelated stage run.
func (l *lane) claim(kind string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.claimed[kind] {
		return false
	}
	l.claimed[kind] = true
	return true
}

func (l *lane) release(kind string) {
	l.mu.Lock()
	delete(l.claimed, kind)
	l.mu.Unlock()
}
