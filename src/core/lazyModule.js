// Vite gives every async chunk a content hash in its filename - a deploy
// (npm run deploy -> gh-pages) replaces old hashes wholesale and deletes the
// old files. A browser tab that has been open since before that deploy still
// holds the OLD hashes baked into its already-loaded bundle, and 404s the
// moment it tries to dynamically import one - e.g. clicking "Exportar ZIP"
// (illustratorPackage.js) or triggering any hybrid-AI call (deepseekClient.js)
// days after the last deploy. The browser's own error ("Failed to fetch
// dynamically imported module: .../jszip.min-XXXX.js") gives the user
// nothing actionable. Verified: no service worker, no chunk preloading, no
// retry anywhere in this app - a stale tab has no way to recover on its own.
// This wraps a dynamic import() so that ONE specific failure becomes a
// silent auto-reload (the common case: a tab left open across a deploy) or,
// if that already happened once this session, a clear instruction instead
// of a stack trace.

const RELOAD_FLAG = "techpack.lazyModule.reloadedForStaleChunk"

function isStaleChunkError(error) {
  const message = String((error && error.message) || "")
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(message)
}

// `importer` is a thunk returning the import() call, since import() itself
// cannot be passed as a value and stay statically analyzable by the bundler
// at its actual call site - callers write `() => import("jszip")`.
export async function loadLazyModule(importer, { moduleName = "este modulo" } = {}) {
  try {
    return await importer()
  } catch (error) {
    if (!isStaleChunkError(error)) throw error
    // One automatic recovery attempt per session: a hard reload fetches the
    // CURRENT index.html, which references the CURRENT chunk hashes - this
    // silently fixes the common case without the user ever seeing an error.
    if (typeof window !== "undefined" && typeof window.sessionStorage !== "undefined" && !window.sessionStorage.getItem(RELOAD_FLAG)) {
      window.sessionStorage.setItem(RELOAD_FLAG, "1")
      window.location.reload()
      return new Promise(() => {}) // the reload is already underway - never resolves
    }
    const friendly = new Error("La app se actualizo. Recarga la pagina (Cmd/Ctrl+R) para seguir usando " + moduleName + ".")
    friendly.staleChunk = true
    friendly.cause = error
    throw friendly
  }
}
