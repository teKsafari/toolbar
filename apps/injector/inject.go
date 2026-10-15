package main

// Streaming <head> injection. The body is tokenized with golang.org/x/net/html as it arrives and
// every token is written out as its raw bytes, so the output equals the input plus one tag. The
// tag goes right after the <head> start tag, or, when the document has no <head> tag, right before
// the first token that would open the implied head (a head element such as <meta>, a body element
// or text): the parser then puts the script into the implied head. Once the tag is out, or once the
// scan gives up, the rest of the body is copied through untouched.

import (
	"bytes"
	"errors"
	"io"
	"strings"

	"golang.org/x/net/html"
)

// Bytes of the document scanned for a head before the injector gives up and copies the rest.
const defaultScanLimit = 256 << 10

// Largest single token held while scanning (a long comment or inline script before <head>).
const maxTokenBytes = 64 << 10

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// headInjector is an io.ReadCloser over an HTML body that adds tag to the document head.
type headInjector struct {
	src      io.ReadCloser
	counted  *countingReader
	z        *html.Tokenizer
	tag      []byte
	limit    int
	out      bytes.Buffer // bytes ready for the caller
	rest     io.Reader    // set once scanning ends: what is left, passed through
	err      error        // a read error to return after out drains
	injected bool
}

type countingReader struct {
	r io.Reader
	n int
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += n
	return n, err
}

func newHeadInjector(src io.ReadCloser, tag []byte, scanLimit int) *headInjector {
	if scanLimit <= 0 {
		scanLimit = defaultScanLimit
	}
	c := &countingReader{r: src}
	z := html.NewTokenizer(c)
	z.SetMaxBuf(maxTokenBytes)
	return &headInjector{src: src, counted: c, z: z, tag: tag, limit: scanLimit}
}

// Injected reports whether the tag went into the output.
func (h *headInjector) Injected() bool { return h.injected }

func (h *headInjector) Close() error { return h.src.Close() }

func (h *headInjector) Read(p []byte) (int, error) {
	for {
		if h.out.Len() > 0 {
			return h.out.Read(p)
		}
		if h.err != nil {
			return 0, h.err
		}
		if h.rest != nil {
			return h.rest.Read(p)
		}
		h.step()
	}
}

// finish stops scanning: whatever the tokenizer holds goes out as is, then the source.
func (h *headInjector) finish() {
	buffered := append([]byte(nil), h.z.Buffered()...)
	h.rest = io.MultiReader(bytes.NewReader(buffered), h.src)
}

func (h *headInjector) inject() {
	h.out.Write(h.tag)
	h.injected = true
}

// step reads one token and decides what to write.
func (h *headInjector) step() {
	tt := h.z.Next()
	raw := h.z.Raw()
	if tt == html.ErrorToken {
		// The partial token and the unread buffer are written unchanged.
		h.out.Write(raw)
		err := h.z.Err()
		switch {
		case errors.Is(err, io.EOF):
			h.out.Write(h.z.Buffered())
			h.rest = eofReader{}
		case errors.Is(err, html.ErrBufferExceeded):
			h.finish()
		default:
			h.out.Write(h.z.Buffered())
			h.err = err
		}
		return
	}
	switch tt {
	case html.DoctypeToken, html.CommentToken:
		h.out.Write(raw)
	case html.TextToken:
		if isBlank(raw) {
			h.out.Write(raw)
		} else {
			h.inject()
			h.out.Write(raw)
			h.finish()
			return
		}
	case html.StartTagToken, html.SelfClosingTagToken:
		name, _ := h.z.TagName()
		switch string(name) {
		case "html":
			h.out.Write(raw)
		case "head":
			h.out.Write(raw)
			h.inject()
			h.finish()
			return
		default:
			h.inject()
			h.out.Write(raw)
			h.finish()
			return
		}
	default:
		// An end tag before any head: odd markup. Leave the document alone.
		h.out.Write(raw)
		h.finish()
		return
	}
	if h.counted.n >= h.limit {
		h.finish()
	}
}

func isBlank(b []byte) bool {
	b = bytes.TrimPrefix(b, utf8BOM)
	return len(bytes.TrimLeft(b, " \t\r\n\f")) == 0
}

type eofReader struct{}

func (eofReader) Read([]byte) (int, error) { return 0, io.EOF }

// scriptTag builds the injected tag. The nonce is used only when it is plain base64 or base64url.
func scriptTag(src, nonce string) []byte {
	var b strings.Builder
	b.WriteString(`<script src="`)
	b.WriteString(html.EscapeString(src))
	b.WriteString(`"`)
	if nonce != "" && validNonce(nonce) {
		b.WriteString(` nonce="`)
		b.WriteString(nonce)
		b.WriteString(`"`)
	}
	b.WriteString(` data-open-toolbar=""></script>`)
	return []byte(b.String())
}

func validNonce(n string) bool {
	if len(n) > 256 {
		return false
	}
	for _, c := range n {
		ok := c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '=' || c == '-' || c == '_'
		if !ok {
			return false
		}
	}
	return n != ""
}
