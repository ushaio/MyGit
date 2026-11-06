package services

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestPickInstallerAsset(t *testing.T) {
	assets := []releaseAsset{
		{Name: "MyGit-amd64-installer.exe", URL: "u1"},
		{Name: "MyGit-arm64-installer.exe", URL: "u2"},
		{Name: "MyGit.exe", URL: "portable"},
		{Name: "MyGit.deb", URL: "deb"},
		{Name: "mygit-x86_64.AppImage", URL: "appimage"},
	}
	for arch, want := range map[string]string{"amd64": "u1", "arm64": "u2"} {
		asset, ok := pickInstallerAsset(assets, arch)
		if !ok || asset.URL != want {
			t.Errorf("pickInstallerAsset(%q) = %+v, %v; want %q", arch, asset, ok, want)
		}
	}
	if _, ok := pickInstallerAsset([]releaseAsset{{Name: "MyGit.exe"}, {Name: "MyGit.deb"}}, "amd64"); ok {
		t.Error("picked a non-installer asset")
	}
}

func TestReleaseAssetsParsesFragment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/releases/expanded_assets/v1.2.3") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		fmt.Fprint(w, `<ul><li><a href="/ushaio/MyGit/releases/download/v1.2.3/MyGit-amd64-installer.exe" rel="nofollow">x</a></li>
<li><a href="/ushaio/MyGit/releases/download/v1.2.3/MyGit.deb" rel="nofollow">y</a></li></ul>`)
	}))
	defer server.Close()
	previous := updateEndpoint
	updateEndpoint = server.URL + "/releases/latest"
	defer func() { updateEndpoint = previous }()

	assets, err := (&AppService{}).releaseAssets("v1.2.3")
	if err != nil {
		t.Fatalf("releaseAssets: %v", err)
	}
	if len(assets) != 2 {
		t.Fatalf("assets = %+v, want 2", assets)
	}
	if assets[0].Name != "MyGit-amd64-installer.exe" || assets[0].URL != server.URL+"/ushaio/MyGit/releases/download/v1.2.3/MyGit-amd64-installer.exe" {
		t.Errorf("first asset = %+v", assets[0])
	}
}

func TestDownloadUpdateSavesMatchingInstaller(t *testing.T) {
	installer := fmt.Sprintf("MyGit-%s-installer.exe", runtime.GOARCH)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/releases/latest"):
			http.Redirect(w, r, "/releases/tag/v9.9.9", http.StatusFound)
		case strings.HasSuffix(r.URL.Path, "/releases/expanded_assets/v9.9.9"):
			fmt.Fprintf(w, `<a href="/ushaio/MyGit/releases/download/v9.9.9/%s" rel="nofollow">x</a>`, installer)
		case strings.HasSuffix(r.URL.Path, "/releases/tag/v9.9.9"):
			w.WriteHeader(http.StatusOK)
		case strings.HasSuffix(r.URL.Path, "/releases/download/v9.9.9/"+installer):
			fmt.Fprint(w, "fake-installer-bytes")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	previous := updateEndpoint
	updateEndpoint = server.URL + "/releases/latest"
	defer func() { updateEndpoint = previous }()

	service := &AppService{}
	info, err := service.CheckUpdate()
	if err != nil || !info.Available || info.AssetURL == "" {
		t.Fatalf("CheckUpdate = %+v, %v", info, err)
	}
	path, err := service.DownloadUpdate()
	if err != nil {
		t.Fatalf("DownloadUpdate: %v", err)
	}
	defer os.Remove(path)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read download: %v", err)
	}
	if string(data) != "fake-installer-bytes" {
		t.Errorf("downloaded %q", data)
	}
	if !strings.HasSuffix(path, installer) {
		t.Errorf("path = %q, want suffix %q", path, installer)
	}
}

func TestInstallUpdateRejectsForeignPath(t *testing.T) {
	if err := (&AppService{}).InstallUpdate(`C:\Windows\not-an-update.exe`); err == nil {
		t.Error("expected an error for a path outside the update folder")
	}
}
