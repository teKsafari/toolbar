package main

import (
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"
)

// testdata/review-cookie.json is shared with the server's TypeScript signer
// (apps/server/test/review-cookie.test.ts): both sides must produce and accept the same value.
type vector struct {
	Secret string       `json:"secret"`
	Claims reviewClaims `json:"claims"`
	Value  string       `json:"value"`
}

func loadVector(t *testing.T) vector {
	t.Helper()
	b, err := os.ReadFile("testdata/review-cookie.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vector
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestCookieVector(t *testing.T) {
	v := loadVector(t)
	got, err := signReview([]byte(v.Secret), v.Claims)
	if err != nil || got != v.Value {
		t.Fatalf("sign: %q %v", got, err)
	}
	c, err := verifyReview([]byte(v.Secret), v.Value, v.Claims.Origin, time.Unix(v.Claims.Exp-10, 0))
	if err != nil || c != v.Claims {
		t.Fatalf("verify: %+v %v", c, err)
	}
}

func TestCookieRefusals(t *testing.T) {
	v := loadVector(t)
	at := time.Unix(v.Claims.Exp-10, 0)
	if _, err := verifyReview([]byte("another-secret-0123456789abcdef0123"), v.Value, v.Claims.Origin, at); err != errSignature {
		t.Fatal("other secret accepted", err)
	}
	if _, err := verifyReview([]byte(v.Secret), v.Value, v.Claims.Origin, time.Unix(v.Claims.Exp, 0)); err != errExpired {
		t.Fatal("expired accepted", err)
	}
	if _, err := verifyReview([]byte(v.Secret), v.Value, "https://evil.example", at); err != errOrigin {
		t.Fatal("other origin accepted", err)
	}
	if _, err := verifyReview(nil, v.Value, v.Claims.Origin, at); err == nil {
		t.Fatal("no secret accepted")
	}
	for _, bad := range []string{"", "tbr1.", "tbr1.abc", "tbr1.abc.", "tbr2." + v.Value[5:], v.Value + "x"} {
		if _, err := verifyReview([]byte(v.Secret), bad, v.Claims.Origin, at); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}

func TestStripReviewCookie(t *testing.T) {
	h := http.Header{}
	h.Add("Cookie", "a=1; tb_review=x; __Host-tb_review=y;b=2")
	stripReviewCookie(h)
	if got := h.Get("Cookie"); got != "a=1; b=2" {
		t.Fatalf("got %q", got)
	}
	h = http.Header{"Cookie": {"tb_review=x"}}
	stripReviewCookie(h)
	if _, ok := h["Cookie"]; ok {
		t.Fatal("empty cookie header kept")
	}
	h = http.Header{"Cookie": {"a=1;b=2"}}
	stripReviewCookie(h)
	if h.Get("Cookie") != "a=1;b=2" {
		t.Fatal("untouched header rewritten")
	}
}
