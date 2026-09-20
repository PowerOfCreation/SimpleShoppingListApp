import React from "react"
import { Animated } from "react-native"
import { act, render } from "@testing-library/react-native"
import { SystemMessage } from "../SystemMessage"

// Wraps SystemMessage the way real callers do: onHide is a fresh inline
// closure every render. Re-rendering the wrapper forces the same unrelated
// re-render any other state change in the parent screen would.
function Wrapper({ onHide }: { onHide: () => void }) {
  return <SystemMessage message="Sorted" onHide={onHide} duration={1000} />
}

describe("SystemMessage", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    // Isolate the effect's setTimeout scheduling from real Animated timing,
    // which needs its own (unrelated) frame-by-frame ticking under fake
    // timers - start() resolves its callback synchronously instead.
    jest.spyOn(Animated, "timing").mockReturnValue({
      start: (cb?: (result: { finished: boolean }) => void) =>
        cb?.({ finished: true }),
    } as unknown as ReturnType<typeof Animated.timing>)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it("hides on its original schedule even when the parent re-renders with a new onHide", () => {
    // Regression test: onHide used to be an effect dependency, so any
    // unrelated parent re-render (fresh inline closure) reset the hide
    // timer - the toast visibly flickered and stayed up far longer than
    // `duration`.
    const onHide = jest.fn()
    const { rerender } = render(<Wrapper onHide={onHide} />)

    act(() => {
      jest.advanceTimersByTime(500)
    })
    // Unrelated re-render halfway through, with a brand-new onHide identity.
    rerender(<Wrapper onHide={() => onHide()} />)

    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it("does not restart the timer on every render when nothing changed", () => {
    const onHide = jest.fn()
    const { rerender } = render(<Wrapper onHide={onHide} />)

    for (let i = 0; i < 5; i++) {
      act(() => {
        jest.advanceTimersByTime(100)
      })
      rerender(<Wrapper onHide={() => onHide()} />)
    }

    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(onHide).toHaveBeenCalledTimes(1)
  })
})
