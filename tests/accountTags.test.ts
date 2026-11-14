import { describe, expect, it } from 'vitest';
import { buildAccountTags } from '../shared/accountTags';

describe('account tags for mixed lists', () => {
  it('names accounts on different domains by their domain', () => {
    const tags = buildAccountTags(['alex.morgan@northwind.example', 'alex@morgan-family.example']);
    expect(tags.get('alex.morgan@northwind.example')?.label).toBe('northwind');
    expect(tags.get('alex@morgan-family.example')?.label).toBe('morgan-family');
  });

  it('names accounts on one domain by the part before @', () => {
    const tags = buildAccountTags(['alex@postbox.example', 'billing@postbox.example']);
    expect(tags.get('alex@postbox.example')?.label).toBe('alex');
    expect(tags.get('billing@postbox.example')?.label).toBe('billing');
  });

  it('gives each account its own colour and keeps the full address', () => {
    const tags = buildAccountTags(['a@one.example', 'b@two.example', 'c@three.example']);
    expect(new Set(Array.from(tags.values()).map(tag => tag.color)).size).toBe(3);
    expect(tags.get('b@two.example')?.email).toBe('b@two.example');
  });

  it('adds nothing for a single account', () => {
    expect(buildAccountTags(['a@one.example']).size).toBe(0);
    expect(buildAccountTags([]).size).toBe(0);
    expect(buildAccountTags(['a@one.example', ' a@one.example ']).size).toBe(0);
  });

  it('gives each account a short code for narrow rows, unique within the set', () => {
    const tags = buildAccountTags(['alex.morgan@northwind.example', 'alex@morgan-family.example']);
    expect(tags.get('alex.morgan@northwind.example')?.short).toBe('NO');
    expect(tags.get('alex@morgan-family.example')?.short).toBe('MF');
    const close = buildAccountTags(['a@north.example', 'b@northwind.example', 'c@norway.example']);
    const codes = Array.from(close.values()).map(tag => tag.short);
    expect(new Set(codes).size).toBe(3);
    expect(codes.every(code => code.length >= 2)).toBe(true);
  });
});
