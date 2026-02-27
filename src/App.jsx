import { useMemo, useRef, useState } from 'react'

const tabs = ['Feed', 'Home', 'Drawings', 'Documents']

const FEEDHANDLER_BASE = (() => {
  const configured = (import.meta.env.VITE_FEEDHANDLER_BASE_URL || '').trim()
  if (configured) return configured

  // Local dev uses Vite proxy; production should default to Railway API.
  return import.meta.env.DEV
    ? '/api'
    : 'https://onsitexfeedhandler-production.up.railway.app'
})()
const DEFAULT_JOBSITE = import.meta.env.VITE_DEFAULT_JOBSITE_ID || 'twujobsite'
const DEFAULT_EMAIL = import.meta.env.VITE_DEFAULT_USER_EMAIL || ''
const MAX_STATUS_POLLS = 30
const STATUS_POLL_INTERVAL_MS = 3000

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function deriveTitleFromFilename(filename) {
  if (!filename) return 'Uploaded Document'
  return filename.replace(/\.pdf$/i, '').trim() || filename
}

function buildPreviewUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/\.pdf(?:$|[?#])/i.test(value) && !value.includes('#')) {
    return `${value}#view=FitH&navpanes=0`
  }
  return value
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Home')
  const [messages, setMessages] = useState([
    { id: 'm1', role: 'assistant', text: 'Hello! Ask me about your project documents.' }
  ])
  const [documents, setDocuments] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lastUploadedName, setLastUploadedName] = useState('')
  const [sourcePreview, setSourcePreview] = useState(null)
  const fileInputRef = useRef(null)

  const sessionId = useMemo(() => getSessionId(), [])

  function addAssistantMessage(text) {
    setMessages((prev) => [...prev, { id: `a-${Date.now()}-${prev.length}`, role: 'assistant', text }])
  }

  async function pollDocumentStatus(documentId) {
    const endpoint = `${FEEDHANDLER_BASE.replace(/\/$/, '')}/document_status/${encodeURIComponent(documentId)}/`

    for (let i = 0; i < MAX_STATUS_POLLS; i += 1) {
      try {
        const res = await fetch(endpoint, { method: 'GET' })
        if (res.ok) {
          const data = await res.json()
          const processed = Boolean(
            data?.document?.processed ?? data?.processing_status?.processed ?? false
          )
          if (processed) return true
        }
      } catch {
        // Continue polling on transient errors.
      }
      await wait(STATUS_POLL_INTERVAL_MS)
    }

    return false
  }

  async function uploadDocument(file) {
    if (!file || uploading) return
    setUploading(true)
    setLastUploadedName(file.name)

    try {
      const endpoint = `${FEEDHANDLER_BASE.replace(/\/$/, '')}/upload_document/`
      const form = new FormData()
      form.append('file', file)
      form.append('title', deriveTitleFromFilename(file.name))
      form.append('userEmail', DEFAULT_EMAIL)
      form.append('jobsiteId', DEFAULT_JOBSITE)

      const res = await fetch(endpoint, {
        method: 'POST',
        body: form
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`HTTP ${res.status}${errorText ? `: ${errorText}` : ''}`)
      }

      const data = await res.json()
      const documentId = data?.document_id || data?.documentId
      if (!documentId) {
        throw new Error('Upload returned no document_id')
      }

      addAssistantMessage(`Upload received: ${file.name}\nIndexing started. I will notify you when it is ready.`)
      const processed = await pollDocumentStatus(documentId)
      if (processed) {
        addAssistantMessage(`Document ready: ${file.name}\nYou can now ask questions about it.`)
      } else {
        addAssistantMessage(
          `Upload started for ${file.name}, but indexing is still running.\nYou can ask now, but results may improve in a minute.`
        )
      }
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : 'Unknown upload error'
      addAssistantMessage(`Upload failed for ${file.name}\n${detail}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function onUploadClick() {
    if (uploading) return
    fileInputRef.current?.click()
  }

  function onFileSelected(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      addAssistantMessage('Please upload a PDF file.')
      event.target.value = ''
      return
    }
    uploadDocument(file)
  }

  async function sendMessage() {
    const query = input.trim()
    if (!query || loading) return

    const userMessage = { id: `u-${Date.now()}`, role: 'user', text: query }
    const pendingId = `p-${Date.now()}`
    const pendingMessage = { id: pendingId, role: 'assistant', text: 'OnSite is thinking', pending: true }

    setMessages((prev) => [...prev, userMessage, pendingMessage])
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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { id: `a-${Date.now()}`, role: 'assistant', text: responseText }
            : m
        )
      )
      setDocuments(Array.isArray(data?.documents) ? data.documents : [])
    } catch (err) {
      const fallback = 'Request failed. Check network/API URL and try again.'
      const detail = err instanceof Error && err.message ? err.message : ''
      const errorText = detail ? `${fallback}\n${detail}` : fallback
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { id: `e-${Date.now()}`, role: 'assistant', text: errorText }
            : m
        )
      )
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

  function openSourcePreview(url, title) {
    if (!url) return
    setSourcePreview({
      previewUrl: buildPreviewUrl(url),
      rawUrl: url,
      title: title || 'Source Document'
    })
  }

  function closeSourcePreview() {
    setSourcePreview(null)
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
                <div className={`bubble ${m.role} ${m.pending ? 'pending' : ''}`}>
                  {m.pending ? (
                    <div className="thinking-wrap">
                      <span className="thinking-text">{m.text}</span>
                      <span className="thinking-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  ) : (
                    m.text
                  )}
                </div>
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
                      <button
                        type="button"
                        className="doc-link as-button"
                        onClick={() => openSourcePreview(url, title)}
                      >
                        View source
                      </button>
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

      {sourcePreview && (
        <section className="source-modal-backdrop" onClick={closeSourcePreview}>
          <article
            className="source-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Source document preview"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="source-modal-header">
              <p className="source-modal-title">{sourcePreview.title}</p>
              <div className="source-modal-actions">
                <a className="doc-link" href={sourcePreview.rawUrl} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
              </div>
            </header>
            <iframe
              className="source-frame"
              title={sourcePreview.title}
              src={sourcePreview.previewUrl}
            />
            <button
              type="button"
              className="source-close-fab"
              aria-label="Close source preview"
              onClick={closeSourcePreview}
            >
              Close
            </button>
          </article>
        </section>
      )}

      <footer className="composer">
        <div className="upload-row">
          <button className="upload-btn" onClick={onUploadClick} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload PDF'}
          </button>
          <span className="upload-meta">
            {uploading ? `Uploading ${lastUploadedName}` : lastUploadedName ? `Last: ${lastUploadedName}` : ''}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={onFileSelected}
            style={{ display: 'none' }}
          />
        </div>
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
