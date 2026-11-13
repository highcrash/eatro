import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CheckCircle2, Plus, RotateCcw, X, XCircle } from 'lucide-react';

import { api } from '../../lib/api';
import { CARD, Dialog, fmtTime, friendly, GHOST, HINT, INPUT, LABEL, PRIMARY, taka } from './shared';

type Provider = 'OPENAI_COMPATIBLE' | 'ANTHROPIC';
type Job = 'CHAT' | 'VISION' | 'COMMENT';

interface TestResult { name: string; passed: boolean; note: string | null; reply: string | null; latencyMs: number | null }
interface Connection {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string | null;
  model: string;
  supportsVision: boolean;
  isActive: boolean;
  monthlyBudget: number | null;
  dailyRequestLimit: number | null;
  inputPricePerM: number;
  outputPricePerM: number;
  keySet: boolean;
  keyHint: string | null;
  keyUnreadable: boolean;
  selfTestScore: number | null;
  selfTestAt: string | null;
  selfTestDetail: { passed: number; total: number; avgLatencyMs: number | null; results: TestResult[] } | null;
  selfTestRunning: boolean;
  requestsToday: number;
  requestsThisMonth: number;
  costThisMonthTaka: number;
  budgetUsedPercent: number | null;
}
interface Route { job: Job; label: string; connectionIds: string[]; splitConnectionId: string | null; splitPercent: number; shadowConnectionId: string | null }
interface Routes { routes: Route[]; canSwitchBack: boolean; lastChange: { at: string; by: string | null; note: string | null } | null }
interface Usage { id: string; name: string; model: string; requests: number; ok: number; errors: number; blocked: number; tests: number; costTaka: number; avgLatencyMs: number | null }
interface FreeModel { id: string; name: string; free: boolean; vision: boolean; contextLength: number | null }

const PASS = 60;
const JOB_HELP: Record<Job, string> = {
  CHAT: 'Answers customer messages. Tried in this order; if one fails, is over budget or out of daily requests, the next one answers.',
  VISION: 'Reads customer photos. Only connections marked "reads images" can be added. Photos must also be switched on in Settings.',
  COMMENT: 'Sorts unclear Facebook and Instagram comments. Used once those channels are connected.',
};

export default function AiModelsTab() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<Connection | 'new' | null>(null);
  const [openRouter, setOpenRouter] = useState(false);
  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ['ai-connections'],
    queryFn: () => api.get('/chatbot/ai/connections'),
    refetchInterval: (q) => ((q.state.data as Connection[] | undefined)?.some((c) => c.selfTestRunning) ? 3_000 : false),
  });
  const { data: routes } = useQuery<Routes>({ queryKey: ['ai-routes'], queryFn: () => api.get('/chatbot/ai/routes') });
  const { data: usage = [] } = useQuery<Usage[]>({ queryKey: ['ai-usage'], queryFn: () => api.get('/chatbot/ai/usage?days=30') });
  const switchBack = useMutation({ mutationFn: () => api.post('/chatbot/ai/switch-back', {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-routes'] }) });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-white tracking-wide">AI CONNECTIONS</h2>
            <p className={HINT}>Each connection is one AI account and model. Add as many as you like; a change takes effect on the next customer message.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setOpenRouter(true)} className={PRIMARY}>Connect OpenRouter (free)</button>
            <button onClick={() => setAdding('new')} className={GHOST}><Plus size={14} className="inline mr-1" />Other AI</button>
          </div>
        </div>
        {connections.length === 0 && <div className={`${CARD} p-4`}><p className={HINT}>No AI yet. Start with "Connect OpenRouter (free)". Until an AI is set up, the bot answers pre-ready questions only and passes everything else to staff.</p></div>}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {connections.map((c) => <ConnectionCard key={c.id} c={c} onEdit={() => setAdding(c)} />)}
        </div>
      </section>

      {routes && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-white tracking-wide">WHICH AI DOES WHAT</h2>
              <p className={HINT}>A model must score {PASS}% or more on the self-test before it can answer chats.</p>
            </div>
            {routes.canSwitchBack && (
              <button onClick={() => { if (confirm('Restore the AI setup from before the last change?')) switchBack.mutate(); }} className={GHOST}>
                <RotateCcw size={14} className="inline mr-1" />Switch back
                {routes.lastChange && <span className="text-[#555] ml-2 text-xs">{fmtTime(routes.lastChange.at)}{routes.lastChange.by ? ` · ${routes.lastChange.by}` : ''}</span>}
              </button>
            )}
          </div>
          {switchBack.error && <p className="text-[#F03535] text-xs font-body">{friendly(switchBack.error)}</p>}
          {routes.routes.map((r) => <RouteEditor key={r.job + JSON.stringify(r)} route={r} connections={connections} />)}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-white tracking-wide">LAST 30 DAYS</h2>
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-sm font-body">
            <thead className="text-[#666] text-xs uppercase tracking-widest">
              <tr>{['Connection', 'Requests', 'Answered', 'Withheld by price check', 'Errors', 'Avg reply time', 'Cost'].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {usage.length === 0 && <tr><td colSpan={7} className={`${HINT} px-3 py-3`}>No AI requests yet.</td></tr>}
              {usage.map((u) => (
                <tr key={u.id} className="border-t border-[#222] text-[#ccc]">
                  <td className="px-3 py-2 text-white">{u.name}<span className="text-[#555] text-xs ml-2">{u.model}</span></td>
                  <td className="px-3 py-2">{u.requests}{u.tests > 0 && <span className="text-[#555] text-xs"> ({u.tests} test)</span>}</td>
                  <td className="px-3 py-2">{u.ok}</td>
                  <td className="px-3 py-2">{u.blocked}</td>
                  <td className="px-3 py-2">{u.errors}</td>
                  <td className="px-3 py-2">{u.avgLatencyMs != null ? `${(u.avgLatencyMs / 1000).toFixed(1)} s` : '—'}</td>
                  <td className="px-3 py-2">{taka(u.costTaka)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openRouter && <OpenRouterDialog onClose={() => setOpenRouter(false)} />}
      {adding && <ConnectionDialog connection={adding === 'new' ? null : adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function ScoreBadge({ c }: { c: Connection }) {
  if (c.selfTestRunning) return <span className="text-xs font-body text-[#FFA726]">Self-test running…</span>;
  if (c.selfTestScore == null) return <span className="text-xs font-body text-[#888]">Not tested</span>;
  const ok = c.selfTestScore >= PASS;
  return <span className={`text-xs font-body ${ok ? 'text-[#4CAF50]' : 'text-[#F03535]'}`}>Self-test {c.selfTestScore}%{ok ? '' : ' (needs 60%)'}</span>;
}

function ConnectionCard({ c, onEdit }: { c: Connection; onEdit: () => void }) {
  const qc = useQueryClient();
  const [details, setDetails] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['ai-connections'] });
  const test = useMutation({ mutationFn: () => api.post(`/chatbot/ai/connections/${c.id}/self-test`, {}), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: () => api.patch(`/chatbot/ai/connections/${c.id}`, { isActive: !c.isActive }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.delete(`/chatbot/ai/connections/${c.id}`), onSuccess: refresh });
  const error = test.error ?? toggle.error ?? remove.error;

  return (
    <div className={`${CARD} p-4 space-y-2 ${c.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-body text-sm">{c.name}{!c.isActive && <span className="text-[#888] text-xs ml-2">(off)</span>}</p>
          <p className="text-[#888] text-xs font-body break-all">{c.model}</p>
          <p className={HINT}>{c.provider === 'ANTHROPIC' ? 'Anthropic' : (c.baseUrl ?? '').replace(/^https?:\/\//, '')} · key {c.keyUnreadable ? <span className="text-[#F03535]">unreadable, paste again</span> : c.keyHint}{c.supportsVision ? ' · reads images' : ''}</p>
        </div>
        <ScoreBadge c={c} />
      </div>
      <p className="text-[#aaa] text-xs font-body">
        Today {c.requestsToday}{c.dailyRequestLimit != null ? ` / ${c.dailyRequestLimit}` : ''} requests · this month {c.requestsThisMonth} · {taka(c.costThisMonthTaka)}
        {c.monthlyBudget != null && <> of {taka(c.monthlyBudget)} budget{c.budgetUsedPercent != null && c.budgetUsedPercent >= 80 && <span className={c.budgetUsedPercent >= 100 ? 'text-[#F03535]' : 'text-[#FFA726]'}> ({c.budgetUsedPercent}%{c.budgetUsedPercent >= 100 ? ', paused until next month' : ''})</span>}</>}
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => test.mutate()} disabled={c.selfTestRunning || test.isPending} className={`${GHOST} !px-2 !py-1 text-xs`}>Run self-test</button>
        {c.selfTestDetail && <button onClick={() => setDetails((d) => !d)} className={`${GHOST} !px-2 !py-1 text-xs`}>{details ? 'Hide' : 'Show'} results</button>}
        <button onClick={onEdit} className={`${GHOST} !px-2 !py-1 text-xs`}>Edit</button>
        <button onClick={() => toggle.mutate()} className={`${GHOST} !px-2 !py-1 text-xs`}>{c.isActive ? 'Turn off' : 'Turn on'}</button>
        <button onClick={() => { if (confirm(`Remove ${c.name}?`)) remove.mutate(); }} className={`${GHOST} !px-2 !py-1 text-xs`}>Remove</button>
      </div>
      {error && <p className="text-[#F03535] text-xs font-body">{friendly(error)}</p>}
      {details && c.selfTestDetail && (
        <div className="border-t border-[#222] pt-2 space-y-1.5">
          <p className={HINT}>{c.selfTestDetail.passed} of {c.selfTestDetail.total} passed{c.selfTestDetail.avgLatencyMs != null ? ` · average ${(c.selfTestDetail.avgLatencyMs / 1000).toFixed(1)} s per reply` : ''} · {c.selfTestAt ? fmtTime(c.selfTestAt) : ''}</p>
          {c.selfTestDetail.results.map((r) => (
            <div key={r.name} className="text-xs font-body">
              <p className={r.passed ? 'text-[#4CAF50]' : 'text-[#F03535]'}>
                {r.passed ? <CheckCircle2 size={12} className="inline mr-1" /> : <XCircle size={12} className="inline mr-1" />}{r.name}{r.note ? `: ${r.note}` : ''}
              </p>
              {r.reply && <p className="text-[#777] pl-4 line-clamp-2">{r.reply}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpenRouterDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const check = useMutation<{ label: string | null; freeDailyLimit: number; boughtCredit: boolean; freeModels: FreeModel[] }>({ mutationFn: () => api.post('/chatbot/ai/openrouter/check', { apiKey }) });
  const chosen = check.data?.freeModels.find((m) => m.id === model);
  const create = useMutation({
    mutationFn: async () => {
      const c = await api.post<Connection>('/chatbot/ai/connections', {
        name: `OpenRouter free: ${chosen?.name ?? model}`.slice(0, 80),
        provider: 'OPENAI_COMPATIBLE',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey,
        model,
        supportsVision: !!chosen?.vision,
        dailyRequestLimit: check.data?.freeDailyLimit ?? 50,
        inputPricePerM: 0,
        outputPricePerM: 0,
      });
      await api.post(`/chatbot/ai/connections/${c.id}/self-test`, {});
      return c;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ai-connections'] }); onClose(); },
  });

  return (
    <Dialog title="CONNECT OPENROUTER" onClose={onClose} wide>
      <ol className="text-[#ccc] text-sm font-body list-decimal pl-5 space-y-1">
        <li>Sign in at <a className="text-[#D62B2B]" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">openrouter.ai/settings/keys</a> and create a key named "EATRO chatbot".</li>
        <li>Optional but recommended: buy $10 of credit once. Free models then allow 1,000 requests a day instead of 50.</li>
        <li>Paste the key here. It is stored encrypted and never shown again.</li>
      </ol>
      <div>
        <label className={LABEL}>OpenRouter API key</label>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="sk-or-v1-…" className={`w-full ${INPUT}`} />
      </div>
      <button onClick={() => check.mutate()} disabled={!apiKey.trim() || check.isPending} className={GHOST}>{check.isPending ? 'Checking…' : 'Check key and list free models'}</button>
      {check.error && <p className="text-[#F03535] text-xs font-body">{friendly(check.error)}</p>}
      {check.data && (
        <>
          <p className="text-[#4CAF50] text-sm font-body">
            Key accepted{check.data.label ? ` (${check.data.label})` : ''}. Free daily limit: {check.data.freeDailyLimit} requests
            {!check.data.boughtCredit && <span className="text-[#FFA726]">. Buy $10 credit once to raise it to 1,000.</span>}
          </p>
          <div>
            <label className={LABEL}>Free model ({check.data.freeModels.length} available today)</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className={`w-full ${INPUT}`}>
              <option value="">Choose a model…</option>
              {check.data.freeModels.map((m) => <option key={m.id} value={m.id}>{m.name}{m.vision ? ' · reads images' : ''}</option>)}
            </select>
            <p className={`${HINT} mt-1`}>Not sure? Add two or three. Each one runs the self-test and the scores show which handles your menu and Bangla best.</p>
          </div>
          {create.error && <p className="text-[#F03535] text-xs font-body">{friendly(create.error)}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className={`flex-1 ${GHOST}`}>Close</button>
            <button onClick={() => create.mutate()} disabled={!model || create.isPending} className={`flex-1 ${PRIMARY}`}>{create.isPending ? 'Adding…' : 'Add and run self-test'}</button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function ConnectionDialog({ connection, onClose }: { connection: Connection | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: connection?.name ?? '',
    provider: (connection?.provider ?? 'OPENAI_COMPATIBLE') as Provider,
    baseUrl: connection?.baseUrl ?? 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: connection?.model ?? '',
    supportsVision: connection?.supportsVision ?? false,
    monthlyBudget: connection?.monthlyBudget?.toString() ?? '',
    dailyRequestLimit: connection?.dailyRequestLimit?.toString() ?? '',
    inputPricePerM: connection?.inputPricePerM?.toString() ?? '0',
    outputPricePerM: connection?.outputPricePerM?.toString() ?? '0',
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        provider: f.provider,
        baseUrl: f.provider === 'ANTHROPIC' ? null : f.baseUrl,
        model: f.model,
        supportsVision: f.supportsVision,
        monthlyBudget: f.monthlyBudget.trim() === '' ? null : Number(f.monthlyBudget),
        dailyRequestLimit: f.dailyRequestLimit.trim() === '' ? null : Number(f.dailyRequestLimit),
        inputPricePerM: Number(f.inputPricePerM || 0),
        outputPricePerM: Number(f.outputPricePerM || 0),
        ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}),
      };
      return connection ? api.patch(`/chatbot/ai/connections/${connection.id}`, body) : api.post('/chatbot/ai/connections', body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ai-connections'] }); onClose(); },
  });

  return (
    <Dialog title={connection ? 'EDIT AI CONNECTION' : 'ADD AI CONNECTION'} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={LABEL}>Name</label>
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Claude Haiku (paid)" className={`w-full ${INPUT}`} />
        </div>
        <div className="col-span-2">
          <label className={LABEL}>Type</label>
          <select value={f.provider} onChange={(e) => set({ provider: e.target.value as Provider })} className={`w-full ${INPUT}`}>
            <option value="OPENAI_COMPATIBLE">OpenAI-style service (OpenRouter, OmniRoute, Groq, OpenAI…)</option>
            <option value="ANTHROPIC">Anthropic (Claude) direct</option>
          </select>
        </div>
        {f.provider === 'OPENAI_COMPATIBLE' && (
          <div className="col-span-2">
            <label className={LABEL}>Service address</label>
            <input value={f.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} className={`w-full ${INPUT}`} />
          </div>
        )}
        <div className="col-span-2">
          <label className={LABEL}>API key {connection && '(leave empty to keep the saved one)'}</label>
          <input type="password" autoComplete="off" value={f.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={connection?.keyHint ?? ''} className={`w-full ${INPUT}`} />
        </div>
        <div className="col-span-2">
          <label className={LABEL}>Model id</label>
          <input value={f.model} onChange={(e) => set({ model: e.target.value })} placeholder={f.provider === 'ANTHROPIC' ? 'claude-haiku-5-5' : 'anthropic/claude-haiku-5.5 or a :free model'} className={`w-full ${INPUT}`} />
          <p className={`${HINT} mt-1`}>Changing the model or key resets the self-test score.</p>
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm font-body text-[#ccc]">
          <input type="checkbox" checked={f.supportsVision} onChange={(e) => set({ supportsVision: e.target.checked })} /> This model can read images
        </label>
        <div>
          <label className={LABEL}>Input price $ / million tokens</label>
          <input type="number" min={0} step="0.01" value={f.inputPricePerM} onChange={(e) => set({ inputPricePerM: e.target.value })} className={`w-full ${INPUT}`} />
        </div>
        <div>
          <label className={LABEL}>Output price $ / million tokens</label>
          <input type="number" min={0} step="0.01" value={f.outputPricePerM} onChange={(e) => set({ outputPricePerM: e.target.value })} className={`w-full ${INPUT}`} />
        </div>
        <div>
          <label className={LABEL}>Monthly budget ৳ (empty = no limit)</label>
          <input type="number" min={0} value={f.monthlyBudget} onChange={(e) => set({ monthlyBudget: e.target.value })} className={`w-full ${INPUT}`} />
        </div>
        <div>
          <label className={LABEL}>Requests per day (empty = no limit)</label>
          <input type="number" min={0} value={f.dailyRequestLimit} onChange={(e) => set({ dailyRequestLimit: e.target.value })} className={`w-full ${INPUT}`} />
        </div>
      </div>
      <p className={HINT}>Prices are only used to show cost and stop at the budget. Copy them from the provider's pricing page; use 0 for free models.</p>
      {save.error && <p className="text-[#F03535] text-xs font-body">{friendly(save.error)}</p>}
      <div className="flex gap-3">
        <button onClick={onClose} className={`flex-1 ${GHOST}`}>Cancel</button>
        <button onClick={() => save.mutate()} disabled={save.isPending || !f.name || !f.model || (!connection && !f.apiKey)} className={`flex-1 ${PRIMARY}`}>Save</button>
      </div>
    </Dialog>
  );
}

function RouteEditor({ route, connections }: { route: Route; connections: Connection[] }) {
  const qc = useQueryClient();
  const [ids, setIds] = useState(route.connectionIds);
  const [split, setSplit] = useState({ id: route.splitConnectionId ?? '', percent: route.splitPercent });
  const [shadow, setShadow] = useState(route.shadowConnectionId ?? '');
  useEffect(() => { setIds(route.connectionIds); }, [route.connectionIds]);
  const usable = connections.filter((c) => (route.job === 'VISION' ? c.supportsVision : true));
  const name = (id: string) => connections.find((c) => c.id === id)?.name ?? 'Removed connection';
  const save = useMutation({
    mutationFn: () => api.put(`/chatbot/ai/routes/${route.job}`, { connectionIds: ids, splitConnectionId: split.id || null, splitPercent: split.id ? split.percent : 0, shadowConnectionId: shadow || null }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-routes'] }),
  });
  const move = (i: number, d: number) => setIds((xs) => { const n = [...xs]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const dirty = JSON.stringify(ids) !== JSON.stringify(route.connectionIds) || (split.id || null) !== route.splitConnectionId || (split.id ? split.percent : 0) !== route.splitPercent || (shadow || null) !== route.shadowConnectionId;

  return (
    <div className={`${CARD} p-4 space-y-3`}>
      <div>
        <p className="text-white font-body text-sm">{route.label}</p>
        <p className={HINT}>{JOB_HELP[route.job]}</p>
      </div>
      <div className="space-y-1">
        {ids.length === 0 && <p className="text-[#FFA726] text-xs font-body">No AI assigned{route.job === 'CHAT' ? ': only pre-ready answers are sent, everything else goes to staff.' : '.'}</p>}
        {ids.map((id, i) => (
          <div key={id} className="flex items-center gap-2 text-sm font-body">
            <span className="text-[#666] w-14 text-xs">{i === 0 ? 'First' : `Backup ${i}`}</span>
            <span className="text-white flex-1">{name(id)}</span>
            <button disabled={i === 0} onClick={() => move(i, -1)} className="text-[#888] hover:text-white disabled:opacity-20"><ArrowUp size={14} /></button>
            <button disabled={i === ids.length - 1} onClick={() => move(i, 1)} className="text-[#888] hover:text-white disabled:opacity-20"><ArrowDown size={14} /></button>
            <button onClick={() => setIds((xs) => xs.filter((x) => x !== id))} className="text-[#888] hover:text-[#F03535]"><X size={14} /></button>
          </div>
        ))}
        <select value="" onChange={(e) => e.target.value && setIds((xs) => [...xs, e.target.value])} className={`${INPUT} text-xs`}>
          <option value="">+ Add a connection…</option>
          {usable.filter((c) => !ids.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}{c.selfTestScore != null ? ` (${c.selfTestScore}%)` : ' (not tested)'}</option>)}
        </select>
      </div>
      {route.job === 'CHAT' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-[#222] pt-3">
          <div>
            <label className={LABEL}>Split test: send a share of chats to</label>
            <div className="flex gap-2">
              <select value={split.id} onChange={(e) => setSplit({ ...split, id: e.target.value })} className={`flex-1 ${INPUT} text-xs`}>
                <option value="">Off</option>
                {usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {split.id && <input type="number" min={1} max={100} value={split.percent} onChange={(e) => setSplit({ ...split, percent: Number(e.target.value) })} className={`w-20 ${INPUT} text-xs`} />}
              {split.id && <span className="text-[#888] text-xs self-center">%</span>}
            </div>
          </div>
          <div>
            <label className={LABEL}>Trial model (drafts only you see)</label>
            <select value={shadow} onChange={(e) => setShadow(e.target.value)} className={`w-full ${INPUT} text-xs`}>
              <option value="">Off</option>
              {usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      )}
      {save.error && <p className="text-[#F03535] text-xs font-body">{friendly(save.error)}</p>}
      <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className={PRIMARY}>Save {route.label.toLowerCase()}</button>
    </div>
  );
}
