/**
 * Pro flagship: a chattable AI academic advisor. It's seeded with the student's
 * situation (remaining requirements, prerequisites, saved schedule, terms) and
 * you can ask follow-up questions about your schedule. It shows the AI's
 * thinking and can web-search distribution/breadth requirements. Free users see
 * an upgrade prompt.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReqOverrideValue, StoredDegree, TermConfig } from '../shared/types';
import { sendToBackground, type ChatResult } from '../background/messages';
import { buildSchedulingPlan } from './engine/plan';
import { evaluateDegree, normalizeCode, scopeReqOverrides, type CourseStates } from './engine/requirements';
import { aiLaneFullMessage, aiLaneOpen, enterAiLane, leaveAiLane } from './aiLock';

interface Props {
  degrees: StoredDegree[];
  states: CourseStates;
  terms: TermConfig[];
  prereqOverrides: Record<string, string[]>;
  courseEquivalents: Record<string, string[]>;
  reqOverrides: Record<string, ReqOverrideValue>;
  isPro: boolean;
  /** Supreme gets the priority AI lane: several concurrent requests. */
  isSupreme: boolean;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
}

// Module-level so the chat survives switching planner tabs (the component
// unmounts, but the conversation and any in-flight reply must not be lost).
const threadSignal = signal<ChatTurn[]>([]);
const busySignal = signal(false);
const errorSignal = signal<string | null>(null);

function buildContext(props: Props): string {
  const plan = buildSchedulingPlan(props.degrees, props.states, props.prereqOverrides, props.courseEquivalents, props.reqOverrides);
  const lines: string[] = [];
  lines.push(`Completed courses: ${[...props.states.completed].join(', ') || '(none recorded)'}`);
  lines.push(`Currently in progress: ${[...props.states.inProgress].join(', ') || '(none)'}`);
  lines.push(`Saved for an upcoming term: ${[...props.states.planned].join(', ') || '(none)'}`);
  lines.push(
    `Upcoming terms (credit caps): ${
      props.terms.map((t) => `${t.label} (cap ${t.creditCap})`).join('; ') || '(none configured)'
    }`,
  );
  lines.push('Degrees pursued:');
  for (const d of props.degrees) lines.push(`- ${d.name} (${d.type})`);
  lines.push('Courses still required (prereqs when known):');
  for (const c of plan.required) {
    const pre = c.prereqCodes.length ? ` [needs: ${c.prereqCodes.join(', ')}]` : '';
    const multi = (plan.requirementCount.get(normalizeCode(c.code)) ?? 1) > 1 ? ' (multi-requirement)' : '';
    lines.push(`- ${c.code}${c.title ? ` — ${c.title}` : ''}${pre}${multi}`);
  }
  for (const e of plan.electives) {
    lines.push(`Elective: ${e.degreeName} · ${e.groupTitle}: choose ${e.needed} from ${[...e.picked, ...e.options].map((c) => c.code).join(', ')}`);
  }
  // Category/credit requirements (distribution, breadth, other-department credits)
  // have no fixed course list, so they'd otherwise vanish from planning. Always
  // restate the unmet ones so every reply keeps them in mind.
  const catLines: string[] = [];
  for (const d of props.degrees) {
    for (const g of evaluateDegree(d, props.states, props.courseEquivalents, scopeReqOverrides(props.reqOverrides, d.id)).groups) {
      if (!g.satisfied && (g.group.courses.length === 0 || g.group.notes)) {
        const rule =
          g.group.rule.kind === 'credits'
            ? `${g.group.rule.credits ?? '?'} credits`
            : g.group.rule.kind === 'chooseN'
              ? `choose ${g.group.rule.n ?? 1}`
              : 'required';
        catLines.push(
          `- [${d.name}] ${g.group.title} (${rule}; progress ${g.progress}/${g.required})${g.group.notes ? ` — ${g.group.notes}` : ''}`,
        );
      }
    }
  }
  if (catLines.length) {
    lines.push(
      'UNMET category/credit requirements (no fixed course list — ALWAYS factor these into any plan or answer, and suggest concrete courses that satisfy them when possible):',
      ...catLines,
    );
  }
  return lines.join('\n');
}

export function AiAdvisor(props: Props) {
  const thread = threadSignal.value;
  const busy = busySignal.value;
  const error = errorSignal.value;
  const [input, setInput] = useState('');
  const [openThinking, setOpenThinking] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [thread, busy]);

  if (!props.isPro) {
    return (
      <div class="pl-card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div style={{ fontSize: '40px' }}>✨</div>
        <h2>AI Advisor (chat)</h2>
        <p class="pl-muted" style={{ maxWidth: '540px', margin: '0 auto 14px' }}>
          Chat with an AI that knows your whole situation — completed courses, remaining
          requirements across every degree, prerequisites, and your saved schedule. It plans your
          next term, answers follow-ups, shows its thinking, and looks up your school's
          distribution requirements. This is a <b>Pro</b> feature.
        </p>
        <button class="pl-btn" onClick={() => void sendToBackground({ kind: 'OPEN_SUBSCRIBE' })}>
          ✨ Upgrade to Pro
        </button>
      </div>
    );
  }

  const send = async (text: string) => {
    if (busySignal.value) return;
    if (!aiLaneOpen(props.isSupreme)) {
      errorSignal.value = aiLaneFullMessage(props.isSupreme);
      return;
    }
    const userTurn: ChatTurn = { role: 'user', content: text };
    const nextThread = [...threadSignal.value, userTurn];
    threadSignal.value = nextThread;
    setInput('');
    busySignal.value = true;
    enterAiLane();
    errorSignal.value = null;
    try {
      const res = await sendToBackground<ChatResult>({
        kind: 'AI_CHAT',
        context: buildContext(props),
        messages: nextThread.map((t) => ({ role: t.role, content: t.content })),
      });
      // Write to the module signal (not component state) so the reply lands even
      // if the user switched tabs and this component unmounted mid-request.
      threadSignal.value = [
        ...threadSignal.value,
        { role: 'assistant', content: res.text, thinking: res.thinking },
      ];
    } catch (err) {
      errorSignal.value = err instanceof Error ? err.message : String(err);
    } finally {
      busySignal.value = false;
      leaveAiLane();
    }
  };

  const resetChat = () => {
    threadSignal.value = [];
    errorSignal.value = null;
    setOpenThinking(null);
  };

  return (
    <div class="pl-card" style={{ display: 'flex', flexDirection: 'column', height: '70vh' }}>
      <div class="pl-row">
        <h2>✨ AI Advisor</h2>
        <span class="pl-muted">
          {busy
            ? '💭 Thinking… you can switch tabs — it keeps working and the reply will be here.'
            : 'Ask about your schedule, or plan your next term.'}
        </span>
        {thread.length > 0 && (
          <button class="pl-btn secondary" onClick={resetChat} disabled={busy} title="Start a new conversation">
            New chat
          </button>
        )}
      </div>

      <div ref={scrollRef} class="pl-chat">
        {thread.length === 0 && (
          <div class="pl-chat-empty">
            <p class="pl-muted">Try one of these, or type your own question:</p>
            {[
              'Plan my next semester.',
              'Can I graduate in two more years?',
              'Which remaining courses are the biggest bottlenecks?',
              'What distribution/breadth requirements am I missing?',
            ].map((s) => (
              <button
                class="pl-btn secondary"
                style={{ display: 'block', margin: '6px 0', textAlign: 'left' }}
                disabled={busy || !aiLaneOpen(props.isSupreme)}
                onClick={() => void send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {thread.map((turn, i) => (
          <div class={`pl-chat-turn ${turn.role}`}>
            {turn.role === 'assistant' && turn.thinking ? (
              <button
                class="pl-chat-thinking-toggle"
                onClick={() => setOpenThinking(openThinking === i ? null : i)}
              >
                🧠 {openThinking === i ? 'Hide thinking' : 'Show thinking'}
              </button>
            ) : null}
            {openThinking === i && turn.thinking && (
              <div class="pl-chat-thinking">{turn.thinking}</div>
            )}
            <div class="pl-chat-bubble">{renderMarkish(turn.content)}</div>
          </div>
        ))}
        {busy && (
          <div class="pl-chat-turn assistant">
            <div class="pl-chat-bubble">
              <span class="pl-typing" title="The advisor is thinking">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
      </div>

      {error && <div class="pl-error">{error}</div>}

      <div class="pl-row" style={{ marginTop: '8px' }}>
        <input
          type="text"
          placeholder={!aiLaneOpen(props.isSupreme) && !busy ? 'The AI lane is full — one moment…' : 'Ask the advisor…'}
          value={input}
          disabled={busy || !aiLaneOpen(props.isSupreme)}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && input.trim() && void send(input.trim())}
        />
        <button class="pl-btn" disabled={busy || !aiLaneOpen(props.isSupreme) || !input.trim()} onClick={() => void send(input.trim())}>
          Send
        </button>
      </div>
      <p class="pl-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
        AI guidance — verify against your official degree audit before registering.
      </p>
    </div>
  );
}

/** Minimal markdown-ish rendering: **bold**, bullet lines, and line breaks. */
function renderMarkish(text: string) {
  return text.split('\n').map((line) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    const content = line.replace(/^\s*[-*]\s+/, '');
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p) =>
      p.startsWith('**') && p.endsWith('**') ? <b>{p.slice(2, -2)}</b> : p,
    );
    return <div style={bullet ? { paddingLeft: '14px', textIndent: '-10px' } : {}}>{bullet ? '• ' : ''}{parts}</div>;
  });
}
