import { useMemo, useState } from 'react'

const tabs = ['Feed', 'Home', 'Drawings', 'Documents']

const FEEDHANDLER_BASE =
  import.meta.env.VITE_FEEDHANDLER_BASE_URL || '/api'
const DEFAULT_JOBSITE = import.meta.env.VITE_DEFAULT_JOBSITE_ID || 'twujobsite'
const DEFAULT_EMAIL = import.meta.env.VITE_DEFAULT_USER_EMAIL || ''

function createSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `session-${Date.now()}`
}

function getSessionId() {
  const key = 'onsite_web_session_id'
  const cached = localStorage.getItem(key)
  if (cached) return cached
  const next = createSessionId()
  localStorage.setItem(key, next)
  return next
}

function clip(text, max = 220) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Home')
  const [messages, setMessages] = useState([
    { id: 'm1', role: 'assistant', text: 'Hello! Ask me about your project documents.' }
  ])
  const [documents, setDocuments] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const sessionId = useMemo(() => getSessionId(), [])

  async function sendMessage() {
    const query = input.trim()
    if (!query || loading) return

    const userMessage = { id: `u-${Date.now()}`, role: 'user', text: query }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const endpoint = `${FEEDHANDLER_BASE.replace(/\/$/, '')}/chat_with_documents/`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          session_id: sessionId,
          jobsite_id: DEFAULT_JOBSITE,
          user_email: DEFAULT_EMAIL
        })
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`HTTP ${res.status}${errorText ? `: ${errorText}` : ''}`)
      }

      const data = await res.json()
      const responseText = data?.response || data?.message || 'No response returned.'
      const assistantMessage = { id: `a-${Date.now()}`, role: 'assistant', text: responseText }
      setMessages((prev) => [...prev, assistantMessage])
      setDocuments(Array.isArray(data?.documents) ? data.documents : [])
    } catch (err) {
      const fallback = 'Request failed. Check network/API URL and try again.'
      const detail = err instanceof Error && err.message ? err.message : ''
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: detail ? `${fallback}\n${detail}` : fallback
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <button className="icon-btn" aria-label="Menu">☰</button>
        <nav className="tab-pill" aria-label="Main">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
        <div className="avatar">VR</div>
      </header>

      <main className="content">
        <section className="chat-panel">
          <div className="messages">
            {messages.map((m) => (
              <div key={m.id} className={`bubble-row ${m.role === 'user' ? 'user' : 'assistant'}`}>
                <div className={`bubble ${m.role}`}>{m.text}</div>
              </div>
            ))}
          </div>

          {documents.length > 0 && (
            <section className="docs-panel">
              <h3>Related Documents</h3>
              {documents.slice(0, 5).map((doc, i) => {
                const title = doc.title || doc.filename || `Document ${i + 1}`
                const url = doc.file_url || doc.fileUrl || ''
                return (
                  <article key={`${doc.document_id || doc.id || i}-${i}`} className="doc-card">
                    <p className="doc-title">{title}</p>
                    <p className="doc-snippet">{clip(doc.text || '')}</p>
                    {url ? (
                      <a className="doc-link" href={url} target="_blank" rel="noreferrer">
                        View source
                      </a>
                    ) : (
                      <p className="doc-link muted">No source URL</p>
                    )}
                  </article>
                )
              })}
            </section>
          )}
        </section>
      </main>

      <footer className="composer">
        <div className="input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message..."
            rows={2}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()}>
            {loading ? '...' : 'Send'}
          </button>
        </div>
      </footer>
    </div>
  )
}
