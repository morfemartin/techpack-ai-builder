import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './design/base.css'
import { applyCssVars } from './design/tokens.js'

// Inject the design tokens as CSS custom properties from the single source of
// truth (src/design/tokens.js) so both CSS and inline styles read the same values.
applyCssVars()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
