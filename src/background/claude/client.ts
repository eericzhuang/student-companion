/**
 * Claude Messages API client for parsing degree-requirement catalog pages
 * and unofficial transcripts into structured models. Called from the
 * background service worker with the user's own API key (stored locally, sent
 * only to Anthropic).
 */
import type { DegreeProgram, HistoryCourse } from '../../shared/types';
import { getAllStored, getStored } from '../../shared/storage';
import { BILLING_API_URL, billingEnabled } from '../../shared/billing';
import { DEGREE_SCHEMA } from './schema';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_INPUT_CHARS = 150_000;

// A fast, cheap model for mechanical steps (structuring prose into JSON, parsing
// a transcript). Keeps latency down without hurting quality on rote work.
const FAST_MODEL = 'claude-haiku-4-5';

/**
 * A line appended to research prompts so the model targets the CURRENT catalog
 * instead of a stale year, fetches the live page, and keeps full course numbers.
 * Computed at call time from the system clock.
 */
function currentCatalogHint(): string {
  const year = new Date().getFullYear();
  return `Today's year is ${year}. Use the MOST RECENT catalog/bulletin (the ${year}–${year + 1} edition, or the newest published). Prefer fetching the live official catalog page with the web_fetch tool to confirm current requirements rather than relying on possibly-stale search snippets. Write every course code in the exact catalog form "DEPT NUMBER", keeping the FULL course number — most schools use 4-digit numbers (e.g. "CS 2110", "MATH 4200"); never truncate, round, or drop digits.`;
}

/**
 * Everything the extension knows about the student, as a system-prompt block.
 * Injected into every ADVISORY/RESEARCH AI call (advisor chat, degree research,
 * prereq research) so responses are grounded in their actual school, degrees
 * (including university-wide/distribution requirements), history, and schedule.
 * The mechanical structuring passes (transcript parse, degree-catalog parse)
 * deliberately omit it: they must reflect only the supplied document, and
 * context about the student could bias what gets extracted.
 */
async function studentContext(opts: { lite?: boolean } = {}): Promise<string> {
  const store = await getAllStored();
  const lines: string[] = ['--- What is known about this student (use it; do not ask again) ---'];
  lines.push(`School: ${store.settings.rmpSchool?.name ?? '(not set)'}`);

  const degrees = Object.values(store.degrees);
  if (degrees.length) {
    lines.push('Degree programs pursued (with EVERY requirement group, including university-wide ones):');
    for (const d of degrees) {
      lines.push(`- ${d.name} (${d.type})${d.totalCredits ? ` — ${d.totalCredits} total credits required` : ''}`);
      for (const g of d.groups) {
        const rule =
          g.rule.kind === 'chooseN'
            ? `choose ${g.rule.n ?? 1}`
            : g.rule.kind === 'credits'
              ? `${g.rule.credits ?? '?'} credits`
              : 'all required';
        const courses = g.courses.map((c) => c.code).join(', ') || '(category requirement — no fixed course list)';
        // The student can manually mark a group met/unmet — that verdict is authoritative.
        const manual = store.reqOverrides[`${d.id}::${g.title}`];
        const verdict =
          manual === 'met'
            ? ' — STUDENT CONFIRMED: already satisfied, do not plan for it'
            : manual === 'unmet'
              ? ' — STUDENT CONFIRMED: NOT yet satisfied, must still be planned for'
              : typeof manual === 'object' && manual !== null
                ? ` — STUDENT CONFIRMED: ${manual.done} of these already completed`
                : '';
        lines.push(`  • ${g.title} [${rule}]: ${courses}${g.notes ? ` — NOTE: ${g.notes}` : ''}${verdict}`);
      }
    }
  } else {
    lines.push('Degree programs pursued: (none imported yet)');
  }

  // Lite mode: the caller supplies its own history/schedule summary — don't pay
  // input tokens for the same lists twice.
  if (opts.lite) return lines.join('\n');

  const hist = store.academicHistory?.courses ?? [];
  if (hist.length) {
    const done = hist.filter((c) => c.status === 'completed').map((c) => `${c.code}${c.grade ? ` (${c.grade})` : ''}`);
    const inProg = hist.filter((c) => c.status === 'in-progress').map((c) => c.code);
    lines.push(`Completed courses: ${done.join(', ') || '(none)'}`);
    if (inProg.length) lines.push(`Currently taking: ${inProg.join(', ')}`);
  }
  const sched = store.schedule?.sections ?? [];
  if (sched.length) {
    lines.push(`Saved schedule${store.schedule?.termLabel ? ` (${store.schedule.termLabel})` : ''}: ${sched.map((s) => s.courseCode).join(', ')}`);
  }
  if (store.settings.terms.length) {
    lines.push(`Upcoming terms configured: ${store.settings.terms.map((t) => `${t.label} (cap ${t.creditCap}cr)`).join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * Keep the MV3 service worker alive during a long AI request. Without this the
 * worker can be terminated mid-request, closing the message port ("the message
 * channel closed before a response was received"). A cheap periodic API call
 * resets the idle timer.
 */
function startKeepAlive(): () => void {
  const id = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
    } catch {
      /* noop */
    }
  }, 20_000);
  return () => clearInterval(id);
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  cache_control?: { type: 'ephemeral' };
}
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}
interface ClaudeResponse {
  content: ContentBlock[];
  stop_reason: string;
}

/** Latest server tools (dynamic-filtering variants for Sonnet 5 / Opus 4.8). */
const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };
const WEB_FETCH_TOOL = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 };
/** Basic variants accepted by older models — the last rungs of the fallback
 *  ladder, so web access never disappears just because the user picked an
 *  older model or their key lacks the newest tool versions. */
const LEGACY_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
const LEGACY_FETCH_TOOL = { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5 };
/** Tools for catalog research: search to find pages, fetch to read them live. */
const RESEARCH_TOOLS = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];
/** Cheaper caps for the per-turn advisor chat — every search result is billed
 *  as input tokens, so casual chat turns shouldn't fan out like deep research. */
const ADVISOR_TOOLS = [
  { ...WEB_SEARCH_TOOL, max_uses: 3 },
  { ...WEB_FETCH_TOOL, max_uses: 2 },
];

/** True when an API error looks like "this key/model doesn't have that tool".
 *  Deliberately requires the error to actually reference tools — a generic 400
 *  (e.g. over-long input) must throw immediately, not walk the ladder and mask
 *  the real cause behind 4 extra paid calls. */
function isToolUnsupportedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // The API names the offending tool type ("web_search_20260209", "tools.0.type…");
  // nothing else in our requests would put those words in an error message.
  if (/web_(search|fetch)/i.test(msg)) return true;
  return /tools?[^a-z]*[\s\S]{0,80}?(not.*(support|enabl|allow)|unsupported|unknown|invalid|does not match)/i.test(msg);
}

/**
 * Run `exec` with the first toolset the API accepts, walking a ladder from the
 * newest tools down to the legacy web_search. Web access is a paid (Pro/Supreme)
 * feature, so it must ALWAYS be available: only tool-unsupported errors advance
 * the ladder — real errors (network, auth, credits) are thrown immediately.
 */
async function withWebToolFallback(
  toolsets: unknown[][],
  exec: (tools: unknown[]) => Promise<ClaudeResponse>,
): Promise<ClaudeResponse> {
  let lastErr: unknown;
  for (const tools of toolsets) {
    try {
      return await exec(tools);
    } catch (e) {
      if (!isToolUnsupportedError(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Low-level Anthropic Messages call. Injects auth/model, and transparently
 * resumes the server-side tool loop when a web search yields stop_reason
 * "pause_turn". Returns the final response.
 */
async function anthropicMessages(body: {
  system: string;
  messages: ClaudeMessage[];
  tools?: unknown[];
  output_config?: unknown;
  thinking?: unknown;
  tooLongMsg: string;
  /** override the configured model (e.g. a fast model for mechanical steps) */
  model?: string;
  /** product feature this call serves — the relay uses it for tier checks */
  feature?: string;
}): Promise<ClaudeResponse> {
  const settings = await getStored('settings');
  // Billing live → every AI call goes through OUR relay on the subscription's
  // activation code; users never hold an API key. Billing off (beta/dev) →
  // legacy direct call with the locally configured key.
  const viaRelay = billingEnabled();
  // Trim to defend against a value pasted with stray whitespace/newlines, which
  // makes fetch construct an invalid header and fail.
  const apiKey = settings.claudeApiKey?.trim();
  const licenseToken = settings.licenseToken?.trim();
  if (viaRelay && !licenseToken) {
    throw new Error("Your subscription isn't activated yet — open the Upgrade page and paste your activation code.");
  }
  if (!viaRelay && !apiKey) {
    throw new Error('No Claude API key configured. Add one in the extension options.');
  }
  const model = body.model || settings.claudeModel || 'claude-sonnet-5';
  const stopKeepAlive = startKeepAlive();

  try {
  let messages = body.messages;
  for (let round = 0; round < 6; round++) {
    const payload = {
      model,
      max_tokens: 16000,
      // System as a cache-marked block: multi-turn chats and multi-round tool
      // loops then re-read the (large) student context at ~10% of input price.
      system: [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }],
      ...(body.tools ? { tools: body.tools } : {}),
      ...(body.output_config ? { output_config: body.output_config } : {}),
      ...(body.thinking ? { thinking: body.thinking } : {}),
      messages,
    };
    let res: Response;
    try {
      res = viaRelay
        ? await fetch(`${BILLING_API_URL}/ai/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${licenseToken}`,
            },
            body: JSON.stringify({ feature: body.feature ?? 'chat', request: payload }),
          })
        : await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey as string,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(payload),
          });
    } catch (netErr) {
      // fetch() rejects with a TypeError ("Failed to fetch") only for network-level
      // failures — never for HTTP error statuses. Turn it into something actionable.
      console.warn('[wd-companion] Claude API network error', netErr);
      const detail = netErr instanceof Error ? netErr.message : String(netErr);
      throw new Error(
        viaRelay
          ? `Couldn't reach the AI service (network error: ${detail}). Check your connection and try again in a minute.`
          : `Couldn't reach api.anthropic.com (network error: ${detail}). Use "Test AI connection" in Options to diagnose. Common causes: a firewall / VPN / ad-blocker / antivirus web-shield blocking api.anthropic.com, or a school network that filters it — try another network or a phone hotspot once to confirm.`,
      );
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = (await res.json()) as { error?: { message?: string } };
        if (err.error?.message) detail = err.error.message;
      } catch {
        // keep HTTP status
      }
      if (res.status === 401) {
        detail = viaRelay
          ? detail // the relay already words 401s for users ("subscription not active…")
          : 'Invalid API key. Check it in the extension options.';
      }
      // Relay 402 (budget) / 403 (tier) / 429 (rate) messages are user-ready.
      throw new Error(viaRelay ? detail : `Claude API error: ${detail}`);
    }

    const resp = (await res.json()) as ClaudeResponse;
    if (resp.stop_reason === 'max_tokens') throw new Error(body.tooLongMsg);
    // Server tool (web search) paused mid-loop — append and resume.
    if (resp.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: resp.content }];
      continue;
    }
    return resp;
  }
  throw new Error('The request took too many rounds — try a narrower query.');
  } finally {
    stopKeepAlive();
  }
}

/** Shared structured-output call. Returns the parsed JSON text block. */
async function callClaudeJson(
  system: string,
  userContent: string,
  schema: object,
  tooLongMsg: string,
  model?: string,
  feature?: string,
): Promise<unknown> {
  const truncated =
    userContent.length > MAX_INPUT_CHARS ? userContent.slice(0, MAX_INPUT_CHARS) : userContent;
  const resp = await anthropicMessages({
    system,
    messages: [{ role: 'user', content: truncated }],
    output_config: { format: { type: 'json_schema', schema } },
    tooLongMsg,
    model,
    feature,
  });
  const textBlock = resp.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Claude returned no parseable content.');
  return JSON.parse(textBlock.text);
}

const SYSTEM_PROMPT = `You convert university degree-requirement catalog text into structured JSON.

Rules:
- Normalize every course code to "DEPT NUMBER" form, keeping the FULL course number as printed (most schools use 4-digit numbers, e.g. "CS 2110", "MATH 1920"); never truncate or drop digits. Strip section numbers.
- Each requirement heading becomes one group. Infer the rule:
  - "all": every course in the group is required.
  - "chooseN": text like "choose two of the following" or "select 3 courses" (set n).
  - "credits": text like "12 credits from the following" (set credits).
- Include prerequisites in prereqCodes ONLY when the text explicitly states them.
- When a requirement can be met by an alternative ("X or Y", "or equivalent", an AP/IB/transfer equivalent), list those alternative course codes in the course's equivalents array; otherwise use an empty array.
- Put GPA minimums, grade requirements, residency rules, and other non-course constraints in the group's notes field.
- If the page contains multiple programs, extract only the primary/most prominent one.
- Ignore navigation menus, footers, and unrelated page furniture.`;

export async function parseDegreeText(pageText: string): Promise<DegreeProgram> {
  return (await callClaudeJson(
    SYSTEM_PROMPT,
    `Parse the following degree-requirements page into the structured format:\n\n${pageText}`,
    DEGREE_SCHEMA,
    'Catalog page too long — the parse was cut off. Try pasting only the requirements section.',
    undefined,
    'degree-parse',
  )) as DegreeProgram;
}

const TRANSCRIPT_SYSTEM = `You convert a university unofficial transcript into structured JSON.

Rules:
- Normalize every course code to "DEPT NUMBER" form (e.g. "CS 2110").
- status: "completed" if a final letter/passing grade is present; "in-progress" if the course is currently enrolled / registered / has no grade yet; "withdrawn" for W.
- Keep the grade exactly as shown (e.g. "A-", "B+", "P", "W"); null if none.
- term: the academic term the course was taken, e.g. "Fall 2024", if determinable.
- credits: numeric credit/unit value if shown, else null.
- Include transfer/AP credit courses if listed with a grade or "TR".
- Ignore GPA summary lines, headers, and totals.`;

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['courses'],
  properties: {
    courses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'title', 'credits', 'grade', 'term', 'status'],
        properties: {
          code: { type: 'string' },
          title: { type: ['string', 'null'] },
          credits: { type: ['number', 'null'] },
          grade: { type: ['string', 'null'] },
          term: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['completed', 'in-progress', 'withdrawn', 'unknown'] },
        },
      },
    },
  },
} as const;

export async function parseTranscriptWithClaude(text: string): Promise<HistoryCourse[]> {
  const result = (await callClaudeJson(
    TRANSCRIPT_SYSTEM,
    `Parse this unofficial transcript into structured courses:\n\n${text}`,
    TRANSCRIPT_SCHEMA,
    'Transcript too long — the parse was cut off. Try uploading one term at a time.',
    FAST_MODEL,
    'transcript-parse',
  )) as { courses: HistoryCourse[] };
  return result.courses;
}

// ---------- Connection test ----------

export interface AiTestResult {
  ok: boolean;
  detail: string;
}

/**
 * Minimal end-to-end check of key + network, on the cheapest model with a
 * one-token answer. Returns a precise, user-readable verdict either way.
 */
export async function testAiConnection(): Promise<AiTestResult> {
  const settings = await getStored('settings');

  // Billing live: test the relay with the activation code (no user key exists).
  if (billingEnabled()) {
    const token = settings.licenseToken?.trim();
    if (!token) {
      return { ok: false, detail: 'Activate your subscription first (Upgrade page → paste your activation code), then test again.' };
    }
    try {
      const res = await fetch(`${BILLING_API_URL}/ai/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          feature: 'chat',
          request: { model: FAST_MODEL, max_tokens: 4, messages: [{ role: 'user', content: 'Say "ok".' }] },
        }),
      });
      if (res.ok) return { ok: true, detail: '✓ Connected — your subscription is active and AI is ready. No API key needed.' };
      let msg = `HTTP ${res.status}`;
      try {
        const err = (await res.json()) as { error?: { message?: string } };
        if (err.error?.message) msg = err.error.message;
      } catch { /* keep status */ }
      return { ok: false, detail: msg };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: `Couldn't reach the AI service (${detail}). Check your connection and try again.` };
    }
  }

  const apiKey = settings.claudeApiKey?.trim();
  if (!apiKey) return { ok: false, detail: 'No API key saved yet — paste one above and Save first.' };
  if (!apiKey.startsWith('sk-ant-')) {
    return { ok: false, detail: 'That doesn\'t look like an Anthropic API key (they start with "sk-ant-"). Get one at console.anthropic.com → API keys.' };
  }
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: FAST_MODEL,
        max_tokens: 4,
        messages: [{ role: 'user', content: 'Say "ok".' }],
      }),
    });
    if (res.ok) return { ok: true, detail: '✓ Connected — key works and api.anthropic.com is reachable.' };
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) msg = `${msg}: ${err.error.message}`;
    } catch { /* keep status */ }
    if (res.status === 401) msg = 'Your API key was rejected (401). Re-copy it from console.anthropic.com — no spaces or line breaks.';
    if (res.status === 403) msg = 'Access denied (403) — the key may be disabled or your workspace restricted.';
    if (res.status === 429) msg = 'Rate/credit limit hit (429) — check your plan & billing at console.anthropic.com.';
    return { ok: false, detail: msg };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      detail: `Network-level failure (${detail}) — the request never reached Anthropic. The extension itself is fine (this same check works elsewhere), so something between you and api.anthropic.com is blocking it: firewall, VPN, ad-blocker, antivirus web-shield, or a school/work network filter. Try once on a phone hotspot to confirm, and whitelist api.anthropic.com wherever you can.`,
    };
  }
}

// ---------- Chattable semester advisor (Pro flagship) ----------

const ADVISOR_SYSTEM = `You are an experienced, friendly academic advisor for a university student. You help them plan upcoming terms and answer questions about their saved schedule and degree progress.

You are given a summary of what they've completed, what they're taking now, courses saved for an upcoming term, their remaining requirements across every degree (with prerequisites), and their configured future terms with credit caps.

Guidance:
- Only recommend courses whose prerequisites are met (completed or in progress). Never place a course before its prereqs.
- Prefer courses that satisfy MULTIPLE requirements, unblock future courses, or are offered infrequently. Respect each term's credit cap and aim for a balanced load.
- Many programs also require credits across distribution/breadth areas (writing, quantitative, arts & humanities, social sciences, physical/biological sciences, etc.). Use web search to find the student's school and program distribution/general-education requirements, and use web_fetch to open the official catalog/bulletin page and verify specifics — cite the source. Only say something couldn't be verified after actually trying both tools.
- Be economical with tools: answer from the provided student data whenever it suffices, and only search/fetch when the question genuinely needs external facts you don't have.
- Be specific, warm, and concise. When recommending courses, give a one-line reason each. Flag risks (heavy load, prereq gaps, bottlenecks) and practical tips.
- Answer the student's follow-up questions directly and update recommendations based on their concerns and preferences.
- Format replies in short paragraphs and bullet lists. Do not invent professor ratings or requirements you didn't verify.`;

export interface AdvisorReply {
  text: string;
  thinking: string;
}

/**
 * One turn of the advisor chat. `context` (the student's situation) is folded
 * into the system prompt; `messages` is the running conversation. Extended
 * thinking is enabled (summarized) and web search is available so the model can
 * look up distribution/breadth requirements.
 */
export async function chatAdvisor(
  context: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AdvisorReply> {
  // lite: `context` (the planner summary) already covers history/schedule.
  const system = `${ADVISOR_SYSTEM}\n\n${await studentContext({ lite: true })}\n\n--- The student's current situation (planner summary) ---\n${context}`;
  // Cache breakpoint on the last message: the next turn re-reads this whole
  // conversation prefix from cache instead of paying full input price again.
  const cachedMessages: ClaudeMessage[] = messages.map((m, i) =>
    i === messages.length - 1
      ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
      : { role: m.role, content: m.content },
  );
  const base = {
    system,
    messages: cachedMessages,
    thinking: { type: 'adaptive', display: 'summarized' },
    tooLongMsg: 'This conversation got too long — start a new advisor chat.',
  };
  // Search AND live page fetch, so the advisor can verify catalog specifics
  // itself instead of replying "not verified due to tool limitations". The
  // ladder ends at legacy web_search so web access always survives.
  const resp = await withWebToolFallback(
    [
      ADVISOR_TOOLS,
      [{ ...WEB_SEARCH_TOOL, max_uses: 3 }],
      [{ ...LEGACY_SEARCH_TOOL, max_uses: 3 }, { ...LEGACY_FETCH_TOOL, max_uses: 2 }],
      [{ ...LEGACY_SEARCH_TOOL, max_uses: 3 }],
    ],
    (tools) => anthropicMessages({ ...base, tools, feature: 'chat' }),
  );
  const text = resp.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim();
  const thinking = resp.content
    .filter((b) => b.type === 'thinking' && b.thinking)
    .map((b) => b.thinking)
    .join('\n')
    .trim();
  return { text: text || '(no reply)', thinking };
}

// ---------- Degree research (Pro): find requirements via web search ----------
//
// NOTE: web search and forced JSON output (output_config) can't be combined in
// ONE call — forcing the JSON format prevents the model from actually running
// the search tool, so it emits an empty/hallucinated structure. We therefore do
// it in TWO steps: (1) search the web and write findings as prose, then
// (2) convert that prose into the schema with no tools.

const RESEARCH_SYSTEM = `You are a university academic-catalog researcher. Given a school and a program name, use web search to find EVERYTHING a student must complete to GRADUATE with that program, and write it up as a thorough plain-text report (NOT JSON).

Graduation requirements almost always live in more than one place. Research and include ALL of these, not just the major:
1. The major/program requirements (core courses, electives, concentrations) from the department's catalog page.
2. College/school-wide requirements that also gate graduation even though they're run by other departments or offices — e.g. general-education / distribution / breadth requirements, a first-year writing or composition requirement, a foreign-language requirement, quantitative-reasoning, physical-education, first-year-seminar, ethics/diversity, and any senior capstone or thesis.
3. University-wide rules: total credit minimum, residency credits, minimum GPA, and any upper-division-credit minimum.

Do multiple searches: search the program page, then separately search "<school> general education requirements", "<school> distribution requirements", and the university bulletin's graduation-requirements page. Don't stop at the major.

Write your findings as a clear outline: one section per requirement area, each listing the exact course codes (as "DEPT NUMBER"), the rule (all required / choose N / earn N credits), any stated prerequisites and "X or Y / AP equivalent" alternatives, and the total credits and GPA minimums. Note the source pages. If you cannot find a section, say so explicitly. Do not fabricate courses.`;

const DEGREE_STRUCTURE_SYSTEM = `You convert a researched university degree-requirements report into structured JSON.

Rules:
- Normalize every course code to "DEPT NUMBER" form, keeping the FULL course number as printed (most schools use 4-digit numbers, e.g. "CS 2110"); never truncate or drop digits.
- Make ONE group per requirement area. Give major groups clear titles ("Core Courses", "CS Electives") AND include separate groups for college/university requirements ("Distribution: Arts & Humanities", "First-Year Writing", "Foreign Language", "University: Total Credits").
- Set each group's rule: "all" (every listed course required), "chooseN" (pick n; set n), or "credits" (earn N credits; set credits).
- Record stated prerequisites in each course's prereqCodes, and "X or Y / or equivalent / AP credit" alternatives in equivalents.
- When a requirement is a category rather than a fixed course list (e.g. "3 credits of any arts & humanities course"), create the group, use "credits" or "chooseN", leave courses empty if none are named, and describe the category in notes.
- Put GPA minimums, residency, credit totals, and other non-course constraints in the relevant group's notes.
- Set totalCredits to the university's stated minimum for the degree.
- Base the JSON only on the report; do not invent courses not mentioned in it.`;

/**
 * Run a web-research turn. Prefers search + live page fetch for freshness, but
 * transparently retries with search only if this API key doesn't have web_fetch,
 * so research never hard-fails just because the newer tool isn't enabled.
 */
async function webResearchCall(
  system: string,
  userMessage: string,
  tooLongMsg: string,
  feature: string,
): Promise<ClaudeResponse> {
  // Ground the research in what we know about the student (school, degrees,
  // history) so results match their institution and catalog conventions.
  system = `${system}\n\n${await studentContext()}`;
  const messages: ClaudeMessage[] = [{ role: 'user', content: userMessage }];
  const finalSystem = system;
  return withWebToolFallback(
    [RESEARCH_TOOLS, [WEB_SEARCH_TOOL], [LEGACY_SEARCH_TOOL, LEGACY_FETCH_TOOL], [LEGACY_SEARCH_TOOL]],
    (tools) => anthropicMessages({ system: finalSystem, messages, tools, tooLongMsg, feature }),
  );
}

export async function researchDegreeRequirements(
  school: string,
  program: string,
): Promise<DegreeProgram> {
  // Step 1 — search the web and gather findings as prose (no forced format).
  const searchResp = await webResearchCall(
    `${RESEARCH_SYSTEM}\n\n${currentCatalogHint()}`,
    `Research ALL graduation requirements for "${program}" at "${school}" — the major requirements AND the college/university-wide requirements (general education / distribution / breadth, writing, language, total credits, GPA). Search the official catalog and the general-education/graduation-requirements pages, then write your complete findings.`,
    'The research response was cut off — try a more specific program name.',
    'degree-research',
  );
  const findings = searchResp.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (findings.length < 80) {
    throw new Error(
      `Couldn't find enough about "${program}" at "${school}" online. Check the spelling, try the official program name, or paste the catalog URL instead.`,
    );
  }

  // Step 2 — convert the prose findings into the schema (fast model, no tools).
  const degree = (await callClaudeJson(
    DEGREE_STRUCTURE_SYSTEM,
    `Convert this researched requirements report for "${program}" at "${school}" into the structured format:\n\n${findings}`,
    DEGREE_SCHEMA,
    'The structured result was cut off — try a more specific program name.',
    FAST_MODEL,
    'degree-research',
  )) as DegreeProgram;

  if (!degree.groups || degree.groups.length === 0) {
    throw new Error(
      `The research didn't return usable requirements for "${program}" at "${school}". Try the official program name or paste the catalog URL instead.`,
    );
  }
  if (!degree.name || degree.name.trim().length < 3) degree.name = program;
  return degree;
}

// ---------- Prerequisite research (Pro): find a course's prereqs via web search ----------

const PREREQ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prereqs', 'equivalents', 'note'],
  properties: {
    prereqs: {
      type: 'array',
      items: { type: 'string' },
      description: 'Course codes that must be completed before this course, normalized "DEPT NUMBER". Empty if none/unknown.',
    },
    equivalents: {
      type: 'array',
      items: { type: 'string' },
      description: 'Alternative course codes that also satisfy this course (e.g. "X or Y", AP/transfer credit). Empty if none.',
    },
    note: {
      type: ['string', 'null'],
      description: 'Brief human-readable summary of the prerequisite rule, or what could not be verified.',
    },
  },
} as const;

const PREREQ_RESEARCH_SYSTEM = `You research a single university course's prerequisites. Given a school and a course code, use web search to find that course in the school's official catalog and write up what its prerequisites are (in prose, NOT JSON).

Rules:
- Search the school's official catalog/course-listing for the exact course. Prefer the current catalog year.
- If the CURRENT year's information isn't published or findable, fall back to the MOST RECENT published information you can find — and state clearly which catalog year/edition it came from, warning that course codes or names may since have changed.
- If you can't find the course in ANY year, say so plainly and report nothing.
- Report only DIRECT prerequisites (courses required immediately before), as "DEPT NUMBER". Do not expand the full chain.
- Treat "X or Y" alternatives and "or equivalent / AP credit" as equivalents, not separate prereqs.
- If a corequisite or "recommended" course is not a hard prerequisite, say so.
- Note the source page. Never fabricate prerequisites.`;

const PREREQ_STRUCTURE_SYSTEM = `You convert a researched course-prerequisite report into structured JSON, following the schema exactly. Only include courses actually stated in the report; if it found none, return empty arrays and explain in note. If the report says the information came from an older catalog year, the note MUST start with "⚠ From the <year> catalog (latest published):" so the student knows codes/names may have changed.`;

export interface PrereqResearch {
  prereqs: string[];
  equivalents: string[];
  note: string | null;
}

export async function researchPrerequisites(
  school: string,
  course: string,
): Promise<PrereqResearch> {
  // Step 1 — search the web and report findings as prose (no forced format).
  const searchResp = await webResearchCall(
    `${PREREQ_RESEARCH_SYSTEM}\n\n${currentCatalogHint()}`,
    `What are the prerequisites for "${course}" at "${school}"? Search the official catalog and report what you find.`,
    'The research response was cut off — try again.',
    'prereq-research',
  );
  const findings = searchResp.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!findings) {
    return { prereqs: [], equivalents: [], note: `Couldn't find "${course}" at "${school}" online.` };
  }

  // Step 2 — convert the prose findings into the schema (fast model, no tools).
  return (await callClaudeJson(
    PREREQ_STRUCTURE_SYSTEM,
    `Convert this prerequisite report for "${course}" at "${school}" into the structured format:\n\n${findings}`,
    PREREQ_SCHEMA,
    'The structured result was cut off — try again.',
    FAST_MODEL,
    'prereq-research',
  )) as PrereqResearch;
}

// ---------- Campus-map research (Pro+): building coordinates via web search ----------

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['buildings'],
  properties: {
    buildings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'lat', 'lng'],
        properties: {
          name: { type: 'string', description: 'Building name exactly as given in the request' },
          lat: { type: 'number' },
          lng: { type: 'number' },
        },
      },
    },
  },
} as const;

const MAP_RESEARCH_SYSTEM = `You are a campus-geography researcher. Given campus building names and a school, find each building's precise latitude and longitude using the school's official campus map, OpenStreetMap, or other reliable sources. Coordinates must be of the building itself (not the town center). Skip buildings you cannot locate confidently — wrong coordinates are worse than none.`;

export interface BuildingCoords {
  name: string;
  lat: number;
  lng: number;
}

export async function researchBuildingCoords(
  school: string,
  buildings: string[],
): Promise<BuildingCoords[]> {
  const searchResp = await webResearchCall(
    MAP_RESEARCH_SYSTEM,
    `Find the latitude/longitude of these buildings at "${school}":\n${buildings
      .map((b) => `- ${b}`)
      .join('\n')}\nReport each building with its coordinates.`,
    'The research response was cut off — try fewer buildings at once.',
    'map-research',
  );
  const findings = searchResp.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!findings) return [];

  const result = (await callClaudeJson(
    'Extract building coordinates from the research report into the structured format. Only include buildings whose coordinates the report states; use the building names exactly as they appear in the request list.',
    `Request list:\n${buildings.map((b) => `- ${b}`).join('\n')}\n\nReport:\n${findings}`,
    MAP_SCHEMA,
    'The structured result was cut off — try fewer buildings at once.',
    FAST_MODEL,
    'map-research',
  )) as { buildings: BuildingCoords[] };
  // Guard against junk coordinates before they poison the map.
  return result.buildings.filter(
    (b) => Number.isFinite(b.lat) && Number.isFinite(b.lng) && Math.abs(b.lat) <= 90 && Math.abs(b.lng) <= 180,
  );
}
