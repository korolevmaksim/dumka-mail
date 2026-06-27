export function compileMarkdownToHtml(md: string): string {
  if (!md) return '';
  
  // Escape HTML characters to ensure safety
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

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

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #5383E6; text-decoration: underline;">$1</a>');

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

  return `<html><body><div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">${html}</div></body></html>`;
}
