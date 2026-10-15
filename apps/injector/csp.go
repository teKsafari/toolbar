package main

import (
	"net/http"
	"strings"
)

// cspNonce returns the nonce a <script src> element needs under the response's enforced
// Content-Security-Policy, or "" when no policy asks for one. A script element is checked
// against script-src-elem, then script-src, then default-src (CSP Level 3, section 6.1.1.1
// "effective directive"); the first of those a policy has is the one that counts. Report-only
// policies are ignored: they block nothing.
func cspNonce(h http.Header) string {
	for _, value := range h.Values("Content-Security-Policy") {
		// One header may carry several policies separated by commas.
		for _, policy := range strings.Split(value, ",") {
			if n := policyNonce(policy); n != "" {
				return n
			}
		}
	}
	return ""
}

func policyNonce(policy string) string {
	dirs := map[string][]string{}
	for _, d := range strings.Split(policy, ";") {
		f := strings.Fields(d)
		if len(f) == 0 {
			continue
		}
		name := strings.ToLower(f[0])
		if _, seen := dirs[name]; seen {
			continue // the first occurrence of a directive wins
		}
		dirs[name] = f[1:]
	}
	for _, name := range []string{"script-src-elem", "script-src", "default-src"} {
		sources, ok := dirs[name]
		if !ok {
			continue
		}
		for _, s := range sources {
			ls := strings.ToLower(s)
			if strings.HasPrefix(ls, "'nonce-") && strings.HasSuffix(s, "'") && len(s) > len("'nonce-'") {
				return s[len("'nonce-") : len(s)-1]
			}
		}
		return ""
	}
	return ""
}
