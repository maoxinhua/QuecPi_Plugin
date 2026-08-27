/**
 * DeepSeek Harness session bridge: lets the chat talk to a RUNNING harness
 * session (the agent itself) instead of a bare model.
 *  - session.list / session.prompt / session.history (POST /api/*)
 *  - events.mux (GET /api/events.mux, SSE) → assistant text + tool activity
 */

export interface HarnessSession {
  sessionId: string;
  title?: string;
  cwd?: string;
  running: boolean;
  blank: boolean;
  agentPreset?: string;
  updatedAt?: number;
}

export interface MuxCallbacks {
  onTextDelta: (text: string) => void;
  onToolCall: (name: string, args: string) => void;
  onToolResult: (name: string) => void;
  onTurnEnd: () => void;
  onError: (msg: string) => void;
}

async function rpc<T>(baseUrl: string, method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/${method}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `quecpi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method,
      payload,
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`harness ${method} HTTP ${resp.status}`);
  const data = (await resp.json()) as any;
  const r = data?.result;
  if (!r || !r.ok) throw new Error(`harness ${method} failed: ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
  return r.value as T;
}

export async function listSessions(baseUrl: string): Promise<HarnessSession[]> {
  const v = await rpc<{ items: HarnessSession[] }>(baseUrl, 'session.list', {});
  return v.items;
}

export async function promptSession(baseUrl: string, sessionId: string, text: string): Promise<void> {
  await rpc(baseUrl, 'session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
    clientTimeZone: 'Asia/Shanghai',
  });
}

export interface HistoryMsg {
  role: 'user' | 'assistant';
  content: string;
}

function extractText(blocks: any[]): string {
  return (blocks ?? [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

export async function sessionHistory(baseUrl: string, sessionId: string, maxMessages = 60): Promise<HistoryMsg[]> {
  const v = await rpc<{ events: { event: any }[] }>(baseUrl, 'session.history', { sessionId, maxMessages });
  const out: HistoryMsg[] = [];
  for (const e of v.events) {
    const ev = e?.event;
    if (!ev) continue;
    const data = ev.data ?? {};
    if (ev.type === 'user/message') {
      const t = extractText(data.content ?? data.message?.content ?? []);
      if (t.trim()) out.push({ role: 'user', content: t });
    } else if (ev.type === 'assistant/message') {
      const t = extractText(data.message?.content ?? data.content ?? []);
      if (t.trim()) out.push({ role: 'assistant', content: t });
    }
  }
  return out;
}

function dispatchEvent(ev: any, cb: MuxCallbacks) {
  const data = ev?.data ?? {};
  switch (ev?.type) {
    case 'assistant/chunk': {
      const c = data.chunk;
      if (c?.type === 'text-delta' && typeof c.text === 'string') cb.onTextDelta(c.text);
      break;
    }
    case 'tool/call':
      cb.onToolCall(data.name ?? 'tool', data.arguments ?? '');
      break;
    case 'tool/result':
      cb.onToolResult(data.name ?? 'tool');
      break;
    case 'turn/end':
      cb.onTurnEnd();
      break;
  }
}

/**
 * Opens the aggregated SSE mux stream once and dispatches this session's
 * events to cb. Long-lived; returns an AbortController the caller can abort.
 */
export function openMux(baseUrl: string, sessionId: string, cb: MuxCallbacks): AbortController {
  const ac = new AbortController();
  const url = `${baseUrl.replace(/\/+$/, '')}/api/events.mux`;
  (async () => {
    let resp: Response;
    try {
      resp = await fetch(url, { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
    } catch (e: any) {
      if (e?.name !== 'AbortError') cb.onError(`events.mux 连接失败: ${e?.message ?? e}`);
      return;
    }
    if (!resp.ok || !resp.body) {
      cb.onError(`events.mux HTTP ${resp.status}`);
      return;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payloadStr = line.slice(6).trim();
          if (!payloadStr) continue;
          let frame: any;
          try {
            frame = JSON.parse(payloadStr);
          } catch {
            continue;
          }
          const p = frame?.payload;
          if (!p) continue;
          if (frame.method === 'session/event' && p.sessionId === sessionId) {
            dispatchEvent(p.event, cb);
          } else if (frame.method === 'stream/error') {
            cb.onError(p.error?.message ?? 'stream error');
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') cb.onError(`events.mux 流中断: ${e?.message ?? e}`);
    }
  })();
  return ac;
}
