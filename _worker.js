import { createSession, handleSfs } from './src/sfs.js';

// One Durable Object instance per BlueBox session id => sticky game state.
export class SfsSession {
  constructor(state, env) {
    this.sessions = new Map(); // sessId -> { st, createdAt }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/BlueBox/BlueBox.do' || request.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    let raw = '';
    try {
      const form = await request.formData();
      raw = form.get('sfsHttp') || '';
    } catch (e) {
      return new Response('err01|bad-form', { status: 200 });
    }
    const parts = String(raw).split('|');
    if (parts.length < 3) return new Response('err01|bad-frame', { status: 200 });
    const [sess, cmd, data] = parts;

    if (cmd === 'connect') {
      const id = crypto.randomUUID().replace(/-/g, '');
      this.sessions.set(id, { st: createSession(), createdAt: Date.now() });
      return new Response(`connect|${id}`, { headers: cors() });
    }

    const entry = this.sessions.get(sess);
    if (!entry) return new Response('err01|invalid-session', { status: 200, headers: cors() });
    const st = entry.st;

    if (cmd === 'data') {
      try {
        const bytes = b64dec(data);
        // One DATA may carry multiple framed SFS packets; walk them.
        let off = 0;
        while (off + 3 <= bytes.length) {
          if (!(bytes[off] & 0x80)) break;
          const big = bytes[off] & 0x08;
          const hlen = big ? 5 : 3;
          if (off + hlen > bytes.length) break;
          const dv = new DataView(bytes.buffer, bytes.byteOffset + off + 1, big ? 4 : 2);
          const ln = big ? dv.getUint32(0) : dv.getUint16(0);
          if (off + hlen + ln > bytes.length) break;
          let payload = bytes.slice(off + hlen, off + hlen + ln);
          off += hlen + ln;
          if (bytes[off - hlen - ln - (big ? 4 : 2) - 1] & 0x20) {
            // compressed (zlib) — inflate
            const ds = new DecompressionStream('deflate');
            const w = ds.writable.getWriter();
            w.write(payload); w.close();
            payload = new Uint8Array(await new Response(ds.readable).arrayBuffer());
          }
          try { handleSfs(st, payload); } catch (e) { /* keep session alive */ }
        }
      } catch (e) { /* malformed data: ignore, stay connected */ }
      return new Response('data|null', { headers: cors() });
    }

    if (cmd === 'poll') {
      const next = st.outbox.shift();
      if (!next) return new Response('poll|null', { headers: cors() });
      return new Response('poll|' + b64enc(next), { headers: cors() });
    }

    if (cmd === 'disconnect') {
      this.sessions.delete(sess);
      return new Response('disconnect|null', { headers: cors() });
    }

    return new Response('err01|unknown-cmd', { status: 200, headers: cors() });
  }
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function b64dec(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function b64enc(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    // BlueBox game transport -> sticky session Durable Object.
    if (url.pathname === '/BlueBox/BlueBox.do') {
      let sess = 'lobby';
      try {
        const clone = request.clone();
        const form = await clone.formData();
        const raw = String(form.get('sfsHttp') || '');
        const p = raw.split('|');
        if (p.length >= 2 && p[0] !== 'null' && p[0] !== '') sess = p[0];
      } catch (e) {}
      const id = env.SFS.idFromName(sess);
      return env.SFS.get(id).fetch(request);
    }

    // Balancer — exact shape NetworkBalancerManager + BalancerSettings expects.
    if (url.pathname === '/balance') {
      return Response.json({
        version: {
          cur: '0.1.3.0.835-prod',
          url: `${url.origin}/cdn/config.zip`,
        },
        load: { 'sfthreeds.adiforgottenme.workers.dev:80': 0 },
      }, { headers: cors() });
    }

    if (url.pathname === '/cdn/config.zip') {
      return Response.json(
        { error: 'config.zip not implemented yet — keep balancer cur == 0.1.3.0.835-prod to skip this step' },
        { status: 501, headers: cors }
      );
    }

    if (url.pathname === '/debug') {
      return Response.json({ ok: true, now: new Date().toISOString() }, { headers: cors() });
    }

    if (url.pathname === '/') {
      return new Response('sf3 worker alive. GET /balance for balancer JSON.', { headers: cors() });
    }

    return Response.json({ error: 'not found', path: url.pathname }, { status: 404, headers: cors() });
  },
};
