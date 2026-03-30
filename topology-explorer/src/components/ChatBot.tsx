import { useEffect, useRef, useState } from 'react'

type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

const WELCOME: Message = {
  id: 0,
  role: 'assistant',
  content:
    'Hola! Soy tu asistente de **Interference Explorer**.\n\nPuedo ayudarte a:\n- Importar y visualizar tu topología de red\n- Interpretar resultados del clasificador de interferencia\n- Guiarte paso a paso en cualquier función de la app\n- Explicar qué significan las alertas y cómo actuar\n\n¿En qué te ayudo?',
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n- /g, '\n• ')
    .replace(/\n/g, '<br/>')
}

export default function ChatBot() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  let nextId = useRef(1)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: nextId.current++, role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    const history = [...messages, userMsg]
      .filter((m) => m.id > 0)
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error ?? 'Error del servidor')
        return
      }

      setMessages((prev) => [
        ...prev,
        { id: nextId.current++, role: 'assistant', content: data.reply },
      ])
    } catch {
      setError('No se pudo conectar con el servidor. Verifica tu conexión.')
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

  return (
    <>
      {/* Floating button */}
      <button
        className={`chatbot-fab ${open ? 'chatbot-fab--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Asistente IA"
        aria-label="Abrir asistente"
      >
        {open ? (
          <span className="material-icons-round">close</span>
        ) : (
          <span className="material-icons-round">smart_toy</span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <span className="material-icons-round chatbot-header-icon">smart_toy</span>
            <div>
              <div className="chatbot-title">Asistente RF</div>
              <div className="chatbot-subtitle">Interference Explorer AI</div>
            </div>
            <button className="chatbot-close" onClick={() => setOpen(false)}>
              <span className="material-icons-round">close</span>
            </button>
          </div>

          <div className="chatbot-messages">
            {messages.map((msg) => (
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

            {error && (
              <div className="chatbot-error">{error}</div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="chatbot-input-row">
            <textarea
              ref={inputRef}
              className="chatbot-input"
              placeholder="Pregunta algo..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
