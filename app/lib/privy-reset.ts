/**
 * Browser-side Privy state reset — the in-app equivalent of "Clear site data" for the wallet
 * connect loop (GH#2862 sibling): the Privy modal says "Successfully connected … Wallet was
 * already linked", closes, and the session is gone again.
 *
 * `usePrivy().logout()` clears the active user's tokens, but residual records written under an
 * older configuration (pre-2026-10-02: no HttpOnly cookies / no privy.percolator.trade) can
 * survive it. This removes only Privy's own keys (`privy:*` storage, `privy-*` JS-readable
 * cookies). HttpOnly cookies cannot be touched from JS; they are cleared by `logout()`'s server
 * call. It never touches the app's own storage or other wallets' keys.
 */

const PRIVY_KEY_PREFIXES = ["privy:", "privy-"];

function isPrivyKey(key: string): boolean {
  return PRIVY_KEY_PREFIXES.some((p) => key.startsWith(p));
}

function clearStorage(storage: Storage | undefined): number {
  if (!storage) return 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && isPrivyKey(k)) keys.push(k);
  }
  keys.forEach((k) => storage.removeItem(k));
  return keys.length;
}

function clearPrivyCookies(doc: Document, hostname: string): number {
  const names = doc.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter((n) => n && isPrivyKey(n));
  // Host-only and every parent-domain scope (Privy's base domain is percolator.trade).
  const parts = hostname.split(".");
  const domains: Array<string | null> = [null];
  for (let i = 0; i < parts.length - 1; i++) domains.push("." + parts.slice(i).join("."));
  for (const name of names) {
    for (const d of domains) {
      doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? `; domain=${d}` : ""}`;
    }
  }
  return names.length;
}

/** Removes Privy's own browser state. Returns how many entries were removed. Never throws. */
export function clearPrivyBrowserState(): number {
  if (typeof window === "undefined") return 0;
  let n = 0;
  try {
    n += clearStorage(window.localStorage);
  } catch {
    /* storage blocked */
  }
  try {
    n += clearStorage(window.sessionStorage);
  } catch {
    /* storage blocked */
  }
  try {
    n += clearPrivyCookies(document, window.location.hostname);
  } catch {
    /* cookies blocked */
  }
  return n;
}

/**
 * Full reset: Privy `logout()` (server-side session + HttpOnly cookies; failures are ignored
 * because there may be no session), then the browser-state sweep, then `reload` so the SDK
 * re-initialises from clean storage. Does not open any wallet prompt.
 */
export async function resetPrivyConnection(
  logout: () => Promise<void> | void,
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  try {
    await logout();
  } catch {
    /* no session to log out of */
  }
  clearPrivyBrowserState();
  reload();
}
