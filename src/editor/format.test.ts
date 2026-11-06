import { describe, expect, it } from 'vitest';
import { formatDecimal, formatDuration, formatPercent, MAX_TRACK_SEC, parseDuration, toHexColor } from './format';

describe('duraciones', () => {
  it('formatea m:ss y h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(355)).toBe('5:55');
    expect(formatDuration(3727)).toBe('1:02:07');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('lee m:ss, h:mm:ss y segundos sueltos', () => {
    expect(parseDuration('3:07')).toBe(187);
    expect(parseDuration(' 03:07 ')).toBe(187);
    expect(parseDuration('1:02:07')).toBe(3727);
    expect(parseDuration('187')).toBe(187);
  });

  it('rechaza lo inválido, cero y lo demasiado largo', () => {
    for (const bad of ['', '3:', '3:7', '3:60', '1:60:00', 'abc', '0', '0:00', '-1:00']) expect(parseDuration(bad)).toBeNull();
    expect(parseDuration(String(MAX_TRACK_SEC + 1))).toBeNull();
    expect(parseDuration('99:59')).toBe(MAX_TRACK_SEC);
  });
});

describe('números y colores', () => {
  it('usa coma decimal y porcentajes enteros', () => {
    expect(formatDecimal(1.45, 2)).toBe('1,45');
    expect(formatDecimal(8.333, 1)).toBe('8,3');
    expect(formatPercent(0.354)).toBe('35 %');
  });

  it('convierte colores CSS sencillos a #rrggbb', () => {
    expect(toHexColor('#ABC')).toBe('#aabbcc');
    expect(toHexColor('#d1302a')).toBe('#d1302a');
    expect(toHexColor('#d1302a80')).toBe('#d1302a');
    expect(toHexColor('rgb(209, 48, 42)')).toBe('#d1302a');
    expect(toHexColor('rgba(255 255 255 / 0.5)')).toBe('#ffffff');
    expect(toHexColor('tomato')).toBeNull();
  });
});
