import { afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => vi.useRealTimers());

it('refreshes array values and their used range before the anchor is read', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(DAY(TODAY()))');
  expect(wb.getValue(id, 1, 0)).toBe(2);
  expect(wb.usedRange(id).r2).toBe(1);
  wb.markClean();
  wb.clearHistory();

  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
  expect(wb.refreshVolatile()).toBe(true);
  expect(wb.getValue(id, 2, 0)).toBe(3);
  expect(wb.usedRange(id).r2).toBe(2);

  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  expect(wb.refreshVolatile()).toBe(true);
  expect(wb.getValue(id, 2, 0)).toBeNull();
  expect(wb.usedRange(id).r2).toBe(0);
  expect(wb.dirty).toBe(false);
  expect(wb.canUndo()).toBe(false);
});
