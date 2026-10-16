package main

// Loopback mode (D-200): Traefik sends the injector only reviewer requests and /__toolbar/, for
// any host, and the injector forwards each one back into Traefik instead of to a configured app
// address. Traefik then routes it to the app through the router Coolify made from the app's
// labels, so the injector needs no list of apps.
//
//	browser -> Traefik (router "open-toolbar-injector") -> injector
//	        -> Traefik again (no reviewer cookie, Via: 1.1 open-toolbar-injector) -> app
//
// The second pass cannot reach the injector again: the reviewer cookie is gone (the injector
// strips it) and /__toolbar/ is answered by the injector, never forwarded, so it matches only
// Coolify's router. If one ever comes back anyway (a hand-made Traefik rule, say), the Via token
// stops it with a 508 instead of a loop.

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// passHeader carries the pass value, for the fallback while the injector is down. The Traefik
// router adds it to what it routes, the router rule leaves out requests that carry it, so the
// fallback hop (Traefik to itself) reaches the app through Coolify's router instead of coming
// back to the dead injector. It is derived from INJECTOR_SECRET, so a page script cannot send it
// to get the reviewer cookie past the injector. The injector removes it from every request, never
// sends it on, and warns once when it is missing or wrong (the Traefik file was not filled in).
const passHeader = "X-Open-Toolbar-Pass"

// viaToken marks a request the injector already forwarded once.
const viaToken = "open-toolbar-injector"

// passValue is base64url(HMAC-SHA256(secret, "open-toolbar pass v1")), 43 characters.
func passValue(secret []byte) string {
	if len(secret) == 0 {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(mac(secret, "open-toolbar pass v1"))
}

// looped: the request carries this injector's Via token, so it already went through once.
func looped(r *http.Request) bool {
	for _, v := range r.Header.Values("Via") {
		if strings.Contains(strings.ToLower(v), viaToken) {
			return true
		}
	}
	return false
}

// loopbackAddr is host:port of INJECTOR_LOOPBACK, with the scheme's default port.
func loopbackAddr(u *url.URL) string {
	if u.Port() != "" {
		return u.Host
	}
	if u.Scheme == "https" {
		return net.JoinHostPort(u.Hostname(), "443")
	}
	return net.JoinHostPort(u.Hostname(), "80")
}

// newLoopTransport dials INJECTOR_LOOPBACK for every request while the request URL keeps the
// app's host. The transport therefore sends that host as the TLS server name, checks the
// proxy's certificate against it (the certificate Traefik serves the app with, from the system
// roots), and keeps connections per app host, so one host's connection never carries another's
// request. HTTP/1.1 only: WebSocket upgrades through the loop need it.
func newLoopTransport(loopback *url.URL, insecure bool, roots *x509.CertPool) *http.Transport {
	addr := loopbackAddr(loopback)
	d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return d.DialContext(ctx, network, addr)
		},
		TLSClientConfig: &tls.Config{
			MinVersion:         tls.VersionTLS12,
			NextProtos:         []string{"http/1.1"},
			RootCAs:            roots,    // nil: the system roots
			InsecureSkipVerify: insecure, //nolint:gosec // INJECTOR_LOOPBACK_INSECURE, for a proxy with a self-signed certificate
		},
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   32,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
}

// certError: the loopback hop failed on the proxy's certificate.
func certError(err error) bool {
	var unknown x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	var verify *tls.CertificateVerificationError
	return errors.As(err, &unknown) || errors.As(err, &hostname) || errors.As(err, &invalid) || errors.As(err, &verify)
}
