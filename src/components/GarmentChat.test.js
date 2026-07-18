import { describe, expect, it, vi } from "vitest"
import { withIntakeTimeout } from "./GarmentChat.jsx"

describe("withIntakeTimeout", () => {
  it("returns a provider result that arrives before the deadline", async () => {
    await expect(withIntakeTimeout(Promise.resolve("ok"), 10)).resolves.toBe("ok")
  })

  it("rejects stalled provider work with a fallback marker", async () => {
    vi.useFakeTimers()
    try {
      const result = withIntakeTimeout(new Promise(() => {}), 25)
      const rejection = expect(result).rejects.toMatchObject({
        message: "analysis_timeout",
        useLocalFallback: true,
      })
      await vi.advanceTimersByTimeAsync(25)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})
