import { useEffect, useMemo, useState } from 'react'

function Pill({ text, onRemove }) {
  return (
    <span className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm mr-2 mb-2">
      {text}
      {onRemove && (
        <button onClick={onRemove} className="text-blue-500 hover:text-blue-700">×</button>
      )}
    </span>
  )
}

function Section({ title, children, subtitle }) {
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

export default function App() {
  const baseUrl = useMemo(() => import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000', [])

  const [forwardRules, setForwardRules] = useState([])
  const [backwardRules, setBackwardRules] = useState([])
  const [faultPrefix, setFaultPrefix] = useState('fault_')

  // Forward chaining state
  const [factInput, setFactInput] = useState('')
  const [facts, setFacts] = useState([])
  const [forwardResult, setForwardResult] = useState(null)
  const [loadingForward, setLoadingForward] = useState(false)
  const [error, setError] = useState('')

  // Backward chaining state
  const [goal, setGoal] = useState('fault_power_supply')
  const [backwardResult, setBackwardResult] = useState(null)
  const [loadingBackward, setLoadingBackward] = useState(false)

  useEffect(() => {
    const loadRules = async () => {
      try {
        const res = await fetch(`${baseUrl}/rules`)
        const data = await res.json()
        setForwardRules(data.forward_rules || data.rules || [])
        setBackwardRules(data.backward_rules || data.rules || [])
        setFaultPrefix(data.fault_prefix || 'fault_')
      } catch (e) {
        // ignore
      }
    }
    loadRules()
  }, [baseUrl])

  const addFact = () => {
    const f = factInput.trim()
    if (!f) return
    if (!facts.includes(f)) setFacts([...facts, f])
    setFactInput('')
  }

  const removeFact = (f) => setFacts(facts.filter(x => x !== f))

  const runForward = async () => {
    setLoadingForward(true)
    setError('')
    setForwardResult(null)
    try {
      const res = await fetch(`${baseUrl}/diagnose/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setForwardResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingForward(false)
    }
  }

  const runBackward = async () => {
    setLoadingBackward(true)
    setError('')
    setBackwardResult(null)
    try {
      const res = await fetch(`${baseUrl}/diagnose/backward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts, goal }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setBackwardResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingBackward(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-sky-50 to-teal-50">
      <header className="px-6 py-6">
        <h1 className="text-3xl font-bold text-gray-800">Symbolic Fault Diagnosis</h1>
        <p className="text-gray-600">Enter observed symptoms as logical facts, then infer possible faults using forward or backward chaining.</p>
      </header>

      <main className="px-6 pb-16 max-w-6xl mx-auto grid gap-6 md:grid-cols-2">
        <Section title="Facts" subtitle="Add observed symptoms as atomic propositions (e.g., battery_low, no_wifi)">
          <div className="flex gap-2 mb-4">
            <input
              value={factInput}
              onChange={e => setFactInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addFact()}
              placeholder="Type a fact and press Enter"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button onClick={addFact} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add</button>
          </div>
          <div className="min-h-[44px]">
            {facts.length === 0 ? (
              <p className="text-gray-500 text-sm">No facts yet.</p>
            ) : (
              <div className="flex flex-wrap">
                {facts.map(f => (
                  <Pill key={f} text={f} onRemove={() => removeFact(f)} />
                ))}
              </div>
            )}
          </div>
        </Section>

        <Section title="Knowledge Base" subtitle="Current rules loaded (separate sets for forward and backward reasoning)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-gray-800 mb-2">Forward Rules (used by Forward Chaining)</h3>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {forwardRules.map((r, idx) => (
                  <div key={`f-${idx}`} className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2">
                    <span className="font-mono">{(r.antecedents || []).join(' ∧ ') || 'TRUE'}</span>
                    <span className="mx-2">→</span>
                    <span className="font-mono font-semibold">{r.consequent}</span>
                    {r.description && <div className="text-gray-500 text-xs">{r.description}</div>}
                  </div>
                ))}
                {forwardRules.length === 0 && (
                  <p className="text-sm text-gray-500">Loading rules…</p>
                )}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 mb-2">Backward Rules (used by Backward Chaining)</h3>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {backwardRules.map((r, idx) => (
                  <div key={`b-${idx}`} className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2">
                    <span className="font-mono">{(r.antecedents || []).join(' ∧ ') || 'TRUE'}</span>
                    <span className="mx-2">→</span>
                    <span className="font-mono font-semibold">{r.consequent}</span>
                    {r.description && <div className="text-gray-500 text-xs">{r.description}</div>}
                  </div>
                ))}
                {backwardRules.length === 0 && (
                  <p className="text-sm text-gray-500">Loading rules…</p>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">Faults are facts that start with the prefix <span className="font-mono">{faultPrefix}</span>.</p>
        </Section>

        <Section title="Forward Chaining" subtitle="Derive all consequences from the given facts and list candidate faults (uses Forward Rules)">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={runForward} disabled={loadingForward}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              {loadingForward ? 'Running…' : 'Run Forward Inference'}
            </button>
            <span className="text-xs text-gray-500">Backend: {baseUrl}</span>
          </div>
          {error && (
            <div className="text-red-600 text-sm mb-2">{error}</div>
          )}
          {forwardResult && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-800">Derived Facts</h3>
                <div className="mt-2 flex flex-wrap">
                  {forwardResult.derived_facts.length === 0 && (
                    <p className="text-sm text-gray-500">No new facts.</p>
                  )}
                  {forwardResult.derived_facts.map((f) => (
                    <Pill key={f} text={f} />
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Candidate Faults</h3>
                <div className="mt-2 flex flex-wrap">
                  {forwardResult.faults.length === 0 && (
                    <p className="text-sm text-gray-500">No faults derived.</p>
                  )}
                  {forwardResult.faults.map((f) => (
                    <Pill key={f} text={f} />
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Trace</h3>
                <ol className="list-decimal list-inside text-sm space-y-1">
                  {forwardResult.trace.map((t, i) => (
                    <li key={i} className="text-gray-700">
                      If <span className="font-mono">{t.antecedents.join(' ∧ ')}</span> then <span className="font-mono">{t.consequent}</span>
                      {t.description && <span className="text-gray-500"> — {t.description}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </Section>

        <Section title="Backward Chaining" subtitle="Test whether a specific fault (goal) can be proven from the facts (uses Backward Rules)">
          <div className="flex gap-2 mb-3">
            <input
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder={`e.g., ${faultPrefix}battery`}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button onClick={runBackward} disabled={loadingBackward}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {loadingBackward ? 'Checking…' : 'Prove Goal'}
            </button>
          </div>
          {backwardResult && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="font-semibold">Provable:</span>{' '}
                {backwardResult.provable ? (
                  <span className="text-emerald-700">Yes</span>
                ) : (
                  <span className="text-rose-700">No</span>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Proof</h3>
                <pre className="bg-gray-50 rounded-lg p-3 text-xs overflow-auto max-h-64">
{JSON.stringify(backwardResult.proof, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </Section>

        <div className="md:col-span-2 text-center">
          <a href="/test" className="inline-block mt-2 text-sm text-gray-600 hover:text-gray-800 underline">
            Connection Test
          </a>
        </div>
      </main>
    </div>
  )
}
