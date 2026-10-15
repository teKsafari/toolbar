package main

// Reviewer cookie (D-130 in docs/decisions.md; format in apps/injector/README.md). The open-toolbar
// server issues it for one project origin; this proxy only checks it, offline, with the shared
// INJECTOR_SECRET:
//
//	tbr1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "tbr1." + payload part))>
//
// payload: {"v":1,"o":"<origin>","u":"<user id>","x":<expiry, unix seconds>,"k":"<device token>"}
//
// The device token is what the proxy sends to the server as a bearer on /__toolbar/api/ calls.
// The cookie is HttpOnly and the proxy removes it from every request it forwards to the app, so
// neither page scripts nor the app's server see it.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const cookiePrefix = "tbr1."

// Cookie names: the __Host- form on https (no Domain, Path=/, Secure), a plain name on http.
const (
	cookieNameSecure = "__Host-tb_review"
	cookieNamePlain  = "tb_review"
)

type reviewClaims struct {
	V      int    `json:"v"`
	Origin string `json:"o"`
	User   string `json:"u"`
	Exp    int64  `json:"x"`
	Token  string `json:"k"`
}

var (
	errMalformed = errors.New("malformed reviewer cookie")
	errSignature = errors.New("bad reviewer cookie signature")
	errExpired   = errors.New("reviewer cookie expired")
	errOrigin    = errors.New("reviewer cookie is for another origin")
)

func signReview(secret []byte, c reviewClaims) (string, error) {
	body, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	part := base64.RawURLEncoding.EncodeToString(body)
	return cookiePrefix + part + "." + base64.RawURLEncoding.EncodeToString(mac(secret, cookiePrefix+part)), nil
}

func mac(secret []byte, s string) []byte {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(s))
	return m.Sum(nil)
}

// verifyReview checks signature, expiry and origin. origin is the request's own origin.
func verifyReview(secret []byte, value, origin string, now time.Time) (reviewClaims, error) {
	var c reviewClaims
	if len(secret) == 0 || !strings.HasPrefix(value, cookiePrefix) {
		return c, errMalformed
	}
	rest := value[len(cookiePrefix):]
	dot := strings.IndexByte(rest, '.')
	if dot <= 0 || dot == len(rest)-1 {
		return c, errMalformed
	}
	part, sigPart := rest[:dot], rest[dot+1:]
	sig, err := base64.RawURLEncoding.DecodeString(sigPart)
	if err != nil {
		return c, errMalformed
	}
	if !hmac.Equal(sig, mac(secret, cookiePrefix+part)) {
		return c, errSignature
	}
	body, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		return c, errMalformed
	}
	if err := json.Unmarshal(body, &c); err != nil || c.V != 1 || c.Token == "" || c.Origin == "" {
		return reviewClaims{}, errMalformed
	}
	if now.Unix() >= c.Exp {
		return reviewClaims{}, errExpired
	}
	if !strings.EqualFold(c.Origin, origin) {
		return reviewClaims{}, errOrigin
	}
	return c, nil
}

// reviewCookieValue returns the first reviewer cookie on the request, under either name.
func reviewCookieValue(r *http.Request) string {
	for _, name := range []string{cookieNameSecure, cookieNamePlain} {
		if c, err := r.Cookie(name); err == nil && c.Value != "" {
			return c.Value
		}
	}
	return ""
}

// stripReviewCookie removes the reviewer cookies from the Cookie header. A header without them
// stays as it was.
func stripReviewCookie(h http.Header) {
	values := h.Values("Cookie")
	if !strings.Contains(strings.Join(values, ";"), cookieNamePlain) {
		return
	}
	var kept []string
	for _, v := range values {
		var parts []string
		for _, p := range strings.Split(v, ";") {
			name, _, _ := strings.Cut(strings.TrimSpace(p), "=")
			if name == cookieNameSecure || name == cookieNamePlain {
				continue
			}
			if strings.TrimSpace(p) != "" {
				parts = append(parts, strings.TrimSpace(p))
			}
		}
		if len(parts) > 0 {
			kept = append(kept, strings.Join(parts, "; "))
		}
	}
	h.Del("Cookie")
	for _, v := range kept {
		h.Add("Cookie", v)
	}
}
