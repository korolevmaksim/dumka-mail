import { describe, it, expect } from 'vitest';
import { compileMarkdownToHtml, compileMarkdownToHtmlFragment } from '../shared/markdown';

describe('compileMarkdownToHtml', () => {
  it('compiles standard formatting', () => {
    const md = 'Hello **world**';
    const html = compileMarkdownToHtml(md);
    expect(html).toContain('Hello <strong>world</strong>');
  });

  it('compiles single-level blockquote', () => {
    const md = 'On Sun, Jun 28, 2026, Alex wrote:\n> Line 1\n> Line 2';
    const html = compileMarkdownToHtml(md);
    
    // Check Gmail blockquote class and styling
    expect(html).toContain('<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex; border-left:1px solid rgb(204,204,204); padding-left:1ex">');
    expect(html).toContain('Line 1<br/>Line 2');
    expect(html).toContain('</blockquote>');
    // Ensure no redundant <br/> right inside or outside blockquote
    expect(html).not.toContain('<blockquote><br/>');
    expect(html).not.toContain('<br/></blockquote>');
  });

  it('compiles nested blockquotes', () => {
    const md = '> Outer level\n> > Inner level\n> Back to outer';
    const html = compileMarkdownToHtml(md);
    
    // Should contain 2 blockquotes nested
    const blockquoteCount = (html.match(/<blockquote/g) || []).length;
    expect(blockquoteCount).toBe(2);
    
    expect(html).toContain('Outer level');
    expect(html).toContain('Inner level');
    expect(html).toContain('Back to outer');
  });

  it('compiles blockquote with heading and list', () => {
    const md = '> # Quoted Heading\n> - Item 1\n> - Item 2';
    const html = compileMarkdownToHtml(md);
    
    expect(html).toContain('<h1>Quoted Heading</h1>');
    expect(html).toContain('<li>Item 1</li>');
    expect(html).toContain('<li>Item 2</li>');
  });

  it('compiles a reusable fragment without document wrappers', () => {
    const html = compileMarkdownToHtmlFragment('A **bold** point');

    expect(html).toContain('A <strong>bold</strong> point');
    expect(html).not.toContain('<html>');
    expect(html).not.toContain('<body>');
  });

  it('does not emit unsafe link schemes', () => {
    const html = compileMarkdownToHtmlFragment('[bad](javascript:alert(1)) and [good](https://example.com)');

    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('href="https://example.com"');
  });
});
