/**
 * Regression (GH#2862 sibling, Squid 2026-10-02): signed-out header loops on Connect. Privy's modal
 * says "Successfully connected with Solflare — Wallet was already linked", closes, and the header is
 * still "Connect". The header must (a) offer an in-app "Reset wallet connection" once it sees the
 * loop, (b) never offer it on a healthy signed-out load or a signed-in session, and (c) the reset
 * must log out, clear only Privy's browser state, and not prompt a wallet.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUsePrivy, mockUseWallets, mockLogout, mockSetPreferred, mockLogin, loginOpts, mockReset } =
  vi.hoisted(() => ({
    mockUsePrivy: vi.fn(),
    mockUseWallets: vi.fn(),
    mockLogout: vi.fn(async () => {}),
    mockSetPreferred: vi.fn(),
    mockLogin: vi.fn(),
    loginOpts: { current: null as null | { onComplete?: (a: unknown) => void } },
    mockReset: vi.fn(),
  }));

vi.mock("@/lib/config", () => ({ getConfig: () => ({ network: "devnet" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/usePreferredWallet", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePreferredWallet")>()),
  usePreferredWallet: () => ({ preferredAddress: null, setPreferredAddress: mockSetPreferred }),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => mockUsePrivy(),
  useLogin: (o: { onComplete?: (a: unknown) => void }) => {
    loginOpts.current = o;
    return { login: mockLogin };
  },
}));
vi.mock("@privy-io/react-auth/solana", () => ({
  useWallets: () => mockUseWallets(),
  useFundWallet: () => ({ fundWallet: vi.fn() }),
}));
vi.mock("@/lib/privy-reset", () => ({ resetPrivyConnection: (...a: unknown[]) => mockReset(...a) }));

import { ConnectButtonPrivyInner } from "@/components/wallet/ConnectButtonPrivyInner";
import { LOOP_ATTEMPTS, SESSION_SETTLE_MS } from "@/hooks/useSignInLoopRecovery";

const SIGNED_OUT = { ready: true, authenticated: false, logout: mockLogout, exportWallet: vi.fn(), user: null };
const completeLogin = () =>
  act(() => {
    loginOpts.current?.onComplete?.({ loginAccount: { type: "wallet", chainType: "solana", address: "SOLFLARE" } });
  });
const resetBtn = () => screen.queryByTestId("wallet-reset");

describe("signed-out Connect loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUsePrivy.mockReturnValue(SIGNED_OUT);
    mockUseWallets.mockReturnValue({ ready: true, wallets: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("login completes but the session never appears: offers Reset after the settle window", () => {
    render(<ConnectButtonPrivyInner />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    completeLogin();
    act(() => void vi.advanceTimersByTime(SESSION_SETTLE_MS - 1));
    expect(resetBtn()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(resetBtn()).not.toBeNull();
  });

  it("CONTROL: login completes and the session DOES appear: no Reset", () => {
    const { rerender } = render(<ConnectButtonPrivyInner />);
    completeLogin();
    mockUsePrivy.mockReturnValue({
      ...SIGNED_OUT,
      authenticated: true,
      user: { wallet: { address: "SOLFLARE" }, linkedAccounts: [] },
    });
    rerender(<ConnectButtonPrivyInner />);
    act(() => void vi.advanceTimersByTime(SESSION_SETTLE_MS * 3));
    expect(resetBtn()).toBeNull();
  });

  it("repeated Connect clicks with no session also offer Reset (drop never surfaced onComplete)", () => {
    render(<ConnectButtonPrivyInner />);
    for (let i = 0; i < LOOP_ATTEMPTS - 1; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    }
    expect(resetBtn()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(resetBtn()).not.toBeNull();
  });

  it("CONTROL: a healthy signed-out page never shows Reset", () => {
    render(<ConnectButtonPrivyInner />);
    act(() => void vi.advanceTimersByTime(SESSION_SETTLE_MS * 5));
    expect(resetBtn()).toBeNull();
  });

  it("CONTROL: a signed-in session never shows Reset", () => {
    mockUsePrivy.mockReturnValue({
      ...SIGNED_OUT,
      authenticated: true,
      user: { wallet: { address: "A" }, linkedAccounts: [] },
    });
    mockUseWallets.mockReturnValue({ ready: true, wallets: [{ address: "A" }] });
    render(<ConnectButtonPrivyInner />);
    completeLogin();
    act(() => void vi.advanceTimersByTime(SESSION_SETTLE_MS * 2));
    expect(resetBtn()).toBeNull();
  });

  it("CONTROL: Connect still opens Privy login exactly once per click (no extra auto-prompt)", () => {
    render(<ConnectButtonPrivyInner />);
    completeLogin();
    act(() => void vi.advanceTimersByTime(SESSION_SETTLE_MS * 2));
    expect(mockLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it("clicking Reset clears the preferred wallet and runs the reset with Privy logout; no login prompt", () => {
    render(<ConnectButtonPrivyInner />);
    completeLogin();
    act(() => void vi.advanceTimersByTime(SESSION_SETTLE_MS));
    fireEvent.click(screen.getByTestId("wallet-reset"));
    expect(mockSetPreferred).toHaveBeenCalledWith(null);
    expect(mockReset).toHaveBeenCalledWith(mockLogout);
    expect(mockLogin).not.toHaveBeenCalled();
  });
});
