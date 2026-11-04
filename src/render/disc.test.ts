import { expect, it } from 'vitest';

it('sonda: getContext en happy-dom', () => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  console.log('ctx:', ctx === null ? 'null' : typeof ctx);
  console.log('getComputedStyle:', typeof getComputedStyle(document.documentElement).getPropertyValue('--aluminio'));
  expect(c.width).toBe(64);
});
