import { t } from './i18n'
import type { Analysis, Decision, Doc, RecordItem } from './data'

// Functions, not constants: the message is written in the interface language of the moment it is shown.
const apiError = () => t('The RAG service could not complete this request.')
const unreachable = () => t('The RAG service is not reachable. Start it (start.bat or ./start.sh), then retry.')

/** An HTTP error from the RAG service; `status` lets callers treat e.g. 404 as "already gone". */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Where a page's data stands while it comes from the RAG service. */
export type LoadState = 'loading' | 'ready' | 'error'

export const errorText = (err: unknown, fallback = apiError()) => err instanceof Error ? err.message : fallback

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    // fetch only rejects when no answer arrives at all (service stopped, network down).
    throw new ApiError(unreachable(), 0)
  }
  if (!response.ok) {
    let detail = apiError()
    const text = await response.text().catch(() => '')
    try {
      const body = JSON.parse(text) as { detail?: unknown }
      const message = (body.detail as { message?: unknown } | null)?.message
      detail = typeof body.detail === 'string' ? body.detail : typeof message === 'string' ? message : detail
    } catch {
      // Keep the user-facing error stable when the server returns non-JSON.
      // The development proxy answers an empty 5xx when the RAG service is stopped.
      if (response.status >= 500 && !text.trim()) throw new ApiError(unreachable(), response.status)
    }
    throw new ApiError(`${detail} (${response.status})`, response.status)
  }
  return response.json() as Promise<T>
}

// The last answer of each read is kept while the app is open: a page visited before shows it at once and refreshes it in
// the background, instead of a loading state on every visit (the records list alone took seconds). Every write drops the
// answers it changes, so a page never shows data older than the user's own last change.
const lastRead = new Map<string, unknown>()

async function read<T>(path: string): Promise<T> {
  const value = await request<T>(path)
  lastRead.set(path, value)
  return value
}

function forget(...prefixes: string[]) {
  for (const key of [...lastRead.keys()]) if (prefixes.some(prefix => key.startsWith(prefix))) lastRead.delete(key)
}

/** The last answer of a read in this session, or undefined when it never ran or a write changed its data since. */
export const peek = {
  documents: (mode: 'company' | 'demo' = 'company') => (lastRead.get(`/api/documents?data_mode=${mode}`) as { documents: Doc[] } | undefined)?.documents,
  records: (mode: 'company' | 'demo' = 'company') => (lastRead.get(`/api/records?data_mode=${mode}`) as { records: RecordItem[] } | undefined)?.records,
  tenders: () => (lastRead.get('/api/tenders') as { tenders: StoredTender[] } | undefined)?.tenders,
  benchmark: () => lastRead.get('/api/benchmark') as Benchmark | undefined,
}

export interface Health {
  status: string
  version: string
  model: string
  reranker: string | null
  index_ready: boolean
}

/** One retrieval system's scores on the labelled retrieval set (benchmark/retrieval_eval.py), over its positive queries. */
export interface RetrievalScores {
  'p@3': number; 'r@5': number; mrr: number; 'ndcg@5': number; 'hit@1': number; queries: number; latency_ms_median?: number
  /** Final system only: the documents it keeps as proof, against the labels. */
  set_precision?: number; set_recall?: number
  /** Final system only: queries that have no right answer, and those it still answered. */
  negatives?: { total: number; false_positives: string[]; false_positive_rate: number }
}
export interface Accuracy { lines: number; correct: number; accuracy: number }
/** Requirement lines n8n sent in one run, labelled by hand (benchmark/real_tenders.py): the status the RAG gives against the
 * label. Real tenders ran in Company mode, the synthetic demo tenders in Demo mode. */
export interface RealTenders {
  tenders: number; lines: number
  summary: Accuracy & {
    by_mode?: Record<string, Accuracy>; by_category?: Record<string, Accuracy>; by_expected?: Record<string, Accuracy>
    over_claims?: string[]; under_claims?: string[]; claimed?: number; right_proof?: number
  }
  per_line?: { id: string; tender_id?: string; data_mode: string; category: string; line: string; expect: string; got: string; ok: boolean }[]
}

export interface Benchmark {
  available: boolean
  updated?: string
  meta?: { finished_at: string; documents: number; real_cv_tests: number; embedding_model: string; reranker: string }
  real_cvs?: Record<string, { passed: number; total: number; rows: { q: string; expect: string; got: string; pass: boolean; found: number }[] }>
  retrieval?: {
    queries: number; positives: number; negatives: number; french_positives?: number; corpus?: Record<string, number>
    systems: Record<string, RetrievalScores>
  }
  real_tenders?: RealTenders
  tests?: { summary: string; counts: Record<string, number> }
}

export async function health(): Promise<Health> {
  return request<Health>('/health')
}

export async function benchmark(): Promise<Benchmark> {
  return read<Benchmark>('/api/benchmark')
}

export async function documents(mode: 'company' | 'demo' = 'company'): Promise<Doc[]> {
  const result = await read<{ documents: Doc[] }>(`/api/documents?data_mode=${mode}`)
  return result.documents
}

export async function records(mode: 'company' | 'demo' = 'company'): Promise<RecordItem[]> {
  const result = await read<{ records: RecordItem[] }>(`/api/records?data_mode=${mode}`)
  return result.records
}

export interface StoredTender {
  tender_id: string
  title?: string
  client?: string
  sector?: string
  country?: string
  source?: string
  source_url?: string
  published?: string
  deadline?: string
  estimated_budget?: string
  data_mode?: 'company' | 'demo'
  requirements?: TenderInput['requirements']
  rag_analysis?: Analysis
  decision?: Decision
}

export async function tenders(): Promise<StoredTender[]> {
  const result = await read<{ tenders: StoredTender[] }>('/api/tenders')
  return result.tenders
}

/** One stored tender, or null when the RAG service has none with this ID. */
export async function tender(id: string): Promise<StoredTender | null> {
  try {
    return await request<StoredTender>(`/api/tenders/${encodeURIComponent(id)}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** Deletes one stored tender and its analysis. A tender that is already gone counts as deleted. */
export async function deleteTender(id: string): Promise<void> {
  forget('/api/tenders')
  try {
    await request(`/api/tenders/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err
  }
}

/** Records the bid decision of a tender (a no-bid needs its reason) and returns the stored tender. */
export async function recordDecision(id: string, decision: Decision): Promise<StoredTender> {
  forget('/api/tenders')
  return request<StoredTender>(`/api/tenders/${encodeURIComponent(id)}/decision`, { method: 'PUT', body: JSON.stringify(decision) })
}

/** Removes the bid decision: the tender is back to In review. Returns the stored tender. */
export async function reopenTender(id: string): Promise<StoredTender> {
  forget('/api/tenders')
  return request<StoredTender>(`/api/tenders/${encodeURIComponent(id)}/decision`, { method: 'DELETE' })
}

/** Deletes every stored tender; returns how many the RAG service removed. */
export async function clearTenders(): Promise<number> {
  forget('/api/tenders')
  const result = await request<{ deleted: number }>('/api/tenders', { method: 'DELETE' })
  return result.deleted
}

export interface TenderInput {
  tender_id?: string
  title?: string
  client?: string
  sector?: string
  source?: string
  published?: string
  data_mode: 'company' | 'demo'
  requirements: {
    technical: string[]
    team: string[]
    experience: string[]
    sector?: string
    client?: string
  }
}

export async function analyzeTender(input: TenderInput): Promise<Analysis> {
  forget('/api/tenders')   // the RAG service stores every analysed tender in its inbox
  return request<Analysis>('/retrieve/tender', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export type RecordPayload = {
  type: RecordItem['type']
  title: string
  description: string
  client?: string
  sector?: string
  company_role?: string
  scope?: string
  technologies?: string[]
  delivery_status?: string
  use_cases?: string
  relationship?: string
  country?: string
  year?: number
  outcomes?: string
  budget?: number
  currency?: string
  linked_ids?: string[]
  team_cv_ids?: string[]
  tool_kind?: string
  licence_details?: string
  source?: string
  action: 'draft' | 'index'
}

export type CvProfile = {
  name: string; title: string; seniority: '' | 'junior' | 'mid' | 'senior'; years: number | null
  fields: string[]; roles: string[]; skills: string[]; certifications: string[]; sectors: string[]
  languages: string[]; education: string[]
}
export type CvExtraction = CvProfile & { ok: boolean; error?: string; missing: string[]; sections_found: string[]; years_source: string | null }

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Reads a PDF CV section by section (the RAG's cv_extract.py) to fill the Add CV form. */
export async function extractCv(file: File): Promise<CvExtraction> {
  return request('/api/cvs/extract', { method: 'POST', body: JSON.stringify({ content_base64: await base64Of(file) }) })
}

/** Adds a PDF CV to knowledge-base/cvs with the fields checked in the form; the RAG reindexes in the background (cvStatus). */
export async function addCv(name: string, file: File, profile: Partial<CvProfile> = {}): Promise<{ file: string; status: string }> {
  forget('/api/documents')
  return request('/api/cvs', { method: 'POST', body: JSON.stringify({ name, content_base64: await base64Of(file), profile }) })
}

export async function cvStatus(): Promise<{ status: 'idle' | 'indexing' | 'done' | 'failed'; file: string | null; error: string | null }> {
  return request('/api/cvs/status')
}

export async function saveRecord(payload: RecordPayload): Promise<{ record: RecordItem }> {
  forget('/api/records', '/api/documents')
  return request<{ record: RecordItem }>('/api/records', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateRecord(id: string, payload: RecordPayload): Promise<{ record: RecordItem }> {
  forget('/api/records', '/api/documents')
  return request<{ record: RecordItem }>(`/api/records/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteRecord(id: string, confirmLinks = false): Promise<void> {
  forget('/api/records', '/api/documents')
  await request(`/api/records/${encodeURIComponent(id)}?confirm_links=${confirmLinks}`, { method: 'DELETE' })
}

// ---- OliveSoft pricing (knowledge-base/pricing/pricing.json): the deck's budget slide is priced from it

export type Seniority = 'junior' | 'mid' | 'senior'
// manual: true = entered by hand, never overwritten by "Update prices"; openrouter_id: the model's id in OpenRouter's
// public model list when it is not the default one (rag/pricing.py OPENROUTER_IDS)
export interface CloudItem { label: string; unit: 'hour' | 'gb_month'; price: number; manual?: boolean }
export interface CloudProvider { label: string; region: string; currency: 'EUR' | 'USD'; source: string; date: string; items: Record<string, CloudItem> }
export interface LlmModel { label: string; provider: string; input_per_1m: number; output_per_1m: number; source: string; openrouter_id?: string; manual?: boolean }
export interface Pricing {
  currency: string
  status: string
  last_updated: string
  usd_per_eur: { value: number; date: string; source: string; manual?: boolean }
  workdays_per_week: number
  support_percent_of_build: number
  contingency_percent: number
  margin_percent: number
  day_rates: Record<string, Record<Seniority, number>>
  staffing: Record<string, Seniority>
  default_cloud: string
  hours_per_month: number
  cloud: Record<string, CloudProvider>
  llm: { currency: string; date: string; source?: string; models: Record<string, LlmModel>; default_model: string }
  [key: string]: unknown
}
/** One source of "Update prices" (azure, gcp, fx, llm): the items it updated, the ones it did not find or skipped as
 * manual (both keep their value), the error that stopped it, or a note when it did not run (GCP without its key). */
export interface PriceReport { updated: string[]; missing: string[]; skipped?: string[]; error: string | null; note?: string }

export async function pricing(): Promise<Pricing> {
  return request<Pricing>('/api/pricing')
}

export async function savePricing(p: Pricing): Promise<Pricing> {
  return request<Pricing>('/api/pricing', { method: 'PUT', body: JSON.stringify(p) })
}

export async function refreshPricing(): Promise<{ pricing: Pricing; report: Record<string, PriceReport> }> {
  return request('/api/pricing/refresh', { method: 'POST' })
}
