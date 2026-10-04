import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionResponse } from "./api/types";

interface SessionContextValue {
  session: SessionResponse;
  /** Replace the session after a rotation (enrollment, recovery, key removal). */
  updateSession: (session: SessionResponse) => void;
  signOut: () => Promise<void>;
  /** Incremented after any banking change so balances and lists refetch. */
  bankVersion: number;
  bankChanged: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  session,
  updateSession,
  signOut,
  children,
}: {
  session: SessionResponse;
  updateSession: (session: SessionResponse) => void;
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const [bankVersion, setBankVersion] = useState(0);
  const bankChanged = useCallback(() => setBankVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ session, updateSession, signOut, bankVersion, bankChanged }),
    [session, updateSession, signOut, bankVersion, bankChanged],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

/** Recovery hold restricts sensitive writes; reads and confirmed lookups stay available. */
export function holdActive(session: SessionResponse, now = Date.now()) {
  return session.security.holdUntil > now;
}
