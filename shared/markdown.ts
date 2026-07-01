function parseBlockquotes(html: string): string {
  const lines = html.split('\n');
  const processedLines: string[] = [];
  let currentLevel = 0;

  for (const line of lines) {
    let remaining = line;
    let level = 0;
    while (true) {
      remaining = remaining.trimStart();
      if (remaining.startsWith('&gt;')) {
        level++;
        remaining = remaining.substring(4); // Remove '&gt;'
        if (remaining.startsWith(' ')) {
          remaining = remaining.substring(1);
        }
      } else {
        break;
      }
    }

    while (currentLevel < level) {
      processedLines.push(`<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex; border-left:1px solid rgb(204,204,204); padding-left:1ex">`);
      currentLevel++;
    }
    while (currentLevel > level) {
      processedLines.push(`</blockquote>`);
      currentLevel--;
    }

    processedLines.push(remaining);
  }

  while (currentLevel > 0) {
    processedLines.push(`</blockquote>`);
    currentLevel--;
  }

  return processedLines.join('\n');
}

function safeMarkdownUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:|mailto:|tel:|#)/i.test(trimmed)) {
    return trimmed
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  return null;
}

export function compileMarkdownToHtmlFragment(md: string): string {
  if (!md) return '';
  
  // Escape HTML characters to ensure safety
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Parse blockquotes
  html = parseBlockquotes(html);

  // Headings
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');

  // Links: [text](url). Text is already escaped; URL is restricted to safe schemes.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
    const safeUrl = safeMarkdownUrl(url);
    if (!safeUrl) return text;
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer" style="color: #5383E6; text-decoration: underline;">${text}</a>`;
  });

  // Unordered list items
  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li>$1</li>');
  
  // Wrap list items in <ul>
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

  // Code blocks
  html = html.replace(/```([^`]+)```/g, '<pre style="background: #f3f4f6; border: 1px solid #e5e7eb; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 12px; margin: 8px 0; white-space: pre-wrap;">$1</pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background: #f3f4f6; border: 1px solid #e5e7eb; padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 11px;">$1</code>');

  // Line breaks
  html = html.replace(/\n/g, '<br/>');

  // Clean up line breaks around block elements
  html = html
    .replace(/<br\/>(<\/blockquote>)/g, '$1')
    .replace(/(<blockquote[^>]*>)<br\/>/g, '$1')
    .replace(/<br\/>(<\/ul>)/g, '$1')
    .replace(/(<ul>)<br\/>/g, '$1')
    .replace(/<br\/>(<\/li>)/g, '$1')
    .replace(/(<li>)<br\/>/g, '$1')
    .replace(/<br\/>(<\/pre>)/g, '$1')
    .replace(/(<pre[^>]*>)<br\/>/g, '$1')
    .replace(/<br\/>(<h[1-6]>)/g, '$1')
    .replace(/(<\/h[1-6]>)<br\/>/g, '$1');

  return html;
}

export function compileMarkdownToHtml(md: string): string {
  if (!md) return '';
  const html = compileMarkdownToHtmlFragment(md);
  return `<html><body><div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">${html}</div></body></html>`;
}
