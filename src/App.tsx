import React, { useEffect } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Home from './routes/Home'
import Canvas from './routes/Canvas'
import Assistant from './routes/Assistant'
import Editor from './routes/Editor'
import ShortDramaStudioPage from './routes/ShortDramaStudioPage'
import EcomStudioPage from './routes/EcomStudioPage'
import UpdateChecker from './components/UpdateChecker'
import { useAssetsStore } from '@/store/assets'

const base = import.meta.env.BASE_URL || '/'
const isDesktop = base.startsWith('./')
const basename = isDesktop ? undefined : base.replace(/\/$/, '')

export default function App() {
  const Router = isDesktop ? HashRouter : BrowserRouter

  // Load persisted history assets once on app startup
  useEffect(() => {
    void useAssetsStore.getState().loadAssets()
  }, [])

  return (
    <Router basename={basename}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/canvas/:id?" element={<Canvas />} />
        <Route path="/short-drama/:projectId" element={<ShortDramaStudioPage />} />
        <Route path="/ecommerce/:projectId" element={<EcomStudioPage />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/edit/:projectId" element={<Editor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdateChecker />
    </Router>
  )
}
