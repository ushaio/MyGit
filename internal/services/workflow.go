package services

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/zalando/go-keyring"
)

// The workflow panel talks to a hosting platform's Actions/CICD REST API. It is
// deliberately a separate service from RepositoryService so pipeline network
// traffic never runs inside the Git command lanes.

// WorkflowTarget is a repository a workflow panel can operate on. ResolveTarget
// produces one from a remote name and URL.
type WorkflowTarget struct {
	Platform string // "github" | "gitee" | "gitcode"
	Host     string // 远程主机，例如 "github.com"
	APIHost  string // API 主机，例如 "api.github.com"；Gitee/GitCode 为空
	Owner    string
	Repo     string
	Remote   string // 远程名称，例如 "origin"
	WebURL   string // 平台网页地址，例如 https://github.com/owner/repo
}

// WorkflowCapabilities says which operations a target supports. Gitee/GitCode
// only have OpenWeb=true until a public management API is confirmed.
type WorkflowCapabilities struct {
	ListWorkflows bool
	ListRuns      bool
	Dispatch      bool
	Rerun         bool
	Cancel        bool
	OpenWeb       bool
}

// Workflow is one workflow definition in a repository.
type Workflow struct {
	ID      int64
	Name    string
	Path    string // 例如 .github/workflows/ci.yml
	State   string // active | disabled_manually | ...
	HTMLURL string
}

// WorkflowRun is one execution of a workflow.
type WorkflowRun struct {
	ID         int64
	WorkflowID int64
	Number     int
	Title      string
	Status     string // queued | in_progress | completed | ...
	Conclusion string // success | failure | cancelled | skipped | ""（未完成时）
	Branch     string
	HeadSHA    string
	Event      string
	CreatedAt  string // ISO8601
	UpdatedAt  string
	HTMLURL    string
}

// WorkflowStep is one step inside a job (the leaf of the run → job → step tree).
type WorkflowStep struct {
	Number      int
	Name        string
	Status      string // queued | in_progress | completed | ...
	Conclusion  string // success | failure | skipped | cancelled | ""
	StartedAt   string // ISO8601
	CompletedAt string
}

// WorkflowJob is one job of a run. A matrix expands into one job per combination,
// which is why a single run can carry several "Build & Package (...)"" jobs.
type WorkflowJob struct {
	ID          int64
	RunID       int64
	Name        string
	Status      string
	Conclusion  string
	StartedAt   string
	CompletedAt string
	Steps       []WorkflowStep
}

// WorkflowJobs is the job list for one run.
type WorkflowJobs struct {
	Jobs  []WorkflowJob
	Total int
}

// WorkflowList is one page of workflow definitions.
type WorkflowList struct {
	Workflows []Workflow
	Total     int
	Page      int
	PerPage   int
	HasMore   bool
}

// WorkflowRuns is one page of workflow run history.
type WorkflowRuns struct {
	Runs    []WorkflowRun
	Total   int
	Page    int
	PerPage int
	HasMore bool
}

// WorkflowAccount reports whether a target's platform has a stored credential.
type WorkflowAccount struct {
	Platform   string
	Host       string
	Configured bool
	Account    string // 已配置返回登录名；未知为 ""
}

// WorkflowInput is one workflow_dispatch parameter definition. Default doubles
// as the value the user submits back to Dispatch: the fixed interface is
// definition-shaped, so Dispatch reads each input's value from Default and only
// sends the non-empty ones.
type WorkflowInput struct {
	Name        string
	Description string
	Required    bool
	Type        string // "string" | "boolean" | "choice" | "environment"
	Default     string
	Options     []string // 仅 choice 有值
}

// httpDoer is the minimal HTTP surface the service needs; tests inject a fake.
type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

// credentialStore is the secret backend; the keyring.ErrNotFound sentinel means
// "nothing stored". Tests inject an in-memory fake so no real keyring is touched.
type credentialStore interface {
	Get(service, account string) (string, error)
	Set(service, account, secret string) error
	Delete(service, account string) error
}

// keyringCredentialStore is the production credentialStore, backed by the OS
// keychain. It never falls back to a plaintext file.
type keyringCredentialStore struct{}

func (keyringCredentialStore) Get(service, account string) (string, error) {
	return keyring.Get(service, account)
}

func (keyringCredentialStore) Set(service, account, secret string) error {
	return keyring.Set(service, account, secret)
}

func (keyringCredentialStore) Delete(service, account string) error {
	return keyring.Delete(service, account)
}

const (
	workflowKeyringService = "mygit-wails3.workflows"
	workflowTimeout        = 20 * time.Second
	workflowPerPage        = 20

	defaultGitHubAPIBase = "https://api.github.com"
)

// WorkflowService is the Wails service backing the workflow panel.
type WorkflowService struct {
	client  httpDoer
	creds   credentialStore
	apiBase string // GitHub REST base; tests point this at an httptest server

	mu     sync.Mutex
	logins map[string]string // "platform|host" → login, cached after SaveToken
}

// NewWorkflowService builds the production service: the system keychain and the
// shared http.DefaultClient.
func NewWorkflowService() *WorkflowService {
	return newWorkflowService(http.DefaultClient, keyringCredentialStore{}, defaultGitHubAPIBase)
}

// newWorkflowService is the injectable constructor used by tests.
func newWorkflowService(client httpDoer, creds credentialStore, apiBase string) *WorkflowService {
	return &WorkflowService{
		client:  client,
		creds:   creds,
		apiBase: apiBase,
		logins:  make(map[string]string),
	}
}

// Capabilities is the pure capability matrix for a target's platform.
func (s *WorkflowService) Capabilities(target WorkflowTarget) WorkflowCapabilities {
	if target.Platform == "github" {
		return WorkflowCapabilities{
			ListWorkflows: true,
			ListRuns:      true,
			Dispatch:      true,
			Rerun:         true,
			Cancel:        true,
			OpenWeb:       true,
		}
	}
	// Gitee and GitCode:公开管理接口核实前只有网页入口。
	return WorkflowCapabilities{OpenWeb: true}
}

// Account reports whether a token is stored for the target and, when the login
// name is known (cached after SaveToken), which account it belongs to.
func (s *WorkflowService) Account(target WorkflowTarget) (WorkflowAccount, error) {
	account := WorkflowAccount{Platform: target.Platform, Host: target.Host}
	if target.Platform != "github" {
		return account, nil
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return account, err
	}
	if token == "" {
		return account, nil
	}
	account.Configured = true
	s.mu.Lock()
	account.Account = s.logins[credentialAccount(target.Platform, target.Host)]
	s.mu.Unlock()
	return account, nil
}

// SaveToken validates a GitHub token against GET /user, then stores it in the
// keychain. Non-GitHub platforms are not supported yet.
func (s *WorkflowService) SaveToken(target WorkflowTarget, token string) (WorkflowAccount, error) {
	account := WorkflowAccount{Platform: target.Platform, Host: target.Host}
	if target.Platform != "github" {
		return account, unsupportedPlatformError(target.Platform)
	}
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return account, errors.New("enter a GitHub token")
	}
	login, err := s.verifyToken(trimmed)
	if err != nil {
		return account, err
	}
	key := credentialAccount(target.Platform, target.Host)
	if err := s.creds.Set(workflowKeyringService, key, trimmed); err != nil {
		return account, fmt.Errorf("could not save the token in the system keyring: %w", err)
	}
	s.mu.Lock()
	s.logins[key] = login
	s.mu.Unlock()
	return WorkflowAccount{Platform: target.Platform, Host: target.Host, Configured: true, Account: login}, nil
}

// DeleteToken forgets the stored GitHub token for a target.
func (s *WorkflowService) DeleteToken(target WorkflowTarget) (WorkflowAccount, error) {
	account := WorkflowAccount{Platform: target.Platform, Host: target.Host}
	if target.Platform != "github" {
		return account, unsupportedPlatformError(target.Platform)
	}
	key := credentialAccount(target.Platform, target.Host)
	if err := s.creds.Delete(workflowKeyringService, key); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return account, fmt.Errorf("could not delete the saved GitHub token: %w", err)
	}
	s.mu.Lock()
	delete(s.logins, key)
	s.mu.Unlock()
	return account, nil
}

// credentialAccount is the keyring account name for a platform/host pair.
func credentialAccount(platform, host string) string {
	return platform + "|" + host
}

// tokenFor reads the stored token, treating "not found" as an empty token.
func (s *WorkflowService) tokenFor(target WorkflowTarget) (string, error) {
	token, err := s.creds.Get(workflowKeyringService, credentialAccount(target.Platform, target.Host))
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return "", nil
		}
		return "", fmt.Errorf("could not read the saved GitHub token: %w", err)
	}
	return strings.TrimSpace(token), nil
}

// unsupportedPlatformError explains that only GitHub Actions are manageable.
func unsupportedPlatformError(platform string) error {
	return fmt.Errorf("%s 暂不支持管理令牌与工作流，仅支持 GitHub Actions", platformLabel(platform))
}

// platformLabel is the human name for a platform id.
func platformLabel(platform string) string {
	switch platform {
	case "github":
		return "GitHub"
	case "gitee":
		return "Gitee"
	case "gitcode":
		return "GitCode"
	}
	if platform == "" {
		return "该平台"
	}
	return platform
}
