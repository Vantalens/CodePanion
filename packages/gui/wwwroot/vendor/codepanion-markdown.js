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

    window.marked = { parse, setOptions: function () {}, version: 'codepanion-local' };
    window.DOMPurify = { sanitize: function (html) { return String(html ?? ''); } };
    window.hljs = {
        getLanguage: function () { return false; },
        highlightAuto: function (code) { return { value: escapeHtml(code) }; },
        highlight: function (code) { return { value: escapeHtml(code) }; }
    };
})();
