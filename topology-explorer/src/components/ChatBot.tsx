import { useEffect, useRef, useState } from 'react'

type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
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

type Props = {
  ragContext?: ChatBotContext
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

export default function ChatBot({ ragContext }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docs, setDocs] = useState<RagDoc[]>([])
  const [docsOpen, setDocsOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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

    const history = [...messages, userMsg]
      .filter(m => m.id > 0)
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          context: {
            topology: ragContext?.topology ?? null,
            selectedCell: ragContext?.selectedCell ?? null,
            kpis: ragContext?.kpis ?? null,
            docs: docs.length > 0 ? docs : undefined,
          },
        }),
      })

      if (!res.ok || !res.body) {
        setError('Error del servidor')
        setLoading(false)
        return
      }

      // Add empty assistant message to stream into
      const assistantId = nextId.current++
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') { setLoading(false); return }
            try {
              const parsed = JSON.parse(raw) as { delta?: string; error?: string }
              if (parsed.error) { setError(parsed.error); setLoading(false); return }
              if (parsed.delta) {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: m.content + parsed.delta }
                      : m
                  )
                )
              }
            } catch { /* skip malformed line */ }
          }
        }
        setLoading(false)
      }

      pump().catch(() => { setError('Error en streaming'); setLoading(false) })
      return  // don't hit the finally block's setLoading — pump handles it
    } catch {
      setError('No se pudo conectar. Verifica tu conexión.')
    } finally {
      setLoading(false)
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
              <div className="chatbot-subtitle">RF Analyst · RAG activo</div>
            </div>
            <button className="chatbot-close" onClick={() => setOpen(false)}>
              <span className="material-icons-round">close</span>
            </button>
          </div>

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
                  <span /><span /><span />
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
