package main

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
	"testing/iotest"
)

const tag = `<script src="/__toolbar/toolbar.js" data-open-toolbar=""></script>`

func run(t *testing.T, r io.Reader, limit int) (string, bool, error) {
	t.Helper()
	h := newHeadInjector(io.NopCloser(r), []byte(tag), limit)
	out, err := io.ReadAll(h)
	return string(out), h.Injected(), err
}

// splitReader returns the input in two reads, split at i.
type splitReader struct {
	parts [][]byte
}

func (s *splitReader) Read(p []byte) (int, error) {
	for len(s.parts) > 0 && len(s.parts[0]) == 0 {
		s.parts = s.parts[1:]
	}
	if len(s.parts) == 0 {
		return 0, io.EOF
	}
	n := copy(p, s.parts[0])
	s.parts[0] = s.parts[0][n:]
	return n, nil
}

var cases = []struct {
	name, in, want string
}{
	{"head", "<!doctype html><html><head><title>x</title></head><body>hi</body></html>",
		"<!doctype html><html><head>" + tag + "<title>x</title></head><body>hi</body></html>"},
	{"head with attributes and case", "<!DOCTYPE html>\n<HTML lang=en>\n<HEAD data-x=\"a>b\">\n<meta charset=utf-8>",
		"<!DOCTYPE html>\n<HTML lang=en>\n<HEAD data-x=\"a>b\">" + tag + "\n<meta charset=utf-8>"},
	{"implied head, meta first", "<!doctype html><meta charset=utf-8><title>t</title>",
		"<!doctype html>" + tag + "<meta charset=utf-8><title>t</title>"},
	{"implied head and body", "<p>hello</p>", tag + "<p>hello</p>"},
	{"text first", "hello <b>x</b>", tag + "hello <b>x</b>"},
	{"bom and whitespace", "\xEF\xBB\xBF\n  <!doctype html>\n<html><head></head>",
		"\xEF\xBB\xBF\n  <!doctype html>\n<html><head>" + tag + "</head>"},
	{"head inside a comment is skipped", "<!-- <head> --><html><head>",
		"<!-- <head> --><html><head>" + tag},
	{"script before head", "<html><script>var s='<head>'</script><head>",
		"<html>" + tag + "<script>var s='<head>'</script><head>"},
	{"self-closing head", "<html><head/><body>", "<html><head/>" + tag + "<body>"},
	{"truncated at eof", "<!doctype html><hea", "<!doctype html><hea"},
	{"empty", "", ""},
	{"only doctype", "<!doctype html>", "<!doctype html>"},
	{"end tag first", "</div><head>", "</div><head>"},
	{"later heads untouched", "<head></head><body><template><head></head></template>",
		"<head>" + tag + "</head><body><template><head></head></template>"},
}

func TestInjectWholeReads(t *testing.T) {
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _, err := run(t, strings.NewReader(c.in), 0)
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("\n got %q\nwant %q", got, c.want)
			}
		})
	}
}

func TestInjectChunkBoundaries(t *testing.T) {
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// one byte per read
			got, _, err := run(t, iotest.OneByteReader(strings.NewReader(c.in)), 0)
			if err != nil || got != c.want {
				t.Fatalf("one byte reads: %q %v", got, err)
			}
			// every split point of two chunks, and three chunks around each point
			for i := 0; i <= len(c.in); i++ {
				got, _, err := run(t, &splitReader{parts: [][]byte{[]byte(c.in[:i]), []byte(c.in[i:])}}, 0)
				if err != nil || got != c.want {
					t.Fatalf("split at %d: %q %v", i, got, err)
				}
				j := min(i+3, len(c.in))
				got, _, err = run(t, &splitReader{parts: [][]byte{[]byte(c.in[:i]), []byte(c.in[i:j]), []byte(c.in[j:])}}, 0)
				if err != nil || got != c.want {
					t.Fatalf("split at %d,%d: %q %v", i, j, got, err)
				}
			}
			// data errors from the reader are surfaced at the end, not swallowed
			got, _, err = run(t, iotest.DataErrReader(strings.NewReader(c.in)), 0)
			if err != nil || got != c.want {
				t.Fatalf("data err reader: %q %v", got, err)
			}
		})
	}
}

func TestInjectLargeDocumentStreams(t *testing.T) {
	body := strings.Repeat("<p>row</p>\n", 200_000) // about 2 MB after the head
	in := "<!doctype html><html><head><title>big</title></head><body>" + body
	got, injected, err := run(t, iotest.HalfReader(strings.NewReader(in)), 0)
	if err != nil || !injected {
		t.Fatalf("err %v injected %v", err, injected)
	}
	want := "<!doctype html><html><head>" + tag + "<title>big</title></head><body>" + body
	if got != want {
		t.Fatal("large document changed beyond the tag")
	}
}

func TestInjectGivesUpAfterScanLimit(t *testing.T) {
	in := "<!doctype html>" + strings.Repeat("<!-- c -->", 50) + "<head>"
	got, injected, err := run(t, iotest.OneByteReader(strings.NewReader(in)), 64)
	if err != nil || injected || got != in {
		t.Fatalf("scan limit: injected %v err %v out %q", injected, err, got)
	}
}

func TestInjectHugeTokenPassesThrough(t *testing.T) {
	in := "<!doctype html><!--" + strings.Repeat("x", maxTokenBytes*2) + "--><html><head><title>t</title>"
	got, injected, err := run(t, strings.NewReader(in), 1<<30)
	if err != nil || injected || got != in {
		t.Fatalf("huge token: injected %v err %v len %d want %d", injected, err, len(got), len(in))
	}
}

type failingReader struct {
	data []byte
	err  error
}

func (f *failingReader) Read(p []byte) (int, error) {
	if len(f.data) == 0 {
		return 0, f.err
	}
	n := copy(p, f.data)
	f.data = f.data[n:]
	return n, nil
}

func TestInjectReadErrorBeforeHead(t *testing.T) {
	boom := errors.New("upstream reset")
	got, injected, err := run(t, &failingReader{data: []byte("<!doctype html><ht"), err: boom}, 0)
	if !errors.Is(err, boom) {
		t.Fatalf("want the upstream error, got %v", err)
	}
	if injected || got != "<!doctype html><ht" {
		t.Fatalf("bytes before the error must pass unchanged: %q", got)
	}
}

func TestInjectReadErrorAfterHead(t *testing.T) {
	boom := errors.New("upstream reset")
	got, injected, err := run(t, &failingReader{data: []byte("<html><head><title>a"), err: boom}, 0)
	if !errors.Is(err, boom) || !injected {
		t.Fatalf("err %v injected %v", err, injected)
	}
	if !bytes.HasPrefix([]byte(got), []byte("<html><head>"+tag)) {
		t.Fatalf("got %q", got)
	}
}

func TestScriptTagNonce(t *testing.T) {
	if got := string(scriptTag("/__toolbar/toolbar.js?v=1", "abc+/=_-")); got != `<script src="/__toolbar/toolbar.js?v=1" nonce="abc+/=_-" data-open-toolbar=""></script>` {
		t.Fatal(got)
	}
	if got := string(scriptTag("/x.js", `a"><script>`)); strings.Contains(got, "nonce") {
		t.Fatal("unsafe nonce kept:", got)
	}
}
