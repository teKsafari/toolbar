// Command injector is the open-toolbar reverse proxy (PLAN "Zero integration", delivery 2). It
// sits between Traefik and chosen apps, adds the toolbar script to the <head> of HTML pages for
// signed-in reviewers only, and serves the toolbar bundle and its API relay under /__toolbar/.
// Configuration is read from the environment; see README.md.
package main

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

func env(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}

func parseURL(name, raw string) (*url.URL, error) {
	if raw == "" {
		return nil, nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("%s: not an http(s) URL: %q", name, raw)
	}
	return u, nil
}

func loadConfig() (Config, error) {
	c := Config{
		Listen:         env("INJECTOR_LISTEN", ":8080"),
		AssetsDir:      env("INJECTOR_ASSETS", "/srv/toolbar"),
		TrustForwarded: env("INJECTOR_TRUST_FORWARDED", "1") != "0",
		Upstreams:      map[string]*url.URL{},
	}
	var err error
	if c.Upstream, err = parseURL("INJECTOR_UPSTREAM", env("INJECTOR_UPSTREAM", "")); err != nil {
		return c, err
	}
	for _, pair := range strings.FieldsFunc(env("INJECTOR_UPSTREAMS", ""), func(r rune) bool { return r == ',' || r == ' ' || r == '\n' }) {
		host, raw, ok := strings.Cut(pair, "=")
		if !ok {
			return c, fmt.Errorf("INJECTOR_UPSTREAMS: %q is not host=url", pair)
		}
		u, err := parseURL("INJECTOR_UPSTREAMS", raw)
		if err != nil {
			return c, err
		}
		c.Upstreams[strings.ToLower(strings.TrimSpace(host))] = u
	}
	if c.Loopback, err = parseURL("INJECTOR_LOOPBACK", env("INJECTOR_LOOPBACK", "")); err != nil {
		return c, err
	}
	if c.Loopback != nil && (c.Loopback.Path != "" && c.Loopback.Path != "/" || c.Loopback.RawQuery != "") {
		return c, fmt.Errorf("INJECTOR_LOOPBACK: scheme, host and port only: %q", c.Loopback.String())
	}
	c.LoopbackInsecure = env("INJECTOR_LOOPBACK_INSECURE", "0") == "1"
	if c.Upstream == nil && len(c.Upstreams) == 0 && c.Loopback == nil {
		return c, errors.New("set INJECTOR_LOOPBACK (the proxy in front, e.g. https://coolify-proxy:443), or INJECTOR_UPSTREAM or INJECTOR_UPSTREAMS")
	}
	if c.ServerURL, err = parseURL("TOOLBAR_SERVER_URL", env("TOOLBAR_SERVER_URL", "")); err != nil {
		return c, err
	}
	if c.PublicServerURL, err = parseURL("TOOLBAR_PUBLIC_URL", env("TOOLBAR_PUBLIC_URL", "")); err != nil {
		return c, err
	}
	if c.PublicServerURL == nil {
		c.PublicServerURL = c.ServerURL
	}
	if s := os.Getenv("INJECTOR_SECRET"); s != "" {
		if len(s) < 32 {
			return c, errors.New("INJECTOR_SECRET must be at least 32 characters")
		}
		c.Secret = []byte(s)
	}
	if n, err := strconv.Atoi(env("INJECTOR_SCAN_LIMIT", "0")); err == nil && n > 0 {
		c.ScanLimit = n
	}
	return c, nil
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if len(os.Args) > 1 && os.Args[1] == "pass-value" {
		// The value of the X-Open-Toolbar-Pass header for the Traefik file, derived from
		// INJECTOR_SECRET (README, "Coolify"). Prints nothing else, so it can be piped.
		s := os.Getenv("INJECTOR_SECRET")
		if len(s) < 32 {
			fmt.Fprintln(os.Stderr, "INJECTOR_SECRET must be set, at least 32 characters")
			os.Exit(2)
		}
		fmt.Println(passValue([]byte(s)))
		os.Exit(0)
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		// for the container HEALTHCHECK: distroless images have no curl
		addr := env("INJECTOR_LISTEN", ":8080")
		if strings.HasPrefix(addr, ":") {
			addr = "127.0.0.1" + addr
		}
		res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://" + addr + toolbarPrefix + "health")
		if err != nil || res.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}
	cfg, err := loadConfig()
	if err != nil {
		log.Error("config", "err", err.Error())
		os.Exit(2)
	}
	if len(cfg.Secret) == 0 {
		log.Warn("INJECTOR_SECRET is not set: no request carries a valid reviewer cookie, so the injector only passes traffic through")
	}
	in := NewInjector(cfg, log)
	if in.bundleHash == "" {
		log.Warn("toolbar bundle missing", "path", cfg.AssetsDir+"/"+bundleName)
	}
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           in,
		ReadHeaderTimeout: 30 * time.Second,
	}
	mode := "upstreams"
	if cfg.Loopback != nil {
		mode = "loopback " + cfg.Loopback.Host
		if cfg.LoopbackInsecure {
			mode += " (certificate not verified)"
		}
	}
	log.Info("injector listening", "addr", cfg.Listen, "mode", mode, "hosts", len(cfg.Upstreams))
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("listen", "err", err.Error())
		os.Exit(1)
	}
}
