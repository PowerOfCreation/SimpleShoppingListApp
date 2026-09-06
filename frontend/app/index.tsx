import { useEffect, useState } from "react"
import { Redirect } from "expo-router"

import { loadPendingInvite } from "@/api/auth/token-store"

export default function Index() {
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    loadPendingInvite().then((token) => {
      if (cancelled) return
      setTarget(token ? `/invite?token=${token}` : "/(home)")
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!target) return null
  return <Redirect href={target} />
}
