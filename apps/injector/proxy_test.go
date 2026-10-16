package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

var secret = []byte("test-secret-0123456789abcdef0123456789")

const page = `<!doctype html><html><head><title>app</title></head><body>ok</body></html>`

type seen struct {
	mu      sync.Mutex
	headers []http.Header
	paths   []string
}

func (s *seen) add(r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.headers = append(s.headers, r.Header.Clone())
	s.paths = append(s.paths, r.URL.Path)
}

func (s *seen) last() http.Header {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.headers[len(s.headers)-1]
}

type rig struct {
	app, server *httptest.Server
	appSeen     *seen
	serverSeen  *seen
	in          *Injector
	front       *httptest.Server
}

func newRig(t *testing.T) *rig {
	t.Helper()
	r := &rig{appSeen: &seen{}, serverSeen: &seen{}}
	r.app = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		r.appSeen.add(q)
		switch q.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Content-Security-Policy", "script-src 'self' 'nonce-n0nce'")
			w.Header().Set("ETag", `"abc"`)
			w.Header().Set("Content-Length", strconv.Itoa(len(page)))
			_, _ = io.WriteString(w, page)
		case "/gzip":
			// an app that ignores Accept-Encoding: identity
			var b bytes.Buffer
			z := gzip.NewWriter(&b)
			_, _ = io.WriteString(z, page)
			_ = z.Close()
			w.Header().Set("Content-Type", "text/html")
			w.Header().Set("Content-Encoding", "gzip")
			_, _ = w.Write(b.Bytes())
		case "/json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"html":"<head>"}`)
		case "/xhtml":
			w.Header().Set("Content-Type", "application/xhtml+xml")
			_, _ = io.WriteString(w, page)
		case "/download":
			w.Header().Set("Content-Type", "text/html")
			w.Header().Set("Content-Disposition", "attachment; filename=a.html")
			_, _ = io.WriteString(w, page)
		case "/broken":
			// headers out, then the connection dies before the head
			w.Header().Set("Content-Type", "text/html")
			w.Header().Set("Content-Length", "1000")
			_, _ = io.WriteString(w, "<!doctype html><ht")
		case "/slow":
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "<!doctype html><html><head>")
			w.(http.Flusher).Flush()
			time.Sleep(300 * time.Millisecond)
			_, _ = io.WriteString(w, "<title>later</title></head>")
		default:
			http.NotFound(w, q)
		}
	}))
	r.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		r.serverSeen.add(q)
		w.Header().Set("Set-Cookie", "server=1")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	assets := t.TempDir()
	if err := os.WriteFile(filepath.Join(assets, bundleName), []byte("/* bundle */"), 0o644); err != nil {
		t.Fatal(err)
	}
	appURL, _ := url.Parse(r.app.URL)
	serverURL, _ := url.Parse(r.server.URL)
	r.in = NewInjector(Config{Upstream: appURL, ServerURL: serverURL, PublicServerURL: serverURL, Secret: secret, AssetsDir: assets, TrustForwarded: true}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r.front = httptest.NewServer(r.in)
	t.Cleanup(func() {
		r.front.Close()
		r.app.Close()
		r.server.Close()
	})
	return r
}

func (r *rig) origin() string { return r.front.URL }

func (r *rig) cookie(t *testing.T, origin string, exp time.Time) string {
	t.Helper()
	v, err := signReview(secret, reviewClaims{V: 1, Origin: origin, User: "u1", Exp: exp.Unix(), Token: "tb_dev_secret"})
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func (r *rig) get(t *testing.T, path string, hdr map[string]string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, r.front.URL+path, nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	// raw transport: no transparent gunzip, so the test sees the bytes as sent
	res, err := (&http.Transport{DisableCompression: true}).RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func withCookie(v string) map[string]string {
	return map[string]string{"Cookie": "a=1; " + cookieNamePlain + "=" + v + "; b=2"}
}

const wantTag = `<script src="/__toolbar/toolbar.js?v=`

func TestNoCookiePassesThrough(t *testing.T) {
	r := newRig(t)
	res, body := r.get(t, "/", nil)
	if body != page || res.Header.Get("X-Toolbar-Injected") != "" || res.Header.Get("ETag") != `"abc"` {
		t.Fatalf("changed without a cookie: %q", body)
	}
	if got := r.appSeen.last().Get("Accept-Encoding"); got != "gzip, br" {
		t.Fatalf("accept-encoding changed for a non-reviewer: %q", got)
	}
	_, _ = r.get(t, "/", map[string]string{"If-None-Match": `"abc"`})
	if r.appSeen.last().Get("If-None-Match") != `"abc"` {
		t.Fatal("conditional request changed for a non-reviewer")
	}
	if got := r.appSeen.last().Get("Accept-Encoding"); got != "gzip, br" {
		t.Fatalf("accept-encoding changed for a non-reviewer: %q", got)
	}
}

func TestReviewerGetsToolbarWithNonce(t *testing.T) {
	r := newRig(t)
	c := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	// the browser revalidates the copy it cached before sign-in: the reviewer gets a full page
	h := withCookie(c)
	h["If-None-Match"] = `"abc"`
	h["If-Modified-Since"] = "Thu, 15 Oct 2026 00:00:00 GMT"
	res, body := r.get(t, "/", h)
	if !strings.Contains(body, "<head>"+wantTag) || !strings.Contains(body, `nonce="n0nce"`) {
		t.Fatalf("no tag: %q", body)
	}
	stripped := strings.Replace(body, body[strings.Index(body, "<script"):strings.Index(body, "</script>")+len("</script>")], "", 1)
	if stripped != page {
		t.Fatalf("more than the head changed: %q", stripped)
	}
	if res.Header.Get("Content-Length") != "" || res.Header.Get("ETag") != "" || res.Header.Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("headers: %v", res.Header)
	}
	if res.Header.Get("Content-Security-Policy") != "script-src 'self' 'nonce-n0nce'" {
		t.Fatal("CSP must stay as the app sent it")
	}
	up := r.appSeen.last()
	if up.Get("Accept-Encoding") != "identity" {
		t.Fatalf("upstream accept-encoding %q", up.Get("Accept-Encoding"))
	}
	if up.Get("If-None-Match") != "" || up.Get("If-Modified-Since") != "" {
		t.Fatal("conditional headers reached the app for a reviewer")
	}
	if ck := up.Get("Cookie"); ck != "a=1; b=2" {
		t.Fatalf("reviewer cookie reached the app: %q", ck)
	}
}

func TestGzipFromAppPassesThrough(t *testing.T) {
	r := newRig(t)
	c := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	res, body := r.get(t, "/gzip", withCookie(c))
	if res.Header.Get("Content-Encoding") != "gzip" || res.Header.Get("X-Toolbar-Injected") != "" {
		t.Fatalf("headers %v", res.Header)
	}
	z, err := gzip.NewReader(strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := io.ReadAll(z)
	if string(plain) != page {
		t.Fatalf("gzip body changed: %q", plain)
	}
}

func TestNotHTMLPassesThrough(t *testing.T) {
	r := newRig(t)
	c := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	for _, p := range []string{"/json", "/xhtml", "/download"} {
		res, body := r.get(t, p, withCookie(c))
		if strings.Contains(body, "__toolbar") || res.Header.Get("X-Toolbar-Injected") != "" {
			t.Fatalf("%s injected: %q", p, body)
		}
	}
}

func TestNoInjection(t *testing.T) {
	r := newRig(t)
	good := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	cases := map[string]map[string]string{
		"x-review-skip":        {"Cookie": cookieNamePlain + "=" + good, "X-Review-Skip": "1"},
		"fetch, not document":  {"Cookie": cookieNamePlain + "=" + good, "Sec-Fetch-Dest": "empty"},
		"iframe":               {"Cookie": cookieNamePlain + "=" + good, "Sec-Fetch-Dest": "iframe"},
		"prefetch":             {"Cookie": cookieNamePlain + "=" + good, "Sec-Purpose": "prefetch"},
		"expired":              withCookie(r.cookie(t, r.origin(), time.Now().Add(-time.Second))),
		"other origin":         withCookie(r.cookie(t, "https://other.example", time.Now().Add(time.Hour))),
		"https origin on http": withCookie(r.cookie(t, strings.Replace(r.origin(), "http:", "https:", 1), time.Now().Add(time.Hour))),
		"tampered":             withCookie(good[:len(good)-2] + "AA"),
		"garbage":              withCookie("tbr1.x.y"),
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			_, body := r.get(t, "/", h)
			if body != page {
				t.Fatalf("injected: %q", body)
			}
			if strings.Contains(r.appSeen.last().Get("Cookie"), cookieNamePlain) {
				t.Fatal("reviewer cookie reached the app")
			}
		})
	}
}

func TestForwardedProtoDecidesOrigin(t *testing.T) {
	r := newRig(t)
	host := strings.TrimPrefix(r.origin(), "http://")
	c := r.cookie(t, "https://"+host, time.Now().Add(time.Hour))
	_, body := r.get(t, "/", map[string]string{"Cookie": cookieNameSecure + "=" + c, "X-Forwarded-Proto": "https"})
	if !strings.Contains(body, wantTag) {
		t.Fatalf("not injected behind https Traefik: %q", body)
	}
}

func TestUpstreamErrorBeforeHeadKeepsBytes(t *testing.T) {
	r := newRig(t)
	c := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	req, _ := http.NewRequest(http.MethodGet, r.front.URL+"/broken", nil)
	req.Header.Set("Cookie", cookieNamePlain+"="+c)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if string(b) != "<!doctype html><ht" {
		t.Fatalf("got %q", b)
	}
}

func TestStreamsBeforeUpstreamFinishes(t *testing.T) {
	r := newRig(t)
	c := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	req, _ := http.NewRequest(http.MethodGet, r.front.URL+"/slow", nil)
	req.Header.Set("Cookie", cookieNamePlain+"="+c)
	start := time.Now()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	buf := make([]byte, 4096)
	first := ""
	for !strings.Contains(first, "</script>") {
		n, err := res.Body.Read(buf)
		first += string(buf[:n])
		if err != nil {
			break
		}
	}
	if !strings.Contains(first, wantTag) || time.Since(start) > 250*time.Millisecond {
		t.Fatalf("head with the tag should arrive before the rest: %q after %v", first, time.Since(start))
	}
	rest, _ := io.ReadAll(res.Body)
	if !strings.HasSuffix(first+string(rest), "<title>later</title></head>") {
		t.Fatal("tail missing")
	}
}

func TestSessionSetsCookie(t *testing.T) {
	r := newRig(t)
	c := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.PostForm(r.front.URL+"/__toolbar/session", url.Values{"token": {c}, "next": {"/lesson/1?x=1"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "/lesson/1?x=1" {
		t.Fatalf("status %d location %q", res.StatusCode, res.Header.Get("Location"))
	}
	sc := res.Header.Get("Set-Cookie")
	if !strings.HasPrefix(sc, cookieNamePlain+"="+c) || !strings.Contains(sc, "HttpOnly") || !strings.Contains(sc, "SameSite=Lax") {
		t.Fatalf("set-cookie %q", sc)
	}
	// open redirects and foreign tokens are refused
	res, _ = client.PostForm(r.front.URL+"/__toolbar/session", url.Values{"token": {c}, "next": {"//evil.example/"}})
	if res.Header.Get("Location") != "/" {
		t.Fatalf("open redirect: %q", res.Header.Get("Location"))
	}
	res, _ = client.PostForm(r.front.URL+"/__toolbar/session", url.Values{"token": {r.cookie(t, "https://other.example", time.Now().Add(time.Hour))}})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign token: %d", res.StatusCode)
	}
	res, _ = client.Get(r.front.URL + "/__toolbar/session")
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET session: %d", res.StatusCode)
	}
}

func TestLoginRedirectsToServer(t *testing.T) {
	r := newRig(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Get(r.front.URL + "/__toolbar/login?next=/a")
	if err != nil {
		t.Fatal(err)
	}
	loc, _ := url.Parse(res.Header.Get("Location"))
	if loc.Path != "/go" || loc.Query().Get("site") != r.origin() || loc.Query().Get("next") != "/a" {
		t.Fatalf("location %v", loc)
	}
}

func (r *rig) api(t *testing.T, method, path string, hdr map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, r.front.URL+path, strings.NewReader(`{}`))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, res.Body)
	res.Body.Close()
	return res
}

func TestAPIRelay(t *testing.T) {
	r := newRig(t)
	c := r.cookie(t, r.origin(), time.Now().Add(time.Hour))
	ok := map[string]string{"Cookie": "a=1; " + cookieNamePlain + "=" + c, pageHeader: "1", "Origin": r.origin()}
	res := r.api(t, http.MethodPost, "/__toolbar/api/v1/recordings", ok)
	if res.StatusCode != 200 || res.Header.Get("Set-Cookie") != "" {
		t.Fatalf("relay: %d %v", res.StatusCode, res.Header)
	}
	h := r.serverSeen.last()
	if h.Get("Authorization") != "Bearer tb_dev_secret" || h.Get("Cookie") != "" || h.Get("Origin") != "" || h.Get(pageHeader) != "" {
		t.Fatalf("server saw %v", h)
	}
	if p := r.serverSeen.paths[len(r.serverSeen.paths)-1]; p != "/api/v1/recordings" {
		t.Fatalf("path %q", p)
	}
	n := len(r.serverSeen.paths)
	refused := []struct {
		name, method, path string
		hdr                map[string]string
		status             int
	}{
		{"no page header", "POST", "/__toolbar/api/v1/recordings", map[string]string{"Cookie": cookieNamePlain + "=" + c}, 403},
		{"cross origin", "POST", "/__toolbar/api/v1/recordings", map[string]string{"Cookie": cookieNamePlain + "=" + c, pageHeader: "1", "Origin": "https://evil.example"}, 403},
		{"no cookie", "POST", "/__toolbar/api/v1/recordings", map[string]string{pageHeader: "1"}, 401},
		{"route not on the list", "GET", "/__toolbar/api/v1/tokens", ok, 404},
		{"wrong method", "DELETE", "/__toolbar/api/v1/recordings", ok, 404},
		{"dot segments", "GET", "/__toolbar/api/v1/ext/../tokens", ok, 404},
	}
	for _, x := range refused {
		if res := r.api(t, x.method, x.path, x.hdr); res.StatusCode != x.status {
			t.Fatalf("%s: %d", x.name, res.StatusCode)
		}
	}
	if len(r.serverSeen.paths) != n {
		t.Fatal("a refused call reached the server")
	}
}

func TestAssetsAndStatus(t *testing.T) {
	r := newRig(t)
	res, body := r.get(t, "/__toolbar/toolbar.js?v="+r.in.bundleHash, nil)
	if body != "/* bundle */" || !strings.Contains(res.Header.Get("Cache-Control"), "immutable") || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/javascript") {
		t.Fatalf("bundle: %q %v", body, res.Header)
	}
	for _, p := range []string{"/__toolbar/../go.mod", "/__toolbar/.hidden", "/__toolbar/nope.js"} {
		if res, _ := r.get(t, p, nil); res.StatusCode != 404 {
			t.Fatalf("%s: %d", p, res.StatusCode)
		}
	}
	_, body = r.get(t, "/__toolbar/status", nil)
	var s struct{ Reviewer bool }
	if json.Unmarshal([]byte(body), &s) != nil || s.Reviewer {
		t.Fatalf("status %q", body)
	}
	_, body = r.get(t, "/__toolbar/status", withCookie(r.cookie(t, r.origin(), time.Now().Add(time.Hour))))
	if json.Unmarshal([]byte(body), &s) != nil || !s.Reviewer {
		t.Fatalf("status %q", body)
	}
}

func TestUpstreamsByHost(t *testing.T) {
	r := newRig(t)
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { _, _ = io.WriteString(w, "other:"+q.Host) }))
	defer other.Close()
	u, _ := url.Parse(other.URL)
	r.in.cfg.Upstreams = map[string]*url.URL{"nuru.example": u}
	req, _ := http.NewRequest(http.MethodGet, r.front.URL+"/", nil)
	req.Host = "nuru.example"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(b) != "other:nuru.example" {
		t.Fatalf("got %q", b)
	}
}

func TestLogoutRevokesTokenAndDropsCookie(t *testing.T) {
	r := newRig(t)
	res, _ := r.get(t, "/__toolbar/logout?next=/x", withCookie(r.cookie(t, r.origin(), time.Now().Add(time.Hour))))
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "/x" || !strings.Contains(strings.Join(res.Header.Values("Set-Cookie"), "\n"), "Max-Age=0") {
		t.Fatalf("logout: %d %v", res.StatusCode, res.Header)
	}
	if p := r.serverSeen.paths; len(p) != 1 || p[0] != "/api/v1/ext/logout" || r.serverSeen.last().Get("Authorization") != "Bearer tb_dev_secret" {
		t.Fatalf("revoke not called: %v", p)
	}
}
