import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.jsx"
import "./design/base.css"
import { applyCssVars } from "./design/tokens.js"

// `studio.html` is the private test entry point. getTextAIProvider() detects
// this route and enables the loopback Qwen bridge without changing the public
// wizard's provider or requiring a query parameter.
applyCssVars()
document.documentElement.dataset.techpackMode = "studio"

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
