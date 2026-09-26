import { describe, expect, it } from 'vitest';
import { revokeAppRoles } from '../revokeAppRoles.server';

function fixture(fail = false) {
  let rows = ['a', 'b'].flatMap(company_id => ['admin', 'driver', 'passenger', 'dispatch', 'billing', 'admin_biller'].map(role => ({company_id, role, user_id: 'shared'})));
  const db: any = { from: () => {
    let matches = rows;
    const query: any = {
      delete: () => query,
      eq: (k: string, v: unknown) => { matches = matches.filter(r => (r as any)[k] === v); return query; },
      in: (k: string, vs: unknown[]) => { matches = matches.filter(r => vs.includes((r as any)[k])); return query; },
      select: async () => {
        if (fail) return {data: null, error: {message: 'Database unavailable'}};
        rows = rows.filter(row => !matches.includes(row));
        return {data: matches, error: null};
      },
    };
    return query;
  } };
  return {db, rows: () => rows};
}
describe('remove app access preserves shared account', () => {
  it('removes dispatch only within the selected company', async () => {
    const f = fixture();
    await revokeAppRoles(f.db, 'a', 'shared', ['dispatch']);
    expect(f.rows()).toHaveLength(11);
    expect(f.rows().filter(r => r.company_id === 'a').map(r => r.role)).toEqual(['admin','driver','passenger','billing','admin_biller']);
    expect(f.rows().filter(r => r.company_id === 'b')).toHaveLength(6);
  });
  it('handles both billing roles without deleting other roles', async () => {
    const f = fixture();
    await revokeAppRoles(f.db, 'a', 'shared', ['billing','admin_biller']);
    expect(f.rows().filter(r => r.company_id === 'a').map(r => r.role)).toEqual(['admin','driver','passenger','dispatch']);
  });
  it('reports missing access instead of claiming success', async () => {
    const f = fixture();
    await expect(revokeAppRoles(f.db, 'other', 'shared', ['dispatch'])).rejects.toThrow('no longer');
    expect(f.rows()).toHaveLength(12);
  });
  it('surfaces database failure and keeps access intact', async () => {
    const f = fixture(true);
    await expect(revokeAppRoles(f.db, 'a', 'shared', ['dispatch'])).rejects.toThrow('Database unavailable');
    expect(f.rows()).toHaveLength(12);
  });
});
