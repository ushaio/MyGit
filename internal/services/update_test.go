package services

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		latest, current string
		want            int
	}{
		{"0.2.0", "0.1.0", 1},
		{"v0.1.1", "0.1.0", 1},
		{"1.0.0", "0.9.9", 1},
		{"0.1.0", "0.1.0", 0},
		{"0.1.0", "0.2.0", -1},
		{"0.2.0-rc1", "0.2.0", 0},
		{"0.2", "0.1.9", 1},
	}
	for _, test := range cases {
		if got := compareVersions(test.latest, test.current); got != test.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", test.latest, test.current, got, test.want)
		}
	}
}

// withUpdateServer points updateEndpoint at a local server that redirects the
// latest-release route to tag (or answers status when tag is empty).
func withUpdateServer(t *testing.T, status int, tag string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		if tag == "" {
			w.WriteHeader(http.StatusOK) // stays on /releases/latest: no release
			return
		}
		if strings.HasSuffix(r.URL.Path, "/releases/latest") {
			http.Redirect(w, r, "/releases/tag/"+tag, http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	previous := updateEndpoint
	updateEndpoint = server.URL + "/releases/latest"
	t.Cleanup(func() {
		updateEndpoint = previous
		server.Close()
	})
}

func TestCheckUpdateReportsNewerRelease(t *testing.T) {
	withUpdateServer(t, http.StatusOK, "v9.9.9")
	info, err := (&AppService{}).CheckUpdate()
	if err != nil {
		t.Fatalf("CheckUpdate: %v", err)
	}
	if info.Current != Version {
		t.Errorf("Current = %q, want %q", info.Current, Version)
	}
	if info.Latest != "9.9.9" || !info.Available {
		t.Errorf("Latest = %q, Available = %v; want 9.9.9, true", info.Latest, info.Available)
	}
	if info.URL == "" {
		t.Errorf("URL is empty")
	}
}

func TestCheckUpdateReportsUpToDate(t *testing.T) {
	withUpdateServer(t, http.StatusOK, "v0.0.1")
	info, err := (&AppService{}).CheckUpdate()
	if err != nil {
		t.Fatalf("CheckUpdate: %v", err)
	}
	if info.Available {
		t.Errorf("Available = true for an older release")
	}
	if info.Latest != "0.0.1" {
		t.Errorf("Latest = %q, want 0.0.1", info.Latest)
	}
}

func TestCheckUpdateWithoutReleases(t *testing.T) {
	withUpdateServer(t, http.StatusOK, "")
	if _, err := (&AppService{}).CheckUpdate(); err == nil {
		t.Fatal("expected an error when the project has no releases")
	}
}

func TestReleaseTag(t *testing.T) {
	cases := map[string]string{
		"/ushaio/MyGit/releases/tag/v1.2.3": "v1.2.3",
		"/ushaio/MyGit/releases/latest":     "",
		"/releases/tag/v0.1.0/":             "v0.1.0",
	}
	for path, want := range cases {
		if got := releaseTag(path); got != want {
			t.Errorf("releaseTag(%q) = %q, want %q", path, got, want)
		}
	}
}
