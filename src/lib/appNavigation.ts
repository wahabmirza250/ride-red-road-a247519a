/** Compare navigation against the route inside this company's workspace. */
export function tenantRelativePath(pathname: string, companySlug: string) {
  const prefix = `/${companySlug}`;
  const path = pathname === prefix ? '/' : pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
  return path.replace(/\/+$/, '') || '/';
}

export function isAppNavActive(path: string, target: string, exact = false) {
  return path === target || (!exact && path.startsWith(`${target}/`));
}
