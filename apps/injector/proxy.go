package main

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Prefix of everything the injector answers itself on the app's origin.
const toolbarPrefix = "/__toolbar/"

// Name of the bundle in the assets folder, served as /__toolbar/toolbar.js.
const bundleName = "toolbar.js"

// Header the page bundle sends on /__toolbar/api/ calls. A cross-origin page cannot send it
// without a CORS preflight, which the injector never answers.
const pageHeader = "X-Toolbar-Page"

// Header for automated tests (PLAN "Zero integration"): any value turns injection off.
const skipHeader = "X-Review-Skip"

type Config struct {
	Listen           string
	Upstream         *url.URL            // default app (explicit mode)
	Upstreams        map[string]*url.URL // by lower-case host (no port; explicit mode)
	Loopback         *url.URL            // the proxy in front, to forward back into (loopback mode, loop.go)
	LoopbackInsecure bool                // skip the certificate check on the loopback hop
	LoopbackRoots    *x509.CertPool      // tests only; nil means the system roots
	ServerURL        *url.URL            // open-toolbar server, as the injector reaches it
	PublicServerURL  *url.URL            // open-toolbar server, as browsers reach it
	Secret           []byte
	AssetsDir        string
	TrustForwarded   bool
	ScanLimit        int
}

type Injector struct {
	cfg        Config
	log        *slog.Logger
	app        *httputil.ReverseProxy
	loop       *httputil.ReverseProxy // nil without INJECTOR_LOOPBACK
	api        *httputil.ReverseProxy
	bundleHash string
	pass       string // the X-Open-Toolbar-Pass value (loop.go)
	now        func() time.Time
	warned     sync.Map // one-time warnings by key
}

type ctxKey struct{}

// decision travels on the outbound request so ModifyResponse knows what the request side found.
type decision struct {
	inject bool
}

func NewInjector(cfg Config, log *slog.Logger) *Injector {
	if cfg.ScanLimit <= 0 {
		cfg.ScanLimit = defaultScanLimit
	}
	in := &Injector{cfg: cfg, log: log, now: time.Now, pass: passValue(cfg.Secret)}
	in.bundleHash = fileHash(filepath.Join(cfg.AssetsDir, bundleName))
	if cfg.Loopback != nil {
		in.loop = &httputil.ReverseProxy{
			Rewrite:        in.rewriteApp,
			ModifyResponse: in.modifyApp,
			FlushInterval:  -1,
			ErrorHandler:   in.upstreamError,
			Transport:      newLoopTransport(cfg.Loopback, cfg.LoopbackInsecure, cfg.LoopbackRoots),
		}
	}
	in.app = &httputil.ReverseProxy{
		Rewrite:        in.rewriteApp,
		ModifyResponse: in.modifyApp,
		FlushInterval:  -1, // stream: HTML, server-sent events and long polls go out as they come
		ErrorHandler:   in.upstreamError,
	}
	in.api = &httputil.ReverseProxy{
		Rewrite:        in.rewriteAPI,
		ModifyResponse: func(r *http.Response) error { r.Header.Del("Set-Cookie"); return nil },
		ErrorHandler:   in.upstreamError,
	}
	return in
}

func fileHash(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:6])
}

func (in *Injector) bundleURL() string {
	u := toolbarPrefix + bundleName
	if in.bundleHash != "" {
		u += "?v=" + in.bundleHash
	}
	return u
}

// requestOrigin is the origin the browser used: scheme from X-Forwarded-Proto (Traefik sets it)
// when trusted, host from the Host header (Traefik passes it through).
func (in *Injector) requestOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if in.cfg.TrustForwarded {
		if p := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])); p == "http" || p == "https" {
			scheme = p
		}
	}
	host := r.Host
	if in.cfg.TrustForwarded {
		if h := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); h != "" {
			host = h
		}
	}
	host = strings.ToLower(host)
	// default ports are not part of an origin
	if (scheme == "https" && strings.HasSuffix(host, ":443")) || (scheme == "http" && strings.HasSuffix(host, ":80")) {
		host = host[:strings.LastIndexByte(host, ':')]
	}
	return scheme + "://" + host
}

func (in *Injector) reviewer(r *http.Request) (reviewClaims, bool) {
	v := reviewCookieValue(r)
	if v == "" || len(in.cfg.Secret) == 0 {
		return reviewClaims{}, false
	}
	c, err := verifyReview(in.cfg.Secret, v, in.requestOrigin(r), in.now())
	if err != nil {
		return reviewClaims{}, false
	}
	return c, true
}

func (in *Injector) warnOnce(key, msg string, args ...any) {
	if _, done := in.warned.LoadOrStore(key, true); !done {
		in.log.Warn(msg, args...)
	}
}

func (in *Injector) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	w := &statusWriter{ResponseWriter: rw}
	start := time.Now()
	kind := "app"
	defer func() {
		if r.URL.Path == toolbarPrefix+"health" {
			return // Traefik's and Docker's health checks, every few seconds
		}
		// One line per request. Only reviewers and /__toolbar/ reach the injector behind the Traefik
		// file, so this is the reviewers' traffic; a visitor's request here means the router is wrong.
		// The path only: query strings can hold secrets.
		in.log.Info("request", "kind", kind, "method", r.Method, "host", r.Host, "path", r.URL.Path, "status", w.status, "injected", w.Header().Get("X-Toolbar-Injected") == "1", "ms", time.Since(start).Milliseconds())
	}()
	if looped(r) {
		kind = "loop"
		in.warnOnce("loop", "a request came back to the injector after it forwarded it: check that the Traefik router matches only /__toolbar/ and the reviewer cookie (deploy/injector/traefik-open-toolbar-injector.yml)", "host", r.Host)
		http.Error(w, "open-toolbar injector: request loop", http.StatusLoopDetected)
		return
	}
	// Health checks (Traefik's, Docker's) come without the router's middleware.
	if in.cfg.Loopback != nil && in.pass != "" && r.URL.Path != toolbarPrefix+"health" {
		switch v := r.Header.Get(passHeader); {
		case v == "":
			in.warnOnce("pass-missing", "requests arrive without "+passHeader+": the Traefik file's router lacks the open-toolbar-pass middleware, so reviewers get errors instead of the plain app while the injector is down")
		case !hmac.Equal([]byte(v), []byte(in.pass)):
			in.warnOnce("pass-wrong", passHeader+" in the Traefik file does not match INJECTOR_SECRET: run `/injector pass-value` in the injector container and put its output in the file")
		}
	}
	r.Header.Del(passHeader)
	if strings.HasPrefix(r.URL.Path, toolbarPrefix) {
		kind = "toolbar"
		in.serveToolbar(w, r)
		return
	}
	target, loop := in.upstreamFor(r)
	switch {
	case loop:
		kind = "loopback"
		in.loop.ServeHTTP(w, r)
	case target != nil:
		in.app.ServeHTTP(w, r)
	default:
		http.Error(w, "open-toolbar injector: no upstream for this host", http.StatusBadGateway)
	}
}

// statusWriter records the status for the request log. Unwrap lets http.ResponseController reach
// the connection for flushes and WebSocket hijacks.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack: the reverse proxy takes the connection over after the app agreed to switch protocols
// (WebSockets) and writes the 101 itself.
func (s *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	c, rw, err := http.NewResponseController(s.ResponseWriter).Hijack()
	if err == nil && s.status == 0 {
		s.status = http.StatusSwitchingProtocols
	}
	return c, rw, err
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// ---------- the app ----------

// upstreamFor picks where a request goes: the host's INJECTOR_UPSTREAMS entry, else back into the
// proxy (INJECTOR_LOOPBACK, loop is true), else INJECTOR_UPSTREAM.
func (in *Injector) upstreamFor(r *http.Request) (target *url.URL, loop bool) {
	host := strings.ToLower(r.Host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if u, ok := in.cfg.Upstreams[host]; ok {
		return u, false
	}
	if in.loop != nil {
		return in.cfg.Loopback, true
	}
	return in.cfg.Upstream, false
}

// wantsDocument: only top-level page loads get the toolbar. Fetches of HTML fragments (htmx,
// Turbo, prefetch) and iframes do not. Without Sec-Fetch-Dest (old browsers, curl) the request
// counts as a page load.
func wantsDocument(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	if d := r.Header.Get("Sec-Fetch-Dest"); d != "" && d != "document" {
		return false
	}
	if p := r.Header.Get("Sec-Purpose"); strings.Contains(p, "prefetch") {
		return false
	}
	if r.Header.Get("Purpose") == "prefetch" {
		return false
	}
	return true
}

func (in *Injector) rewriteApp(pr *httputil.ProxyRequest) {
	target, loop := in.upstreamFor(pr.In)
	if loop {
		// Back into the proxy with the app's own host: the URL keeps the host, so the TLS server
		// name and the connection pool follow it, and the transport dials INJECTOR_LOOPBACK.
		pr.SetURL(&url.URL{Scheme: target.Scheme, Host: pr.In.Host})
		// No pass header here: the second pass has no reviewer cookie and is not under
		// /__toolbar/, so it misses the injector router anyway, and the header would hand its
		// value to every app (loop.go).
		pr.Out.Header.Add("Via", "1.1 "+viaToken)
	} else {
		pr.SetURL(target)
	}
	pr.Out.Host = pr.In.Host // the app sees the host the browser used, as behind Traefik alone
	copyForwarded(pr)
	stripReviewCookie(pr.Out.Header)

	d := decision{}
	if _, ok := in.reviewer(pr.In); ok && wantsDocument(pr.In) && pr.In.Header.Get(skipHeader) == "" {
		d.inject = true
		// Ask for an uncompressed body so the head can be edited while it streams.
		pr.Out.Header.Set("Accept-Encoding", "identity")
		// A copy the browser cached before the reviewer signed in has no toolbar: ask for the
		// full page instead of a 304 that would bring that copy back.
		pr.Out.Header.Del("If-None-Match")
		pr.Out.Header.Del("If-Modified-Since")
	}
	pr.Out = pr.Out.WithContext(context.WithValue(pr.Out.Context(), ctxKey{}, d))
}

// copyForwarded keeps the X-Forwarded-* headers Traefik set (Rewrite drops them) and adds this hop.
func copyForwarded(pr *httputil.ProxyRequest) {
	clientIP, _, err := net.SplitHostPort(pr.In.RemoteAddr)
	if err != nil {
		clientIP = pr.In.RemoteAddr
	}
	xff := pr.In.Header.Get("X-Forwarded-For")
	if xff != "" {
		xff += ", " + clientIP
	} else {
		xff = clientIP
	}
	pr.Out.Header.Set("X-Forwarded-For", xff)
	if h := pr.In.Header.Get("X-Forwarded-Host"); h != "" {
		pr.Out.Header.Set("X-Forwarded-Host", h)
	} else {
		pr.Out.Header.Set("X-Forwarded-Host", pr.In.Host)
	}
	if p := pr.In.Header.Get("X-Forwarded-Proto"); p != "" {
		pr.Out.Header.Set("X-Forwarded-Proto", p)
	} else if pr.In.TLS != nil {
		pr.Out.Header.Set("X-Forwarded-Proto", "https")
	} else {
		pr.Out.Header.Set("X-Forwarded-Proto", "http")
	}
	for _, h := range []string{"X-Forwarded-Port", "X-Forwarded-Server", "X-Real-Ip"} {
		if v := pr.In.Header.Get(h); v != "" {
			pr.Out.Header.Set(h, v)
		}
	}
}

// injectable: plain HTML that the injector may edit. Everything else passes through.
func injectable(resp *http.Response) bool {
	if resp.Request != nil && resp.Request.Method != http.MethodGet {
		return false
	}
	if resp.StatusCode < 200 || resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotModified || resp.StatusCode == http.StatusPartialContent {
		return false
	}
	if ce := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Encoding"))); ce != "" && ce != "identity" {
		return false // the app ignored Accept-Encoding: identity
	}
	mt, params, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || mt != "text/html" {
		return false
	}
	if cs := strings.ToLower(params["charset"]); strings.HasPrefix(cs, "utf-16") || strings.HasPrefix(cs, "utf-32") {
		return false
	}
	if cd := strings.ToLower(resp.Header.Get("Content-Disposition")); strings.HasPrefix(cd, "attachment") {
		return false
	}
	return resp.Body != nil && resp.Body != http.NoBody
}

func (in *Injector) modifyApp(resp *http.Response) (err error) {
	// Never fail the response because of the injector: any panic leaves it as it was.
	defer func() {
		if p := recover(); p != nil {
			in.log.Error("inject: recovered", "panic", fmt.Sprint(p))
			err = nil
		}
	}()
	d, _ := resp.Request.Context().Value(ctxKey{}).(decision)
	if !d.inject || !injectable(resp) {
		return nil
	}
	tag := scriptTag(in.bundleURL(), cspNonce(resp.Header))
	resp.Body = newHeadInjector(resp.Body, tag, in.cfg.ScanLimit)
	resp.ContentLength = -1
	resp.Header.Del("Content-Length")
	// The body differs from the app's: its validators no longer describe it, and no shared cache
	// may keep a reviewer's copy for someone else.
	resp.Header.Del("ETag")
	resp.Header.Del("Last-Modified")
	resp.Header.Set("Cache-Control", "private, no-cache")
	resp.Header.Add("Vary", "Cookie")
	resp.Header.Set("X-Toolbar-Injected", "1")
	return nil
}

func (in *Injector) upstreamError(w http.ResponseWriter, r *http.Request, err error) {
	if certError(err) && in.cfg.Loopback != nil {
		in.log.Error("loopback: the proxy's certificate for this host did not verify against the system roots; set INJECTOR_LOOPBACK_INSECURE=1 if the proxy uses a self-signed certificate", "host", r.Host, "err", err.Error())
	} else {
		in.log.Warn("upstream error", "host", r.Host, "path", r.URL.Path, "err", err.Error())
	}
	w.WriteHeader(http.StatusBadGateway)
}

// ---------- /__toolbar/ ----------

func (in *Injector) serveToolbar(w http.ResponseWriter, r *http.Request) {
	sub := strings.TrimPrefix(r.URL.Path, toolbarPrefix)
	switch {
	case sub == "health":
		// Readable from the server's hand-off page on another origin, which checks that the
		// injector answers on the app before it sends the reviewer there.
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = w.Write([]byte(`{"ok":true,"service":"open-toolbar-injector"}` + "\n"))
	case sub == "session":
		in.serveSession(w, r)
	case sub == "login":
		in.serveLogin(w, r)
	case sub == "logout":
		in.serveLogout(w, r)
	case sub == "status":
		in.serveStatus(w, r)
	case strings.HasPrefix(sub, "api/"):
		in.serveAPI(w, r, "/"+sub)
	default:
		in.serveAsset(w, r, sub)
	}
}

func (in *Injector) cookieName(r *http.Request) string {
	if strings.HasPrefix(in.requestOrigin(r), "https://") {
		return cookieNameSecure
	}
	return cookieNamePlain
}

// safeNext keeps a same-origin path only.
func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, "/\\") || strings.ContainsAny(next, "\r\n") {
		return "/"
	}
	return next
}

// POST /__toolbar/session: the server's hand-off page posts the signed cookie value here
// (a form post keeps it out of URLs and logs). The cookie is checked, set and the browser goes on.
func (in *Injector) serveSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	value := r.PostForm.Get("token")
	c, err := verifyReview(in.cfg.Secret, value, in.requestOrigin(r), in.now())
	if err != nil {
		in.log.Info("session refused", "err", err.Error())
		http.Error(w, "This review link is not valid for this site. Open it again from open-toolbar.", http.StatusForbidden)
		return
	}
	https := strings.HasPrefix(in.requestOrigin(r), "https://")
	http.SetCookie(w, &http.Cookie{
		Name:     in.cookieName(r),
		Value:    value,
		Path:     "/",
		Expires:  time.Unix(c.Exp, 0),
		MaxAge:   int(time.Until(time.Unix(c.Exp, 0)).Seconds()),
		HttpOnly: true,
		Secure:   https,
		SameSite: http.SameSiteLaxMode,
	})
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, safeNext(r.PostForm.Get("next")), http.StatusSeeOther)
}

// GET /__toolbar/login?next=/path: to the server, which signs the reviewer in and hands a cookie back.
func (in *Injector) serveLogin(w http.ResponseWriter, r *http.Request) {
	if in.cfg.PublicServerURL == nil {
		http.Error(w, "TOOLBAR_PUBLIC_URL is not set", http.StatusServiceUnavailable)
		return
	}
	u := *in.cfg.PublicServerURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/go"
	q := url.Values{}
	q.Set("site", in.requestOrigin(r))
	q.Set("next", safeNext(r.URL.Query().Get("next")))
	u.RawQuery = q.Encode()
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// /__toolbar/logout: revokes the cookie's device token on the server (best effort) and drops the
// cookie; the next page load has no toolbar.
func (in *Injector) serveLogout(w http.ResponseWriter, r *http.Request) {
	if c, ok := in.reviewer(r); ok && in.cfg.ServerURL != nil {
		in.revoke(r.Context(), c.Token)
	}
	for _, name := range []string{cookieNameSecure, cookieNamePlain} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: name == cookieNameSecure, SameSite: http.SameSiteLaxMode})
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, safeNext(r.URL.Query().Get("next")), http.StatusSeeOther)
}

// revoke ends a device token: the server's extension sign-out route revokes the token it is called with.
func (in *Injector) revoke(ctx context.Context, token string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	u := *in.cfg.ServerURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/ext/logout"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		in.log.Warn("logout: could not revoke the device token", "err", err.Error())
		return
	}
	_ = res.Body.Close()
}

// GET /__toolbar/status: {"reviewer":true|false} for the bundle and for tests. Says nothing else.
func (in *Injector) serveStatus(w http.ResponseWriter, r *http.Request) {
	_, ok := in.reviewer(r)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintf(w, `{"reviewer":%t}`+"\n", ok)
}

// The server routes the page bundle may call through the injector: what a capture upload needs.
var apiAllow = []struct {
	method string
	re     *regexp.Regexp
}{
	{http.MethodGet, regexp.MustCompile(`^/api/v1/ext/bootstrap$`)},
	{http.MethodGet, regexp.MustCompile(`^/api/v1/branding$`)},
	{http.MethodPost, regexp.MustCompile(`^/api/v1/recordings$`)},
	{http.MethodPut, regexp.MustCompile(`^/api/v1/recordings/[0-9a-f-]{36}/streams/[a-z]+/chunks/\d+$`)},
	{http.MethodGet, regexp.MustCompile(`^/api/v1/recordings/[0-9a-f-]{36}/streams/[a-z]+/chunks$`)},
	{http.MethodPost, regexp.MustCompile(`^/api/v1/recordings/[0-9a-f-]{36}/streams/[a-z]+/complete$`)},
	{http.MethodPost, regexp.MustCompile(`^/api/v1/recordings/[0-9a-f-]{36}/finalize$`)},
	{http.MethodPost, regexp.MustCompile(`^/api/v1/assets$`)},
}

func apiAllowed(method, p string) bool {
	for _, a := range apiAllow {
		if a.method == method && a.re.MatchString(p) {
			return true
		}
	}
	return false
}

type apiCtx struct{ token, path string }

func (in *Injector) serveAPI(w http.ResponseWriter, r *http.Request, apiPath string) {
	if in.cfg.ServerURL == nil {
		http.Error(w, `{"error":"unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	clean := path.Clean(apiPath)
	if clean != apiPath || !apiAllowed(r.Method, clean) {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	if r.Header.Get(pageHeader) != "1" {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	if o := r.Header.Get("Origin"); o != "" && !strings.EqualFold(o, in.requestOrigin(r)) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	c, ok := in.reviewer(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, apiCtx{token: c.Token, path: clean}))
	in.api.ServeHTTP(w, r)
}

func (in *Injector) rewriteAPI(pr *httputil.ProxyRequest) {
	a, _ := pr.In.Context().Value(ctxKey{}).(apiCtx)
	pr.SetURL(in.cfg.ServerURL)
	pr.Out.URL.Path = strings.TrimSuffix(in.cfg.ServerURL.Path, "/") + a.path
	pr.Out.URL.RawPath = ""
	// Nothing of the app's origin goes to the server: no cookies, no origin, no referrer.
	for _, h := range []string{"Cookie", "Origin", "Referer", pageHeader} {
		pr.Out.Header.Del(h)
	}
	pr.Out.Header.Set("Authorization", "Bearer "+a.token)
}

func (in *Injector) serveAsset(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Only plain files at the top of the assets folder.
	if name == "" || strings.ContainsAny(name, "/\\") || strings.HasPrefix(name, ".") {
		http.NotFound(w, r)
		return
	}
	p := filepath.Join(in.cfg.AssetsDir, name)
	st, err := os.Stat(p)
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	if v := r.URL.Query().Get("v"); v != "" && v == in.bundleHash {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if strings.HasSuffix(name, ".js") {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	}
	http.ServeFile(w, r, p)
}
