package services

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

const (
	workflowLogsArchiveLimit = 32 << 20
	workflowLogsEntryLimit   = 8 << 20
	workflowLogsTotalLimit   = 64 << 20
	workflowLogsEntryCount   = 10000
	workflowLogsRedirects    = 5
)

// WorkflowJobLogs contains only the requested job's individual step logs.
// Missing files (for example, skipped steps) are omitted; aggregate job logs are
// never substituted for step logs. Content retains timestamps and group markers.
type WorkflowJobLogs struct {
	Steps []WorkflowStepLog
}

// WorkflowStepLog is the numbered step from GitHub's job metadata and ZIP.
type WorkflowStepLog struct {
	Number  int
	Content string
}

type workflowLogJob struct {
	ID         int64  `json:"id"`
	RunID      int64  `json:"run_id"`
	RunAttempt int    `json:"run_attempt"`
	Name       string `json:"name"`
	Steps      []struct {
		Number int `json:"number"`
	} `json:"steps"`
}

// JobLogs downloads the official run log archive and returns the requested job's
// actual per-step files. Completed jobs may still have no downloadable logs if
// GitHub has not finished publishing them or their retention period has expired.
func (s *WorkflowService) JobLogs(target WorkflowTarget, runID, jobID int64) (WorkflowJobLogs, error) {
	result := WorkflowJobLogs{Steps: []WorkflowStepLog{}}
	if err := s.requireGitHub(target); err != nil {
		return result, err
	}
	if runID <= 0 || jobID <= 0 {
		return result, errors.New("读取步骤日志需要有效的运行记录 ID 和作业 ID")
	}
	client, err := s.workflowLogClient()
	if err != nil {
		return result, err
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return result, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()

	// Reuse the API helper with a redirect-stopping client for metadata too: even
	// an unexpected API redirect must not carry the credential to another host.
	api := &WorkflowService{client: client, apiBase: s.apiBase}
	base := fmt.Sprintf("/repos/%s/%s/actions", url.PathEscape(target.Owner), url.PathEscape(target.Repo))
	status, body, err := api.gitHub(ctx, http.MethodGet, fmt.Sprintf("%s/jobs/%d", base, jobID), nil, nil, token)
	if err != nil {
		return result, fmt.Errorf("无法读取作业日志元数据：%w", err)
	}
	if status != http.StatusOK {
		return result, fmt.Errorf("无法读取作业日志元数据：%w", gitHubError(status, body))
	}
	var job workflowLogJob
	if err := json.Unmarshal(body, &job); err != nil {
		return result, fmt.Errorf("无法解析作业日志元数据：%w", err)
	}
	if job.ID != jobID || job.RunID != runID {
		return result, fmt.Errorf("作业 %d 不属于运行记录 %d（GitHub 返回作业 %d、运行记录 %d）", jobID, runID, job.ID, job.RunID)
	}
	if strings.TrimSpace(job.Name) == "" || job.RunAttempt < 0 {
		return result, errors.New("GitHub 作业元数据缺少有效的作业名称或运行尝试编号")
	}

	route := fmt.Sprintf("%s/runs/%d/logs", base, runID)
	if job.RunAttempt > 0 {
		// The plain run endpoint serves the latest attempt, which may no longer
		// contain this job ID after a rerun (even for a job from attempt 1).
		route = fmt.Sprintf("%s/runs/%d/attempts/%d/logs", base, runID, job.RunAttempt)
	}
	archive, err := workflowLogDownload(ctx, client, strings.TrimRight(s.apiBase, "/")+route, token)
	if err != nil {
		return result, err
	}
	return workflowLogSteps(archive, job)
}

// workflowLogClient isolates redirect policy from the service's shared client.
// An opaque Do implementation cannot guarantee that it will not forward the
// token, so fail closed instead of making an authenticated request through it.
func (s *WorkflowService) workflowLogClient() (*http.Client, error) {
	client, ok := s.client.(*http.Client)
	if !ok || client == nil {
		return nil, errors.New("安全下载 GitHub 日志需要 *http.Client，以便阻止自动转发令牌")
	}
	clone := *client
	clone.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	clone.Jar = nil
	return &clone, nil
}

func workflowLogDownload(ctx context.Context, client *http.Client, endpoint, token string) ([]byte, error) {
	for redirects := 0; ; redirects++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil || request.URL.Host == "" || request.URL.User != nil || (request.URL.Scheme != "http" && request.URL.Scheme != "https") {
			return nil, errors.New("GitHub 返回了无效的日志下载地址")
		}
		request.Header.Set("User-Agent", "MyGit")
		if redirects == 0 {
			request.Header.Set("Accept", "application/vnd.github+json")
			if token != "" {
				request.Header.Set("Authorization", "Bearer "+token)
			}
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("无法下载 GitHub 作业日志，请稍后重试：%w", err)
		}
		switch response.StatusCode {
		case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
			next, locationErr := response.Location()
			response.Body.Close()
			if locationErr != nil {
				return nil, errors.New("GitHub 日志下载重定向缺少有效的 Location 地址")
			}
			if redirects >= workflowLogsRedirects {
				return nil, errors.New("GitHub 日志下载重定向次数过多，请稍后重试")
			}
			if request.URL.Scheme == "https" && next.Scheme != "https" {
				return nil, errors.New("GitHub 日志下载地址不能从 HTTPS 降级到 HTTP")
			}
			// Build a fresh unauthenticated request, including same-host hops.
			endpoint = next.String()
			continue
		}
		if response.StatusCode != http.StatusOK {
			body, readErr := io.ReadAll(io.LimitReader(response.Body, workflowBodyLimit))
			response.Body.Close()
			if readErr != nil {
				return nil, fmt.Errorf("无法读取 GitHub 日志下载错误：%w", readErr)
			}
			if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone || response.StatusCode == http.StatusAccepted || response.StatusCode == http.StatusNoContent {
				return nil, fmt.Errorf("GitHub 作业日志暂不可用（%d）：请等待作业完成后重试；日志也可能已过保留期或被删除，请在 GitHub Actions 中确认", response.StatusCode)
			}
			return nil, fmt.Errorf("无法下载 GitHub 作业日志：%w", gitHubError(response.StatusCode, body))
		}
		if response.ContentLength > workflowLogsArchiveLimit {
			response.Body.Close()
			return nil, fmt.Errorf("GitHub 日志 ZIP 超过 %d MiB 下载上限，请在 GitHub Actions 网页下载", workflowLogsArchiveLimit>>20)
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, workflowLogsArchiveLimit+1))
		response.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("无法读取 GitHub 日志 ZIP：%w", readErr)
		}
		if len(body) > workflowLogsArchiveLimit {
			return nil, fmt.Errorf("GitHub 日志 ZIP 超过 %d MiB 下载上限，请在 GitHub Actions 网页下载", workflowLogsArchiveLimit>>20)
		}
		return body, nil
	}
}

func workflowLogSteps(archive []byte, job workflowLogJob) (WorkflowJobLogs, error) {
	result := WorkflowJobLogs{Steps: []WorkflowStepLog{}}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return result, fmt.Errorf("GitHub 未返回有效的日志 ZIP，请稍后重试或在 GitHub Actions 中查看：%w", err)
	}
	if len(reader.File) > workflowLogsEntryCount {
		return result, errors.New("GitHub 日志 ZIP 文件数超过安全上限，请在 GitHub Actions 网页下载")
	}
	folders := make(map[string]map[int]*zip.File)
	numbers := make(map[int]bool, len(job.Steps))
	for _, step := range job.Steps {
		if step.Number > 0 {
			numbers[step.Number] = true
		}
	}
	var total uint64
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		if file.UncompressedSize64 > workflowLogsEntryLimit || file.UncompressedSize64 > workflowLogsTotalLimit-total {
			return result, fmt.Errorf("GitHub 日志 ZIP 解压大小超过安全上限（单文件 %d MiB、总计 %d MiB），请在 GitHub Actions 网页下载", workflowLogsEntryLimit>>20, workflowLogsTotalLimit>>20)
		}
		total += file.UncompressedSize64
		// No files are extracted to disk. Reject unsafe names nevertheless so
		// traversal aliases cannot accidentally match a different job folder.
		if strings.HasPrefix(file.Name, "/") || strings.Contains(file.Name, "\\") {
			continue
		}
		unsafe := false
		for _, part := range strings.Split(file.Name, "/") {
			if part == "." || part == ".." || part == "" {
				unsafe = true
				break
			}
		}
		if unsafe {
			continue
		}
		slash := strings.LastIndexByte(file.Name, '/')
		if slash < 1 {
			continue // Ignore the aggregate <job>.txt at the ZIP root.
		}
		folder, name := file.Name[:slash], file.Name[slash+1:]
		prefix, _, found := strings.Cut(name, "_")
		number, parseErr := strconv.Atoi(prefix)
		if !found || parseErr != nil || !numbers[number] || !strings.HasSuffix(strings.ToLower(name), ".txt") {
			continue
		}
		if folders[folder] == nil {
			folders[folder] = make(map[int]*zip.File)
		}
		if folders[folder][number] != nil {
			return result, fmt.Errorf("GitHub 日志 ZIP 中作业 %q 的步骤 %d 有多个文件，无法可靠匹配日志", folder, number)
		}
		folders[folder][number] = file
	}
	selected := folders[job.Name]
	if selected == nil {
		// GitHub may sanitize characters invalid in Windows filenames. Match
		// only this specific transformation, and only if the result is unique;
		// never guess by using the only unrelated folder in an archive.
		key := workflowLogFolderKey(job.Name)
		for folder, files := range folders {
			if workflowLogFolderKey(folder) != key {
				continue
			}
			if selected != nil {
				return result, fmt.Errorf("GitHub 日志 ZIP 中作业 %q 的目录匹配不唯一，无法可靠匹配日志", job.Name)
			}
			selected = files
		}
	}
	if len(selected) == 0 {
		return result, fmt.Errorf("GitHub 尚无作业 %q 可匹配的步骤日志；请等待日志发布后重试，或在 GitHub Actions 中确认日志是否已删除或过期", job.Name)
	}
	ordered := make([]int, 0, len(selected))
	for number := range selected {
		ordered = append(ordered, number)
	}
	sort.Ints(ordered)
	var readTotal int64
	for _, number := range ordered {
		file := selected[number]
		stream, openErr := file.Open()
		if openErr != nil {
			return WorkflowJobLogs{Steps: []WorkflowStepLog{}}, fmt.Errorf("无法打开步骤 %d 日志：%w", number, openErr)
		}
		content, readErr := io.ReadAll(io.LimitReader(stream, workflowLogsEntryLimit+1))
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil {
			return WorkflowJobLogs{Steps: []WorkflowStepLog{}}, fmt.Errorf("无法解压步骤 %d 日志：%w", number, errors.Join(readErr, closeErr))
		}
		readTotal += int64(len(content))
		if len(content) > workflowLogsEntryLimit || readTotal > workflowLogsTotalLimit {
			return WorkflowJobLogs{Steps: []WorkflowStepLog{}}, errors.New("GitHub 步骤日志解压大小超过安全上限，请在 GitHub Actions 网页下载")
		}
		result.Steps = append(result.Steps, WorkflowStepLog{Number: number, Content: strings.ToValidUTF8(string(content), "�")})
	}
	return result, nil
}

func workflowLogFolderKey(name string) string {
	return strings.TrimRight(strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, name), ". ")
}
