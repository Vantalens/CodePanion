(function () {
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderInline(text) {
        return escapeHtml(text)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
    }

    function parse(markdown) {
        const source = String(markdown ?? '').replace(/\r\n/g, '\n');
        const blocks = [];
        const lines = source.split('\n');
        let inCode = false;
        let codeLang = 'text';
        let codeLines = [];
        let paragraph = [];

        function flushParagraph() {
            if (paragraph.length === 0) return;
            blocks.push(`<p>${renderInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
            paragraph = [];
        }

        function flushCode() {
            blocks.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            codeLines = [];
        }

        for (const line of lines) {
            const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/);
            if (fence && !inCode) {
                flushParagraph();
                inCode = true;
                codeLang = fence[1] || 'text';
                continue;
            }
            if (fence && inCode) {
                inCode = false;
                flushCode();
                continue;
            }
            if (inCode) {
                codeLines.push(line);
                continue;
            }
            if (/^\s*$/.test(line)) {
                flushParagraph();
                continue;
            }
            const heading = line.match(/^(#{1,3})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                const level = heading[1].length;
                blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
                continue;
            }
            paragraph.push(line);
        }

        flushParagraph();
        if (inCode) flushCode();
        return blocks.join('\n');
    }

    // Allowlist-based sanitizer. Replaces the previous no-op stub.
    // Rules:
    //   - Only tags in ALLOWED_TAGS survive; everything else is unwrapped (children kept) or stripped.
    //   - <script>, <iframe>, <object>, <embed>, <style>, <link>, <meta>, <base> are stripped wholesale.
    //   - All attributes are removed except those explicitly allowed per tag.
    //   - Any attribute whose value contains a javascript: / vbscript: / data:text/html URL is rejected.
    //   - All on* event handler attributes are always rejected.
    const ALLOWED_TAGS = new Set([
        'p', 'br', 'hr', 'div', 'span',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'strong', 'em', 'b', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
        'a', 'code', 'pre', 'kbd', 'samp', 'var',
        'ul', 'ol', 'li',
        'blockquote', 'q', 'cite',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
    ]);
    const DROP_WHOLE = new Set(['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'noscript', 'svg', 'math']);
    const ATTR_ALLOWLIST = {
        a: ['href', 'title'],
        code: ['class'],
        pre: ['class'],
        span: ['class'],
        div: ['class'],
        th: ['scope'],
        td: ['colspan', 'rowspan'],
        col: ['span'],
    };
    const URL_ATTR = new Set(['href', 'src', 'cite']);
    const SAFE_URL_RE = /^(https?:|mailto:|#|\/)/i;
    const UNSAFE_URL_RE = /^\s*(javascript|vbscript|data:text\/html|file):/i;

    function sanitizeAttributes(el) {
        const tag = el.tagName.toLowerCase();
        const allowed = ATTR_ALLOWLIST[tag] || [];
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value;
            if (name.startsWith('on') || !allowed.includes(name)) {
                el.removeAttribute(attr.name);
                continue;
            }
            if (URL_ATTR.has(name)) {
                const trimmed = value.trim();
                if (UNSAFE_URL_RE.test(trimmed) || !SAFE_URL_RE.test(trimmed)) {
                    el.removeAttribute(attr.name);
                    continue;
                }
            }
            if (name === 'class') {
                // keep simple class tokens only (language-*, hljs, codepanion-*)
                const safe = value.split(/\s+/).filter((token) => /^[A-Za-z0-9_-]+$/.test(token));
                if (safe.length === 0) {
                    el.removeAttribute(attr.name);
                } else {
                    el.setAttribute('class', safe.join(' '));
                }
            }
        }
    }

    function sanitizeNode(node) {
        // Walk children first (snapshot to avoid live-list mutation issues).
        const children = Array.from(node.childNodes);
        for (const child of children) {
            if (child.nodeType === 1 /* ELEMENT_NODE */) {
                const tag = child.tagName.toLowerCase();
                if (DROP_WHOLE.has(tag)) {
                    child.remove();
                    continue;
                }
                if (!ALLOWED_TAGS.has(tag)) {
                    // Unwrap: keep children, drop the element itself.
                    sanitizeNode(child);
                    while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
                    child.remove();
                    continue;
                }
                sanitizeAttributes(child);
                sanitizeNode(child);
            } else if (child.nodeType === 8 /* COMMENT_NODE */) {
                child.remove();
            }
            // Text nodes are left as-is; DOM parser already escapes them safely.
        }
    }

    function sanitize(dirty) {
        const html = String(dirty ?? '');
        if (!html) return '';
        const template = document.createElement('template');
        template.innerHTML = html;
        sanitizeNode(template.content);
        return template.innerHTML;
    }

    window.marked = { parse, setOptions: function () {}, version: 'codepanion-local' };
    window.DOMPurify = { sanitize, version: 'codepanion-local' };
    window.hljs = {
        getLanguage: function () { return false; },
        highlightAuto: function (code) { return { value: escapeHtml(code) }; },
        highlight: function (code) { return { value: escapeHtml(code) }; }
    };
})();
