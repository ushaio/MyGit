package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Version is the version the running build reports. Keep it in sync with
// frontend/src/lib/app-info.ts and build/config.yml; a release build may
// override it with -ldflags "-X mygit-wails3/internal/services.Version=…".
var Version = "0.4.0"

const (
	updateTimeout   = 10 * time.Second
	downloadTimeout = 10 * time.Minute
)

// updateEndpoint is the public "latest release" route. GitHub redirects it to
// the newest tag, which avoids the unauthenticated API rate limit. It is a
// variable so tests can point it at a local server.
var updateEndpoint = "https://github.com/ushaio/MyGit/releases/latest"

// UpdateInfo compares the running version with the latest GitHub release. The
// Asset* fields point at the installer that matches this build's platform, so
// the UI can download it in place instead of sending the user to GitHub.
type UpdateInfo struct {
	Current     string
	Latest      string
	Available   bool
	URL         string
	Name        string
	PublishedAt string
	AssetName   string
	AssetURL    string
	AssetSize   int64
}

type releaseAsset struct {
	Name string
	URL  string
}

// assetLinkPattern finds release downloads in GitHub's expanded-assets
// fragment, e.g. href="/owner/repo/releases/download/v0.2.0/MyGit-amd64-installer.exe".
var assetLinkPattern = regexp.MustCompile(`href="(/[^"]+/releases/download/[^"]+)"`)

// CheckUpdate follows GitHub's "latest release" redirect and reports whether
// that tag is newer than the running version, together with the installer that
// matches the current OS architecture.
func (s *AppService) CheckUpdate() (UpdateInfo, error) {
	info := UpdateInfo{Current: Version}
	ctx, cancel := context.WithTimeout(context.Background(), updateTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, updateEndpoint, nil)
	if err != nil {
		return info, errors.New("invalid update endpoint")
	}
	request.Header.Set("Accept", "text/html")
	request.Header.Set("User-Agent", "MyGit/"+Version)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return info, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return info, errors.New("this project has no published releases yet")
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<16))
		return info, fmt.Errorf("GitHub refused the request (%s): %s", response.Status, snippet(body))
	}
	final := response.Request.URL
	tag := releaseTag(final.Path)
	if tag == "" {
		return info, errors.New("this project has no published releases yet")
	}
	info.Latest = normalizeVersion(tag)
	info.URL = final.String()
	info.Available = compareVersions(info.Latest, Version) > 0
	if info.Available {
		if assets, assetErr := s.releaseAssets(tag); assetErr == nil {
			if asset, ok := pickInstallerAsset(assets, runtime.GOARCH); ok {
				info.AssetName = asset.Name
				info.AssetURL = asset.URL
			}
		}
	}
	s.updateMu.Lock()
	s.latestUpdate = info
	s.hasUpdate = true
	s.updateMu.Unlock()
	return info, nil
}

// releaseAssets reads the lazily loaded asset list GitHub renders under a
// release tag. Using the HTML fragment avoids the API's anonymous rate limit.
func (s *AppService) releaseAssets(tag string) ([]releaseAsset, error) {
	endpoint, err := url.Parse(updateEndpoint)
	if err != nil {
		return nil, errors.New("invalid update endpoint")
	}
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/releases/latest") +
		"/releases/expanded_assets/" + url.PathEscape(tag)
	endpoint.RawQuery = ""

	ctx, cancel := context.WithTimeout(context.Background(), updateTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "text/html")
	request.Header.Set("User-Agent", "MyGit/"+Version)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("could not list release assets: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, fmt.Errorf("could not list release assets (%s)", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var assets []releaseAsset
	for _, match := range assetLinkPattern.FindAllStringSubmatch(string(body), -1) {
		href := match[1]
		if seen[href] {
			continue
		}
		seen[href] = true
		absolute, parseErr := endpoint.Parse(href)
		if parseErr != nil {
			continue
		}
		name := absolute.Path
		if index := strings.LastIndex(name, "/"); index >= 0 {
			name = name[index+1:]
		}
		if decoded, decodeErr := url.PathUnescape(name); decodeErr == nil {
			name = decoded
		}
		assets = append(assets, releaseAsset{Name: name, URL: absolute.String()})
	}
	return assets, nil
}

// pickInstallerAsset keeps the downloaded package the same kind the app was
// installed with: a Windows installer matching the running architecture. It
// deliberately skips portable binaries, MSIX, archives and other platforms'
// packages, and never mixes amd64 with arm64.
func pickInstallerAsset(assets []releaseAsset, goarch string) (releaseAsset, bool) {
	arch := strings.ToLower(goarch)
	other := "arm64"
	if arch == "arm64" {
		other = "amd64"
	}
	best := -1
	var chosen releaseAsset
	for _, asset := range assets {
		lower := strings.ToLower(asset.Name)
		if !strings.HasSuffix(lower, ".exe") && !strings.HasSuffix(lower, ".msi") {
			continue
		}
		if !strings.Contains(lower, "installer") {
			continue
		}
		if strings.Contains(lower, other) && !strings.Contains(lower, arch) {
			continue
		}
		score := 5
		switch {
		case strings.Contains(lower, "-"+arch+"-installer.exe"):
			score = 0
		case strings.HasSuffix(lower, ".exe") && strings.Contains(lower, arch):
			score = 1
		case strings.HasSuffix(lower, ".exe"):
			score = 2
		case strings.HasSuffix(lower, ".msi") && strings.Contains(lower, arch):
			score = 3
		case strings.HasSuffix(lower, ".msi"):
			score = 4
		}
		if best < 0 || score < best {
			best = score
			chosen = asset
		}
	}
	if best < 0 {
		return releaseAsset{}, false
	}
	return chosen, true
}

// DownloadUpdate fetches the installer CheckUpdate selected and returns its
// local path. Progress is emitted as "update:progress" events so the UI can
// show a percentage without this call having to return early.
func (s *AppService) DownloadUpdate() (string, error) {
	info, ok := s.cachedUpdate()
	if !ok || !info.Available {
		fresh, err := s.CheckUpdate()
		if err != nil {
			return "", err
		}
		info = fresh
	}
	if !info.Available {
		return "", errors.New("MyGit is already up to date")
	}
	if info.AssetURL == "" {
		// The earlier check may have failed to list assets; try once more.
		fresh, err := s.CheckUpdate()
		if err != nil {
			return "", err
		}
		info = fresh
	}
	if info.AssetURL == "" {
		return "", errors.New("this release has no installer for this platform")
	}
	name := filepath.Base(info.AssetName)
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = "MyGit-update.exe"
	}
	if extension := strings.ToLower(filepath.Ext(name)); extension != ".exe" && extension != ".msi" {
		return "", errors.New("the update is not a Windows installer")
	}
	dir := updateDownloadDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("could not prepare the update folder: %w", err)
	}
	destination := filepath.Join(dir, name)
	partial := destination + ".part"
	_ = os.Remove(partial)

	ctx, cancel := context.WithTimeout(context.Background(), downloadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, info.AssetURL, nil)
	if err != nil {
		return "", errors.New("invalid download address")
	}
	request.Header.Set("User-Agent", "MyGit/"+Version)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("could not download the update: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return "", fmt.Errorf("GitHub refused the download (%s)", response.Status)
	}
	file, err := os.Create(partial)
	if err != nil {
		return "", fmt.Errorf("could not save the update: %w", err)
	}
	total := response.ContentLength
	received := int64(0)
	s.emitUpdateProgress(received, total)
	buffer := make([]byte, 128*1024)
	lastEmit := time.Now()
	for {
		read, readErr := response.Body.Read(buffer)
		if read > 0 {
			if _, writeErr := file.Write(buffer[:read]); writeErr != nil {
				file.Close()
				os.Remove(partial)
				return "", fmt.Errorf("could not save the update: %w", writeErr)
			}
			received += int64(read)
			if time.Since(lastEmit) >= 200*time.Millisecond {
				s.emitUpdateProgress(received, total)
				lastEmit = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			file.Close()
			os.Remove(partial)
			return "", fmt.Errorf("download interrupted: %w", readErr)
		}
	}
	if err := file.Close(); err != nil {
		os.Remove(partial)
		return "", fmt.Errorf("could not save the update: %w", err)
	}
	if err := os.Rename(partial, destination); err != nil {
		os.Remove(partial)
		return "", fmt.Errorf("could not finish the update: %w", err)
	}
	s.emitUpdateProgress(received, received)
	return destination, nil
}

// InstallUpdate launches the downloaded installer after this process exits, so
// the installer can replace the running binary. The app then quits and the
// installer's own UI takes over.
func (s *AppService) InstallUpdate(path string) error {
	path = filepath.Clean(strings.TrimSpace(path))
	dir := filepath.Clean(updateDownloadDir())
	relative, err := filepath.Rel(dir, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("unexpected update file")
	}
	extension := strings.ToLower(filepath.Ext(path))
	if extension != ".exe" && extension != ".msi" {
		return errors.New("the update is not a Windows installer")
	}
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		return errors.New("the downloaded installer is missing")
	}
	return s.launchInstaller(path)
}

func (s *AppService) cachedUpdate() (UpdateInfo, bool) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	return s.latestUpdate, s.hasUpdate
}

func (s *AppService) emitUpdateProgress(received, total int64) {
	if s.window == nil {
		return
	}
	percent := -1
	if total > 0 {
		percent = int(received * 100 / total)
		if percent > 100 {
			percent = 100
		}
	}
	s.window.EmitEvent("update:progress", map[string]any{
		"received": received,
		"total":    total,
		"percent":  percent,
	})
}

func updateDownloadDir() string {
	return filepath.Join(os.TempDir(), "MyGit-update")
}

// releaseTag extracts the tag from a /owner/repo/releases/tag/<tag> path.
func releaseTag(path string) string {
	const marker = "/releases/tag/"
	index := strings.LastIndex(path, marker)
	if index < 0 {
		return ""
	}
	return strings.Trim(strings.TrimPrefix(path[index+len(marker):], "/"), "/")
}

func normalizeVersion(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(strings.TrimPrefix(value, "v"), "V")
	return value
}

// compareVersions compares dotted numeric versions and returns -1, 0 or 1.
// Pre-release and build suffixes are ignored: 0.2.0-rc1 counts as 0.2.0.
func compareVersions(a, b string) int {
	left, right := parseVersion(a), parseVersion(b)
	for i := 0; i < 3; i++ {
		switch {
		case left[i] > right[i]:
			return 1
		case left[i] < right[i]:
			return -1
		}
	}
	return 0
}

func parseVersion(value string) [3]int {
	var parts [3]int
	value = normalizeVersion(value)
	if index := strings.IndexAny(value, "-+"); index >= 0 {
		value = value[:index]
	}
	for i, part := range strings.Split(value, ".") {
		if i >= len(parts) {
			break
		}
		digits := strings.Builder{}
		for _, character := range part {
			if character < '0' || character > '9' {
				break
			}
			digits.WriteRune(character)
		}
		parts[i], _ = strconv.Atoi(digits.String())
	}
	return parts
}
