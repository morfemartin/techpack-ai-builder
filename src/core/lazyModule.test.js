import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { loadLazyModule } from "./lazyModule.js"

// No jsdom in this project's vitest setup (default "node" environment, no
// `window` global) - loadLazyModule's browser behavior is stubbed manually
// rather than pulling in a DOM environment just for this one module.
function fakeSessionStorage() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    clear: () => store.clear(),
  }
}

describe("loadLazyModule", () => {
  const RELOAD_FLAG = "techpack.lazyModule.reloadedForStaleChunk"
  let reload
  let sessionStorage

  beforeEach(() => {
    reload = vi.fn()
    sessionStorage = fakeSessionStorage()
    vi.stubGlobal("window", { sessionStorage, location: { reload } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the module unchanged when the import succeeds", async () => {
    const mod = { default: "ok" }
    await expect(loadLazyModule(() => Promise.resolve(mod))).resolves.toBe(mod)
  })

  it("rethrows a non-stale-chunk failure untouched", async () => {
    const original = new Error("network offline")
    await expect(loadLazyModule(() => Promise.reject(original))).rejects.toBe(original)
  })

  // The core bug this fixes: a tab open since before the last deploy holds
  // OLD chunk hashes, and clicking something that dynamically imports a
  // chunk that deploy already replaced (e.g. jszip for the ZIP export)
  // 404s with this exact browser-generated message.
  it("on a stale-chunk failure, reloads the page once instead of surfacing the raw error", async () => {
    const staleError = new Error("Failed to fetch dynamically imported module: https://x/assets/jszip.min-XXXX.js")

    const promise = loadLazyModule(() => Promise.reject(staleError))
    // The reload path never resolves (a real reload would tear the page
    // down) - just assert the side effects happened, don't await it.
    await Promise.race([promise, new Promise((resolve) => setTimeout(resolve, 10))])

    expect(reload).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe("1")
  })

  it("on a SECOND stale-chunk failure this session, surfaces a clear message instead of reloading again", async () => {
    sessionStorage.setItem(RELOAD_FLAG, "1")
    const staleError = new Error("error loading dynamically imported module: https://x/assets/hybridAI-XXXX.js")

    await expect(loadLazyModule(() => Promise.reject(staleError), { moduleName: "el motor de IA" })).rejects.toThrow(
      "La app se actualizo. Recarga la pagina (Cmd/Ctrl+R) para seguir usando el motor de IA."
    )
    expect(reload).not.toHaveBeenCalled()
  })

  it("tags the friendly error so callers can distinguish it from a real failure", async () => {
    sessionStorage.setItem(RELOAD_FLAG, "1")
    const staleError = new Error("Failed to fetch dynamically imported module: x")
    try {
      await loadLazyModule(() => Promise.reject(staleError))
      throw new Error("should have thrown")
    } catch (error) {
      expect(error.staleChunk).toBe(true)
      expect(error.cause).toBe(staleError)
    }
  })
})
