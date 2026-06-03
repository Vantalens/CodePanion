// 简单的 Markdown 渲染器
(function() {
    'use strict';

    // 转义 HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 渲染代码块
    function renderCodeBlock(code, lang) {
        const escaped = escapeHtml(code);
        const langClass = lang ? ` language-${lang}` : '';
        return `<pre><code class="${langClass}">${escaped}</code></pre>`;
    }

    // 主渲染函数
    function renderMarkdown(text) {
        if (!text) return '';

        let html = text;

        // 1. 代码块（```）
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            return renderCodeBlock(code.trim(), lang);
        });

        // 2. 标题
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // 3. 粗体
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // 4. 斜体
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // 5. 行内代码
        html = html.replace(/`([^`]+)`/g, (match, code) => {
            return `<code>${escapeHtml(code)}</code>`;
        });

        // 6. 链接
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
            // 检查是否是内部链接
            if (url.startsWith('#') || url.startsWith('/')) {
                return `<a href="${url}">${text}</a>`;
            }
            // 外部链接通过 host 打开
            return `<a href="#" data-external-url="${escapeHtml(url)}">${text}</a>`;
        });

        // 7. 无序列表
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');

        // 8. 有序列表
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

        // 9. 水平线
        html = html.replace(/^---$/gm, '<hr>');

        // 10. 段落（最后处理）
        const lines = html.split('\n');
        const paragraphs = [];
        let currentPara = [];

        for (const line of lines) {
            const trimmed = line.trim();

            // 跳过空行和已经是块级元素的行
            if (!trimmed ||
                trimmed.startsWith('<h') ||
                trimmed.startsWith('<pre>') ||
                trimmed.startsWith('<ul>') ||
                trimmed.startsWith('<ol>') ||
                trimmed.startsWith('<li>') ||
                trimmed.startsWith('<hr>')) {

                if (currentPara.length > 0) {
                    paragraphs.push(`<p>${currentPara.join(' ')}</p>`);
                    currentPara = [];
                }
                paragraphs.push(line);
            } else {
                currentPara.push(trimmed);
            }
        }

        if (currentPara.length > 0) {
            paragraphs.push(`<p>${currentPara.join(' ')}</p>`);
        }

        html = paragraphs.join('\n');

        return html;
    }

    // 处理外部链接点击
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-external-url]');
        if (link) {
            e.preventDefault();
            const url = link.dataset.externalUrl;
            if (url && window.codexApp) {
                window.codexApp.sendToHost({
                    type: 'open-external',
                    href: url
                });
            }
        }
    });

    // 暴露到全局
    window.renderMarkdown = renderMarkdown;
})();
