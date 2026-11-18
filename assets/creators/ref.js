/*
 * Creator referral capture. Add to every page of the site:
 *   <script src="/assets/creators/ref.js" defer></script>
 *
 * A visitor arriving on ?ref=CODE is remembered for 30 days in this browser.
 * ?ref=CODE&v=TAG also remembers which of the creator's links it was.
 * The moment they are signed in (on any page, by any of the site's sign-in
 * flows) the account is tied to that creator, once and for good, by the
 * `creator_claim_referral` database function. Commission is then counted
 * server-side from RevenueCat's purchase events; nothing here is trusted for
 * money, it only says who sent the visitor.
 *
 * While the code is remembered, each page and each step of the sign-up funnel
 * the visitor reaches is recorded once against the creator, under a random id
 * kept in this browser, so the team can see where a creator's visitors stop.
 * No name, email or account goes with it.
 *
 * No dependencies and no supabase-js: two small fetches, so it can sit on the
 * home page without loading the auth bundle there.
 */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://ruvsikvpldhtiwesoxjo.supabase.co';
  /* The public anon key, the same one already in the markup of /account and /pro. */
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1dnNpa3ZwbGRodGl3ZXNveGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMDY3MDcsImV4cCI6MjEwNTc4MjcwN30.8jhdLGhF1Z61qCfIHNl79xvowB5_k3Y0_wgTc9snVo0';
  const STORE = 'mindroll.ref';
  const TTL = 30 * 24 * 60 * 60 * 1000;
  /* supabase-js keeps the session under this key by default. */
  const SESSION = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  };

  const rpc = (name, body, token) =>
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token || SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      keepalive: true,
    });

  /* 1. Remember a code that arrived in the address. The newest link wins. */
  const arrived = (new URLSearchParams(location.search).get('ref') || '').trim().toLowerCase();
  /* An optional tag on the link (?ref=code&v=tag) says which video or niche it was for. */
  const tagArrived = (new URLSearchParams(location.search).get('v') || '').trim().toLowerCase();
  const tag = /^[a-z0-9_-]{1,24}$/.test(tagArrived) ? tagArrived : null;
  if (/^[a-z0-9_]{3,24}$/.test(arrived)) {
    const known = read(STORE);
    try {
      localStorage.setItem(STORE, JSON.stringify({ code: arrived, at: Date.now(), ...(tag ? { tag } : {}) }));
    } catch {
      /* Private window. The visit still counts below; the claim cannot. */
    }
    if (!known || known.code !== arrived || (known.tag || null) !== tag) rpc('creator_track_click', { p_code: arrived, ...(tag ? { p_tag: tag } : {}) }).catch(() => {});
  }

  /* 2. Record how far this visitor gets. Once per visitor per step; the database ignores repeats. */
  const VISITOR = 'mindroll.visitor';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const page = location.pathname.replace(/\/+$/, '').replace(/\/index\.html$/, '') || '/';
  const sent = new Set();
  function visitor() {
    let id = null;
    try {
      id = localStorage.getItem(VISITOR);
      if (!/^[0-9a-f-]{36}$/.test(id || '')) {
        id = crypto.randomUUID();
        localStorage.setItem(VISITOR, id);
      }
    } catch {
      /* Private window or an old browser: this visit is simply not counted. */
    }
    return id;
  }
  function reached(step, position) {
    const ref = read(STORE);
    if (local || !ref || Date.now() - Number(ref.at || 0) > TTL) return;
    if (!/^\/[a-z0-9/_-]{0,40}$/.test(page) || !/^[a-z0-9-]{1,40}$/.test(step) || sent.has(step)) return;
    const id = visitor();
    if (!id) return;
    sent.add(step);
    rpc('creator_track_step', { p_code: ref.code, p_visitor: id, p_path: page, p_step: step, p_position: position }).catch(() => {});
  }

  reached('view', 0);
  /* The sign-up funnel names its current step on its root element as it moves. */
  const funnel = document.querySelector('[data-funnel]');
  if (funnel) {
    const order = [...funnel.querySelectorAll('[data-step]')].map((el) => el.dataset.step);
    const note = () => {
      const step = funnel.dataset.currentStep;
      if (step) reached(step, order.indexOf(step) + 1);
    };
    new MutationObserver(note).observe(funnel, { attributes: true, attributeFilter: ['data-current-step'] });
    note();
  }
  /* Pressing a pay button, on the funnel's offer or on the plans page. */
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-checkout]')) reached('checkout-click', 400);
  }, true);

  /* 3. Once signed in, claim. Polls because sign-in can finish without a page load. */
  let busy = false;
  let tries = 0;
  const timer = setInterval(attempt, 1000);
  attempt();

  async function attempt() {
    const ref = read(STORE);
    if (!ref || ref.claimed || Date.now() - Number(ref.at || 0) > TTL || (tries += 1) > 900) {
      clearInterval(timer);
      if (ref && Date.now() - Number(ref.at || 0) > TTL) localStorage.removeItem(STORE);
      return;
    }
    if (busy) return;

    const session = read(SESSION);
    const token = session && session.access_token;
    if (!token || Number(session.expires_at || 0) * 1000 < Date.now()) return;

    busy = true;
    try {
      const res = await rpc('creator_claim_referral', { p_code: ref.code, p_source: 'link', ...(ref.tag ? { p_tag: ref.tag } : {}) }, token);
      /* Any definite answer ends it: claimed, already claimed, or never claimable. */
      if (res.ok) {
        /* Kept, marked done, so the steps after sign-up are still counted for the creator. */
        localStorage.setItem(STORE, JSON.stringify({ ...ref, claimed: true }));
        clearInterval(timer);
      }
    } catch {
      /* Offline. The next tick tries again. */
    } finally {
      busy = false;
    }
  }
})();
