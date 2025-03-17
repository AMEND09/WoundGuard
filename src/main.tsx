import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import WoundTrackingApp from './artifacts/default'
import './index.css'

// Get the correct base name from either Vite environment or fallback to WoundGuard
const baseName = import.meta.env.BASE_URL || '/WoundGuard/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.DEV ? '/' : baseName}>
      <Routes>
        <Route path="/" element={<WoundTrackingApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)