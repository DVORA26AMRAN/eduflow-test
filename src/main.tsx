import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SchoolRegistrationPage } from './pages/SchoolRegistrationPage'
import { registerMpexServiceWorker } from './pwa/registerServiceWorker'
import { isSchoolRegistrationPath } from './utils/schoolRegistrationForm'

registerMpexServiceWorker()

const rootEl = document.getElementById('root')!

createRoot(rootEl).render(
  <StrictMode>
    {isSchoolRegistrationPath(window.location.pathname) ? (
      <SchoolRegistrationPage />
    ) : (
      <App />
    )}
  </StrictMode>,
)
