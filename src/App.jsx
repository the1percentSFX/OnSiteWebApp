import { useEffect, useMemo, useRef, useState } from 'react'

const tabs = ['Feed', 'Home', 'Drawings', 'Documents']

const FEEDHANDLER_BASE = (() => {
  const configured = (import.meta.env.VITE_FEEDHANDLER_BASE_URL || '').trim()
  if (configured) return configured

  // Local dev uses Vite proxy; production should default to Railway API.
  return import.meta.env.DEV
    ? '/api'
    : 'https://onsitexfeedhandler-production.up.railway.app'
})()

const FIREBASE_API_KEY = (import.meta.env.VITE_FIREBASE_API_KEY || '').trim()

const DEFAULT_JOBSITE = import.meta.env.VITE_DEFAULT_JOBSITE_ID || 'twujobsite'
const DEFAULT_EMAIL = import.meta.env.VITE_DEFAULT_USER_EMAIL || ''
const MAX_STATUS_POLLS = 30
const STATUS_POLL_INTERVAL_MS = 3000
const CHAT_STATE_KEY = 'onsite_web_chat_state_v1'
const AUTH_STATE_KEY = 'onsite_web_auth_state_v1'

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

function formatTimelineTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function timelineSourceUrl(event) {
  if (!event || typeof event !== 'object') return ''
  const direct = String(event.source_url || event.sourceUrl || '').trim()
  if (direct) return direct
  const docs = Array.isArray(event.documents) ? event.documents : []
  for (const doc of docs) {
    const url = String(doc?.file_url || doc?.fileUrl || '').trim()
    if (url) return url
  }
  return ''
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

function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 680px)').matches
}

function stripSourcesFromReply(text) {
  const value = String(text || '')
  return value.replace(/(?:\n|^)\s*Sources:\s*[\s\S]*$/i, '').trim()
}

function loadChatState() {
  try {
    const raw = localStorage.getItem(CHAT_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((m) => m && (m.role === 'assistant' || m.role === 'user') && typeof m.text === 'string')
          .map((m) => ({ id: m.id || `m-${Date.now()}`, role: m.role, text: m.text }))
      : []

    const documents = []
    const input = typeof parsed.input === 'string' ? parsed.input : ''
    const lastUploadedName = typeof parsed.lastUploadedName === 'string' ? parsed.lastUploadedName : ''

    return {
      messages,
      documents,
      input,
      lastUploadedName,
    }
  } catch {
    return null
  }
}

function persistChatState(state) {
  try {
    localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage failures.
  }
}

function loadAuthState() {
  try {
    const raw = localStorage.getItem(AUTH_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const email = String(parsed.email || '').trim().toLowerCase()
    const idToken = String(parsed.idToken || '').trim()
    const uid = String(parsed.uid || '').trim()
    if (!email || !idToken) return null
    return {
      email,
      idToken,
      refreshToken: String(parsed.refreshToken || ''),
      uid,
    }
  } catch {
    return null
  }
}

function persistAuthState(state) {
  try {
    if (!state) {
      localStorage.removeItem(AUTH_STATE_KEY)
      return
    }
    localStorage.setItem(AUTH_STATE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage failures.
  }
}

function mapFirebaseError(code) {
  switch (code) {
    case 'INVALID_LOGIN_CREDENTIALS':
    case 'INVALID_PASSWORD':
      return 'Invalid email or password.'
    case 'EMAIL_NOT_FOUND':
      return 'No account found for that email.'
    case 'USER_DISABLED':
      return 'This account is disabled.'
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
      return 'Too many attempts. Try again later.'
    default:
      return 'Login failed. Please try again.'
  }
}

async function signInWithFirebaseEmail(email, password) {
  if (!FIREBASE_API_KEY) {
    throw new Error('Firebase API key is not configured.')
  }

  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    const code = String(data?.error?.message || '')
    throw new Error(mapFirebaseError(code))
  }

  return {
    email: String(data?.email || email).toLowerCase(),
    idToken: String(data?.idToken || ''),
    refreshToken: String(data?.refreshToken || ''),
    uid: String(data?.localId || ''),
  }
}

export default function App() {
  const initialState = useMemo(() => loadChatState(), [])

  const [activeTab, setActiveTab] = useState('Home')
  const [messages, setMessages] = useState(
    initialState?.messages?.length
      ? initialState.messages
      : [{ id: 'm1', role: 'assistant', text: 'Hello! Ask me about your project documents.' }]
  )
  const [documents, setDocuments] = useState(initialState?.documents || [])
  const [input, setInput] = useState(initialState?.input || '')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lastUploadedName, setLastUploadedName] = useState(initialState?.lastUploadedName || '')
  const [sourcePreview, setSourcePreview] = useState(null)
  const [timelineEvents, setTimelineEvents] = useState([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState('')

  const [auth, setAuth] = useState(() => loadAuthState())
  const [loginEmail, setLoginEmail] = useState(() => loadAuthState()?.email || DEFAULT_EMAIL || '')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const fileInputRef = useRef(null)

  const sessionId = useMemo(() => getSessionId(), [])

  const currentUserEmail = (auth?.email || DEFAULT_EMAIL || '').toLowerCase()
  const authHeaders = auth?.idToken
    ? {
        Authorization: `Bearer ${auth.idToken}`,
        'X-Firebase-ID-Token': auth.idToken,
      }
    : {}

  useEffect(() => {
    persistChatState({
      messages: messages.slice(-60).map((m) => ({ id: m.id, role: m.role, text: m.text })),
      documents: [],
      input,
      lastUploadedName,
      savedAt: Date.now(),
    })
  }, [messages, documents, input, lastUploadedName])

  useEffect(() => {
    persistAuthState(auth)
  }, [auth])

  async function fetchOfficeTimeline({ quiet = false } = {}) {
    if (!currentUserEmail) {
      setTimelineEvents([])
      setTimelineError('')
      return
    }
    if (!quiet) setTimelineLoading(true)
    setTimelineError('')
    try {
      const endpoint = `${FEEDHANDLER_BASE.replace(/\/$/, '')}/office_timeline/?jobsite_id=${encodeURIComponent(DEFAULT_JOBSITE)}&user_email=${encodeURIComponent(currentUserEmail)}&limit=20`
      const res = await fetch(endpoint, { method: 'GET', headers: authHeaders })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`)
      }
      const data = await res.json()
      const next = Array.isArray(data?.events) ? data.events : []
      setTimelineEvents(next)
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Timeline request failed.'
      setTimelineError(detail)
    } finally {
      if (!quiet) setTimelineLoading(false)
    }
  }

  useEffect(() => {
    fetchOfficeTimeline()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail, auth?.idToken])

  function addAssistantMessage(text) {
    setMessages((prev) => [...prev, { id: `a-${Date.now()}-${prev.length}`, role: 'assistant', text }])
  }

  async function handleLogin(e) {
    e.preventDefault()

    const email = loginEmail.trim().toLowerCase()
    const password = loginPassword
    if (!email || !password) {
      setLoginError('Enter email and password.')
      return
    }

    setLoggingIn(true)
    setLoginError('')
    try {
      const nextAuth = await signInWithFirebaseEmail(email, password)
      setAuth(nextAuth)
      setLoginPassword('')
      addAssistantMessage(`Signed in as ${nextAuth.email}.`) 
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Login failed.'
      setLoginError(detail)
    } finally {
      setLoggingIn(false)
    }
  }

  function handleLogout() {
    setAuth(null)
    setLoginPassword('')
    setLoginError('')
    setSourcePreview(null)
    setDocuments([])
    addAssistantMessage('Signed out.')
  }

  async function pollDocumentStatus(documentId) {
    const endpoint = `${FEEDHANDLER_BASE.replace(/\/$/, '')}/document_status/${encodeURIComponent(documentId)}/`

    for (let i = 0; i < MAX_STATUS_POLLS; i += 1) {
      try {
        const res = await fetch(endpoint, { method: 'GET', headers: authHeaders })
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

    if (!currentUserEmail) {
      addAssistantMessage('Please sign in before uploading documents.')
      return
    }

    setUploading(true)
    setLastUploadedName(file.name)

    try {
      const endpoint = `${FEEDHANDLER_BASE.replace(/\/$/, '')}/upload_document/`
      const form = new FormData()
      form.append('file', file)
      form.append('title', deriveTitleFromFilename(file.name))
      form.append('userEmail', currentUserEmail)
      form.append('jobsiteId', DEFAULT_JOBSITE)

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders,
        body: form,
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
      fetchOfficeTimeline({ quiet: true })
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

    if (!currentUserEmail) {
      addAssistantMessage('Please sign in to use chat.')
      return
    }

    const userMessage = { id: `u-${Date.now()}`, role: 'user', text: query }
    const pendingId = `p-${Date.now()}`
    const pendingMessage = { id: pendingId, role: 'assistant', text: 'OnSite is thinking', pending: true }

    setMessages((prev) => [...prev, userMessage, pendingMessage])
    setDocuments([])
    setInput('')
    setLoading(true)

    try {
      const endpoint = `${FEEDHANDLER_BASE.replace(/\/$/, '')}/chat_with_documents/`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          query,
          session_id: sessionId,
          jobsite_id: DEFAULT_JOBSITE,
          user_email: currentUserEmail,
        })
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`HTTP ${res.status}${errorText ? `: ${errorText}` : ''}`)
      }

      const data = await res.json()
      const nextDocuments = Array.isArray(data?.documents) ? data.documents : []
      const responseText = stripSourcesFromReply(
        data?.response || data?.message || 'No response returned.'
      )

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { id: `a-${Date.now()}`, role: 'assistant', text: responseText || 'No response returned.' }
            : m
        )
      )
      setDocuments(nextDocuments)
      fetchOfficeTimeline({ quiet: true })
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
      title: title || 'Source Document',
      mobile: isMobileViewport(),
    })
  }

  function closeSourcePreview() {
    setSourcePreview(null)
  }

  if (!auth?.email) {
    return (
      <div className="login-shell">
        <section className="login-card">
          <h1>OnSite Login</h1>
          <p>Sign in with the same account you use in the iOS app.</p>
          <form className="login-form" onSubmit={handleLogin}>
            <label>
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {loginError ? <p className="login-error">{loginError}</p> : null}
            <button type="submit" disabled={loggingIn}>
              {loggingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </section>
      </div>
    )
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
        <button className="avatar avatar-button" title="Sign out" onClick={handleLogout}>
          {(auth.email || 'U').slice(0, 2).toUpperCase()}
        </button>
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

        <section className="timeline-panel">
          <div className="timeline-header">
            <h3>Office Timeline</h3>
            {timelineLoading ? <span className="timeline-status">Updating...</span> : null}
          </div>
          {timelineError ? <p className="timeline-error">Timeline error: {timelineError}</p> : null}
          {timelineEvents.length === 0 ? (
            <p className="timeline-empty">No timeline activity yet.</p>
          ) : (
            timelineEvents.map((event, idx) => {
              const eventId = event.id || `${event.type || 'event'}-${event.created_at_epoch || idx}-${idx}`
              const eventType = event.type === 'document_upload' ? 'Document upload' : 'Chat'
              const actor = String(event.user_email || '').trim()
              const sourceUrl = timelineSourceUrl(event)
              return (
                <article key={eventId} className="timeline-card">
                  <p className="timeline-meta">
                    <span>{eventType}</span>
                    <span>{formatTimelineTime(event.created_at_iso || event.created_at)}</span>
                  </p>
                  {actor ? <p className="timeline-actor">{actor}</p> : null}
                  {event.type === 'document_upload' ? (
                    <p className="timeline-line">Uploaded: {event.title || event.document_id || 'Document'}</p>
                  ) : (
                    <>
                      <p className="timeline-line"><strong>Q:</strong> {clip(event.query || '', 140)}</p>
                      <p className="timeline-line"><strong>A:</strong> {clip(event.response || '', 220)}</p>
                    </>
                  )}
                  {sourceUrl ? (
                    <button
                      type="button"
                      className="doc-link as-button"
                      onClick={() => openSourcePreview(sourceUrl, event.title || 'Timeline source')}
                    >
                      View source
                    </button>
                  ) : null}
                </article>
              )
            })
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

            {sourcePreview.mobile ? (
              <div className="source-mobile-body">
                <p className="source-mobile-note">
                  Mobile preview is simplified for stability. Open the document in a new tab and return here; your chat will stay saved.
                </p>
                <a className="source-mobile-open" href={sourcePreview.rawUrl} target="_blank" rel="noreferrer">
                  Open Document
                </a>
              </div>
            ) : (
              <iframe
                className="source-frame"
                title={sourcePreview.title}
                src={sourcePreview.previewUrl}
              />
            )}

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
            {uploading ? `Uploading ${lastUploadedName}` : lastUploadedName ? `Last: ${lastUploadedName}` : `Signed in: ${auth.email}`}
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
