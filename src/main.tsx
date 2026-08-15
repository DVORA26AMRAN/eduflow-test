import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SchoolRegistrationPage } from './pages/SchoolRegistrationPage'
import { isSchoolRegistrationPath } from './utils/schoolRegistrationForm'

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
