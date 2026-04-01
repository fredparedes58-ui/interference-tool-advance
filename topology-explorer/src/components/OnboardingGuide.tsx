import { useState, useEffect } from 'react'

const ONBOARDING_KEY = 'interference-onboarding-v1'

type Step = {
  icon: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: 'wifi_tethering',
    title: 'Bienvenido a Interference Explorer',
    body: 'Herramienta de análisis de interferencia RAN. Visualiza topología de red, detecta interferencias y analiza KPIs por celda en tiempo real.',
  },
  {
    icon: 'upload_file',
    title: 'Carga tu topología',
    body: 'Toca el botón + en la barra inferior para subir tu archivo topology.json. La app acepta archivos con sites, cells y links.',
  },
  {
    icon: 'cell_tower',
    title: 'Analiza una celda',
    body: 'Toca cualquier celda en el mapa para abrir el panel de análisis: clasificación de interferencia, heatmap PRB, exportación PDF y comparación de celdas.',
  },
  {
    icon: 'show_chart',
    title: 'Panel KPI',
    body: 'Desde el botón KPI en la barra inferior accede a gráficas horarias, comparación entre fechas y análisis de tendencias por celda.',
  },
  {
    icon: 'smart_toy',
    title: 'Hunter — Tu analista IA',
    body: 'El asistente tiene contexto de tu red en tiempo real. Pregúntale sobre interferencias, celdas específicas o adjunta documentos para análisis avanzado.',
  },
]

export default function OnboardingGuide() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY)
    if (!done) setVisible(true)
  }, [])

  const finish = () => {
    localStorage.setItem(ONBOARDING_KEY, '1')
    setVisible(false)
  }

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1)
    else finish()
  }

  const prev = () => setStep(s => Math.max(0, s - 1))

  if (!visible) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Guía de inicio">
      <div className="onboarding-card">
        <button className="onboarding-skip" onClick={finish} title="Saltar guía">
          Saltar
        </button>

        <div className="onboarding-icon-wrap">
          <span className="material-icons-round onboarding-icon">{current.icon}</span>
        </div>

        <div className="onboarding-step-indicator">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={`onboarding-dot ${i === step ? 'onboarding-dot--active' : ''}`}
              onClick={() => setStep(i)}
              aria-label={`Paso ${i + 1}`}
            />
          ))}
        </div>

        <h2 className="onboarding-title">{current.title}</h2>
        <p className="onboarding-body">{current.body}</p>

        <div className="onboarding-actions">
          {step > 0 && (
            <button className="onboarding-btn onboarding-btn--ghost" onClick={prev}>
              Anterior
            </button>
          )}
          <button className="onboarding-btn onboarding-btn--primary" onClick={next}>
            {isLast ? 'Comenzar' : 'Siguiente'}
            <span className="material-icons-round" style={{ fontSize: 16 }}>
              {isLast ? 'rocket_launch' : 'arrow_forward'}
            </span>
          </button>
        </div>

        <div className="onboarding-progress">
          <div
            className="onboarding-progress-bar"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
