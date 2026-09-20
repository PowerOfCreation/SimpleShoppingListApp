import React from "react"

// Mirrors a prop/state value into a ref via effect, so a callback that reads
// it stays stable across renders instead of restarting on every change.
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value)
  React.useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
