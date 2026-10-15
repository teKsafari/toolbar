package main

import (
	"net/http"
	"testing"
)

func TestCSPNonce(t *testing.T) {
	cases := []struct {
		name    string
		headers []string
		want    string
	}{
		{"none", nil, ""},
		{"script-src", []string{"default-src 'self'; script-src 'self' 'nonce-r4nd0m=' 'strict-dynamic'"}, "r4nd0m="},
		{"script-src-elem wins", []string{"script-src 'nonce-a'; script-src-elem 'nonce-b'"}, "b"},
		{"default-src fallback", []string{"default-src 'self' 'nonce-dflt'"}, "dflt"},
		{"script-src without nonce hides default-src", []string{"default-src 'nonce-x'; script-src 'self'"}, ""},
		{"case", []string{"SCRIPT-SRC 'NONCE-AbC'"}, "AbC"},
		{"two policies in one header", []string{"img-src 'self', script-src 'nonce-second'"}, "second"},
		{"two headers", []string{"img-src 'self'", "script-src 'nonce-two'"}, "two"},
		{"first directive occurrence wins", []string{"script-src 'self'; script-src 'nonce-late'"}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := http.Header{}
			for _, v := range c.headers {
				h.Add("Content-Security-Policy", v)
			}
			h.Add("Content-Security-Policy-Report-Only", "script-src 'nonce-reportonly'")
			if got := cspNonce(h); got != c.want {
				t.Fatalf("got %q want %q", got, c.want)
			}
		})
	}
}
