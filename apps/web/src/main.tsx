import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Tenders from './pages/Tenders'
import TenderWorkspace from './pages/TenderWorkspace'
import Knowledge from './pages/Knowledge'
import { Proposals, Quality, Settings } from './pages/Other'
import DeckView from './pages/DeckView'
import Templates from './pages/Templates'
import Pricing from './pages/Pricing'
import { lang, LANG_CHANGED } from './lib/i18n'

/** The app, drawn again from scratch in the new language when the language changes (the address is kept). */
function App() {
  const [current, setCurrent] = useState(lang)
  useEffect(() => {
    const changed = () => setCurrent(lang())
    window.addEventListener(LANG_CHANGED, changed)
    return () => window.removeEventListener(LANG_CHANGED, changed)
  }, [])
  return (
    <HashRouter key={current}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tenders" element={<Tenders />} />
          <Route path="tenders/:id" element={<TenderWorkspace />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="proposals" element={<Proposals />} />
          <Route path="templates" element={<Templates />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="decks/:deckId" element={<DeckView />} />
          <Route path="quality" element={<Quality />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
