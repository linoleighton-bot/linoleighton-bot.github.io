/*
 * Shared by the creator dashboard and the admin dashboard: the Supabase
 * client, sign-in, and the small rendering helpers both pages use.
 *
 * Everything shown is built with `h()`, which only ever sets text and
 * attributes. Creator names, handles and video titles are other people's
 * input and are never parsed as HTML.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-creators]');
  /* Local preview only: try another accent colour (set by /phone-preview.html). Ignored on the real site. */
  try { const pick = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem('mindroll.preview.accent'); if (root && pick) root.style.setProperty('--mr-accent', pick); } catch { /* storage blocked */ }
  if (!root) return;

  /*
   * `?demo` shows sample data. On a local preview server the plain address
   * shows the dashboards as they look before anyone has joined, because there
   * is no backend to sign in to; add `?live` there to use the real one.
   */
  const params = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const empty = local && !params.has('demo') && !params.has('live');
  const demo = params.has('demo') || empty;
  const loadEmpty = () =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `/assets/creators/empty-preview.js?${Date.now()}`;
      script.onload = () => resolve(window.mindrollCreatorsEmpty);
      script.onerror = () => reject(new Error('The preview data is missing.'));
      document.head.append(script);
    });
  const url = root.dataset.supabaseUrl;
  const key = root.dataset.supabaseKey;

  const client =
    !demo && url && key && window.supabase
      ? window.supabase.createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      : null;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (name === 'class') el.className = value;
      else if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
      else el.setAttribute(name, value === true ? '' : value);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const money = (cents) =>
    (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const compact = (n) =>
    Number(n || 0).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const pct = (rate) => `${Math.round(Number(rate) * 1000) / 10}%`;
  const day = (iso) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  /** Only ever link out to https. */
  const safeUrl = (value) => (/^https:\/\//i.test(String(value || '')) ? String(value) : null);

  const PLATFORM = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };

  let toastTimer;
  function toast(message, kind = 'ok') {
    let el = document.querySelector('.cp-toast');
    if (!el) el = document.body.appendChild(h('div', { class: 'cp-toast', role: 'status' }));
    el.textContent = message;
    el.dataset.kind = kind;
    el.dataset.show = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => delete el.dataset.show, 4200);
  }

  /** Call one of the creator edge functions as the signed-in user. */
  async function fn(name, body) {
    if (demo) throw new Error('This is a preview, so actions are switched off.');
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Please sign in again.');
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Something went wrong (${res.status}).`);
    return out;
  }

  /** A database function. Throws with a readable message rather than returning an error. */
  async function rpc(name, args) {
    if (demo) throw new Error('This is a preview, so actions are switched off.');
    const { data, error } = await client.rpc(name, args || {});
    if (error) throw new Error(error.message);
    return data;
  }

  /** Runs a button's action with the button disabled, and says what went wrong. */
  function act(button, work) {
    return async (event) => {
      event?.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      try {
        await work();
      } catch (error) {
        toast(error.message || 'Something went wrong.', 'error');
      } finally {
        button.disabled = false;
      }
    };
  }

  /**
   * A button that asks twice before doing something that moves money or cannot
   * be taken back. No browser dialogs: the button itself becomes the question.
   */
  function confirmButton(label, confirmLabel, cls, work) {
    const button = h('button', { class: cls, type: 'button' }, label);
    let armed = false;
    let timer;
    button.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        button.textContent = confirmLabel;
        button.dataset.armed = '';
        timer = setTimeout(reset, 5000);
        return;
      }
      clearTimeout(timer);
      await act(button, work)();
      reset();
    });
    function reset() {
      armed = false;
      button.textContent = label;
      delete button.dataset.armed;
    }
    return button;
  }

  /* ---------------------------------------------------------------- sign-in */

  const PROVIDER_ICON = {
    apple:
      '<path fill="currentColor" d="M16.2 12.6c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7c-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.5 2 1-.1 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2.1-.8-2.1-3z"/><path fill="currentColor" d="M14.4 6.6c.5-.7.9-1.6.8-2.6-.8 0-1.8.5-2.4 1.2-.5.6-1 1.6-.8 2.5.9.1 1.8-.4 2.4-1.1z"/>',
    google:
      '<path fill="#4285F4" d="M20 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.5a3.9 3.9 0 0 1-1.7 2.5v2.1h2.8A8.2 8.2 0 0 0 20 12.2z"/><path fill="#34A853" d="M12 20.5c2.3 0 4.2-.8 5.6-2.1l-2.8-2.1a5 5 0 0 1-7.4-2.6H4.5v2.2A8.5 8.5 0 0 0 12 20.5z"/><path fill="#FBBC05" d="M7.4 13.7a5 5 0 0 1 0-3.2V8.3H4.5a8.5 8.5 0 0 0 0 7.6z"/><path fill="#EA4335" d="M12 7.4c1.3 0 2.4.4 3.3 1.3l2.5-2.5A8.5 8.5 0 0 0 4.5 8.3l2.9 2.2A5 5 0 0 1 12 7.4z"/>',
  };

  function providerButton(provider, label, status) {
    const button = h('button', { class: 'provider', type: 'button' });
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'ic');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = PROVIDER_ICON[provider]; /* a constant above, not user input */
    button.append(icon, h('span', {}, label));
    button.addEventListener(
      'click',
      act(button, async () => {
        if (!client) throw new Error('Sign-in is not available on this page.');
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${location.origin}${location.pathname}` },
        });
        if (error) status(error.message);
      }),
    );
    return button;
  }

  /** The same sign-in the account page offers: Apple, Google, or email. */
  function signInPanel({ title, lead, oauthOnly = false }) {
    const statusEl = h('p', { class: 'auth-status', hidden: true });
    const status = (message, kind = 'error') => {
      statusEl.textContent = message || '';
      statusEl.dataset.kind = kind;
      statusEl.hidden = !message;
    };

    const failure = window.mindrollOAuth?.readFailure?.();
    if (failure) {
      status(failure.message);
      window.mindrollOAuth.clean();
    }

    const email = h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true });
    const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: '8' });
    const signIn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Sign in');
    const create = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Create account');

    const submit = (mode, button) =>
      act(button, async () => {
        if (!client) throw new Error('Sign-in is not available on this page.');
        if (!email.value || password.value.length < 8) {
          status('Enter your email and a password of at least 8 characters.');
          return;
        }
        status('');
        const creds = { email: email.value.trim(), password: password.value };
        const { data, error } =
          mode === 'sign-up'
            ? await client.auth.signUp({ ...creds, options: { emailRedirectTo: `${location.origin}${location.pathname}` } })
            : await client.auth.signInWithPassword(creds);
        if (error) status(error.message);
        else if (mode === 'sign-up' && !data.session) status('Check your email to confirm your address, then come back here.', 'ok');
      });

    const form = h(
      'form',
      { class: 'auth-form cp-emailform', novalidate: true, hidden: true },
      h('label', { class: 'auth-field' }, h('span', {}, 'Email'), email),
      h('label', { class: 'auth-field' }, h('span', {}, 'Password'), password),
      h('div', { class: 'auth-actions' }, signIn, create),
    );
    form.addEventListener('submit', submit('sign-in', signIn));
    create.addEventListener('click', submit('sign-up', create));

    const toggle = h('button', { class: 'signin__email', type: 'button', 'aria-expanded': 'false' }, 'Use email instead');
    toggle.addEventListener('click', () => {
      form.hidden = !form.hidden;
      toggle.setAttribute('aria-expanded', String(!form.hidden));
    });

    return h(
      'div',
      { class: 'cp-signin signin' },
      h('h2', { class: 'signin__title' }, title),
      h('p', { class: 'signin__lead' }, lead),
      statusEl,
      h('div', { class: 'signin__providers' }, providerButton('apple', 'Continue with Apple', status), providerButton('google', 'Continue with Google', status)),
      oauthOnly ? null : toggle,
      oauthOnly ? null : form,
      h('p', { class: 'signin__legal' }, 'By continuing you agree to our ', h('a', { href: '/terms' }, 'Terms'), ' and ', h('a', { href: '/privacy' }, 'Privacy Policy'), '.'),
    );
  }

  /* ----------------------------------------------------------- small pieces */

  const pill = (text, tone) => h('span', { class: 'cp-pill', 'data-tone': tone || 'muted' }, text);

  const STATUS_TONE = { active: 'good', approved: 'good', paid: 'good', pending: 'warn', paused: 'muted', rejected: 'bad', failed: 'bad' };
  const statusPill = (status) => pill(status.charAt(0).toUpperCase() + status.slice(1), STATUS_TONE[status]);

  const tile = (label, value, note, tone) =>
    h('div', { class: 'cp-tile', 'data-tone': tone }, h('p', { class: 'cp-tile__label' }, label), h('p', { class: 'cp-tile__value' }, value), note && h('p', { class: 'cp-tile__note' }, note));

  /** A table that scrolls sideways on a phone instead of breaking the page. */
  function table(columns, rows, empty) {
    if (!rows.length) return h('p', { class: 'cp-empty' }, empty);
    return h(
      'div',
      { class: 'cp-tablewrap' },
      h(
        'table',
        { class: 'cp-table' },
        h('thead', {}, h('tr', {}, columns.map((col) => h('th', { class: col.num && 'is-num', scope: 'col' }, col.label)))),
        h('tbody', {}, rows.map((row) => h('tr', {}, columns.map((col) => (() => { const v = col.cell(row); return h('td', { class: col.num && 'is-num', 'data-label': col.label, 'data-empty': v == null || v === '' || null }, v); })())))),
      ),
    );
  }

  const section = (title, aside, ...body) =>
    h('section', { class: 'cp-card' }, h('div', { class: 'cp-card__head' }, h('h2', {}, title), aside), body);


  /* ----------------------------------------------------------------- charts */

  /*
   * Three colours do every job on both dashboards, and they always mean the
   * same thing: blue is money already paid (or kept), clay is money ready now,
   * amber is money still on its way. Checked for colour-blind separation; amber
   * is pale against white, so it never appears without a label or legend.
   */
  const COLOR = { paid: '#2A78A6', ready: '#B4552D', wait: '#D9A441' };

  const SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs || {})) if (value != null) el.setAttribute(name, value);
    el.append(...kids.filter(Boolean));
    return el;
  }

  /* One tooltip for the page. Rows are [value, label]; the value leads. */
  let tipEl;
  function showTip(x, y, rows) {
    if (!tipEl) tipEl = document.body.appendChild(h('div', { class: 'cp-tip', role: 'tooltip' }));
    tipEl.replaceChildren(...rows.map(([value, label]) => h('div', {}, h('b', {}, value), label ? h('span', {}, label) : null)));
    tipEl.dataset.show = '';
    const box = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, x - box.width / 2))}px`;
    tipEl.style.top = `${y - box.height - 12 < 8 ? y + 16 : y - box.height - 12}px`;
  }
  const hideTip = () => tipEl && delete tipEl.dataset.show;

  /** Gives any mark a tooltip on hover and on keyboard focus. */
  function tip(el, rows) {
    el.addEventListener('pointermove', (event) => showTip(event.clientX, event.clientY, rows));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', () => {
      const box = el.getBoundingClientRect();
      showTip(box.left + box.width / 2, box.top, rows);
    });
    el.addEventListener('blur', hideTip);
    return el;
  }

  /**
   * One whole split into a few parts: a single bar, each part its own block.
   * parts: [{ label, value, color, dark }]. `dark` puts dark text on a pale block.
   */
  function segbar(parts, fmt) {
    const live = parts.filter((part) => part.value > 0);
    const total = live.reduce((sum, part) => sum + part.value, 0);
    if (!total) return h('div', { class: 'cp-seg cp-seg--empty' });
    const legend = h('ul', { class: 'cp-legend' });
    const bar = h('div', { class: 'cp-seg', role: 'img', 'aria-label': live.map((part) => `${part.label} ${fmt(part.value)}`).join(', ') });
    for (const part of live) {
      const share = part.value / total;
      const text = h('span', {}, fmt(part.value));
      const block = tip(h('div', { class: 'cp-seg__part', tabindex: '0', style: `flex:${part.value} 1 0;background:${part.color};color:${part.dark ? '#171A1F' : '#fff'}` }, text), [[fmt(part.value), part.label], [`${Math.round(share * 100)}%`, 'of the total']]);
      const value = h('b', { hidden: true }, fmt(part.value));
      legend.append(h('li', {}, h('i', { style: `background:${part.color}` }), part.label, value));
      bar.append(block);
      /* A figure that does not fit its block moves to the legend, never clipped. */
      requestAnimationFrame(() => {
        if (text.offsetWidth + 16 > block.clientWidth) {
          text.hidden = true;
          value.hidden = false;
        }
      });
    }
    return h('div', { class: 'cp-segwrap' }, bar, legend);
  }

  /** Ranked bars on one baseline. rows: [{ label, value, note }]. */
  function hbars(rows, fmt, color = COLOR.ready) {
    const max = Math.max(1, ...rows.map((row) => row.value));
    return h(
      'div',
      { class: 'cp-hbars' },
      rows.map((row) =>
        tip(
          h(
            'div',
            { class: 'cp-hbars__row', tabindex: '0' },
            h('span', { class: 'cp-hbars__label' }, row.label),
            h('span', { class: 'cp-hbars__track' }, h('i', { style: `width:${Math.max(0.6, (row.value / max) * 100).toFixed(2)}%;background:${row.color || color}` }), h('b', {}, fmt(row.value))),
          ),
          [[fmt(row.value), row.label], ...(row.note ? [[row.note, '']] : [])],
        ),
      ),
    );
  }

  /* Round axis steps: 1, 2 or 5 times a power of ten. */
  function ticks(max) {
    const rough = Math.max(1, max) / 3;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((value) => value >= rough);
    const out = [];
    for (let value = 0; value < max + step; value += step) out.push(value);
    return out;
  }

  /**
   * A plot over time. kind 'line' (one series, area wash, crosshair) or
   * 'columns' (one bar per period). points: [{ label, value }].
   */
  function timeChart(kind, points, fmt, name, tickFmt = fmt, color = COLOR.ready) {
    /* Drawn narrower on a phone, so the axis labels stay readable once scaled to the screen. */
    const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
    const W = phone ? 340 : 600, H = phone ? 190 : 210, L = phone ? 40 : 46, R = 12, T = 10, B = 26;
    const axis = ticks(Math.max(...points.map((p) => p.value)));
    /* Nothing earned yet: keep a scale so the baseline still draws. */
    const top = axis[axis.length - 1] || 1;
    const slot = (W - L - R) / (kind === 'line' ? Math.max(1, points.length - 1) : points.length);
    const x = (i) => L + (kind === 'line' ? i * slot : (i + 0.5) * slot);
    const y = (value) => T + (1 - value / top) * (H - T - B);
    const short = (value) => tickFmt(value).replace(/\.00$/, '');

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cp-plot', role: 'img', tabindex: '0', 'aria-label': `${name}: ${points.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')}` });
    for (const value of axis) {
      svg.append(s('line', { x1: L, x2: W - R, y1: y(value), y2: y(value), class: 'cp-plot__grid' }), s('text', { x: L - 8, y: y(value) + 4, class: 'cp-plot__tick', 'text-anchor': 'end' }, document.createTextNode(short(value))));
    }
    svg.append(
      s('text', { x: L, y: H - 6, class: 'cp-plot__tick' }, document.createTextNode(points[0].label)),
      s('text', { x: W - R, y: H - 6, class: 'cp-plot__tick', 'text-anchor': 'end' }, document.createTextNode(points[points.length - 1].label)),
    );

    const marks = [];
    if (kind === 'line') {
      const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
      svg.append(
        s('path', { d: `${path}L${x(points.length - 1)} ${y(0)}L${x(0)} ${y(0)}Z`, fill: color, opacity: '0.1' }),
        s('path', { d: path, fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      );
    } else {
      const bw = Math.min(24, slot - 2);
      points.forEach((p, i) => {
        const bh = p.value > 0 ? Math.max(2, y(0) - y(p.value)) : 0;
        const r = Math.min(4, bh);
        const x0 = x(i) - bw / 2;
        const bar = s('path', { d: `M${x0} ${y(0)}V${y(0) - bh + r}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${y(0)}Z`, fill: color });
        marks.push(bar);
        svg.append(bar);
      });
    }

    /* The pointer only has to be nearest a period, never on the mark itself. */
    const hair = s('line', { y1: T, y2: y(0), class: 'cp-plot__hair', visibility: 'hidden' });
    const dot = s('circle', { r: '5', fill: color, stroke: '#fff', 'stroke-width': '2', visibility: kind === 'line' ? 'visible' : 'hidden', cx: x(points.length - 1), cy: y(points[points.length - 1].value) });
    svg.append(hair, dot);
    let at = -1;
    const focus = (i) => {
      at = Math.max(0, Math.min(points.length - 1, i));
      const box = svg.getBoundingClientRect();
      const px = box.left + (x(at) / W) * box.width;
      const py = box.top + (y(points[at].value) / H) * box.height;
      if (kind === 'line') {
        hair.setAttribute('x1', x(at));
        hair.setAttribute('x2', x(at));
        hair.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', x(at));
        dot.setAttribute('cy', y(points[at].value));
      }
      marks.forEach((mark, i) => mark.setAttribute('opacity', i === at ? '1' : '0.45'));
      showTip(px, py, [[fmt(points[at].value), points[at].label]]);
    };
    const rest = () => {
      at = -1;
      hair.setAttribute('visibility', 'hidden');
      dot.setAttribute('cx', x(points.length - 1));
      dot.setAttribute('cy', y(points[points.length - 1].value));
      marks.forEach((mark) => mark.setAttribute('opacity', '1'));
      hideTip();
    };
    svg.addEventListener('pointermove', (event) => {
      const box = svg.getBoundingClientRect();
      const vx = ((event.clientX - box.left) / box.width) * W;
      focus(kind === 'line' ? Math.round((vx - L) / slot) : Math.floor((vx - L) / slot));
    });
    svg.addEventListener('pointerleave', rest);
    svg.addEventListener('blur', rest);
    svg.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') focus(at < 0 ? 0 : at + 1);
      else if (event.key === 'ArrowLeft') focus(at < 0 ? points.length - 1 : at - 1);
      else return;
      event.preventDefault();
    });
    return svg;
  }

  /**
   * A climb through a set of thresholds: one segment per step, filled as the
   * value gets there, ticked when reached. Used for view milestones, tiers and
   * the monthly posting bonuses.
   * steps: [{ at, label, tip: [value, label] }]; `unit` names what is counted.
   */
  function ladder(value, steps, { live = true, unit = '', count = num } = {}) {
    if (!steps.length) return null;
    let floor = 0;
    return h(
      'div',
      { class: 'cp-miles', 'data-off': !live || null, role: 'img', 'aria-label': `${count(value)} ${unit}. ${steps.filter((step) => value >= step.at).length} of ${steps.length} reached.` },
      steps.map((step) => {
        const fill = Math.max(0, Math.min(1, (value - floor) / Math.max(1, step.at - floor)));
        floor = step.at;
        const reached = value >= step.at;
        return tip(
          h('div', { class: 'cp-miles__step', tabindex: '0', 'data-done': reached || null }, h('span', { class: 'cp-miles__track' }, h('i', { style: `width:${(fill * 100).toFixed(1)}%` })), h('span', { class: 'cp-miles__label' }, `${reached ? '✓ ' : ''}${step.label}`)),
          [step.tip, [reached ? 'Reached' : `${count(Math.max(0, step.at - value))} ${unit} to go`, '']],
        );
      }),
    );
  }

  const dollars = (cents) => money(cents).replace(/\.00$/, '');

  /** A video's climb through the view milestones. */
  const milestones = (views, rules, live = true) =>
    ladder(views, rules.map((rule) => ({ at: rule.threshold_views, label: dollars(rule.amount_cents), tip: [money(rule.amount_cents), `at ${num(rule.threshold_views)} views`] })), { live, unit: 'views' });

  /** The four kinds of bonus, in the order every chart lists them. */
  const KINDS = [['views', 'View bonuses'], ['active', 'Active creator'], ['volume', 'Posting volume'], ['rank_up', 'Rank-up'], ['prize', 'Tier campaign prizes'], ['contest', 'Campaign wins'], ['top_video', 'Top videos'], ['referral', 'Creator referrals'], ['iron_views', 'Views pay (Iron)'], ['iron_volume', 'Posting volume (Iron)'], ['first_sale', 'First-sale bonus'], ['first_video', 'First video boost'], ['first_top', 'Race to the podium'], ['daily', 'Champion pay'], ['manual', 'One-off']];

  /** The detail tables, folded away until somebody wants them. */
  const fold = (label, ...body) => h('details', { class: 'cp-fold' }, h('summary', {}, label), ...body);

  /** A card that leads with one figure. */
  const figure = (label, value, hero) => h('div', { class: 'cp-figure' }, h('p', { class: 'cp-figure__label' }, label), h('p', { class: hero ? 'cp-figure__value cp-figure__value--hero' : 'cp-figure__value' }, value));


  /*
   * The UGC brief as it ships. The admin edits a copy of this in the database
   * (Admin > UGC Brief); this one is what shows until the first publish, and in
   * previews.
   */
  const defaultBrief = {
    title: 'MindRoll UGC Brief',
    lead: 'Guidance for creators making MindRoll videos: what to make, what to say, and what to include.',
    examples: {
      title: 'The type of content we are looking for',
      note: 'These are not UGC videos we made. They are our competitors\' videos, and this content style is what we think will perform best. Subtly integrate MindRoll into videos like these.',
      allUrl: 'https://drive.google.com/drive/folders/1FOp2VS4h6rT0o3l4FbsqBD0CEsxBJek8',
      items: [
        { image: 'brief/ex1.jpg', title: 'How To Be Good At Anything', note: 'Numbered tips, skill grid behind the creator', url: 'https://drive.google.com/file/d/1CxdJJRo3I92R2EOk0QPzImPHi2XzgxpF/view' },
        { image: 'brief/ex2.jpg', title: 'How to become The Mentalist', note: 'Pop-culture character hook, stills cut in', url: 'https://drive.google.com/file/d/1dzMHwkOloNlEYkDVdL6bVmsAMs0WwzRz/view' },
        { image: 'brief/ex3.jpg', title: '10/10 habits to become disgustingly overeducated', note: 'Rated listicle, photo strip on top', url: 'https://drive.google.com/file/d/1DB6k2j0dSHKcKYeR3gDYUTX673bAQmcu/view' },
        { image: 'brief/ex4.jpg', title: 'Fast talking head, movie stills', note: 'Captions under the face, high energy', url: 'https://drive.google.com/file/d/19x0W8iJ7yv5va4R7AEXMNSu8sOyILrDq/view' },
        { image: 'brief/ex5.jpg', title: '10/10 things every man should do', note: 'Rated listicle, character stills under the face', url: 'https://drive.google.com/file/d/1GfmEPs7LBXA2MrtYokegtRC1UHsxoHv6/view' },
        { image: 'brief/ex6.jpg', title: 'Five apps every man must have on his phone', note: 'App list, icons under the face. MindRoll is one of the five.', url: 'https://drive.google.com/file/d/14-Wwa_5kfrOdnQBcbxR0OS4g-Q7CDVbu/view' },
        { image: 'brief/ex7.jpg', title: '10/10 highest ROI skills that cost you nothing', note: 'Rated listicle, big title on top', url: 'https://drive.google.com/file/d/1ENkCYdvmyWGx_nT7RqDPZ0O8RTcBoXZp/view' },
        { image: 'brief/ex8.jpg', title: 'How to shift', note: 'Talking head, concept images under the face', url: 'https://drive.google.com/file/d/1KJCEIKeG8FullFlHhGvJBDKHrpukV4Vy/view' },
        { image: 'brief/ex9.jpg', title: 'The highest form of...', note: 'Close-up talking head, captions only', url: 'https://drive.google.com/file/d/1zxb-5h_LvtgrmRfamPVqouQfwV0u_Xfv/view' },
      ],
    },
    ctas: {
      title: 'Use something similar to these',
      note: 'Drop it in naturally, the way the examples mention their app. Say the name MindRoll.',
      listUrl: 'https://docs.google.com/document/d/1txrugBaecNOUzhjMN2iRuoZCG6He0285X_4ULGbiWhc/edit',
      items: [
        'Read books about a topic that interests you. I use this method that has all of the world\'s best books, but summarized for you with the most valuable information, so I have the knowledge of all the books in way less time.',
        'Reading books takes way too much time, so I\'ve been using apps like MindRoll so I just scan any book and scroll through key point summaries in the book, allowing you to read way more books in way less time.',
        'This method which helped me, which gives me bite sized ideas from actual books instead of brain rotting content. It makes you dangerously smart instead of doomscrolling all day.',
        'By using apps like MindRoll, which allows you to scan any book cover, it allows you to scroll through the key ideas and key point summaries, allowing you to read multiple books insanely fast.',
        'I use a method that gives me bite sized ideas from actual books, instead of scrolling and filling my brain with bullshit on TikTok, so now I\'m absorbing the greatest ideas from the top books out there.',
      ],
    },
    assets: {
      title: 'Everything is in our Google Drive',
      items: [
        { title: 'MindRoll Assets folder', note: 'App Store image, screen recording, app clips', url: 'https://drive.google.com/drive/folders/1SRvBU9OLonephUFqgxaEmeLVz4yR_D3K', lead: true },
        { title: 'App screen recording', note: 'Use this where the examples show their app', url: 'https://drive.google.com/file/d/16bNkPkCzN5pxGTYzn7oOTp_2sbYTgeFB/view' },
        { title: 'Logo files', note: 'PNG and SVG', url: 'https://drive.google.com/drive/folders/1jHU1XAuTSqGYT-zeRTqvZq_obSc5nVo2' },
        { title: 'MindRoll on the App Store', note: 'Link for your bio', url: 'https://apps.apple.com/us/app/mindroll-get-smarter-daily/id6810303765' },
      ],
    },
    must: {
      title: 'Include this image in every video',
      text: 'This is our App Store screenshot with our logo. Show it in every creative so people know what to search for.',
      image: 'brief/appstore-listing.jpg',
      url: 'https://drive.google.com/file/d/1rK54XQt2V9c19_it0f0H1ms9-JghLQll/view',
      linkLabel: 'Download the image (IMG_2819.PNG)',
    },
    tips: {
      title: 'How viewers get from your video to your link',
      why: 'To get more conversions, getting to the website has to be as seamless as possible for the viewer. Every extra step loses people, so set up each platform like this.',
      tiktok: {
        title: 'Put your commission link in your bio',
        text: 'Use either one: your **commission link** itself in your bio, or a **Linktree** in your bio with your commission link inside it.',
      },
      instagram: {
        title: 'Say "Comment the word ___"',
        text: 'End the video with a line like: "Comment **app** and I\'ll send it to you." A viewer who is interested doesn\'t have to leave their doomscroll. They just comment the word.',
        words: ['app', 'web', 'mind', 'book'],
        after: 'Then DM your commission link to everyone who comments. That is how the sale gets credited to you.',
      },
      manychat: {
        text: 'Later on we will set up ManyChat on your account, so those DMs send themselves.',
        link: 'Requirements are listed here',
      },
      items: [
        'You don\'t have to do this. But if you skip it you will miss out on a lot of extra money, and sales that came from your video won\'t be credited to you.',
      ],
    },
    closing: '**You have freedom.** If you think another format or different CTAs will perform better for your audience, do that. This is guidance on what we think will perform best, not a script.',
    questions: 'Questions: teammindroll@gmail.com. Send us the post link the same day you post.',
  };

  /** Text with **bold** in it, as nodes. Nothing else is interpreted. */
  const rich = (text) => String(text || '').split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? h('b', {}, part.slice(2, -2)) : part));

  /** Where a brief image lives: shipped with the site, uploaded by an admin, or a full address. */
  const briefImage = (src) => {
    if (!src) return null;
    if (src.startsWith('brief/')) return `/assets/creators/${src}`;
    if (src.startsWith('upload:')) return url ? `${url}/storage/v1/object/public/creator-briefs/${src.slice(7).split('/').map(encodeURIComponent).join('/')}` : null;
    return safeUrl(src);
  };

  /* Pinned videos first, in the order they were placed. */
  /*
   * The "how viewers get to your link" part of a brief. A brief saved before
   * that part had its own fields gets the built-in one, whole.
   */
  const briefTips = (brief) => (brief?.tips && brief.tips.why !== undefined ? brief.tips : defaultBrief.tips);

  const briefVideos = (brief) => { const items = brief?.examples?.items || []; return [...items.filter((v) => v.pinned), ...items.filter((v) => !v.pinned)]; };


  /*
   * Live updates. `tick` runs every `every` ms while the tab is in view, and at
   * once when it comes back into view. A page that is mid-way through something
   * (typing, a confirm waiting, a pop-up open, a form filled in but not sent) is
   * not redrawn under the person: it gets a "New activity" button instead.
   */
  let typedSince = false;
  root.addEventListener('input', () => { typedSince = true; });
  const live = {
    start(tick, every = 20000) {
      let running = false;
      const run = async () => {
        if (running || document.visibilityState !== 'visible') return;
        running = true;
        try { await tick(); } catch { /* try again next round */ }
        running = false;
      };
      const timer = setInterval(run, every);
      const onShow = () => { if (document.visibilityState === 'visible') run(); };
      document.addEventListener('visibilitychange', onShow);
      window.addEventListener('focus', onShow);
      return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); live.offer(null); };
    },
    /** True while a redraw would interrupt someone. */
    busy() {
      const a = document.activeElement;
      return typedSince || !!(a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!document.querySelector('.mr-modal, [data-armed], [aria-busy="true"]');
    },
    /** Call after every full redraw: whatever was typed is gone or sent. */
    drawn() { typedSince = false; live.offer(null); },
    /** Shows (or with null, removes) the button that applies waiting changes. */
    offer(apply) {
      document.querySelector('.mr-fresh')?.remove();
      if (!apply) return;
      document.body.append(h('button', { class: 'mr-fresh', type: 'button', onclick: () => { typedSince = false; apply(); } }, 'New activity. Tap to update'));
    },
  };


  /*
   * A creator shown as a person: picture (or their initials on their rank's
   * colour), name, and the accounts they post from. Used everywhere a creator
   * appears, so nobody has to read an email address to know who it is.
   */
  const RANK_TONES = ['iron', 'iron', 'silver', 'gold', 'platinum', 'diamond'];
  const cleanHandle = (v) => String(v || '').trim().replace(/^@/, '');
  const handleLinks = (c) => {
    const one = (platform, handle) => (handle ? h('a', { class: 'mr-handle', 'data-platform': platform, href: platform === 'tiktok' ? `https://www.tiktok.com/@${encodeURIComponent(handle)}` : `https://www.instagram.com/${encodeURIComponent(handle)}/`, target: '_blank', rel: 'noopener noreferrer', title: platform === 'tiktok' ? 'TikTok' : 'Instagram', onclick: (e) => e.stopPropagation() }, h('i', { 'aria-hidden': 'true' }, platform === 'tiktok' ? 'TT' : 'IG'), `@${handle}`) : null);
    const out = [one('tiktok', cleanHandle(c.tiktok)), one('instagram', cleanHandle(c.instagram))].filter(Boolean);
    return out.length ? out : [h('span', { class: 'mr-handle', 'data-missing': '' }, 'No account linked')];
  };
  const avatar = (c, size) => {
    const name = String(c.display_name || c.name || '?').trim();
    const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
    const tone = c.champion ? 'champion' : RANK_TONES[Number(c.tier_level ?? c.incentives?.tier_level ?? 1)] || 'iron';
    const src = safeUrl(c.avatar_url);
    const el = h('span', { class: 'mr-avatar', 'data-rank': tone, 'data-size': size || null, 'aria-hidden': 'true' }, src ? h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : initials);
    if (src) el.querySelector('img').addEventListener('error', () => { el.textContent = initials; });
    return el;
  };
  const person = (c, o = {}) => h('span', { class: 'mr-person', 'data-size': o.size || null }, avatar(c, o.size), h('span', { class: 'mr-person__text' }, h('span', { class: 'mr-person__name' }, h('b', {}, c.display_name || c.name), o.badge || null), h('span', { class: 'mr-person__handles' }, handleLinks(c))));

  /* A manager's team: the numbers across it, what the manager's pay comes to, and each creator as a profile row. */
  function teamView(team, o = {}) {
    const t = team.totals || {};
    const pay = team.pay || {};
    const tierName = (c) => (c.champion ? 'Champion' : ((team.tiers || []).find((x) => x.level === c.tier_level) || {}).name || 'Iron');
    const tile = (tone, label, value, foot) => h('div', { class: 'mr-tile', 'data-tone': tone }, h('span', { class: 'mr-tile__label' }, label), h('b', { class: 'mr-tile__value' }, value), foot ? h('span', { class: 'mr-tile__foot' }, foot) : null);
    const dollars0 = (cents) => `$${Math.round(Number(cents || 0) / 100).toLocaleString('en-US')}`;
    const signed = (cents) => (Number(cents) < 0 ? `−${dollars0(-cents)}` : dollars0(cents));
    const share = (rate) => `${Math.round(Number(rate || 0) * 1000) / 10}%`;
    const cut = Number(pay.cut_rate ?? team.manager?.cut_rate ?? 0);
    const activity = (c) => {
      if (c.status !== 'active') return ['Waiting for approval', 'warn'];
      if (!c.last_posted_at) return ['Has not posted', 'bad'];
      const days = Math.floor((Date.now() - new Date(c.last_posted_at).getTime()) / 864e5);
      return days <= 0 ? ['Posted today', 'good'] : days <= 3 ? [`Posted ${days}d ago`, 'good'] : days <= 7 ? [`Posted ${days}d ago`, 'warn'] : [`Quiet for ${days}d`, 'bad'];
    };
    const list = team.creators || [];
    const waiting = (team.videos || []).filter((v) => v.status === 'pending');
    const reviewRow = (v) => {
      const why = h('input', { class: 'cp-input', placeholder: 'Reason, if you decline (the creator sees it)', maxlength: '200', 'aria-label': 'Reason for declining' });
      const approve = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Approve');
      const decline = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Decline');
      approve.addEventListener('click', act(approve, () => o.review(v, true, null)));
      decline.addEventListener('click', act(decline, () => o.review(v, false, why.value.trim())));
      return h('li', { class: 'mr-review__row' }, person(v.creator || {}), h('div', { class: 'mr-review__video' }, safeUrl(v.url) ? h('a', { class: 'btn btn--ghost btn--sm', href: safeUrl(v.url), target: '_blank', rel: 'noopener noreferrer' }, `Watch on ${v.platform === 'tiktok' ? 'TikTok' : v.platform === 'instagram' ? 'Instagram' : 'YouTube'}`) : null, h('span', { class: 'cp-muted cp-small' }, v.source === 'creator' ? 'Sent by the creator' : 'Found on their account')), h('div', { class: 'mr-review__act' }, why, approve, decline));
    };
    /*
     * What a manager can change for a creator on their own team. The database checks every one of
     * these again (their team only, the rate between the rank's rate and the admins' cap).
     */
    const info = team.manage || { rate_cap: 0.25, managers: [], rates: {} };
    const pctOf = (rate) => Math.round(Number(rate || 0) * 1000) / 10;
    const manageRow = (c) => {
      const r = info.rates?.[c.id] || { rate: 0.1, rank_rate: 0.1, custom: false };
      const cap = Math.max(Number(info.rate_cap || 0), Number(r.rank_rate || 0));
      const parts = [];
      if (c.status === 'active') {
        const input = h('input', { class: 'cp-input cp-input--num', type: 'number', inputmode: 'decimal', min: String(pctOf(r.rank_rate)), max: String(pctOf(cap)), step: '0.5', value: String(pctOf(r.rate)), 'aria-label': `Commission percent for ${c.display_name}` });
        const save = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Save');
        save.addEventListener('click', act(save, () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || value < pctOf(r.rank_rate) || value > pctOf(cap)) throw new Error(`Choose between ${pctOf(r.rank_rate)}% (their rank) and ${pctOf(cap)}% (the most you can give).`);
          return o.manage.setRate(c, value / 100);
        }));
        const back = r.custom ? confirmButton('Back to rank rate', `Confirm: back to ${pctOf(r.rank_rate)}%`, 'cp-link', () => o.manage.setRate(c, null)) : null;
        parts.push(h('div', { class: 'mr-manage__part' }, h('b', {}, 'Commission'), h('span', { class: 'cp-inline' }, input, '%', save, back), h('small', { class: 'cp-muted' }, `Their rank pays ${pctOf(r.rank_rate)}%. You can give up to ${pctOf(cap)}%. ${r.custom ? 'This creator is on a rate you set.' : 'They are on their rank rate.'}`)));
      }
      if ((info.managers || []).length) {
        const to = h('select', { class: 'cp-input', 'aria-label': `Move ${c.display_name} to` }, h('option', { value: '' }, 'Choose a manager'), info.managers.map((m) => h('option', { value: m.id }, m.name)));
        const move = confirmButton('Move', 'Confirm: move them', 'btn btn--ghost btn--sm', async () => {
          if (!to.value) throw new Error('Choose which manager to move them to.');
          await o.manage.move(c, to.value, to.selectedOptions[0].textContent);
        });
        parts.push(h('div', { class: 'mr-manage__part' }, h('b', {}, 'Move to another team'), h('span', { class: 'cp-inline' }, to, move), h('small', { class: 'cp-muted' }, 'They leave your team and stop counting toward your pay.')));
      }
      parts.push(h('div', { class: 'mr-manage__part' }, h('b', {}, 'Remove'), h('span', { class: 'cp-inline' }, confirmButton('Remove from the program', `Confirm: remove ${c.display_name}`, 'btn btn--ghost btn--sm', () => o.manage.remove(c))), h('small', { class: 'cp-muted' }, 'Their link stops earning and their videos stop counting. Only Mindroll can let them back in.')));
      return h('details', { class: 'mr-manage' }, h('summary', {}, 'Manage'), h('div', { class: 'mr-manage__body' }, parts));
    };
    const toApprove = list.filter((c) => c.status === 'active' && c.handle_verified === false && (cleanHandle(c.tiktok) || cleanHandle(c.instagram)));
    const accountRow = (c) => {
      const approve = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Approve');
      const decline = confirmButton('Decline', 'Confirm: clear these usernames', 'btn btn--ghost btn--sm', () => o.accounts(c, false));
      approve.addEventListener('click', act(approve, () => o.accounts(c, true)));
      return h('li', { class: 'mr-review__row' }, person(c), h('div', { class: 'mr-review__video' }, h('span', { class: 'cp-muted cp-small' }, 'Open each account and check it is really theirs.')), h('div', { class: 'mr-review__act', 'data-plain': '' }, approve, decline));
    };
    /*
     * The pitch: what a manager shows a creator to explain why to join. Every
     * number is read from the program's live settings (ranks, bonuses, prizes,
     * terms), so it never promises something the program does not pay. The one
     * worked example says that it is an example.
     */
    const pitchPanel = () => {
      const k = o.pitch;
      const tiers = k && Array.isArray(k.tiers) ? k.tiers : [];
      if (tiers.length < 2) return null;
      const first = tiers[0], top = tiers[tiers.length - 1];
      /*
       * A column chart drawn as SVG: one column per row, rising left to right,
       * the value written above it and the name below. A row's parts stack, each
       * part in its own colour, with a hairline of background between them.
       * rows: [{ name, parts: [{ value, color?, label? }] }]
       */
      const columns = (rows, fmt, o2 = {}) => {
        const W = o2.wide ? 900 : 320, H = o2.wide ? 280 : 172;
        const top0 = 26, base = H - 26, slot = W / rows.length, bw = Math.min(o2.wide ? 96 : 40, slot * 0.62);
        const total = (r) => r.parts.reduce((n, x) => n + x.value, 0);
        const most = Math.max(...rows.map(total)) || 1;
        const id = `mrg${(columns.n = (columns.n || 0) + 1)}`;
        const grid = [0.25, 0.5, 0.75, 1].map((f) => s('line', { x1: 0, x2: W, y1: base - (base - top0) * f, y2: base - (base - top0) * f, class: 'mr-col__grid' }));
        const bars2 = rows.map((r, i) => {
          const x = slot * i + (slot - bw) / 2;
          let y = base;
          const segs = r.parts.filter((x2) => x2.value > 0).map((part, j, all) => {
            const hgt = Math.max(3, ((base - top0) * part.value) / most);
            y -= hgt;
            const last = j === all.length - 1;
            const rect = s('path', { d: last ? `M${x},${y + hgt} V${y + 5} Q${x},${y} ${x + 5},${y} H${x + bw - 5} Q${x + bw},${y} ${x + bw},${y + 5} V${y + hgt} Z` : `M${x},${y + hgt} V${y + 1} H${x + bw} V${y + hgt} Z`, fill: part.color || `url(#${id})` }, s('title', {}, `${r.name}${part.label ? `, ${part.label}` : ''}: ${fmt(part.value)}`));
            return rect;
          });
          return s('g', {}, ...segs, s('text', { x: x + bw / 2, y: y - 7, class: 'mr-col__value', 'text-anchor': 'middle' }, fmt(total(r))), s('text', { x: x + bw / 2, y: H - 8, class: 'mr-col__name', 'text-anchor': 'middle' }, r.name));
        });
        return s('svg', { viewBox: `0 0 ${W} ${H}`, class: `mr-col${o2.wide ? ' mr-col--wide' : ''}`, role: 'img', 'aria-label': `${o2.label || 'Chart'}: ${rows.map((r) => `${r.name} ${fmt(total(r))}`).join(', ')}` },
          s('defs', {}, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0%', 'stop-color': '#5B8CFF' }), s('stop', { offset: '100%', 'stop-color': '#1E4FD6' }))),
          ...grid, s('line', { x1: 0, x2: W, y1: base, y2: base, class: 'mr-col__base' }), ...bars2);
      };
      const pctOf2 = (rate) => `${Math.round(Number(rate || 0) * 1000) / 10}%`;
      const champ = k.champion && k.champion.slots > 0 ? k.champion : null;
      const base = Number((k.active && (k.active.base_amount_cents ?? k.active.amount_cents)) || 0);
      const weekOf = (t) => Math.round(base * Number(t.bonus_multiplier ?? 1));
      const minDays = Number((k.active && k.active.min_days) || 0);
      const rankUps = tiers.filter((t) => t.rank_up_bonus_cents > 0);
      const rankUpAll = rankUps.reduce((n, t) => n + Number(t.rank_up_bonus_cents), 0);
      const prizes = ((k.race && k.race.prizes) || []).filter((x) => x.cents > 0);
      const ref = k.referral && k.referral.bonus_cents > 0 ? k.referral : null;
      const boost = k.first && k.first.multiplier > 1 ? k.first : null;
      const hold = Number((k.settings && k.settings.hold_days) || 0);
      const minPay = Number((k.settings && k.settings.min_payout_cents) || 0);
      /*
       * The scaling example: a month of sales at each rank's own goal. Most
       * bonuses are only paid out of what a creator's sales leave room for (the
       * program keeps `floor` of every sale), so the bonus part is capped at that.
       */
      const floor = k.margin != null && Number(k.margin) > 0 && Number(k.margin) < 1 ? Number(k.margin) : null;
      const share = floor == null ? null : Math.round((1 - floor) * 100);
      const salesOf = (t) => Number(t.min_revenue_cents) > 0 ? Number(t.min_revenue_cents) : 60000;
      const WEEKS = 4;
      const monthOf = (t) => {
        const commission = Math.round(salesOf(t) * Number(t.commission_rate));
        const room = floor == null ? Infinity : Math.max(0, Math.round(salesOf(t) * (1 - floor)) - commission);
        return [commission, Math.min(WEEKS * weekOf(t), room)];
      };

      const camp = k.campaigns || {};
      const split = Array.isArray(camp.split) && camp.split.length ? camp.split.map(Number) : [];
      const boards = Array.isArray(k.boards) && k.boards.length ? k.boards : ['Campaign 1', 'Campaign 2', 'Campaign 3'];
      const pools = tiers.filter((t) => t.campaign_pool_cents > 0);
      const place = (t, i) => Math.round(((t.campaign_pool_cents / boards.length) * (split[i] || 0)) / 100);
      const nth = (i) => ['1st', '2nd', '3rd'][i] || `${i + 1}th`;
      const SHADE = ['#0B2A6B', '#2F6BFF', '#9DB8FF', '#C9D6FF'];
      const mostPool = Math.max(...pools.map((t) => Number(t.campaign_pool_cents))) || 1;
      const ways = [
        ['Commission on every sale', `${pctOf2(first.commission_rate)} to ${pctOf2(top.commission_rate)}`, `Starts at ${pctOf2(first.commission_rate)} and rises with your rank${champ ? `. The top ${champ.slots} creators get ${pctOf2(champ.rate)}` : ''}.`],
        first.annual_flat_cents > 0 ? ['Each new yearly subscriber', `${dollars(first.annual_flat_cents)} to ${dollars(top.annual_flat_cents)}`, 'A flat amount for every yearly plan sold on your link.'] : null,
        base > 0 ? ['Active-week bonus', `${dollars(weekOf(first))} to ${dollars(weekOf(top))} a week`, `Post on ${minDays || 'enough'} days in a week and hit your rank's daily views.`] : null,
        rankUps.length ? ['Rank-up bonuses', `${dollars(rankUpAll)} in total`, `${rankUps.map((t) => `${t.name} ${dollars(t.rank_up_bonus_cents)}`).join(', ')}. Paid once each.`] : null,
        pools.length && split.length ? ['Campaign prizes', `up to ${dollars(mostPool)}`, `A prize pool every two weeks from ${pools[0].name} up, shared by the top ${split.length} in ${boards.length} campaigns.`] : null,
        prizes.length ? ['Race prizes', `up to ${dollars(Math.max(...prizes.map((x) => x.cents)))}`, `Be the first creator to reach a rank: ${prizes.map((x) => `${x.name} ${dollars(x.cents)}`).join(', ')}.`] : null,
        ref ? ['Invite other creators', `${dollars(ref.bonus_cents)} each`, `When a creator you invite reaches ${compact(ref.views)} views.`] : null,
        boost ? ['First video boost', `${boost.multiplier}x`, `Post in your first ${boost.hours} hours and that video pays ${boost.multiplier}x${boost.sale_days ? ` for ${boost.sale_days} days` : ''}.`] : null,
      ].filter(Boolean);

      /* One measure per chart, one colour, the value written at the end of each bar. */
      const bars = (title, note, rows, fmt) => {
        const most = Math.max(...rows.map((r) => r.value)) || 1;
        return h('figure', { class: 'mr-pitch__chart' }, h('figcaption', {}, h('b', {}, title), note ? h('small', {}, note) : null),
          h('div', { class: 'mr-pitch__bars', role: 'table', 'aria-label': title }, rows.map((r) => h('div', { class: 'mr-pitch__bar', role: 'row' }, h('span', { role: 'rowheader' }, r.name), h('span', { class: 'mr-pitch__track', role: 'presentation' }, h('i', { style: `width:${Math.max(2, (r.value / most) * 100).toFixed(1)}%` })), h('b', { role: 'cell' }, fmt(r.value))))));
      };
      const rateRows = [...tiers.map((t) => ({ name: t.name, value: Number(t.commission_rate) })), ...(champ ? [{ name: 'Champion', value: Number(champ.rate) }] : [])];
      const mostMonth = Math.max(1, ...tiers.map((t) => monthOf(t)[0] + monthOf(t)[1]));
      const growth = h('figure', { class: 'mr-pitch__chart mr-pitch__chart--wide' },
        h('figcaption', {}, h('b', {}, 'How pay scales: a month at each rank\'s own sales goal'), h('small', {}, `An example, not a promise. Sales in the month: ${tiers.map((t) => `${t.name} ${dollars(salesOf(t))}`).join(', ')}. ${base > 0 ? `Commission, plus up to ${WEEKS} active-week bonuses. ` : ''}${share != null ? `Commission and these bonuses together cannot come to more than about ${share}% of the sales you bring in, so a bonus can be smaller than its full amount, or wait.` : ''}`)),
        base > 0 ? h('div', { class: 'mr-pitch__legend' }, h('span', { 'data-k': 'a' }, 'Commission'), h('span', { 'data-k': 'b' }, 'Active-week bonuses')) : null,
        columns(tiers.map((t) => { const [c, a] = monthOf(t); return { name: t.name, parts: [{ value: c, color: '#2F6BFF', label: 'commission' }, { value: a, color: '#0B2A6B', label: 'active-week bonuses' }] }; }), dollars, { wide: true, label: 'Example month at each rank' }));

      /*
       * Campaigns, in full: each rank's prize pool for a two-week round, how it
       * is cut into three campaigns and three places, and what that comes to.
       */
      const campaigns = pools.length && split.length ? [
        h('h3', {}, 'Campaigns: prize money every two weeks'),
        h('div', { class: 'mr-pitch__facts' },
          [['Round length', '14 days', 'A new round starts every second Monday'], ['Campaigns per round', String(boards.length), boards.join(' · ')], ['Paid places', `Top ${split.length} in each`, `Split ${split.map((x) => `${x}%`).join(' / ')}`], ['Biggest pool', dollars(mostPool), `${pools[pools.length - 1].name}, when the prize fund covers it`]]
            .map(([label, value, foot]) => h('div', {}, h('small', {}, label), h('b', {}, value), h('span', {}, foot)))),
        h('figure', { class: 'mr-pitch__chart mr-pitch__chart--wide' },
          h('figcaption', {}, h('b', {}, 'Prize pool per two-week round, by rank'), h('small', {}, `Each column is one round's pool, cut by place across all ${boards.length} campaigns. Hover a segment for the amount.`)),
          h('div', { class: 'mr-pitch__legend' }, split.map((x, i) => h('span', { style: `--k:${SHADE[i] || SHADE[3]}` }, `${nth(i)} place (${x}%)`))),
          columns(pools.map((t) => ({ name: t.name, parts: split.map((x, i2) => ({ value: Math.round((t.campaign_pool_cents * x) / 100), color: SHADE[i2] || SHADE[3], label: `${nth(i2)} place across the ${boards.length} campaigns` })) })), dollars, { wide: true, label: 'Prize pool per round by rank' })),
        h('div', { class: 'cp-tablewrap' },
          h('table', { class: 'cp-table mr-pitch__table' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Rank'), h('th', { scope: 'col', class: 'is-num' }, 'Pool per round'), h('th', { scope: 'col', class: 'is-num' }, 'Per campaign'), split.map((_, i) => h('th', { scope: 'col', class: 'is-num' }, `${nth(i)} place`)), h('th', { scope: 'col', class: 'is-num' }, `Win all ${boards.length}`))),
            h('tbody', {}, pools.map((t) => h('tr', {}, h('th', { scope: 'row' }, t.name), h('td', { class: 'is-num' }, h('b', {}, dollars(t.campaign_pool_cents))), h('td', { class: 'is-num' }, dollars0(t.campaign_pool_cents / boards.length)), split.map((_, i) => h('td', { class: 'is-num' }, dollars0(place(t, i)))), h('td', { class: 'is-num' }, h('b', {}, dollars0((t.campaign_pool_cents * (split[0] || 0)) / 100)))))))),
        h('p', { class: 'cp-muted cp-small' }, `How to read it: a rank's pool is shared equally by its ${boards.length} campaigns, and each campaign pays its top ${split.length}. "Win all ${boards.length}" is the most one creator can take in a round: 1st place in every campaign. You compete only against creators in your own rank${camp.min_creators > 0 ? `, and a rank's campaigns run once it has ${num(camp.min_creators)} creators` : ''}. ${tiers.filter((t) => !(t.campaign_pool_cents > 0)).map((t) => t.name).join(' and ') || 'No rank'} has no campaigns yet. Prizes are paid from the program's prize fund when a round ends, so one can pay less than shown while the fund is small.`),
      ] : [];

      const why = [
        ['Paid on results, not per post', 'A flat fee pays once per video. Commission pays on every sale your link brings, so one good video can pay many times.'],
        ['The rate goes up as you grow', `You start at ${pctOf2(first.commission_rate)} and move up to ${pctOf2(top.commission_rate)} by ranking up. It is not a fixed deal.`],
        ['Bonuses stack on top', 'Weekly bonuses, rank-up bonuses, campaign and race prizes and invite rewards are all paid on top of commission. Most bonuses are paid out of the sales you bring in.'],
      ];
      const pros = [
        'Free to join. No fees.',
        'You keep ownership of your videos.',
        `${ways.length} separate ways to earn, all shown live on your dashboard.`,
        `Commission rises from ${pctOf2(first.commission_rate)} to ${pctOf2(top.commission_rate)} as you rank up.`,
        'A manager who reviews your videos and helps you grow, plus the team Discord.',
        minPay > 0 ? `Cash out from ${dollars(minPay)}.` : null,
      ].filter(Boolean);
      const cons = [
        'No guaranteed pay. No sales and no views means no money.',
        share != null ? `Most bonuses are paid out of your own sales. Commission and bonuses together cannot pass about ${share}% of the sales you bring in; a bonus you reach early waits until your sales cover it.` : null,
        hold > 0 ? `Commission clears after ${hold} days, so refunds can come off first.` : null,
        minPay > 0 ? `You need at least ${dollars(minPay)} to cash out.` : null,
        tiers[1] ? `Higher ranks take steady posting. ${tiers[1].name} needs ${[tiers[1].min_posts > 0 && `${num(tiers[1].min_posts)} videos`, tiers[1].min_views > 0 && `${compact(tiers[1].min_views)} views`].filter(Boolean).join(' and ')} in 30 days.` : null,
        pools.length && split.length ? `Campaign prizes go to the top ${split.length} only, and can pay less than shown while the prize fund is small.` : null,
        'Mindroll can re-post your videos, including as ads.',
        'Rates, bonuses and prizes can change. What you already earned stays yours.',
      ].filter(Boolean);

      /*
       * One small chart for each way to earn, with a sentence saying what the
       * chart shows. Same bars as the rest of the pitch: one measure, one colour.
       */
      const byRank = (pick) => tiers.map((t) => ({ name: t.name, value: Number(pick(t)) || 0 }));
      const boostBase = 5000; /* the worked example for the first-video boost: a $50 bonus */
      const wayChart = {
        'Commission on every sale': [rateRows, pctOf2, 'Your share of each sale, by rank', `Every sale made on your link pays you this share. The column gets taller each time you rank up${champ ? `, and the top ${champ.slots} creators are paid ${pctOf2(champ.rate)}` : ''}.`],
        'Each new yearly subscriber': [byRank((t) => t.annual_flat_cents), dollars, 'Paid per yearly plan, by rank', 'When someone buys a yearly plan on your link you get this flat amount. Ten yearly subscribers pays ten times the column.'],
        'Active-week bonus': [byRank(weekOf), dollars, 'Paid for one active week, by rank', `Post on ${minDays || 'enough'} days in a week, with each day's videos reaching your rank's views, and the week pays this. It can be earned every week, and it is paid out of the sales you bring in: if your sales do not cover it yet, it waits.`],
        'Rank-up bonuses': [rankUps.map((t) => ({ name: t.name, value: Number(t.rank_up_bonus_cents) })), dollars, 'One-time bonus when you reach each rank', `Each rank pays once, the moment you reach it. Reach all of them and the bonuses add up to ${dollars(rankUpAll)}.`],
        'Campaign prizes': [pools.map((t) => ({ name: t.name, value: Number(t.campaign_pool_cents) })), dollars, 'Prize pool every two weeks, by rank', `Each rank from ${pools[0] ? pools[0].name : 'Silver'} up has its own pool every two weeks, shared by the top ${split.length} in ${boards.length} campaigns. The full breakdown is below.`],
        'Race prizes': [prizes.map((x) => ({ name: x.name, value: Number(x.cents) })), dollars, 'Prize for the first creator to reach each rank', 'One prize per rank, won once, by whoever gets there first. Later creators still get the rank and its rank-up bonus.'],
        'Invite other creators': ref ? [[1, 3, 5, 10].map((n) => ({ name: `${n} invited`, value: n * Number(ref.bonus_cents) })), dollars, 'Creators you invite, and what that pays', `Each creator you invite pays ${dollars(ref.bonus_cents)} once their videos reach ${compact(ref.views)} views. There is no limit on how many you invite.`] : null,
        'First video boost': boost ? [[{ name: 'Normal', value: boostBase }, { name: 'Boosted', value: boostBase * Number(boost.multiplier) }], dollars, `Example: a ${dollars(boostBase)} bonus on your first video`, `Post within ${boost.hours} hours of joining and that video's commission and bonuses pay ${boost.multiplier}x${boost.sale_days ? ` for ${boost.sale_days} days` : ''}${boost.cap_cents > 0 ? `, up to ${dollars(boost.cap_cents)} extra` : ''}.`] : null,
      };
      const miniBars = (rows, fmt, label) => columns(rows.map((r) => ({ name: r.name.replace(' invited', ''), parts: [{ value: r.value }] })), fmt, { label });
      const wayCard = ([name, value, how]) => {
        const c = wayChart[name];
        const drawn = c && c[0].length > 0;
        return h('div', { class: 'mr-pitch__way' }, h('small', {}, name), h('b', {}, value), drawn ? h('em', {}, c[2]) : null, drawn ? miniBars(c[0], c[1], c[2]) : null, h('span', {}, drawn ? c[3] : how));
      };

      /*
       * What Mindroll is, in words a manager can paste: once for the creator
       * (what they would be promoting) and once for the creator's viewers (how
       * to describe it in a video or a caption). Taken from the app's own site.
       */
      const ABOUT = [
        ['For the creator', 'Send this so they know what they would be promoting.', [
          'Mindroll is a reading app for people who want to learn from books but do not have hours to read.',
          'Every day it gives you five ideas from books, essays, talks and research. Each one takes about a minute, and the session ends when the five are done. There is no endless feed.',
          'The ideas you save come back after 1, 3, 7, 16 and 35 days, so you actually remember them instead of forgetting the book a week later.',
          'You can also listen to ideas, scan a book you own to get its ideas, and keep a library of what you saved.',
          'It is a paid subscription, on iPhone and Android. Every subscription bought on your link pays you commission.',
          'It is easy to make videos about: pick one idea from a book and share it. Book, self-improvement, productivity and study content all fit.',
        ]],
        ['For their viewers', 'How a creator can describe it in a video or a caption.', [
          'Name one idea from the last book you finished. Most people cannot, because you read it once and nothing ever asked you about it again.',
          'Mindroll fixes that. It gives you five ideas a day from great books, about a minute each, and then you are done.',
          'The ideas you save come back until they stick, so you keep what you read.',
          'Link in my bio.',
        ]],
      ];
      const copier = (label, body) => { const b = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, label); b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(body); toast('Copied. Paste it into a DM or a caption.'); } catch { toast('Could not copy on this browser.', 'error'); } }); return b; };
      const about = h('div', { class: 'mr-pitch__about' }, ABOUT.map(([title, note, lines]) => h('div', {}, h('div', { class: 'mr-pitch__abouthead' }, h('span', {}, h('b', {}, title), h('small', {}, note)), copier('Copy', lines.join('\n\n'))), lines.map((line) => h('p', {}, line)))));

      const text = [
        'Why join the Mindroll creator program', '',
        'What Mindroll is:', ...ABOUT[0][2].map((x) => `- ${x}`), '',
        'How you get paid:', ...ways.map(([name, value, how]) => `- ${name}: ${value}. ${how}`), '',
        'Why it pays more:', ...why.map(([name, how]) => `- ${name}. ${how}`), '',
        'Good to know before you join:', ...cons.map((x) => `- ${x}`), '',
        'Apply: https://getmindroll.com/creators/' + (o.inviteCode ? `?invite=${o.inviteCode}` : team.manager && team.manager.code ? `?team=${team.manager.code}` : ''),
      ].join('\n');
      const copy = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Copy as a message');
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into a DM or an email.'); } catch { toast('Could not copy on this browser.', 'error'); } });
      const list = (items, kind) => h('ul', { class: 'mr-pitch__list', 'data-kind': kind }, items.map((x) => h('li', {}, x)));

      return h('section', { class: 'mr-panel mr-pitch' },
        h('details', { open: o.pitchOpen ? '' : null },
          h('summary', {}, h('span', {}, h('small', {}, 'For your calls with creators'), h('b', {}, 'The pitch: why join Mindroll')), h('span', { class: 'mr-pitch__open' }, 'Open')),
          h('div', { class: 'mr-pitch__body' },
            h('div', { class: 'mr-pitch__tools' }, h('p', { class: 'cp-muted cp-small' }, 'Share your screen and walk through it, or copy it as a message. The numbers are the program\'s live numbers.'), copy),
            h('h3', {}, 'What Mindroll is'),
            about,
            h('h3', {}, 'How you get paid'),
            h('div', { class: 'mr-pitch__ways' }, ways.map(wayCard)),
            h('h3', {}, 'It grows with you'),
            h('div', { class: 'mr-pitch__charts' }, growth),
            ...campaigns,
            h('h3', {}, 'Why it pays more'),
            h('div', { class: 'mr-pitch__why' }, why.map(([name, how]) => h('div', {}, h('b', {}, name), h('span', {}, how)))),
            h('h3', {}, 'The honest pros and cons'),
            h('div', { class: 'mr-pitch__sides' }, h('div', {}, h('b', {}, 'Pros'), list(pros, 'pro')), h('div', {}, h('b', {}, 'Cons'), list(cons, 'con'))),
          ),
        ),
      );
    };
    if (o.only === 'pitch') return [pitchPanel() || h('p', { class: 'cp-empty' }, 'The pitch needs the program\'s pay numbers, which did not load. Refresh the page.')];
    return [
      o.noPitch ? null : pitchPanel(),
      o.accounts && toApprove.length
        ? h('section', { class: 'mr-panel mr-review' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Accounts to approve'), h('b', {}, num(toApprove.length))), h('ul', { class: 'mr-review__list' }, toApprove.map(accountRow)), h('p', { class: 'cp-muted cp-small' }, 'Videos and views are only counted from accounts you have approved.'))
        : null,
      o.review && waiting.length
        ? h('section', { class: 'mr-panel mr-review' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Videos to review'), h('b', {}, num(waiting.length))), h('ul', { class: 'mr-review__list' }, waiting.map(reviewRow)), h('p', { class: 'cp-muted cp-small' }, 'A video only counts for the creator once it is approved.'))
        : null,
      h(
        'section',
        { class: 'mr-briefhero mr-team__hero' },
        h('div', {}, h('p', { class: 'mr-brief__eyebrow' }, o.eyebrow || 'Your team'), h('h2', {}, team.manager?.display_name || 'Team'), h('p', {}, `${num(t.creators || 0)} creator${t.creators === 1 ? '' : 's'} · ${num(t.active_7d || 0)} posted this week${t.pending ? ` · ${num(t.pending)} waiting for approval` : ''}`), h('p', { class: 'mr-team__cutline' }, cut > 0 ? ['Your cut: ', h('b', {}, share(cut)), ' of what your team leaves after your creators are paid'] : 'Your cut has not been set yet. Agree it with Mindroll.')),
        h('div', { class: 'mr-team__pay' }, h('span', {}, 'Your pay, last 30 days'), h('b', {}, dollars0(pay.total_cents)), h('small', {}, 'Your cut plus bonuses. An estimate. Paid out once the money reaches Mindroll from Stripe, usually 3 to 7 days.')),
      ),
      h('div', { class: 'mr-grid' }, tile('paper', 'Team views, 30 days', compact(t.views_30d || 0), `${num(t.videos_30d || 0)} videos`), tile('paper', 'Subscribers brought in', num(t.subscribers || 0), 'by your creators'), tile('paper', 'Paid to your creators', dollars0(pay.paid_out_cents), 'commission and bonuses, 30 days'), tile('amber', 'Active weeks, 30 days', num(t.active_weeks_30d || 0), 'weeks a creator posted 4 days')),
      h(
        'section',
        { class: 'mr-panel' },
        h('div', { class: 'mr-panel__head' }, h('h2', {}, cut > 0 ? `Your cut: ${share(cut)}` : 'Your cut'), h('b', {}, dollars0(pay.from_cut_cents))),
        h(
          'div',
          { class: 'mr-cut' },
          h('div', {}, h('small', {}, 'Your team brought in'), h('b', {}, dollars0(pay.brought_in_cents)), h('span', {}, 'sales, after store fees')),
          h('i', { 'aria-hidden': 'true' }, '−'),
          h('div', {}, h('small', {}, 'Paid to your creators'), h('b', {}, dollars0(pay.paid_out_cents)), h('span', {}, 'commission and every bonus')),
          h('i', { 'aria-hidden': 'true' }, '='),
          h('div', {}, h('small', {}, 'Left over'), h('b', {}, dollars0(pay.profit_cents)), h('span', {}, 'never counted below $0')),
          h('i', { 'aria-hidden': 'true' }, '→'),
          h('div', { 'data-yours': '' }, h('small', {}, cut > 0 ? `Your ${share(cut)}` : 'Your cut'), h('b', {}, dollars0(pay.from_cut_cents)), h('span', {}, cut > 0 ? `Mindroll keeps the other ${share(1 - cut)}` : 'not set yet')),
        ),
        h('p', { class: 'cp-muted cp-small' }, `Your cut is taken from what is left after your creators are paid, not from the sales. Example: a creator brings in $20,000 and is paid $10,000. $10,000 is left, so ${cut > 0 ? `your ${share(cut)} is ${dollars0(1000000 * cut)}` : 'at 50% you would get $5,000'}.`),
        Number(pay.paid_out_cents || 0) > Number(pay.brought_in_cents || 0) ? h('p', { class: 'cp-small' }, 'Right now your creators have been paid more than their sales brought in, so there is nothing left to share yet. It never goes below $0.') : null,
        list.length ? h('details', { class: 'cp-fold' }, h('summary', {}, 'See it creator by creator'), h('div', { class: 'mr-cuttable', role: 'table' }, h('div', { class: 'mr-cuttable__head', role: 'row' }, ['Creator', 'Brought in', 'Paid to them', 'Left over'].map((x) => h('span', { role: 'columnheader' }, x))), list.map((c) => { const paid = Number(c.commission_30d || 0) + Number(c.bonus_30d || 0); return h('div', { class: 'mr-cuttable__row', role: 'row' }, h('b', {}, c.display_name), h('span', { 'data-label': 'Brought in' }, dollars0(c.net_30d)), h('span', { 'data-label': 'Paid to them' }, dollars0(paid)), h('span', { 'data-label': 'Left over' }, signed(Number(c.net_30d || 0) - paid))); })), h('p', { class: 'cp-muted cp-small' }, 'The team is added up as a whole, so one creator in the minus is covered by the others.')) : null,
      ),
      h(
        'section',
        { class: 'mr-panel' },
        h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Bonuses, on top of your cut'), h('b', {}, dollars0(Number(pay.from_rankup_cents || 0) + Number(pay.from_active_cents || 0) + Number(pay.from_views_cents || 0) + Number(pay.from_referral_cents || 0)))),
        h(
          'ul',
          { class: 'mr-team__parts' },
          h('li', { class: 'mr-team__fold' }, h('details', {}, h('summary', {}, h('span', {}, h('b', {}, 'Rank-up bonus'), h('small', {}, `${share(pay.rankup_rate)} of the rank-up bonus, every time one of your creators ranks up. Tap to see every rank.`)), h('b', {}, dollars0(pay.from_rankup_cents))), h('ul', { class: 'mr-rankups' }, (pay.rankups || []).map((r) => h('li', {}, h('b', {}, r.name), h('span', {}, `Creator gets ${dollars(r.bonus_cents)}`), h('span', { 'data-yours': '' }, `You get ${dollars(r.yours_cents)}`), h('small', {}, Number(r.count_30d) > 0 ? `${num(r.count_30d)} in the last 30 days` : 'none yet'))), (pay.rankups || []).length ? null : h('li', { class: 'cp-muted' }, 'No rank-up bonuses are set.')))),
          h('li', {}, h('span', {}, h('b', {}, 'Activeness'), h('small', {}, `${dollars0(pay.active_cents)} for every active week a creator completes`)), h('b', {}, dollars0(pay.from_active_cents))),
          h('li', {}, h('span', {}, h('b', {}, 'Views'), h('small', {}, `${dollars0(pay.views_cents)} for every 100K views your team gains`)), h('b', {}, dollars0(pay.from_views_cents))),
          pay.referral_cents > 0 && team.manager?.code
            ? h('li', { class: 'mr-team__fold' }, h('details', {}, h('summary', {}, h('span', {}, h('b', {}, 'Creators you bring in'), h('small', {}, `${dollars0(pay.referral_cents)} for each creator who joins on your link and reaches ${compact(pay.referral_views)} views. Added as soon as their views are counted. Tap for your link.`)), h('b', {}, dollars0(pay.from_referral_cents))),
                h('p', { class: 'cp-small', style: 'margin:0.5rem 0.75rem' }, 'Your invite link: ', h('code', { class: 'cp-mono' }, o.inviteCode ? `getmindroll.com/creators/?invite=${o.inviteCode}` : `getmindroll.com/creators/?team=${team.manager.code}`)),
                o.inviteCode ? h('p', { class: 'cp-small cp-muted', style: 'margin:0 0.75rem 0.5rem' }, 'One link for everything: it is the same link as on your Invite page. Whoever joins on it is put on your team, and the reward for them goes into your creator wallet and is listed on your Invite page, not in the total above. The total above only counts people who joined on your older team link, which still works.') : null,
                (pay.referrals || []).length
                  ? h('ul', { class: 'mr-rankups' }, pay.referrals.map((r) => h('li', {}, h('span', {}, h('b', {}, r.display_name), h('small', {}, r.paid ? 'Reached the goal' : r.status === 'pending' ? 'Waiting for approval' : `${compact(r.views)} of ${compact(pay.referral_views)} views`)), h('b', {}, r.paid ? dollars0(pay.referral_cents) : '–'))))
                  : h('p', { class: 'cp-small cp-muted' }, 'Nobody has joined on your link yet.')))
            : null,
        ),
      ),
      h(
        'section',
        { class: 'mr-panel' },
        h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Creators'), h('b', {}, num(list.length))),
        list.length
          ? h(
              'div',
              { class: 'mr-roster', role: 'table' },
              h('div', { class: 'mr-roster__head', role: 'row' }, ['Creator', 'Activity', 'Videos', 'Views', 'Subs', 'Earned'].map((x) => h('span', { role: 'columnheader' }, x))),
              list.map((c) => { const [label, tone] = activity(c); return h('div', { class: 'mr-roster__row', role: 'row' }, person(c, { badge: pill(tierName(c), c.champion ? 'good' : 'muted') }), h('span', { class: 'mr-dot', 'data-tone': tone }, label), h('span', { 'data-label': 'Videos' }, num(c.videos_30d || 0)), h('span', { 'data-label': 'Views' }, compact(c.views_30d || 0)), h('span', { 'data-label': 'Subs' }, num(c.subscribers || 0)), h('b', { 'data-label': 'Earned' }, dollars0(c.commission_30d)), o.manage ? manageRow(c) : null); }),
            )
          : h('p', { class: 'cp-muted' }, 'No creators on this team yet.'),
        h('p', { class: 'cp-muted cp-small' }, 'Videos, views and earnings are the last 30 days.'),
      ),
    ];
  }

  /*
   * Creator / Manager / Admin: one row of buttons for moving between the
   * dashboards a person is allowed to see. Only the views in `items` are shown,
   * and nothing is drawn when there is just one.
   * items: [id, label, go]; current: the id that is on screen.
   */
  function viewSwitch(items, current) {
    if (items.length < 2) return null;
    return h('div', { class: 'mr-switch', role: 'group', 'aria-label': 'Switch dashboard' }, items.map(([id, label, go]) => h('button', { class: 'mr-switch__btn', type: 'button', 'aria-pressed': String(id === current), onclick: id === current ? null : go }, label)));
  }

  /*
   * Phones: a bar fixed to the bottom with the main pages, and "More", which
   * opens every page as a sheet. It sits under the root, outside the redrawn
   * view, and is refreshed on each draw; creators.css shows it on narrow screens
   * only, and only while the side menu it stands in for is on the page.
   * items: [id, label, glyph, count, note]; main: the ids on the bar itself.
   */
  let tabbarBox = null;
  let tabbarOpen = false;
  function tabbar({ label, items, main, current, open, icon }) {
    if (!tabbarBox) {
      tabbarBox = root.appendChild(h('div', { class: 'mr-phonenav' }));
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && tabbarOpen) tabbarBox.querySelector('.mr-sheet__close').click(); });
    }
    const dots = icon('more');
    dots.firstChild.setAttribute('d', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z');
    const badge = (n) => (n ? h('b', {}, n > 99 ? '99+' : String(n)) : null);
    const pick = (id) => () => { tabbarOpen = false; open(id); window.scrollTo(0, 0); };
    const toggle = (on) => {
      tabbarOpen = on;
      sheet.hidden = !on;
      more.setAttribute('aria-expanded', String(on));
      if (on) (sheet.querySelector('[aria-current]') || sheet.querySelector('button')).focus({ preventScroll: true });
      else more.focus({ preventScroll: true });
    };
    const rest = items.filter(([id]) => !main.includes(id));
    const more = h('button', { class: 'mr-tab', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': String(tabbarOpen), 'data-on': rest.some(([id]) => id === current) || null, onclick: () => toggle(!tabbarOpen) }, dots, h('span', {}, 'More'), badge(rest.reduce((sum, item) => sum + (item[3] || 0), 0)));
    const sheet = h(
      'div',
      { class: 'mr-sheet', hidden: !tabbarOpen, onclick: (event) => { if (event.target === sheet) toggle(false); } },
      h(
        'div',
        { class: 'mr-sheet__box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'All pages' },
        h('div', { class: 'mr-sheet__top' }, h('b', {}, 'All pages'), h('button', { class: 'mr-sheet__close', type: 'button', onclick: () => toggle(false) }, 'Close')),
        h('div', { class: 'mr-sheet__list' }, items.map(([id, text, glyph, n, note]) => h('button', { class: 'mr-sheet__item', type: 'button', 'aria-current': id === current ? 'page' : null, onclick: pick(id) }, icon(glyph), h('span', {}, text), note ? h('em', {}, note) : badge(n)))),
      ),
    );
    tabbarBox.replaceChildren(
      h('nav', { class: 'mr-tabbar', 'aria-label': label }, main.map((id) => items.find((item) => item[0] === id)).filter(Boolean).map(([id, text, glyph, n]) => h('button', { class: 'mr-tab', type: 'button', 'aria-current': id === current ? 'page' : null, onclick: pick(id) }, icon(glyph), h('span', {}, text), badge(n))), more),
      sheet,
    );
  }

  window.mindrollCreators = {
    root, client, demo, empty, loadEmpty, h, money, num, compact, pct, day, safeUrl, PLATFORM,
    toast, fn, rpc, act, confirmButton, signInPanel, pill, statusPill, tile, table, section,
    COLOR, segbar, hbars, timeChart, milestones, ladder, dollars, KINDS, fold, figure,
    /* Where an uploaded reference video is served from. */
    defaultBrief, rich, briefImage, briefVideos, briefTips,
    live, tabbar,
    avatar, person, handleLinks, teamView, s, viewSwitch,
    briefVideoUrl: (path) => (path && url ? `${url}/storage/v1/object/public/creator-briefs/${encodeURIComponent(path)}` : null),
  };
})();
