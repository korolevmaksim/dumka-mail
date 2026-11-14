import { describe, expect, it } from 'vitest';
import { EMAIL_CANVAS_SCAN_LIMIT, htmlHasOwnCanvas } from '../renderer/src/lib/emailCanvas';

describe('htmlHasOwnCanvas', () => {
  it('treats simple messages as theme-able', () => {
    expect(htmlHasOwnCanvas('')).toBe(false);
    expect(htmlHasOwnCanvas('<div dir="ltr">Hi Alex,<br><br>Could we move the pilot?<br>Thanks,<br>Priya</div>')).toBe(false);
    expect(htmlHasOwnCanvas('<p>See <a href="https://docs.example/x">the doc</a>.</p><p style="margin:0 0 8px">Best</p>')).toBe(false);
  });

  it('ignores quoted-reply styling', () => {
    expect(htmlHasOwnCanvas(
      '<div>Sounds good.</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid rgb(204,204,204);color:rgb(80,0,80);padding-left:1ex">Earlier text</blockquote>',
    )).toBe(false);
  });

  it('ignores neutral values', () => {
    expect(htmlHasOwnCanvas('<div style="background: transparent; color: inherit">Hi</div>')).toBe(false);
  });

  it('keeps designed mail on its own canvas', () => {
    expect(htmlHasOwnCanvas('<body bgcolor="#f4f4f4"><p>News</p></body>')).toBe(true);
    expect(htmlHasOwnCanvas('<div style="background-color:#ffffff">Hi</div>')).toBe(true);
    expect(htmlHasOwnCanvas('<td background="https://img.example/bg.png">x</td>')).toBe(true);
    expect(htmlHasOwnCanvas('<p style="color:#333333">Dark text</p>')).toBe(true);
    expect(htmlHasOwnCanvas('<font color="#222">Hi</font>')).toBe(true);
    expect(htmlHasOwnCanvas('<style>.wrap { background: #fafafa }</style><div class="wrap">x</div>')).toBe(true);
    expect(htmlHasOwnCanvas('<table width="600"><tr><td>Weekly</td></tr></table>')).toBe(true);
    expect(htmlHasOwnCanvas('<table style="width:640px"><tr><td>x</td></tr></table>')).toBe(true);
  });

  it('does not mistake background-color for a text colour, or vice versa', () => {
    expect(htmlHasOwnCanvas('<span style="border-color:#ccc">x</span>')).toBe(false);
  });

  it('keeps the three-tables layout rule and skips blockquote styling only on the blockquote', () => {
    expect(htmlHasOwnCanvas('<table><tr><td>a</td></tr></table><table></table><table></table>')).toBe(true);
    expect(htmlHasOwnCanvas('<blockquote style="color:#555"><p style="color:#111">x</p></blockquote>')).toBe(true);
    expect(htmlHasOwnCanvas('<style>p { color: #222 }')).toBe(true);
  });

  it('treats mail beyond the scan limit as having its own canvas', () => {
    expect(htmlHasOwnCanvas(`<p>${'a'.repeat(EMAIL_CANVAS_SCAN_LIMIT)}</p>`)).toBe(true);
  });

  describe('adversarial input stays linear', () => {
    const budgetMs = 200;
    const megabyte = 1024 * 1024;
    const justUnderLimit = EMAIL_CANVAS_SCAN_LIMIT - 16;
    const repeatTo = (unit: string, length: number) => unit.repeat(Math.floor(length / unit.length));
    const cases: Array<[string, string]> = [
      ['<a ', '<a '],
      ['<table ', '<table '],
      ['<blockquote ', '<blockquote '],
      ['<font ', '<font '],
      [' style="', ' style="'],
      ['<x background', '<x background'],
      ['bgcolor ', 'bgcolor '],
    ];

    for (const [label, unit] of cases) {
      for (const [size, length] of [['1 MB', megabyte], ['just under the limit', justUnderLimit]] as const) {
        it(`${JSON.stringify(label)} repeated, ${size}`, () => {
          const input = repeatTo(unit, length);
          const started = performance.now();
          htmlHasOwnCanvas(input);
          htmlHasOwnCanvas(`${input}>`);
          expect(performance.now() - started).toBeLessThan(budgetMs);
        });
      }
    }

    it('unterminated <style> block', () => {
      for (const length of [megabyte, justUnderLimit]) {
        const input = `<style>${repeatTo('p { margin : 0 } ', length - 7)}`;
        const started = performance.now();
        htmlHasOwnCanvas(input);
        expect(performance.now() - started).toBeLessThan(budgetMs);
      }
    });

    it('many unclosed <style> openers', () => {
      const input = repeatTo('<style>', justUnderLimit);
      const started = performance.now();
      htmlHasOwnCanvas(input);
      expect(performance.now() - started).toBeLessThan(budgetMs);
    });

    it('a neutral colour value followed by a long whitespace run and a stray character', () => {
      for (const spaces of [5_000, 60_000, 150_000]) {
        const run = ' '.repeat(spaces);
        const inputs = [
          `<style>p{color:transparent${run}x}</style><p>Hello</p>`,
          `<p style="background:none${run}x">Hello</p>`,
          `<p style="color:none${run}!x">Hello</p>`,
          `<p style="background:inherit${run}!important${run};${run}">Hello</p>`,
        ];
        for (const input of inputs) {
          const started = performance.now();
          htmlHasOwnCanvas(input);
          expect(performance.now() - started).toBeLessThan(budgetMs);
        }
      }
    });
  });

  describe('neutral colour values', () => {
    it('does not treat neutral values as an own canvas, with or without !important and a trailing semicolon', () => {
      for (const value of ['transparent', 'inherit', 'none !important', 'currentcolor;', ' initial  !important ; ', 'UNSET']) {
        expect(htmlHasOwnCanvas(`<p style="background:${value}">Hello</p>`)).toBe(false);
        expect(htmlHasOwnCanvas(`<p style="color:${value}">Hello</p>`)).toBe(false);
      }
    });

    it('treats a real colour, or a neutral word followed by anything else, as an own canvas', () => {
      for (const value of ['#fff', 'red', 'none x', 'transparent !x', 'inherit important']) {
        expect(htmlHasOwnCanvas(`<p style="color:${value}">Hello</p>`)).toBe(true);
      }
    });
  });
});
