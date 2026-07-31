import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import * as WebBrowser from "expo-web-browser"

import { createLogger } from "@/api/common/logger"
import {
  AuthCancelledError,
  AuthUser,
  login as loginService,
  logout as logoutService,
  restoreSession,
} from "./auth-service"

// Required so the auth flow resolves when the browser hands control back.
WebBrowser.maybeCompleteAuthSession()

const logger = createLogger("AuthProvider")

export type AuthStatus = "loading" | "signedOut" | "signedIn"

type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  error: string | null
  busy: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [user, setUser] = useState<AuthUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const result = await restoreSession()

      if (cancelled) return

      if (!result.success) {
        // A failed restore must not lock the user out of the offline app.
        logger.warn("Could not restore session", result.getError())
        setStatus("signedOut")
        return
      }

      const session = result.getValue()
      setUser(session?.user ?? null)
      setStatus(session ? "signedIn" : "signedOut")
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async () => {
    setBusy(true)
    setError(null)

    const result = await loginService()

    if (result.success) {
      setUser(result.getValue()?.user ?? null)
      setStatus("signedIn")
    } else {
      const loginError = result.getError()
      // Closing the browser is a normal user action, not something to report.
      if (!(loginError instanceof AuthCancelledError)) {
        logger.error("Login failed", loginError)
        setError(loginError.message)
      }
    }

    setBusy(false)
  }, [])

  const logout = useCallback(async () => {
    setBusy(true)
    setError(null)

    const result = await logoutService()

    if (!result.success) {
      logger.error("Logout failed", result.getError())
      setError(result.getError().message)
    }

    // The local tokens are cleared even when ending the SSO session failed,
    // so the app is signed out either way.
    setUser(null)
    setStatus("signedOut")
    setBusy(false)
  }, [])

  const value = useMemo(
    () => ({ status, user, error, busy, login, logout }),
    [status, user, error, busy, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
