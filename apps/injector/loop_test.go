package main

import (
	"bufio"
	"crypto/x509"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// proxyRig stands in for Traefik: a TLS server (certificate for example.com) that the injector
// loops back into. It answers like the app would after Traefik routed the second pass.
type proxyRig struct {
	proxy *httptest.Server
	front *httptest.Server
	in    *Injector
	mu    sync.Mutex
	sni   []string
	reqs  []*http.Request
	logs  *strings.Builder
}

func newProxyRig(t *testing.T, mutate func(*Config)) *proxyRig {
	t.Helper()
	p := &proxyRig{logs: &strings.Builder{}}
	p.proxy = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		p.mu.Lock()
		p.sni = append(p.sni, q.TLS.ServerName)
		p.reqs = append(p.reqs, q.Clone(q.Context()))
		p.mu.Unlock()
		switch q.URL.Path {
		case "/ws":
			// a WebSocket upgrade, answered by hand: 101, then echo one line
			if q.Header.Get("Upgrade") != "websocket" {
				http.Error(w, "no upgrade", 400)
				return
			}
			conn, rw, err := http.NewResponseController(w).Hijack()
			if err != nil {
				return
			}
			defer conn.Close()
			_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
			_ = rw.Flush()
			line, _ := rw.ReadString('\n')
			_, _ = rw.WriteString("echo " + line)
			_ = rw.Flush()
		case "/sse":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: one\n\n")
			w.(http.Flusher).Flush()
			time.Sleep(400 * time.Millisecond)
			_, _ = io.WriteString(w, "data: two\n\n")
		default:
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, page)
		}
	}))
	p.proxy.EnableHTTP2 = true // like Traefik: the injector must still speak HTTP/1.1 to it
	p.proxy.StartTLS()
	lb, _ := url.Parse(p.proxy.URL)
	roots := x509.NewCertPool()
	roots.AddCert(p.proxy.Certificate())
	cfg := Config{Loopback: lb, LoopbackRoots: roots, Secret: secret, AssetsDir: t.TempDir(), TrustForwarded: true}
	if mutate != nil {
		mutate(&cfg)
	}
	p.in = NewInjector(cfg, slog.New(slog.NewTextHandler(syncWriter{p}, nil)))
	p.front = httptest.NewServer(p.in)
	t.Cleanup(func() { p.front.Close(); p.proxy.Close() })
	return p
}

type syncWriter struct{ p *proxyRig }

func (s syncWriter) Write(b []byte) (int, error) {
	s.p.mu.Lock()
	defer s.p.mu.Unlock()
	return s.p.logs.Write(b)
}

func (p *proxyRig) log() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.logs.String()
}

func (p *proxyRig) last(t *testing.T) (*http.Request, string) {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.reqs) == 0 {
		t.Fatal("nothing reached the proxy")
	}
	return p.reqs[len(p.reqs)-1], p.sni[len(p.sni)-1]
}

// do sends a request as Traefik's first pass would: Host example.com, https in X-Forwarded-Proto.
func (p *proxyRig) do(t *testing.T, path string, hdr map[string]string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, p.front.URL+path, nil)
	req.Host = "example.com"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func reviewerCookie(t *testing.T, origin string) map[string]string {
	t.Helper()
	v, err := signReview(secret, reviewClaims{V: 1, Origin: origin, User: "u1", Exp: time.Now().Add(time.Hour).Unix(), Token: "tb_dev_secret"})
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{"Cookie": "app=1; " + cookieNameSecure + "=" + v}
}

func TestLoopbackForwardsIntoProxyWithHostAndSNI(t *testing.T) {
	p := newProxyRig(t, nil)
	h := reviewerCookie(t, "https://example.com")
	h[passHeader] = passValue(secret) // what the Traefik router adds
	res, body := p.do(t, "/page?x=1", h)
	if res.StatusCode != 200 || !strings.Contains(body, `<head><script src="/__toolbar/toolbar.js"`) || res.Header.Get("X-Toolbar-Injected") != "1" {
		t.Fatalf("no injection through the loop: %d %q", res.StatusCode, body)
	}
	q, sni := p.last(t)
	if q.Host != "example.com" || sni != "example.com" {
		t.Fatalf("host %q, sni %q", q.Host, sni)
	}
	if q.URL.RequestURI() != "/page?x=1" {
		t.Fatalf("uri %q", q.URL.RequestURI())
	}
	if q.ProtoMajor != 1 {
		t.Fatalf("loop used HTTP/%d, WebSockets need HTTP/1.1", q.ProtoMajor)
	}
	// the pass value never reaches the app; the Via token marks the one pass
	if q.Header.Get(passHeader) != "" || !strings.Contains(q.Header.Get("Via"), viaToken) {
		t.Fatalf("pass %q via %q", q.Header.Get(passHeader), q.Header.Get("Via"))
	}
	if q.Header.Get("Cookie") != "app=1" {
		t.Fatalf("cookie reached the app: %q", q.Header.Get("Cookie"))
	}
	if q.Header.Get("X-Forwarded-Proto") != "https" || !strings.HasPrefix(q.Header.Get("X-Forwarded-For"), "203.0.113.7, ") || q.Header.Get("X-Forwarded-Host") != "example.com" {
		t.Fatalf("forwarded headers: %v", q.Header)
	}
	if strings.Contains(p.log(), "pass-") || strings.Contains(p.log(), "level=WARN") {
		t.Fatalf("unexpected warning: %s", p.log())
	}
}

func TestLoopbackDropsPassHeaderAndWarnsOnce(t *testing.T) {
	p := newProxyRig(t, nil)
	h := reviewerCookie(t, "https://example.com")
	h[passHeader] = "forged"
	_, _ = p.do(t, "/", h)
	_, _ = p.do(t, "/", h)
	q, _ := p.last(t)
	if q.Header.Get(passHeader) != "" {
		t.Fatalf("pass header forwarded: %q", q.Header.Get(passHeader))
	}
	if n := strings.Count(p.log(), "does not match INJECTOR_SECRET"); n != 1 {
		t.Fatalf("want one warning about the wrong value, got %d: %s", n, p.log())
	}
	delete(h, passHeader)
	_, _ = p.do(t, "/", h)
	if !strings.Contains(p.log(), "lacks the open-toolbar-pass middleware") {
		t.Fatalf("no warning about the missing header: %s", p.log())
	}
}

func TestLoopDetected(t *testing.T) {
	p := newProxyRig(t, nil)
	res, _ := p.do(t, "/", map[string]string{"Via": "1.1 traefik, 1.1 " + viaToken})
	if res.StatusCode != http.StatusLoopDetected {
		t.Fatalf("status %d", res.StatusCode)
	}
	p.mu.Lock()
	n := len(p.reqs)
	p.mu.Unlock()
	if n != 0 {
		t.Fatal("a looped request was forwarded again")
	}
}

func TestLoopbackCertificateVerified(t *testing.T) {
	// the system roots do not know the test certificate: refused, with a hint in the log
	p := newProxyRig(t, func(c *Config) { c.LoopbackRoots = nil })
	res, _ := p.do(t, "/", nil)
	if res.StatusCode != http.StatusBadGateway || !strings.Contains(p.log(), "INJECTOR_LOOPBACK_INSECURE") {
		t.Fatalf("status %d, log %s", res.StatusCode, p.log())
	}
	// a host the certificate does not cover is refused too
	p2 := newProxyRig(t, nil)
	req, _ := http.NewRequest(http.MethodGet, p2.front.URL+"/", nil)
	req.Host = "other.test"
	res2, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode != http.StatusBadGateway {
		t.Fatalf("wrong host accepted: %d", res2.StatusCode)
	}
	// INJECTOR_LOOPBACK_INSECURE: a self-signed proxy works
	p3 := newProxyRig(t, func(c *Config) { c.LoopbackRoots = nil; c.LoopbackInsecure = true })
	if res, _ := p3.do(t, "/", nil); res.StatusCode != 200 {
		t.Fatalf("insecure: %d", res.StatusCode)
	}
}

func TestLoopbackWebSocket(t *testing.T) {
	p := newProxyRig(t, nil)
	conn, err := net.Dial("tcp", strings.TrimPrefix(p.front.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	_, _ = io.WriteString(conn, "GET /ws HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
	br := bufio.NewReader(conn)
	res, err := http.ReadResponse(br, nil)
	if err != nil || res.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade: %v %v", err, res)
	}
	_, _ = io.WriteString(conn, "hello\n")
	line, err := br.ReadString('\n')
	if err != nil || line != "echo hello\n" {
		t.Fatalf("echo %q %v", line, err)
	}
}

func TestLoopbackStreamsEvents(t *testing.T) {
	p := newProxyRig(t, nil)
	req, _ := http.NewRequest(http.MethodGet, p.front.URL+"/sse", nil)
	req.Host = "example.com"
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	start := time.Now()
	buf := make([]byte, 64)
	n, _ := res.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), "data: one") || time.Since(start) > 300*time.Millisecond {
		t.Fatalf("first event held back: %q after %v", buf[:n], time.Since(start))
	}
}

func TestExplicitUpstreamWinsOverLoopback(t *testing.T) {
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { _, _ = io.WriteString(w, "direct") }))
	defer app.Close()
	u, _ := url.Parse(app.URL)
	p := newProxyRig(t, func(c *Config) { c.Upstreams = map[string]*url.URL{"direct.test": u} })
	req, _ := http.NewRequest(http.MethodGet, p.front.URL+"/", nil)
	req.Host = "direct.test"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(b) != "direct" {
		t.Fatalf("got %q", b)
	}
	if _, body := p.do(t, "/", nil); body != page {
		t.Fatalf("other hosts loop back: %q", body)
	}
}

func TestHealthIsReadableCrossOrigin(t *testing.T) {
	p := newProxyRig(t, nil)
	res, body := p.do(t, "/__toolbar/health", nil)
	if res.Header.Get("Access-Control-Allow-Origin") != "*" || !strings.Contains(body, `"service":"open-toolbar-injector"`) {
		t.Fatalf("health %v %q", res.Header, body)
	}
}

func TestPassValueIsStable(t *testing.T) {
	v := passValue([]byte("0123456789abcdef0123456789abcdef"))
	if len(v) != 43 || v != passValue([]byte("0123456789abcdef0123456789abcdef")) || v == passValue(secret) {
		t.Fatalf("pass value %q", v)
	}
	if passValue(nil) != "" {
		t.Fatal("pass value without a secret")
	}
}
