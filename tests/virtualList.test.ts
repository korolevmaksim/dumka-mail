import { describe, expect, it } from 'vitest';
import { calculateVirtualWindow, scrollTopForIndex } from '../renderer/src/lib/virtualList';

describe('virtual list helpers', () => {
  it('returns an empty window for empty lists', () => {
    expect(calculateVirtualWindow({
      itemCount: 0,
      rowHeight: 56,
      viewportHeight: 400,
      scrollTop: 0,
    })).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
  });

  it('adds overscan around the visible row range', () => {
    expect(calculateVirtualWindow({
      itemCount: 1000,
      rowHeight: 50,
      viewportHeight: 250,
      scrollTop: 500,
      overscan: 2,
    })).toEqual({
      startIndex: 8,
      endIndex: 17,
      offsetTop: 400,
      totalHeight: 50000,
    });
  });

  it('clamps virtual ranges near the end of the list', () => {
    expect(calculateVirtualWindow({
      itemCount: 20,
      rowHeight: 40,
      viewportHeight: 160,
      scrollTop: 10_000,
      overscan: 3,
    })).toEqual({
      startIndex: 13,
      endIndex: 20,
      offsetTop: 520,
      totalHeight: 800,
    });
  });

  it('keeps an already visible focused row in place', () => {
    expect(scrollTopForIndex({
      index: 5,
      rowHeight: 50,
      viewportHeight: 300,
      currentScrollTop: 150,
      itemCount: 100,
      marginRows: 1,
    })).toBe(150);
  });

  it('scrolls down when the focused row is below the viewport margin', () => {
    expect(scrollTopForIndex({
      index: 20,
      rowHeight: 50,
      viewportHeight: 300,
      currentScrollTop: 0,
      itemCount: 100,
      marginRows: 1,
    })).toBe(800);
  });

  it('scrolls up when the focused row is above the viewport margin', () => {
    expect(scrollTopForIndex({
      index: 2,
      rowHeight: 50,
      viewportHeight: 300,
      currentScrollTop: 500,
      itemCount: 100,
      marginRows: 1,
    })).toBe(50);
  });
});
