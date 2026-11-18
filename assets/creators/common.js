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
        h('tbody', {}, rows.map((row) => h('tr', {}, columns.map((col) => h('td', { class: col.num && 'is-num', 'data-label': col.label }, col.cell(row)))))),
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
    const W = 600, H = 210, L = 46, R = 12, T = 10, B = 26;
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
  const KINDS = [['views', 'View bonuses'], ['active', 'Active creator'], ['volume', 'Posting volume'], ['rank_up', 'Rank-up'], ['prize', 'Tier campaign prizes'], ['contest', 'Campaign wins'], ['top_video', 'Top videos'], ['referral', 'Creator referrals'], ['iron_views', 'Views pay (Iron)'], ['first_sale', 'First-sale bonus'], ['first_top', 'Race to the podium'], ['daily', 'Champion pay'], ['manual', 'One-off']];

  /** The detail tables, folded away until somebody wants them. */
  const fold = (label, ...body) => h('details', { class: 'cp-fold' }, h('summary', {}, label), ...body);

  /** A card that leads with one figure. */
  const figure = (label, value, hero) => h('div', { class: 'cp-figure' }, h('p', { class: 'cp-figure__label' }, label), h('p', { class: hero ? 'cp-figure__value cp-figure__value--hero' : 'cp-figure__value' }, value));

  window.mindrollCreators = {
    root, client, demo, empty, loadEmpty, h, money, num, compact, pct, day, safeUrl, PLATFORM,
    toast, fn, rpc, act, confirmButton, signInPanel, pill, statusPill, tile, table, section,
    COLOR, segbar, hbars, timeChart, milestones, ladder, dollars, KINDS, fold, figure,
    /* Where an uploaded reference video is served from. */
    briefVideoUrl: (path) => (path && url ? `${url}/storage/v1/object/public/creator-briefs/${encodeURIComponent(path)}` : null),
  };
})();
