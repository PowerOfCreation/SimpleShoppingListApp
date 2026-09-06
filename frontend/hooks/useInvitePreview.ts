import React from "react"

import { createLogger } from "@/api/common/logger"
import { InvitePreview, sharingClient } from "@/api/sharing/sharing-client"
import { describeSharingError } from "@/hooks/useListInvites"

const logger = createLogger("useInvitePreview")

export type InvitePreviewStatus = "idle" | "loading" | "loaded" | "error"

/**
 * Loads what an invite points at (list name, member count, inviter) without
 * joining it - a plain read, unlike useRedeemInvite's multi-step join.
 */
export function useInvitePreview() {
  const [status, setStatus] = React.useState<InvitePreviewStatus>("idle")
  const [data, setData] = React.useState<InvitePreview | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const preview = React.useCallback(async (token: string) => {
    setStatus("loading")
    setErrorMessage(null)

    const result = await sharingClient.previewInvite(token)
    if (!result.success) {
      const sharingError = result.getError()
      logger.warn("Could not preview invite", sharingError)
      setErrorMessage(describeSharingError(sharingError))
      setStatus("error")
      return
    }

    setData(result.getValue()!)
    setStatus("loaded")
  }, [])

  return { status, data, errorMessage, preview }
}
