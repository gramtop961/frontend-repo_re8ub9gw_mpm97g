import { useEffect, useMemo, useState } from 'react'

// Small helpers
function Pill({ children }) {
  return <span className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs mr-2 mb-2">{children}</span>
}

function Section({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// Boolean parsing & evaluation
// Supported syntax:
// - Variables: A, B, C, D
// - NOT: !A or A' (postfix) ("'" binds only to preceding variable or ) )
// - AND: * or implicit adjacency (handled conservatively) — we convert to explicit &
// - OR: +
// - Parentheses: ( )
// We convert to a safe JS expression over booleans using &&, ||, !

function tokenize(exprRaw) {
  const expr = exprRaw.replace(/\s+/g, '')
  const tokens = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if ('ABCD'.includes(ch)) {
      tokens.push({ t: 'var', v: ch })
      i++
      continue
    }
    if (ch === '0' || ch === '1') {
      tokens.push({ t: 'const', v: ch === '1' })
      i++
      continue
    }
    if (ch === '(' || ch === ')') { tokens.push({ t: ch }); i++; continue }
    if (ch === '+' ) { tokens.push({ t: 'OR' }); i++; continue }
    if (ch === '*' || ch === '·') { tokens.push({ t: 'AND' }); i++; continue }
    if (ch === '!') { tokens.push({ t: 'NOT' }); i++; continue }
    if (ch === "'") { tokens.push({ t: "POST_NOT" }); i++; continue }
    // Unrecognized token
    tokens.push({ t: 'UNKNOWN', v: ch }); i++
  }
  return tokens
}

function insertImplicitAnd(tokens) {
  // Insert explicit AND where adjacency implies multiplication: var )( var, var var, )(
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i]
    const prev = out[out.length - 1]
    if (prev) {
      const prevCanEnd = prev.t === 'var' || prev.t === 'const' || prev.t === ')' || prev.t === 'POST_NOT'
      const nextCanStart = cur.t === 'var' || cur.t === 'const' || cur.t === '(' || cur.t === 'NOT'
      if (prevCanEnd && nextCanStart) {
        // Insert implicit AND
        out.push({ t: 'AND' })
      }
    }
    out.push(cur)
  }
  return out
}

function toPostfix(tokens) {
  // Shunting-yard to handle precedence: NOT > AND > OR
  const prec = { 'OR': 1, 'AND': 2, 'NOT': 3 }
  const output = []
  const stack = []
  const processPostNot = () => {
    // Treat POST_NOT as immediate NOT on the previous output
    output.push({ t: 'POST_NOT_APPLY' })
  }
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.t === 'var' || tok.t === 'const') {
      output.push(tok)
      continue
    }
    if (tok.t === 'POST_NOT') { processPostNot(); continue }
    if (tok.t === 'NOT') { stack.push(tok); continue }
    if (tok.t === 'AND' || tok.t === 'OR') {
      while (stack.length) {
        const top = stack[stack.length - 1]
        if ((top.t === 'AND' || top.t === 'OR' || top.t === 'NOT') && prec[top.t] >= prec[tok.t]) {
          output.push(stack.pop())
        } else break
      }
      stack.push(tok)
      continue
    }
    if (tok.t === '(') { stack.push(tok); continue }
    if (tok.t === ')') {
      while (stack.length && stack[stack.length - 1].t !== '(') output.push(stack.pop())
      if (stack.length && stack[stack.length - 1].t === '(') stack.pop()
      // Allow postfix not directly after )
      if (i + 1 < tokens.length && tokens[i + 1].t === 'POST_NOT') {
        output.push({ t: 'POST_NOT_APPLY' })
        i++
      }
      continue
    }
  }
  while (stack.length) output.push(stack.pop())
  return output
}

function evalPostfix(postfix, env) {
  const stack = []
  for (const tok of postfix) {
    if (tok.t === 'var') { stack.push(Boolean(env[tok.v])); continue }
    if (tok.t === 'const') { stack.push(Boolean(tok.v)); continue }
    if (tok.t === 'POST_NOT_APPLY') {
      const a = stack.pop(); stack.push(!a); continue
    }
    if (tok.t === 'NOT') { const a = stack.pop(); stack.push(!a); continue }
    if (tok.t === 'AND') { const b = stack.pop(), a = stack.pop(); stack.push(a && b); continue }
    if (tok.t === 'OR') { const b = stack.pop(), a = stack.pop(); stack.push(a || b); continue }
  }
  return stack.pop() ?? false
}

function extractVars(expr) {
  const set = new Set((expr.match(/[ABCD]/g) || []))
  return Array.from(set).sort()
}

function evalOnBits(expr, vars, bits) {
  const tokens = insertImplicitAnd(tokenize(expr))
  const postfix = toPostfix(tokens)
  const env = {}
  for (let i = 0; i < vars.length; i++) env[vars[i]] = bits[i] === 1
  return evalPostfix(postfix, env) ? 1 : 0
}

// Gray code helpers for K-Map positions
const gray2 = [0,1,3,2]

function popcount(n) { let c = 0; while (n) { c += n & 1; n >>= 1 } return c }

// Quine–McCluskey Simplifier with steps
function qmSimplify(vars, table) {
  const steps = []
  const minterms = []
  const dcs = []
  table.forEach((row) => {
    if (row.val === 1) minterms.push(row.idx)
    if (row.val === 2) dcs.push(row.idx)
  })
  steps.push({ stage: 'extract', minterms: [...minterms], dontCares: [...dcs] })

  // Represent implicants as {bits: number, mask: number, covers: Set<number>, combined: false}
  const makeTerm = (idx) => ({ bits: idx, mask: 0, covers: new Set([idx]), combined: false })
  let groups = new Map()
  ;[...minterms, ...dcs].forEach(idx => {
    const g = popcount(idx)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(makeTerm(idx))
  })
  steps.push({ stage: 'grouping-initial', groups: Object.fromEntries([...groups.entries()].map(([k,v]) => [k, v.map(t=>t.bits)])) })

  function canCombine(a,b){
    const diff = (a.bits ^ b.bits)
    if (popcount(diff) !== 1) return false
    if (a.mask !== b.mask) return false
    return true
  }

  function combineOnce(groups) {
    const newGroups = new Map()
    const marks = []
    const keys = [...groups.keys()].sort((a,b)=>a-b)
    for (let gi = 0; gi < keys.length - 1; gi++) {
      const g1 = keys[gi], g2 = keys[gi+1]
      for (const a of groups.get(g1) || []) {
        for (const b of groups.get(g2) || []) {
          if (canCombine(a,b)) {
            const combined = {
              bits: a.bits & b.bits,
              mask: a.mask | (a.bits ^ b.bits),
              covers: new Set([...a.covers, ...b.covers]),
              combined: false,
            }
            a.combined = true; b.combined = true
            const gc = popcount(combined.bits)
            if (!newGroups.has(gc)) newGroups.set(gc, [])
            // avoid duplicates
            if (!newGroups.get(gc).some(t => t.bits === combined.bits && t.mask === combined.mask)) {
              newGroups.get(gc).push(combined)
              marks.push({ from:[a.bits,b.bits], to:{bits:combined.bits, mask:combined.mask} })
            }
          }
        }
      }
    }
    return { newGroups, marks }
  }

  let allImplicants = []
  let round = 0
  while (true) {
    steps.push({ stage: 'grouping-round', round, snapshot: Object.fromEntries([...groups.entries()].map(([k,v]) => [k, v.map(t=>({bits:t.bits, mask:t.mask}))])) })
    const { newGroups, marks } = combineOnce(groups)
    steps.push({ stage: 'combine', round, combined: marks })
    // collect those not combined further as prime candidates
    for (const arr of groups.values()) {
      for (const t of arr) if (!t.combined) allImplicants.push(t)
    }
    if (newGroups.size === 0) break
    groups = newGroups
    round++
  }

  // Deduplicate prime implicants
  const primes = []
  allImplicants.forEach(t => {
    if (!primes.some(p => p.bits === t.bits && p.mask === t.mask)) primes.push(t)
  })
  steps.push({ stage: 'prime-implicants', count: primes.length, implicants: primes.map(p=>({bits:p.bits, mask:p.mask, covers:[...p.covers]})) })

  // Build PI chart (only real minterms, exclude DCs)
  const realMins = minterms
  const chart = {} // minterm -> indices of primes
  realMins.forEach(m => chart[m] = [])
  primes.forEach((p, pi) => {
    realMins.forEach(m => {
      // Check if p covers m: (m & ~mask) === (bits & ~mask)
      if ((m & ~p.mask) === (p.bits & ~p.mask)) chart[m].push(pi)
    })
  })
  steps.push({ stage: 'pi-chart', chart })

  // Essential PIs: any minterm covered by exactly one PI
  const essential = new Set()
  const covered = new Set()
  for (const m of realMins) {
    if (chart[m].length === 1) {
      essential.add(chart[m][0])
    }
  }
  essential.forEach(pi => {
    realMins.forEach(m => { if (chart[m].includes(pi)) covered.add(m) })
  })
  steps.push({ stage: 'essential', essential: [...essential] })

  // Greedy cover remaining
  while (covered.size < realMins.length) {
    let best = -1, bestCovers = -1
    for (let i = 0; i < primes.length; i++) {
      if (essential.has(i)) continue
      let c = 0
      realMins.forEach(m => { if (!covered.has(m) && chart[m].includes(i)) c++ })
      if (c > bestCovers) { bestCovers = c; best = i }
    }
    if (best === -1) break
    essential.add(best)
    realMins.forEach(m => { if (chart[m].includes(best)) covered.add(m) })
    steps.push({ stage: 'select-prime', selected: best })
  }

  const selected = [...essential]

  // Render SOP string from implicant mask/bits
  const termToString = (p) => {
    const lits = []
    for (let i = 0; i < vars.length; i++) {
      const bit = (p.bits >> (vars.length - 1 - i)) & 1
      const masked = (p.mask >> (vars.length - 1 - i)) & 1
      if (masked === 1) continue // don't care position
      const v = vars[i]
      lits.push(bit === 1 ? v : v + "'")
    }
    return lits.length ? lits.join('') : '1'
  }
  const sopTerms = selected.map(i => termToString(primes[i]))
  const minimized = sopTerms.length ? sopTerms.join(' + ') : (minterms.length ? '0' : '0')

  steps.push({ stage: 'result', sop: minimized, selected, terms: sopTerms })

  return { sop: minimized, primes, selected, steps }
}

// SVG Circuit rendering for SOP (sum of products)
function renderCircuitFromSOP(sop, vars) {
  // Parse SOP like A'B + AC into array of product terms [[{v:'A',neg:true},{v:'B',neg:false}], ...]
  const terms = sop.split('+').map(t => t.trim()).filter(Boolean)
  const parsed = terms.map(t => {
    if (t === '0') return []
    if (t === '1') return []
    const arr = []
    let i = 0
    while (i < t.length) {
      const ch = t[i]
      if ('ABCD'.includes(ch)) {
        let neg = false
        if (i + 1 < t.length && t[i+1] === "'") { neg = true; i++ }
        arr.push({ v: ch, neg })
      }
      i++
    }
    return arr
  })

  const width = 640, height = Math.max(200, 80 + parsed.length * 60)
  const inputY = { A: 40, B: 80, C: 120, D: 160 }
  const gateX = 220
  const orX = 520

  const lines = []
  const texts = []
  const rects = []
  const circles = []

  // Input rails
  Object.entries(inputY).forEach(([v,y]) => {
    lines.push({ x1: 40, y1: y, x2: width - 20, y2: y, stroke: '#e5e7eb' })
    texts.push({ x: 24, y: y + 4, text: v })
  })

  // AND gates per term
  parsed.forEach((term, ti) => {
    const y = 60 + ti * 60
    rects.push({ x: gateX - 20, y: y - 16, w: 40, h: 32, fill: '#eef2ff', stroke: '#4f46e5' })
    texts.push({ x: gateX - 4, y: y + 4, text: 'AND' })
    // connections
    term.forEach(lit => {
      const yIn = inputY[lit.v]
      lines.push({ x1: 40, y1: yIn, x2: gateX - 20, y2: y })
      if (lit.neg) {
        circles.push({ cx: gateX - 24, cy: y, r: 4 })
      }
    })
    // Line to OR gate
    lines.push({ x1: gateX + 20, y1: y, x2: orX - 20, y2: y })
  })

  // OR gate
  rects.push({ x: orX - 20, y: 60 + (parsed.length - 1) * 30 - 16, w: 40, h: 32, fill: '#ecfeff', stroke: '#0891b2' })
  texts.push({ x: orX - 6, y: 60 + (parsed.length - 1) * 30 + 4, text: 'OR' })

  // Output line
  lines.push({ x1: orX + 20, y1: 60 + (parsed.length - 1) * 30, x2: width - 40, y2: 60 + (parsed.length - 1) * 30 })
  texts.push({ x: width - 36, y: 60 + (parsed.length - 1) * 30 - 8, text: 'F' })

  const svg = (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {lines.map((l, i) => (
        <line key={`l-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.stroke || '#111'} strokeWidth={1}/>
      ))}
      {rects.map((r, i) => (
        <rect key={`r-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill || 'white'} stroke={r.stroke || '#111'} rx={6} ry={6}/>
      ))}
      {circles.map((c, i) => (
        <circle key={`c-${i}`} cx={c.cx} cy={c.cy} r={c.r} fill="white" stroke="#111" />
      ))}
      {texts.map((t, i) => (
        <text key={`t-${i}`} x={t.x} y={t.y} fontSize={10} fill="#111">{t.text}</text>
      ))}
    </svg>
  )

  return svg
}

export default function BooleanDesigner() {
  const [expr, setExpr] = useState("A'B + AC")
  const [vars, setVars] = useState(['A','B','C'])
  const [table, setTable] = useState([]) // {idx, bits:[], val:0|1|2}
  const [kmap, setKmap] = useState(null)
  const [qm, setQm] = useState(null)

  // Build initial
  useEffect(() => { runAll() }, [])

  function addChips(id, arr) {
    // id is unused here but kept for API parity; arr are expression strings to append/select
    if (arr && arr.length) setExpr(arr[0])
  }

  function buildTruth(e = expr) {
    const v = extractVars(e)
    const n = Math.min(4, Math.max(1, v.length || 2))
    const used = v.length ? v : ['A','B']
    setVars(used)
    const rows = []
    const total = 1 << used.length
    for (let idx = 0; idx < total; idx++) {
      const bits = []
      for (let i = used.length - 1; i >= 0; i--) bits.push((idx >> i) & 1)
      let val = 0
      try { val = evalOnBits(e, used, bits) } catch(_) { val = 0 }
      rows.push({ idx, bits, val })
    }
    setTable(rows)
  }

  function renderTruth() {
    return (
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              {vars.map(v => <th key={v} className="px-2 py-1 text-left text-gray-600">{v}</th>)}
              <th className="px-2 py-1 text-left text-gray-600">F</th>
            </tr>
          </thead>
          <tbody>
            {table.map(row => (
              <tr key={row.idx} className="border-t">
                {row.bits.map((b,i) => <td key={i} className="px-2 py-1 font-mono">{b}</td>)}
                <td className="px-2 py-1">
                  <button onClick={() => toggleMinterm(row.idx)} className={`px-2 py-0.5 rounded text-xs font-mono ${row.val===1?'bg-emerald-100 text-emerald-700':row.val===2?'bg-amber-100 text-amber-800':'bg-gray-100 text-gray-700'}`}>
                    {row.val===0?'0':row.val===1?'1':'DC'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function toggleMinterm(idx) {
    setTable(prev => prev.map(r => r.idx===idx?{...r, val: (r.val+1)%3 }: r))
  }

  function renderKmap() {
    const n = vars.length
    if (n < 2 || n > 4) return <p className="text-sm text-gray-500">K-Map available for 2–4 variables.</p>

    // Build mapping for 2,3,4 variables (Gray coding)
    let rows, cols, rowBits, colBits
    if (n === 2) {
      rows = [0,1]; cols = [0,1]
      rowBits = [0]; colBits = [1]
    } else if (n === 3) {
      rows = [0,1]; cols = gray2.slice(0,4)
      rowBits = [0]; colBits = [1,2]
    } else { // 4
      rows = gray2; cols = gray2
      rowBits = [0,1]; colBits = [2,3]
    }

    const cellVal = (r,c) => {
      // Construct index by composing row and col bits
      const nbits = new Array(n).fill(0)
      // row bits first
      for (let i = 0; i < rowBits.length; i++) {
        const bitIdx = rowBits[i]
        const bit = (rows[r] >> (rowBits.length - 1 - i)) & 1
        nbits[bitIdx] = bit
      }
      for (let i = 0; i < colBits.length; i++) {
        const bitIdx = colBits[i]
        const bit = (cols[c] >> (colBits.length - 1 - i)) & 1
        nbits[bitIdx] = bit
      }
      // map to idx number
      let idx = 0
      for (let i = 0; i < n; i++) idx = (idx << 1) | nbits[i]
      const row = table.find(x => x.idx === idx)
      return row?.val ?? 0
    }

    return (
      <div className="inline-block">
        <table className="border text-sm">
          <tbody>
            {rows.map((_, ri) => (
              <tr key={ri}>
                {cols.map((_, ci) => {
                  const v = cellVal(ri, ci)
                  const cls = v===1?'bg-emerald-100 text-emerald-800':v===2?'bg-amber-100 text-amber-800':'bg-gray-50 text-gray-700'
                  return <td key={ci} onClick={() => {
                    // toggle corresponding minterm by recomputing idx
                    const nbits = new Array(vars.length).fill(0)
                    // row bits
                    if (vars.length===2){ nbits[0] = rows[ri]; nbits[1] = cols[ci] }
                    else if (vars.length===3){ nbits[0]=(rows[ri]&1); const c=cols[ci]; nbits[1]=(c>>1)&1; nbits[2]=c&1 }
                    else { const r=rows[ri], c=cols[ci]; nbits[0]=(r>>1)&1; nbits[1]=r&1; nbits[2]=(c>>1)&1; nbits[3]=c&1 }
                    let idx = 0; for (let i = 0; i < vars.length; i++) idx = (idx<<1)|nbits[i]
                    toggleMinterm(idx)
                  }} className={`w-12 h-10 border text-center align-middle font-mono cursor-pointer ${cls}`}>{v===0?'0':v===1?'1':'DC'}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function runAll() {
    buildTruth(expr)
    setTimeout(() => {
      const res = qmSimplify(vars, table)
      setQm(res)
      setKmap(true) // marker that K-map is ready (rendered from table)
    }, 0)
  }

  function clearAll() {
    setExpr('')
    setVars(['A','B'])
    setTable([])
    setQm(null)
    setKmap(null)
  }

  function renderSteps(steps) {
    if (!steps) return null
    return (
      <div className="space-y-2 text-xs">
        {steps.map((s, i) => (
          <div key={i} className="bg-gray-50 rounded p-2">
            <div className="font-semibold text-gray-700 mb-1">Step {i+1}: {s.stage}</div>
            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(s, null, 2)}</pre>
          </div>
        ))}
      </div>
    )
  }

  const circuitSvg = useMemo(() => qm?.sop ? renderCircuitFromSOP(qm.sop, vars) : null, [qm, vars])

  return (
    <div className="space-y-6">
      <Section title="Boolean Logic Toolkit" subtitle="Truth table, K-Map, Quine–McCluskey minimization, and auto-drawn logic circuit.">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input value={expr} onChange={e=>setExpr(e.target.value)} placeholder="Enter expression, e.g., A'B + AC" className="flex-1 border border-gray-300 rounded-lg px-3 py-2" />
          <button onClick={() => addChips('expr', ["A'B + AC"]) } className="px-3 py-2 bg-indigo-600 text-white rounded-lg">Add Example</button>
          <button onClick={runAll} className="px-3 py-2 bg-emerald-600 text-white rounded-lg">Run</button>
          <button onClick={clearAll} className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg">Clear</button>
        </div>
        <div className="text-xs text-gray-500 mb-4">Supported: variables A–D, + (OR), implicit/* (AND), ! or ' (NOT), parentheses.</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            "A + B",
            "AB + A'C",
            "(A+B)'C",
            "A'B + AB'",
            "A'B' + ABC",
          ].map((ex,i) => (
            <button key={i} onClick={()=>setExpr(ex)} className="px-2 py-1 text-xs rounded border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">{ex}</button>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Truth Table</h3>
            {renderTruth()}
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">K-Map</h3>
            {renderKmap()}
          </div>
        </div>
      </Section>

      <Section title="Quine–McCluskey Minimization" subtitle="Shows every stage from grouping to prime implicants and final SOP.">
        {qm ? (
          <div className="space-y-3">
            <div className="text-sm">Minimized SOP: <span className="font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">{qm.sop}</span></div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-1">Prime Implicants</h4>
              <div className="flex flex-wrap">{qm.primes?.map((p,i)=>(<Pill key={i}>{`bits=${p.bits.toString(2)} mask=${p.mask.toString(2)}`}</Pill>))}</div>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-1">Steps</h4>
              {renderSteps(qm.steps)}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Run to see minimization steps.</p>
        )}
      </Section>

      <Section title="Logic Circuit" subtitle="Auto-generated SVG from the minimized SOP.">
        {circuitSvg || <p className="text-sm text-gray-500">Run to generate circuit.</p>}
      </Section>
    </div>
  )
}
