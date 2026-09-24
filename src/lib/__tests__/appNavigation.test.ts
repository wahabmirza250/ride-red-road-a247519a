import { describe, expect, it } from 'vitest';
import { isAppNavActive, tenantRelativePath } from '../appNavigation';

describe('company app navigation', () => {
  it('recognizes company-prefixed and trailing-slash home routes', () => {
    expect(tenantRelativePath('/walla/driver/', 'walla')).toBe('/driver');
    expect(isAppNavActive(tenantRelativePath('/walla/driver', 'walla'), '/driver', true)).toBe(true);
  });
  it('keeps the active section on a nested page', () => {
    expect(isAppNavActive(tenantRelativePath('/walla/driver/history/123', 'walla'), '/driver/history')).toBe(true);
  });
  it('does not confuse prefixes with route segments', () => {
    expect(tenantRelativePath('/walla-two/driver', 'walla')).toBe('/walla-two/driver');
    expect(isAppNavActive('/driver/history-old', '/driver/history')).toBe(false);
    expect(isAppNavActive('/driver/history', '/driver', true)).toBe(false);
  });
  it('recognizes booking routes so navigation clears the booking controls', () => {
    expect(tenantRelativePath('/walla/passenger/book/pickup', 'walla').startsWith('/passenger/book/')).toBe(true);
  });
});
