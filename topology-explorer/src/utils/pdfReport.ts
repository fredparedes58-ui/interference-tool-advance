import jsPDF from 'jspdf'
import type { Cell, CellAnalysis } from '../types'

// ── Theme colours ────────────────────────────────────────────────────────────
const BG:    [number, number, number] = [6,   7,  26]
const SURF:  [number, number, number] = [14, 18,  52]
const ACC:   [number, number, number] = [0, 245, 212]   // mint-teal
const ACC2:  [number, number, number] = [129, 140, 248]  // indigo
const TEXT:  [number, number, number] = [200, 210, 255]
const MUTED: [number, number, number] = [100, 116, 139]
const GREEN: [number, number, number] = [34, 197, 94]
const YELL:  [number, number, number] = [234, 179,  8]
const RED:   [number, number, number] = [239,  68, 68]

const SEVERITY_RGB: Record<string, [number, number, number]> = {
  LOW:      GREEN,
  MEDIUM:   YELL,
  HIGH:     RED,
  CRITICAL: [220, 38, 38],
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fill(doc: jsPDF, color: [number, number, number], x: number, y: number, w: number, h: number) {
  doc.setFillColor(...color)
  doc.rect(x, y, w, h, 'F')
}

function label(doc: jsPDF, text: string, x: number, y: number) {
  doc.setTextColor(...MUTED)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.text(text, x, y)
}

function value(doc: jsPDF, text: string, x: number, y: number) {
  doc.setTextColor(...TEXT)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text(text, x, y)
}

function sectionTitle(doc: jsPDF, text: string, x: number, y: number) {
  doc.setTextColor(...ACC2)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text(text.toUpperCase(), x, y)
  // underline
  const w = doc.getTextWidth(text.toUpperCase())
  doc.setDrawColor(...ACC2)
  doc.setLineWidth(0.3)
  doc.line(x, y + 0.8, x + w, y + 0.8)
}

function chip(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  bg: [number, number, number],
  fg: [number, number, number]
) {
  const tw = doc.getTextWidth(text) + 4
  fill(doc, bg, x, y - 4, tw, 5.5)
  doc.setTextColor(...fg)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text(text, x + 2, y)
  return tw
}

// ── Main export function ─────────────────────────────────────────────────────
export function exportCellPdf(
  cell: Cell,
  analysis: CellAnalysis | null,
  heatmapCanvas?: HTMLCanvasElement | null
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  let y = 0

  // ── HEADER ────────────────────────────────────────────────────────────────
  fill(doc, BG, 0, 0, W, 297)
  fill(doc, SURF, 0, 0, W, 30)

  // Accent stripe
  fill(doc, ACC, 0, 0, 3, 30)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...ACC)
  doc.text('RAN Interference Report', 10, 11)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...TEXT)
  doc.text(`Cell: ${cell.id}`, 10, 18)
  doc.text(`Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, 10, 23)

  // Top-right: site info
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text(`Site: ${cell.siteId}`, W - 12, 11, { align: 'right' })
  if (cell.azimuth !== undefined) doc.text(`Azimuth: ${cell.azimuth}°`, W - 12, 17, { align: 'right' })
  if (cell.tilt !== undefined) doc.text(`Tilt: ${cell.tilt}°`, W - 12, 23, { align: 'right' })

  y = 38

  // ── SECTION 1: Cell Info ──────────────────────────────────────────────────
  sectionTitle(doc, 'Cell Information', 10, y)
  y += 6

  fill(doc, SURF, 10, y, W - 20, 32)
  doc.setDrawColor(...ACC2)
  doc.setLineWidth(0.2)
  doc.rect(10, y, W - 20, 32)

  const col1x = 16
  const col2x = 80
  const col3x = 140
  let ry = y + 7

  // Row 1
  label(doc, 'Technology', col1x, ry);     value(doc, cell.tech ?? '—', col1x, ry + 4)
  label(doc, 'Band', col2x, ry);           value(doc, cell.band ?? '—', col2x, ry + 4)
  label(doc, 'Bandwidth', col3x, ry);      value(doc, cell.bwMhz !== undefined ? `${cell.bwMhz} MHz` : '—', col3x, ry + 4)
  ry += 12
  // Row 2
  label(doc, 'Vendor', col1x, ry);         value(doc, cell.vendor ?? '—', col1x, ry + 4)
  label(doc, 'EARFCN', col2x, ry);         value(doc, cell.earfcn !== undefined ? String(cell.earfcn) : '—', col2x, ry + 4)
  label(doc, 'PCI', col3x, ry);            value(doc, cell.pci !== undefined ? String(cell.pci) : '—', col3x, ry + 4)

  y += 38

  // ── SECTION 2: KPI Snapshot ───────────────────────────────────────────────
  if (cell.kpi) {
    sectionTitle(doc, 'KPI Snapshot', 10, y)
    y += 6

    fill(doc, SURF, 10, y, W - 20, 22)
    doc.setDrawColor(...ACC2)
    doc.setLineWidth(0.2)
    doc.rect(10, y, W - 20, 22)

    const kpis: Array<{ lbl: string; val: string; color?: [number, number, number] }> = []
    if (cell.kpi.rssi_avg_dbm !== undefined) kpis.push({ lbl: 'NI avg', val: `${cell.kpi.rssi_avg_dbm.toFixed(1)} dBm` })
    if (cell.kpi.ul_sinr_p50_db !== undefined) kpis.push({ lbl: 'UL SINR p50', val: `${cell.kpi.ul_sinr_p50_db.toFixed(1)} dB` })
    if (cell.kpi.pusch_bler_avg !== undefined) {
      const pct = cell.kpi.pusch_bler_avg * 100
      kpis.push({ lbl: 'PUSCH BLER', val: `${pct.toFixed(1)}%`, color: pct > 20 ? RED : pct > 10 ? YELL : GREEN })
    }
    if (cell.kpi.pucch_bler_avg !== undefined) {
      const pct = cell.kpi.pucch_bler_avg * 100
      kpis.push({ lbl: 'PUCCH BLER', val: `${pct.toFixed(1)}%`, color: pct > 15 ? RED : pct > 8 ? YELL : GREEN })
    }
    if (cell.kpi.ul_thp_mbps !== undefined) kpis.push({ lbl: 'UL Thput', val: `${cell.kpi.ul_thp_mbps.toFixed(1)} Mbps` })
    if (cell.kpi.dl_thp_mbps !== undefined) kpis.push({ lbl: 'DL Thput', val: `${cell.kpi.dl_thp_mbps.toFixed(1)} Mbps` })

    const colW = (W - 20) / Math.max(kpis.length, 1)
    kpis.slice(0, 6).forEach((k, i) => {
      const kx = 14 + i * colW
      label(doc, k.lbl, kx, y + 8)
      if (k.color) doc.setTextColor(...k.color)
      else doc.setTextColor(...TEXT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(k.val, kx, y + 15)
    })

    y += 28
  }

  // ── SECTION 3: Analysis ───────────────────────────────────────────────────
  if (analysis) {
    const primary = analysis.matches[0]

    sectionTitle(doc, 'Interference Analysis', 10, y)
    y += 6

    if (primary) {
      const sevRgb = SEVERITY_RGB[primary.severity] ?? MUTED
      fill(doc, SURF, 10, y, W - 20, 38)
      // Left border coloured by severity
      fill(doc, sevRgb, 10, y, 2, 38)
      doc.setDrawColor(...sevRgb)
      doc.setLineWidth(0.2)
      doc.rect(10, y, W - 20, 38)

      // Source type + confidence
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...TEXT)
      doc.text(primary.label, 16, y + 8)

      // Confidence badge
      const confTxt = `${Math.round(primary.confidence * 100)}%`
      chip(doc, confTxt, W - 30, y + 8, sevRgb, [6, 7, 26])

      // Severity text
      label(doc, `Severity: `, 16, y + 16)
      doc.setTextColor(...sevRgb)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.text(primary.severity, 34, y + 16)

      // Action hint
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      const hint = doc.splitTextToSize(primary.actionHint, W - 36)
      doc.text(hint.slice(0, 2), 16, y + 23)

      // Evidence chips
      if (primary.evidence.length > 0) {
        let ex = 16
        primary.evidence.slice(0, 4).forEach(ev => {
          const tw = chip(doc, ev.slice(0, 30), ex, y + 35, [20, 30, 60], ACC2)
          ex += tw + 3
        })
      }

      y += 44
    }

    // ── Secondary matches ─────────────────────────────────────────────────
    const secondaries = analysis.matches.slice(1, 4)
    if (secondaries.length > 0) {
      sectionTitle(doc, 'Other Candidate Sources', 10, y)
      y += 5

      secondaries.forEach(m => {
        const sevRgb = SEVERITY_RGB[m.severity] ?? MUTED
        const pct = Math.round(m.confidence * 100)
        fill(doc, SURF, 10, y, W - 20, 10)
        doc.rect(10, y, W - 20, 10)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...TEXT)
        doc.text(m.label, 14, y + 6.5)

        // Confidence bar
        const barX = 110
        const barW = 60
        fill(doc, [20, 30, 60], barX, y + 3, barW, 4)
        fill(doc, sevRgb, barX, y + 3, barW * m.confidence, 4)

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(...sevRgb)
        doc.text(`${pct}%`, barX + barW + 4, y + 6.5)

        y += 11
      })
      y += 4
    }

    // ── Mitigations ───────────────────────────────────────────────────────
    if (analysis.mitigations.length > 0) {
      sectionTitle(doc, 'Recommended Mitigations', 10, y)
      y += 6

      analysis.mitigations.slice(0, 3).forEach((m, i) => {
        const typeColors: Record<string, [number, number, number]> = {
          CM: [29, 78, 216],
          FIELD: [180, 83, 9],
          REGULATORY: [109, 40, 217],
        }
        const typeBg = typeColors[m.type] ?? typeColors.FIELD
        const h = 22

        fill(doc, SURF, 10, y, W - 20, h)
        doc.setDrawColor(...(SEVERITY_RGB[m.urgency] ?? MUTED))
        doc.setLineWidth(0.4)
        doc.line(10, y, 10, y + h)
        doc.setDrawColor(...MUTED)
        doc.setLineWidth(0.15)
        doc.rect(10, y, W - 20, h)

        // Step number
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(...MUTED)
        doc.text(String(i + 1), 15, y + 8)

        // Type chip
        chip(doc, m.type, 22, y + 8, typeBg, TEXT)

        // Feature ID
        if (m.featureId) {
          const fwTw = chip(doc, m.featureId, 22 + doc.getTextWidth(m.type) + 8, y + 8, [20, 30, 50], ACC2)
          void fwTw
        }

        // Title
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8.5)
        doc.setTextColor(...TEXT)
        const titleLines = doc.splitTextToSize(m.title, W - 60)
        doc.text(titleLines[0], 22, y + 16)

        // KPI impact
        if (m.expectedKpiImpact.length > 0) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...GREEN)
          doc.text(`✓ ${m.expectedKpiImpact[0]}`, W - 14, y + 10, { align: 'right' })
        }

        y += h + 2
      })
    }

    // ── PRB heatmap image ─────────────────────────────────────────────────
    if (heatmapCanvas) {
      y += 4
      // Check if we need a new page
      if (y > 220) {
        doc.addPage()
        fill(doc, BG, 0, 0, W, 297)
        y = 20
      }

      sectionTitle(doc, 'PRB Interference Histogram (24h)', 10, y)
      y += 5

      try {
        const imgData = heatmapCanvas.toDataURL('image/png')
        const imgW = W - 20
        const aspect = heatmapCanvas.height / heatmapCanvas.width
        const imgH = Math.min(50, imgW * aspect)
        doc.addImage(imgData, 'PNG', 10, y, imgW, imgH)
        y += imgH + 6

        // Legend
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...MUTED)
        doc.text('← −108 dBm (thermal)                     −72 dBm (severe) →', 10, y)
      } catch {
        // canvas may be tainted — skip
      }
    }
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  fill(doc, SURF, 0, 285, W, 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text('RAN Interference Tool — Topology Explorer', 10, 292)
  doc.text(`Page 1`, W - 10, 292, { align: 'right' })

  doc.save(`interference-report-${cell.id}-${new Date().toISOString().slice(0, 10)}.pdf`)
}
