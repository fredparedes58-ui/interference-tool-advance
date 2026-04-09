import { useEffect, useRef, useState } from 'react'
import { useToolExecutor } from '../hooks/useToolExecutor'
import type { NormalizedTopology, InterferenceIssue, SiteForAnalysis } from '../types'
import type { KpiDataset } from './KPIPanel'

const HISTORY_KEY = 'hunter-chat-history'
const MAX_STORED = 10
const MAX_TOOL_CALLS = 5

const EMPTY_TOPOLOGY: NormalizedTopology = {
  version: '',
  sites: [],
  cells: [],
  links: [],
  interferenceSamples: [],
}

type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

type StoredConversation = {
  id: string
  title: string
  messages: Message[]
  savedAt: string
}

type RagDoc = {
  name: string
  text: string
}

export type ChatBotContext = {
  topology?: string | null
  selectedCell?: string | null
  kpis?: string | null
}

// Anthropic message format used in API calls (no SDK import needed client-side)
type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type ApiMessage = {
  role: 'user' | 'assistant'
  content: string | ApiContentBlock[]
}

type Props = {
  ragContext?: ChatBotContext
  topology?: NormalizedTopology | null
  kpiData?: KpiDataset | null
  interferenceIssues?: InterferenceIssue[]
  allSitesForAnalysis?: SiteForAnalysis[]
}

const WELCOME: Message = {
  id: 0,
  role: 'assistant',
  content:
    'Hola! Soy **Hunter**, tu analista de interferencia RF.\n\nAhora tengo acceso en tiempo real a:\n- Los datos de red cargados en la app\n- KPIs de la celda seleccionada\n- Documentos que subas (TXT/CSV/JSON)\n\n¿En qué te ayudo?',
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n- /g, '\n• ')
    .replace(/\n/g, '<br/>')
}

async function extractText(file: File): Promise<string> {
  const text = await file.text()
  if (file.name.endsWith('.json')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>
      if (obj.kpis && obj.kpi_meta) {
        const cells = Object.keys(obj.kpis as object)
        return `KPI dataset: ${cells.length} celdas (${cells.slice(0, 8).join(', ')}${cells.length > 8 ? '...' : ''})\nKPIs: ${(obj.kpi_meta as Array<{ label: string }>).map(m => m.label).join(', ')}`
      }
      if (obj.sites && obj.cells) {
        return `Topology: ${(obj.sites as unknown[]).length} sitios, ${(obj.cells as unknown[]).length} celdas`
      }
      return JSON.stringify(obj).slice(0, 4000)
    } catch {
      return text.slice(0, 8000)
    }
  }
  return text.slice(0, 8000)
}

function loadHistory(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as StoredConversation[]) : []
  } catch { return [] }
}

function saveHistory(convs: StoredConversation[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(convs.slice(0, MAX_STORED))) } catch { /* ignore */ }
}

function buildApiMessages(msgs: Message[]): ApiMessage[] {
  return msgs
    .filter(m => m.id > 0)
    .map(m => ({ role: m.role, content: m.content }))
}

export default function ChatBot({ ragContext, topology, kpiData, interferenceIssues, allSitesForAnalysis }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [docs, setDocs] = useState<RagDoc[]>([])
  const [docsOpen, setDocsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<StoredConversation[]>(loadHistory)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const currentConvId = useRef<string>(Date.now().toString())
  const apiMessagesRef = useRef<ApiMessage[]>([])

  const { executeToolCall } = useToolExecutor({
    topology: topology ?? EMPTY_TOPOLOGY,
    kpiData: kpiData ?? null,
    interferenceIssues: interferenceIssues ?? [],
    allSitesForAnalysis: allSitesForAnalysis ?? [],
  })

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    const userMsgs = messages.filter(m => m.role === 'user')
    if (userMsgs.length === 0 || loading) return
    const title = userMsgs[0].content.slice(0, 60) + (userMsgs[0].content.length > 60 ? '…' : '')
    const conv: StoredConversation = {
      id: currentConvId.current,
      title,
      messages,
      savedAt: new Date().toISOString(),
    }
    setHistory(prev => {
      const filtered = prev.filter(c => c.id !== conv.id)
      const next = [conv, ...filtered]
      saveHistory(next)
      return next
    })
  }, [messages, loading])

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const newDocs: RagDoc[] = []
    for (const file of files) {
      const text = await extractText(file)
      newDocs.push({ name: file.name, text })
    }
    setDocs(prev => [...prev, ...newDocs])
    e.target.value = ''
  }

  const removeDoc = (idx: number) => {
    setDocs(prev => prev.filter((_, i) => i !== idx))
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: nextId.current++, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)
    setToolStatus(null)

    apiMessagesRef.current.push({ role: 'user', content: text })

    const assistantId = nextId.current++
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    let toolCallCount = 0

    // Multi-turn tool use loop
    for (;;) {
      let res: Response
      try {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessagesRef.current,
            context: {
              topology: ragContext?.topology ?? null,
              selectedCell: ragContext?.selectedCell ?? null,
              kpis: ragContext?.kpis ?? null,
              docs: docs.length > 0 ? docs : undefined,
            },
          }),
        })
      } catch {
        setError('No se pudo conectar. Verifica tu conexión.')
        setLoading(false)
        setToolStatus(null)
        return
      }

      if (!res.ok) {
        try {
          const errJson = await res.json() as { error?: string }
          setError(errJson.error ?? 'Error del servidor')
        } catch {
          setError('Error del servidor')
        }
        setLoading(false)
        setToolStatus(null)
        return
      }

      const contentType = res.headers.get('Content-Type') ?? ''

      // ── Tool calls branch ────────────────────────────────────────────────────
      if (contentType.includes('application/json')) {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          setError('Límite de herramientas alcanzado.')
          setLoading(false)
          setToolStatus(null)
          return
        }

        let json: {
          type: string
          toolCalls: Array<{ id: string; name: string; input: unknown }>
          assistantContent: ApiContentBlock[]
        }
        try {
          json = await res.json()
        } catch {
          setError('Error procesando respuesta del servidor')
          setLoading(false)
          setToolStatus(null)
          return
        }

        // Append assistant's tool_use blocks to API history
        apiMessagesRef.current.push({ role: 'assistant', content: json.assistantContent })

        // Show tool activity indicator
        const toolNames = json.toolCalls.map(tc => tc.name.replace(/_/g, ' ')).join(', ')
        setToolStatus(`Consultando: ${toolNames}`)

        // Execute all tool calls client-side (data lives in browser)
        const toolResults: ApiContentBlock[] = await Promise.all(
          json.toolCalls.map(async (tc) => ({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: await executeToolCall({ id: tc.id, name: tc.name, input: tc.input }),
          }))
        )

        // Append tool results as user message
        apiMessagesRef.current.push({ role: 'user', content: toolResults })
        toolCallCount++
        continue
      }

      // ── SSE stream (end_turn) ────────────────────────────────────────────────
      setToolStatus(null)

      if (!res.body) {
        setError('Error en streaming')
        setLoading(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalText = ''
      let streamDone = false

      try {
        while (!streamDone) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') { streamDone = true; break }
            try {
              const parsed = JSON.parse(raw) as { delta?: string; error?: string }
              if (parsed.error) { setError(parsed.error); streamDone = true; break }
              const delta = parsed.delta
              if (delta) {
                finalText += delta
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId ? { ...m, content: m.content + delta } : m
                  )
                )
              }
            } catch { /* skip malformed SSE line */ }
          }
        }
      } catch {
        setError('Error en streaming')
      }

      if (finalText) {
        apiMessagesRef.current.push({ role: 'assistant', content: finalText })
      }
      setLoading(false)
      return
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const hasContext = !!(ragContext?.topology || ragContext?.selectedCell || docs.length > 0)

  return (
    <>
      <button
        className={`chatbot-fab ${open ? 'chatbot-fab--open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Asistente IA"
        aria-label="Abrir asistente"
      >
        {open
          ? <span className="material-icons-round">close</span>
          : <span className="material-icons-round">smart_toy</span>
        }
        {!open && hasContext && <span className="chatbot-fab-dot" />}
      </button>

      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <span className="material-icons-round chatbot-header-icon">smart_toy</span>
            <div>
              <div className="chatbot-title">Hunter</div>
              <div className="chatbot-subtitle">RF Analyst · Tool Use activo</div>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                className="chatbot-history-btn"
                onClick={() => setHistoryOpen(v => !v)}
                title="Historial de conversaciones"
              >
                <span className="material-icons-round" style={{ fontSize: 16 }}>history</span>
                {history.length > 0 && <span className="chatbot-history-count">{history.length}</span>}
              </button>
              <button
                className="chatbot-new-btn"
                onClick={() => {
                  currentConvId.current = Date.now().toString()
                  setMessages([WELCOME])
                  setInput('')
                  setError(null)
                  setHistoryOpen(false)
                  nextId.current = 1
                  apiMessagesRef.current = []
                }}
                title="Nueva conversación"
              >
                <span className="material-icons-round" style={{ fontSize: 16 }}>add_comment</span>
              </button>
              <button className="chatbot-close" onClick={() => setOpen(false)}>
                <span className="material-icons-round">close</span>
              </button>
            </div>
          </div>

          {/* History panel */}
          {historyOpen && (
            <div className="chatbot-history-panel">
              <div className="chatbot-history-title">Conversaciones guardadas</div>
              {history.length === 0 ? (
                <div className="chatbot-history-empty">Sin conversaciones guardadas</div>
              ) : (
                history.map(conv => (
                  <div
                    key={conv.id}
                    className={`chatbot-history-item ${conv.id === currentConvId.current ? 'chatbot-history-item--active' : ''}`}
                    onClick={() => {
                      currentConvId.current = conv.id
                      setMessages(conv.messages)
                      nextId.current = Math.max(...conv.messages.map(m => m.id)) + 1
                      apiMessagesRef.current = buildApiMessages(conv.messages)
                      setHistoryOpen(false)
                    }}
                  >
                    <span className="material-icons-round" style={{ fontSize: 14, flexShrink: 0, opacity: 0.5 }}>chat</span>
                    <div className="chatbot-history-item-text">
                      <div className="chatbot-history-item-title">{conv.title}</div>
                      <div className="chatbot-history-item-date">{conv.savedAt.slice(0, 10)}</div>
                    </div>
                    <button
                      className="chatbot-history-delete"
                      onClick={e => {
                        e.stopPropagation()
                        setHistory(prev => {
                          const next = prev.filter(c => c.id !== conv.id)
                          saveHistory(next)
                          return next
                        })
                      }}
                      title="Eliminar"
                    >✕</button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* RAG context bar */}
          <div className="chatbot-rag-bar">
            <div className="chatbot-rag-chips">
              {ragContext?.topology && (
                <span className="rag-chip rag-chip--green">
                  <span className="material-icons-round" style={{ fontSize: 12 }}>hub</span>
                  Red cargada
                </span>
              )}
              {ragContext?.selectedCell && (
                <span className="rag-chip rag-chip--blue">
                  <span className="material-icons-round" style={{ fontSize: 12 }}>cell_tower</span>
                  {ragContext.selectedCell.split('\n')[0].replace('Celda: ', '')}
                </span>
              )}
              {docs.length > 0 && (
                <button
                  className="rag-chip rag-chip--violet"
                  onClick={() => setDocsOpen(v => !v)}
                  style={{ background: 'none', cursor: 'pointer' }}
                >
                  <span className="material-icons-round" style={{ fontSize: 12 }}>description</span>
                  {docs.length} doc{docs.length > 1 ? 's' : ''}
                </button>
              )}
              {!hasContext && (
                <span className="rag-chip rag-chip--dim">Sin contexto activo</span>
              )}
            </div>
            <button
              className="chatbot-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Adjuntar documento (TXT/CSV/JSON/MD)"
            >
              <span className="material-icons-round" style={{ fontSize: 16 }}>attach_file</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.json,.md"
              multiple
              style={{ display: 'none' }}
              onChange={handleDocUpload}
            />
          </div>

          {/* Docs list */}
          {docsOpen && docs.length > 0 && (
            <div className="chatbot-docs-list">
              {docs.map((doc, i) => (
                <div key={i} className="chatbot-doc-item">
                  <span className="material-icons-round" style={{ fontSize: 14 }}>description</span>
                  <span className="chatbot-doc-name">{doc.name}</span>
                  <button className="chatbot-doc-remove" onClick={() => removeDoc(i)}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="chatbot-messages">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`chatbot-msg ${msg.role === 'user' ? 'chatbot-msg--user' : 'chatbot-msg--bot'}`}
              >
                {msg.role === 'assistant' && (
                  <span className="chatbot-avatar material-icons-round">smart_toy</span>
                )}
                <div
                  className="chatbot-bubble"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              </div>
            ))}

            {loading && (
              <div className="chatbot-msg chatbot-msg--bot">
                <span className="chatbot-avatar material-icons-round">smart_toy</span>
                <div className="chatbot-bubble chatbot-typing">
                  {toolStatus
                    ? <span style={{ fontSize: 11, opacity: 0.75, fontStyle: 'italic' }}>{toolStatus}</span>
                    : <><span /><span /><span /></>
                  }
                </div>
              </div>
            )}

            {error && <div className="chatbot-error">{error}</div>}
            <div ref={bottomRef} />
          </div>

          <div className="chatbot-input-row">
            <textarea
              ref={inputRef}
              className="chatbot-input"
              placeholder="Pregunta sobre tu red, celdas o documentos..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              disabled={loading}
            />
            <button
              className="chatbot-send"
              onClick={send}
              disabled={!input.trim() || loading}
              title="Enviar"
            >
              <span className="material-icons-round">send</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
