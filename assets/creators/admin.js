/*
 * The admin dashboard at /admin.
 *
 * Hiding this page would protect nothing: it is a public file on a static
 * site. What protects the data is the database. Every read and write below is
 * made as the signed-in user, and row-level security only answers for users
 * listed in `creator_admins`. Anyone else who opens this page sees the
 * "not an admin" note and gets empty results if they try the API by hand.
 * Paying somebody goes through the `creator-payout` function, which checks
 * the same table again on the server.
 */
(() => {
  'use strict';
  const cp = window.mindrollCreators;
  if (!cp || cp.root.dataset.creators !== 'admin') return;
  const { h, money, num, compact, day, toast, act, section, table, statusPill, pill, confirmButton } = cp;
  const view = cp.root.querySelector('[data-view]');
  const who = cp.root.querySelector('[data-who]');
  const db = cp.client;

  /* One accent, used for every chart and button in the admin. */
  Object.assign(cp.COLOR, { ready: '#2F6BFF', paid: '#111827', wait: '#F5A524' });
  const TABS = [['overview', 'Home', 'home'], ['alerts', 'Notifications', 'bell'], ['creators', 'Creators', 'users'], ['links', 'Links', 'link'], ['referrals', 'Referrals', 'users'], ['managers', 'Managers', 'badge'], ['brief', 'UGC Brief', 'book'], ['videos', 'Videos', 'play'], ['campaigns', 'Campaigns', 'flag'], ['rankings', 'Leaderboard', 'trophy'], ['revenue', 'Money', 'chart'], ['payouts', 'Payouts', 'wallet'], ['bonuses', 'Pay rules', 'sliders'], ['settings', 'Settings', 'gear']];
  const ICONS = {
    home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    bell: 'M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7zm4 10a2 2 0 0 0 4 0',
    users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6',
    play: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm5 4.5v7l6-3.5z',
    flag: 'M5 21V4h11l-2 4 2 4H5',
    trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4m-4 3h8',
    chart: 'M4 20V10m6 10V4m6 16v-7m5 7H2',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zm13 7h.01',
    sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h.01M16 4v4M10 10v4M18 16v4',
    badge: 'M12 3l2.4 1.9 3-.3.9 2.9 2.5 1.7-1.1 2.8 1.1 2.8-2.5 1.7-.9 2.9-3-.3L12 21l-2.4-1.9-3 .3-.9-2.9-2.5-1.7 1.1-2.8-1.1-2.8 2.5-1.7.9-2.9 3 .3zM9 12l2 2 4-4',
    book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10M9 8h5',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5a7 7 0 0 0 .1-1.2z',
  };
  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name] || ICONS.home);
    svg.append(path);
    return svg;
  };
  let tab = TABS.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let sales = null;
  let state = null;
  /* The funnel card: which creator (null = all) and which page's steps it shows. */
  let funnelCreator = null;
  let funnelPath = null;

  /* ------------------------------------------------------------------ boot */

  let lastUser;
  let stopLive = null;
  async function route(session) {
    const user = session?.user ?? null;
    if ((user?.id ?? null) === lastUser) return;
    lastUser = user?.id ?? null;
    stopLive?.();
    stopLive = null;
    if (!user) {
      setWho(null);
      view.replaceChildren(h('div', { class: 'cp-card cp-narrow' }, cp.signInPanel({ title: 'Admin sign-in', lead: 'For the Mindroll team.', oauthOnly: true })));
      return;
    }
    setWho(user.email || 'Signed in');
    const { data: isAdmin } = await db.rpc('is_creator_admin');
    if (!isAdmin) {
      view.replaceChildren(h('div', { class: 'cp-card cp-narrow' }, h('h1', {}, 'Access denied.'), h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => db.auth.signOut() }, 'Sign out')));
      return;
    }
    await reload();
    stopLive?.();
    stopLive = cp.live.start(() => reload(true));
  }

  function setWho(label) {
    who.replaceChildren();
    if (!label) return;
    who.append(h('span', { class: 'cp-who__name' }, label));
    if (!cp.demo) who.append(h('button', { class: 'cp-link', type: 'button', onclick: () => db.auth.signOut() }, 'Sign out'));
  }

  /** Throws on a Supabase error so one `act()` wrapper reports all of them. */
  const ok = async (query) => {
    if (cp.demo) throw new Error('This is a preview, so actions are switched off.');
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  };

  let lastStamp = null;
  async function reload(quiet = false) {
    if (cp.demo) return render();
    try {
      const [overview, funnel, videos, rules, bonuses, payouts, volume, campaigns, briefDoc, managers, briefs, recent, referrals] = await Promise.all([
        cp.rpc('creator_admin_overview'),
        cp.rpc('creator_admin_funnel', { p_creator: funnelCreator, p_days: 30 }),
        ok(db.from('creator_videos').select('*').order('created_at', { ascending: false }).limit(500)),
        ok(db.from('creator_bonus_rules').select('*').order('threshold_views')),
        ok(db.from('creator_bonuses').select('*').order('created_at', { ascending: false }).limit(300)),
        ok(db.from('creator_payouts').select('*').order('created_at', { ascending: false }).limit(300)),
        ok(db.from('creator_volume_rules').select('*').order('min_videos')),
        cp.rpc('creator_admin_campaigns'),
        cp.rpc('creator_admin_brief').catch(() => null),
        cp.rpc('creator_admin_managers').catch(() => []),
        ok(db.from('creator_briefs').select('*').order('created_at', { ascending: false })),
        ok(db.from('creator_commissions').select('id, creator_id, kind, plan, store, base_cents, amount_cents, occurred_at').order('occurred_at', { ascending: false }).limit(60)),
        cp.rpc('creator_admin_referrals').catch(() => null),
      ]);
      const next = { ...overview, funnel, videos, rules, bonuses, payouts, volume, campaigns, briefs, sales: recent, briefDoc, managers, referrals };
      const stamp = JSON.stringify(next);
      const apply = () => {
        const before = quiet && state ? new Set((state.feed || []).map((e) => `${e.at}|${e.kind}|${e.title}`)) : null;
        lastStamp = stamp;
        state = next;
        if (!briefDirty) briefEdit = null;
        render();
        const fresh = before ? (next.feed || []).filter((e) => !before.has(`${e.at}|${e.kind}|${e.title}`)) : [];
        if (fresh.length) toast(fresh.length === 1 ? `${fresh[0].title}: ${fresh[0].detail}` : `${fresh.length} new notifications`);
      };
      if (quiet) {
        if (stamp === lastStamp) return;
        if (cp.live.busy() || (briefDirty && tab === 'brief')) return cp.live.offer(apply);
      }
      apply();
    } catch (error) {
      if (quiet) return;
      view.replaceChildren(h('div', { class: 'cp-card' }, h('h2', {}, 'Could not load'), h('p', { class: 'cp-muted' }, error.message), h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: reload }, 'Try again')));
    }
  }

  const foldPlain = (label, ...body) => {
    const el = cp.fold(label, ...body);
    el.classList.add('cp-fold--plain');
    return el;
  };
  const creatorOf = (id) => state.creators.find((c) => c.id === id) || { display_name: 'Unknown', code: '' };
  const rateOf = (c) => c.rate ?? c.commission_rate ?? state.settings.default_commission_rate;
  const tierName = (c) => (c.champion ? 'Champion' : (state.tiers.find((t) => t.level === c.incentives?.tier_level) || state.tiers[0] || { name: '' }).name);

  /* ---------------------------------------------------------------- render */

  function render() {
    const feed = state.feed || [];
    const seen = Number(store('mindroll.admin.seen') || 0);
    const contests = state.campaigns?.contests || [];
    const count = {
      alerts: feed.filter((e) => new Date(e.at).getTime() > seen).length,
      creators: state.creators.filter((c) => c.status === 'pending').length,
      videos: state.videos.filter((v) => v.status === 'pending').length,
      campaigns: contests.filter((k) => !k.settled_at && !k.open && !k.upcoming && new Date(k.pay_from || k.ends_at) <= new Date()).length,
      payouts: state.creators.filter((c) => c.cashout_requested_at).length,
    };
    const nav = h('nav', { class: 'mr-side', 'aria-label': 'Admin' }, TABS.map(([id, label, glyph]) => h('button', { class: 'mr-nav', type: 'button', 'aria-current': id === tab ? 'page' : null, onclick: go(id) }, icon(glyph), h('span', {}, label), count[id] ? h('b', {}, count[id] > 99 ? '99+' : String(count[id])) : null)));
    const body = { overview: home, alerts, creators, links: linksTab, referrals: referralsTab, managers: managersTab, brief: briefTab, rankings, campaigns, videos, revenue, bonuses, payouts, settings }[tab]();
    cp.root.dataset.help = helpOn() ? 'on' : 'off';
    const bellButton = h('button', { class: 'mr-bell', type: 'button', 'aria-label': `Notifications${count.alerts ? `, ${count.alerts} new` : ''}`, onclick: go('alerts') }, icon('bell'), count.alerts ? h('b', {}, count.alerts > 99 ? '99+' : String(count.alerts)) : null);
    const head = h('header', { class: 'mr-head' }, h('h1', {}, TABS.find(([id]) => id === tab)[1]), h('div', { class: 'mr-head__tools' }, helpButton(), tab === 'alerts' ? null : bellButton));
    view.replaceChildren(h('div', { class: 'mr-shell' }, nav, h('div', { class: 'mr-main' }, head, ...[body].flat().filter(Boolean))));
    cp.tabbar({ label: 'Admin', items: TABS.map(([id, label, glyph]) => [id, label, glyph, count[id]]), main: ['overview', 'creators', 'videos', 'payouts'], current: tab, open: (id) => go(id)(), icon });
    cp.live.drawn();
  }
  const go = (id) => () => { tab = id; history.replaceState(null, '', `#${id}`); render(); window.scrollTo(0, 0); };
  const store = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* private window */ } return null; };

  /* Explanations are hidden until asked for, so the screens stay numbers and pictures. */
  const helpOn = () => store('mindroll.admin.help') === 'on';
  function helpButton() {
    return h('button', { class: 'mr-tool', type: 'button', 'aria-pressed': String(helpOn()), title: 'Show or hide the explanations', onclick: () => { store('mindroll.admin.help', helpOn() ? 'off' : 'on'); render(); } }, helpOn() ? 'Hide notes' : 'Explain');
  }

  /* ---------------------------------------------------------- notifications */

  const FEED = { applied: ['users', 'New application', 'Review'], approved: ['users', 'Creator accepted', 'See creator'], cashout: ['wallet', 'Wants to be paid', 'Pay'], rank_up: ['trophy', 'Ranked up', 'See leaderboard'], first_top: ['trophy', 'Race prize won', 'Check and pay'], milestone: ['play', 'Big video', 'See videos'], growth: ['chart', 'Video taking off', 'See videos'], contest: ['flag', 'Campaign finished', 'Pay winners'] };
  const since = (iso) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  };
  /* Everything that has happened, newest first. Opening the page marks it all as seen. */
  function alerts() {
    const feed = state.feed || [];
    const seen = Number(store('mindroll.admin.seen') || 0);
    store('mindroll.admin.seen', String(Date.now()));
    if (!feed.length) return h('div', { class: 'mr-blank' }, icon('bell'), h('b', {}, 'Nothing yet'), h('span', {}, 'New creators, big videos and payment requests will show up here.'));
    const dayOf = (iso) => { const d = new Date(iso); const today = new Date(); const diff = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier'; };
    const row = (e) => {
      const [glyph, label, action] = FEED[e.kind] || ['bell', 'Update', 'Open'];
      return h('li', { class: 'mr-alert', 'data-kind': e.kind, 'data-new': new Date(e.at).getTime() > seen || null }, h('i', {}, icon(glyph)), h('div', {}, h('small', {}, label), h('b', {}, e.title), h('span', {}, e.detail)), h('time', {}, since(e.at)), h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: go(e.tab === 'rankings' && (e.kind === 'milestone' || e.kind === 'growth') ? 'rankings' : e.tab || 'overview') }, action));
    };
    return ['Today', 'Yesterday', 'Earlier'].map((group) => {
      const items = feed.filter((e) => dayOf(e.at) === group);
      return items.length ? h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, group), h('b', {}, String(items.length))), h('ul', { class: 'mr-alerts' }, items.map(row))) : null;
    });
  }

  /* ---------------------------------------------------------- video preview */

  /* The address TikTok, Instagram and YouTube give for showing one video inside another page. */
  function embedOf(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      if (host.endsWith('tiktok.com')) { const m = u.pathname.match(/\/video\/(\d+)/); return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null; }
      if (host.endsWith('instagram.com')) { const m = u.pathname.match(/\/(reel|reels|p|tv)\/([\w-]+)/); return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed` : null; }
      if (host === 'youtu.be') return u.pathname.length > 1 ? `https://www.youtube.com/embed/${u.pathname.slice(1)}` : null;
      if (host.endsWith('youtube.com')) { const m = u.pathname.match(/\/shorts\/([\w-]+)/); const id = m ? m[1] : u.searchParams.get('v'); return id ? `https://www.youtube.com/embed/${id}` : null; }
    } catch { /* not a link */ }
    return null;
  }
  function openPreview(url, title) {
    const src = embedOf(url);
    const close = () => { layer.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    const frame = src ? h('iframe', { src, title: title || 'Video', allow: 'encrypted-media; fullscreen; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }) : h('p', { class: 'mr-quiet' }, 'This link cannot be shown here.');
    const layer = h('div', { class: 'mr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Video preview', onclick: (event) => { if (event.target === layer) close(); } }, h('div', { class: 'mr-modal__box' }, h('div', { class: 'mr-modal__head' }, h('b', {}, title || 'Video'), h('button', { class: 'mr-tool', type: 'button', onclick: close }, 'Close')), frame, cp.safeUrl(url) ? h('a', { class: 'btn btn--ghost btn--sm', href: cp.safeUrl(url), target: '_blank', rel: 'noopener noreferrer' }, 'Open the original') : null));
    document.body.append(layer);
    document.addEventListener('keydown', onKey);
  }
  /* A "Watch" button for any video link that can be shown in place. */
  const watch = (url, title) => (embedOf(url) ? h('button', { class: 'mr-watch', type: 'button', onclick: () => openPreview(url, title) }, icon('play'), 'Watch') : null);

  /* ----------------------------------------------------------------- money */

  /*
   * Revenue the way a subscription dashboard shows it: a row of headline
   * figures for the chosen period, one chart each for revenue, new customers
   * and what you kept, and the latest sales underneath.
   */
  let revDays = 28;
  function revenue() {
    const t = state.totals;
    const all = state.pulse?.daily || [];
    const days = all.slice(-revDays);
    const before = all.slice(-2 * revDays, -revDays);
    const sum = (rows, key) => rows.reduce((total, d) => total + Number(d[key] || 0), 0);
    const dollars = (cents) => { const v = Math.round(cents / 100); return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`; };
    const change = (now, prev) => (before.length === days.length && prev > 0 ? Math.round(((now - prev) / prev) * 100) : null);
    const kpi = (label, value, delta, hint) => h('div', { class: 'mr-kpi' }, h('span', {}, label), h('b', {}, value), delta == null ? (hint ? h('small', {}, hint) : null) : h('small', { 'data-dir': delta >= 0 ? 'up' : 'down' }, `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%`, h('em', {}, ` vs the ${revDays} days before`)));
    const rev = sum(days, 'sales_cents');
    const paid = sum(days, 'paid_cents');
    const subs = sum(days, 'subs');
    const picker = h('div', { class: 'cp-switch', role: 'group', 'aria-label': 'Period' }, [[7, '7 days'], [28, '28 days'], [90, '90 days']].map(([n, label]) => h('button', { type: 'button', 'aria-pressed': String(revDays === n), onclick: () => { revDays = n; render(); } }, label)));
    const label = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const points = (key, map = (v) => v) => days.map((d) => ({ label: label(d.day), value: Math.max(0, map(Number(d[key] || 0), d)) }));
    const chart = (title, total, kind, pts, fmt) => h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, title), h('b', {}, total)), pts.some((pt) => pt.value > 0) ? cp.timeChart(kind, pts, fmt, title, fmt, cp.COLOR.ready) : h('p', { class: 'mr-quiet' }, 'Nothing in this period yet.'));
    const who = (id) => creatorOf(id).display_name;
    const KIND = { purchase: 'New subscriber', renewal: 'Renewal', refund: 'Refund' };
    return [
      h('div', { class: 'mr-bar' }, picker),
      h('section', { class: 'mr-kpis' },
        kpi('Revenue', dollars(rev), change(rev, sum(before, 'sales_cents'))),
        kpi('New customers', num(subs), change(subs, sum(before, 'subs'))),
        kpi('Active subscribers', num(t.recurring_subs || 0), null, 'paying weekly now'),
        kpi('Monthly recurring', dollars(t.recurring_sales_month_cents || 0), null, 'estimate'),
        kpi('Paid to creators', dollars(paid), change(paid, sum(before, 'paid_cents'))),
        kpi('You keep', dollars(rev - paid), change(rev - paid, sum(before, 'sales_cents') - sum(before, 'paid_cents'))),
      ),
      chart('Revenue', dollars(rev), revDays > 28 ? 'line' : 'columns', points('sales_cents'), dollars),
      h('div', { class: 'mr-two' }, chart('New customers', num(subs), 'columns', points('subs'), num), chart('You keep', dollars(rev - paid), revDays > 28 ? 'line' : 'columns', points('sales_cents', (v, d) => v - Number(d.paid_cents || 0)), dollars)),
      h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Latest sales')),
        table(
          [
            { label: 'When', cell: (m) => since(m.occurred_at) },
            { label: 'Creator', cell: (m) => h('b', {}, who(m.creator_id)) },
            { label: 'What', cell: (m) => h('span', { class: 'cp-inline' }, pill(KIND[m.kind] || m.kind, m.kind === 'refund' ? 'bad' : m.kind === 'purchase' ? 'good' : undefined), m.plan === 'annual' ? 'Yearly' : m.plan === 'weekly' ? 'Weekly' : '') },
            { label: 'Sale', num: true, cell: (m) => h('b', {}, money(m.base_cents)) },
            { label: 'Creator gets', num: true, cell: (m) => money(m.amount_cents) },
          ],
          state.sales || [],
          'No sales yet.',
        )),
    ];
  }

  /* ------------------------------------------------------------------ home */

  /*
   * One screen that says what is going on: what needs you, the money, the
   * week, who is in, and what is live. Big numbers, few words. Every bubble
   * goes to the tab that deals with it.
   */
  function home() {
    const t = state.totals;
    const p = state.pulse || { daily: [] };
    const s = state.settings;
    const spend = Math.max(0, t.commission_cents) + t.bonus_cents;
    const net = (t.net_cents ?? t.revenue_cents) - spend;
    const gross = t.gross_cents ?? t.revenue_cents ?? 0;
    const kept = gross > 0 ? Math.round((net / gross) * 100) : null;
    const big = (cents) => { const v = Math.round(cents / 100); return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`; };
    const active = state.creators.filter((c) => c.status === 'active');
    const contests = state.campaigns?.contests || [];
    const payable = contests.filter((k) => !k.settled_at && !k.open && !k.upcoming && new Date(k.pay_from || k.ends_at) <= new Date());
    const toCheck = contests.filter((k) => !k.settled_at && k.metric !== 'subs').reduce((sum, k) => sum + k.videos.filter((v) => !v.approved).length, 0);
    const manyNeed = s.manychat_commission_cents || 0;
    const ready = state.creators.reduce((sum, c) => sum + Math.max(0, c.balance.available_cents), 0);

    const todo = [
      ['Applications', state.creators.filter((c) => c.status === 'pending').length, 'creators'],
      ['Cash-outs', state.creators.filter((c) => c.cashout_requested_at).length, 'creators'],
      ['Videos to check', toCheck, 'campaigns'],
      ['Campaigns to pay', payable.length, 'campaigns'],
      ['Accounts to approve', active.filter((c) => c.handle_verified === false && (c.tiktok || c.instagram)).length, 'creators'],
      ['ManyChat', manyNeed ? active.filter((c) => !c.manychat_at && (c.balance.commission_cents || 0) >= manyNeed).length : 0, 'creators'],
      ['On hold', state.creators.filter((c) => c.payout_hold).length, 'creators'],
    ].filter(([, count]) => count > 0);

    const daily = (p.daily || []).slice(-14);
    const top = Math.max(1, ...daily.map((d) => Number(d.sales_cents)));
    const spark = h('div', { class: 'mr-spark', role: 'img', 'aria-label': 'Sales each day for the last 14 days' }, daily.map((d, i) => cp.tip ? h('i', { style: `height:${Math.max(4, (Number(d.sales_cents) / top) * 100).toFixed(1)}%`, 'data-today': i === daily.length - 1 || null }) : h('i', { title: `${day(d.day)}: ${big(d.sales_cents)}`, style: `height:${Math.max(4, (Number(d.sales_cents) / top) * 100).toFixed(1)}%`, 'data-today': i === daily.length - 1 || null })));
    const prev = Number(p.sales_prev_7d_cents || 0);
    const now7 = Number(p.sales_7d_cents || 0);
    const delta = prev > 0 ? Math.round(((now7 - prev) / prev) * 100) : null;

    const tile = (tone, label, value, foot, onclick) => h(onclick ? 'button' : 'div', { class: 'mr-tile', 'data-tone': tone, type: onclick ? 'button' : null, onclick: onclick || null }, h('span', { class: 'mr-tile__label' }, label), h('b', { class: 'mr-tile__value' }, value), foot ? h('span', { class: 'mr-tile__foot' }, foot) : null);

    /* Creators as bubbles, one per tier, sized by how many are in it. */
    const TONE = ['#7A808A', '#A9B1BC', '#D9A441', '#6FA3B5', '#2A78A6'];
    const groups = [...state.tiers.map((tier, i) => ({ name: tier.name, n: active.filter((c) => !c.champion && (c.tier_level ?? c.incentives?.tier_level ?? 1) === tier.level).length, tone: TONE[i % TONE.length] })), { name: 'Champion', n: active.filter((c) => c.champion).length, tone: '#B4552D' }];
    const most = Math.max(1, ...groups.map((g) => g.n));
    const bubbles = h('div', { class: 'mr-bubbles' }, groups.map((g) => h('div', { class: 'mr-bubble', 'data-empty': g.n === 0 || null }, h('i', { style: `--size:${(3.4 + 4.6 * Math.sqrt(g.n / most)).toFixed(2)}rem;--tone:${g.tone}` }, String(g.n)), h('span', {}, g.name))));

    /* Click to subscriber, as three shrinking circles. */
    const clicks = state.creators.reduce((sum, c) => sum + (c.stats.clicks || 0), 0);
    const steps = [['Clicks', clicks], ['Sign-ups', t.signups || 0], ['Subscribers', t.customers || 0]];
    const rate = (x, y) => (y > 0 ? `${Math.round((x / y) * 1000) / 10}%` : '–');
    const funnel = h('div', { class: 'mr-funnel' }, steps.map(([label, n], i) => [i ? h('em', {}, rate(n, steps[i - 1][1])) : null, h('div', { class: 'mr-funnel__step' }, h('i', { style: `--size:${(4 + 5 * Math.sqrt(n / Math.max(1, steps[0][1]))).toFixed(2)}rem` }, compact(n)), h('span', {}, label))]));

    const leaders = [...active].sort((x, y) => (y.incentives?.window_revenue_cents || 0) - (x.incentives?.window_revenue_cents || 0)).filter((c) => (c.incentives?.window_revenue_cents || 0) > 0).slice(0, 3);
    const hit = (state.campaigns?.top_videos?.week || [])[0];
    const live = contests.filter((k) => k.open || k.upcoming);
    const left = (iso) => { const hrs = Math.max(0, (new Date(iso).getTime() - Date.now()) / 36e5); return hrs >= 48 ? `${Math.round(hrs / 24)}d` : hrs >= 1 ? `${Math.round(hrs)}h` : `${Math.max(1, Math.round(hrs * 60))}m`; };

    return [
      todo.length
        ? h('section', { class: 'mr-todo', 'aria-label': 'Needs you' }, h('h2', {}, 'Needs you'), h('div', {}, todo.map(([label, count, to]) => h('button', { type: 'button', onclick: go(to) }, h('b', {}, String(count)), h('span', {}, label)))))
        : h('section', { class: 'mr-todo mr-todo--clear' }, h('h2', {}, 'Needs you'), h('p', {}, 'Nothing. You are all caught up.')),

      h(
        'section',
        { class: 'mr-grid' },
        h('div', { class: 'mr-tile mr-tile--hero', 'data-tone': 'ink' }, h('span', { class: 'mr-tile__label' }, 'Net income'), h('b', { class: 'mr-tile__value' }, big(net)), h('div', { class: 'mr-tile__row' }, h('span', {}, h('b', {}, big(gross)), 'sales'), h('span', {}, h('b', {}, big(spend)), 'to creators'), kept == null ? null : h('span', { 'data-warn': (s.min_margin_rate != null && kept < s.min_margin_rate * 100) || null }, h('b', {}, `${kept}%`), 'kept')), daily.length ? spark : null),
        tile('clay', 'Sales, 7 days', big(now7), delta == null ? `${big(p.sales_today_cents || 0)} today` : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% on last week`),
        tile('paper', 'New subscribers, 7 days', num(p.subs_7d || 0), `${num(p.subs_today || 0)} today`),
        tile('paper', 'Views, 7 days', compact(p.views_7d || 0), `${compact(p.views_today || 0)} today · ${num(p.videos_7d || 0)} videos`),
        tile('amber', 'Ready to pay', big(ready), `${big(Math.max(0, spend - t.paid_cents))} owed in all`, go('creators')),
      ),

      h(
        'div',
        { class: 'mr-two' },
        h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Creators'), h('b', {}, String(active.length))), bubbles),
        h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Click to subscriber'), h('b', {}, rate(steps[2][1], steps[0][1]))), funnel),
      ),

      h(
        'div',
        { class: 'mr-two' },
        h(
          'section',
          { class: 'mr-panel' },
          h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Top creators, 30 days'), h('button', { class: 'cp-link', type: 'button', onclick: go('rankings') }, 'All')),
          leaders.length ? h('ol', { class: 'mr-leaders' }, leaders.map((c, i) => h('li', {}, h('i', {}, String(i + 1)), h('span', {}, h('b', {}, c.display_name), h('small', {}, tierName(c))), h('b', {}, big(c.incentives.window_revenue_cents))))) : h('p', { class: 'mr-quiet' }, 'No sales yet.'),
        ),
        h(
          'section',
          { class: 'mr-panel' },
          h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Top video this week'), h('button', { class: 'cp-link', type: 'button', onclick: go('rankings') }, 'All')),
          hit ? h('div', { class: 'mr-hit' }, h('b', {}, `+${compact(hit.gained)}`), h('span', {}, cp.safeUrl(hit.url) ? h('a', { href: cp.safeUrl(hit.url), target: '_blank', rel: 'noopener noreferrer' }, hit.title || 'Watch') : hit.title || 'Untitled', h('small', {}, hit.creator)), watch(hit.url, hit.title)) : h('p', { class: 'mr-quiet' }, 'No video has gained views this week.'),
          h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Live now'), h('button', { class: 'cp-link', type: 'button', onclick: go('campaigns') }, 'Campaigns')),
          live.length ? h('ul', { class: 'mr-live' }, live.map((k) => h('li', {}, h('i', { 'data-upcoming': k.upcoming || null }), h('span', {}, h('b', {}, k.title), h('small', {}, `${num(k.entrants)} in${k.standing[0] ? ` · ${k.standing[0].name} leads` : ''}`)), h('b', {}, k.upcoming ? `in ${left(k.starts_at)}` : `${left(k.ends_at)} left`)))) : h('p', { class: 'mr-quiet' }, 'No campaign running.'),
        ),
      ),

      cp.fold('All the numbers', ...[overview()].flat().filter(Boolean)),
    ];
  }

  /* -------------------------------------------------------------- overview */

  /* The share of what subscribers paid that is left after store fees and everything owed to creators. */
  function keptPill(t) {
    const gross = t.gross_cents ?? 0;
    if (gross <= 0) return null;
    const kept = ((t.net_cents ?? 0) - t.commission_cents - t.bonus_cents) / gross;
    const floor = state.settings.min_margin_rate;
    const label = `You keep ${Math.round(kept * 1000) / 10}%`;
    return pill(floor == null ? label : `${label} · floor ${Math.round(floor * 100)}%`, floor == null || kept >= floor ? 'good' : 'warn');
  }

  function overview() {
    const t = state.totals;
    const short = (cents) => money(cents).replace(/\.00$/, '');
    const sum = (pick) => state.creators.reduce((total, c) => total + Math.max(0, pick(c)), 0);
    const top = [...state.creators].filter((c) => c.stats.revenue_cents > 0).sort((x, y) => y.stats.revenue_cents - x.stats.revenue_cents).slice(0, 6);
    const spend = Math.max(0, t.commission_cents) + t.bonus_cents;
    const netIncome = (t.net_cents ?? t.revenue_cents) - spend;
    return [
      h(
        'div',
        { class: 'cp-three' },
        h('section', { class: 'cp-card' }, cp.figure('Net income', money(netIncome)), h('p', { class: 'cp-muted cp-small' }, 'What arrived after store fees, less everything owed to creators.')),
        h('section', { class: 'cp-card' }, cp.figure('Total spend on creators', money(spend)), h('p', { class: 'cp-muted cp-small' }, 'Commission, bonuses, prizes and referrals, paid or not yet.')),
        h('section', { class: 'cp-card' }, cp.figure('Paid out so far', money(t.paid_cents)), h('p', { class: 'cp-muted cp-small' }, `${money(Math.max(0, spend - t.paid_cents))} still to pay.`)),
      ),
      h(
        'div',
        { class: 'cp-two cp-even' },
        h(
          'section',
          { class: 'cp-card' },
          h('div', { class: 'cp-card__head' }, cp.figure('Subscribers from creators paid', money(t.gross_cents ?? t.revenue_cents), true), keptPill(t)),
          cp.segbar(
            [
              { label: 'You keep', value: Math.max(0, (t.net_cents ?? t.revenue_cents) - t.commission_cents - t.bonus_cents), color: cp.COLOR.paid },
              { label: 'Commission', value: Math.max(0, t.commission_cents), color: cp.COLOR.ready },
              { label: 'Bonuses', value: t.bonus_cents, color: cp.COLOR.wait, dark: true },
              { label: 'Store fees', value: Math.max(0, (t.gross_cents ?? t.revenue_cents) - (t.net_cents ?? t.revenue_cents)), color: '#8A8F98' },
            ],
            short,
          ),
        ),
        h(
          'section',
          { class: 'cp-card' },
          cp.figure('Creators have earned', money(t.commission_cents + t.bonus_cents)),
          cp.segbar(
            [
              { label: 'Paid', value: t.paid_cents, color: cp.COLOR.paid },
              { label: 'Ready to pay', value: sum((c) => c.balance.available_cents), color: cp.COLOR.ready },
              { label: 'Still clearing', value: sum((c) => c.balance.pending_cents), color: cp.COLOR.wait, dark: true },
            ],
            short,
          ),
          h('div', { class: 'cp-card__foot' }, h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => { tab = 'creators'; history.replaceState(null, '', '#creators'); render(); } }, 'Pay creators')),
        ),
      ),
      h(
        'div',
        { class: 'cp-two cp-even' },
        section('Top creators', h('span', { class: 'cp-muted' }, 'Revenue brought in'), top.length ? cp.hbars(top.map((c) => ({ label: c.display_name, value: c.stats.revenue_cents, note: `${num(c.stats.customers)} subscribers` })), short) : h('p', { class: 'cp-empty' }, 'No sales from creators yet.')),
        section(
          'From click to subscriber',
          null,
          cp.hbars(
            [
              { label: 'Clicked a link', value: sum((c) => c.stats.clicks) },
              { label: 'Signed up', value: t.signups },
              { label: 'Subscribed', value: t.customers },
            ],
            num,
          ),
        ),
      ),
      funnelCard(),
      planCard(t),
      cpmCard(t),
      t.views > 0 && section('Views by creator', h('span', { class: 'cp-muted' }, compact(t.views) + ' total'), cp.hbars([...state.creators].filter((c) => c.stats.views > 0).sort((x, y) => y.stats.views - x.stats.views).slice(0, 6).map((c) => ({ label: c.display_name, value: c.stats.views, note: `${num(c.stats.videos)} videos` })), compact, cp.COLOR.paid)),
    ];
  }

  /*
   * Where visitors from creator links stop. One bar per step they reached, in
   * order, so the longest fall between two bars is the place to fix.
   */
  function funnelCard() {
    const f = state.funnel || { visitors: 0, signups: 0, customers: 0, steps: [], days: 30 };
    const who = h('select', { class: 'cp-input', 'aria-label': 'Creator' }, h('option', { value: '' }, 'All creators'), state.creators.filter((c) => c.status !== 'pending').map((c) => h('option', { value: c.id, selected: c.id === funnelCreator }, c.display_name)));
    who.addEventListener('change', async () => {
      funnelCreator = who.value || null;
      if (cp.demo) return render();
      try {
        state.funnel = await cp.rpc('creator_admin_funnel', { p_creator: funnelCreator, p_days: 30 });
        render();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    /* Pages with steps of their own (the sign-up funnels); every page has a plain "view". */
    const flows = [...new Set(f.steps.filter((row) => row.step !== 'view').map((row) => row.path))];
    if (!flows.includes(funnelPath)) funnelPath = flows[0] || null;
    const name = (step) => (step === 'checkout-click' ? 'Pressed pay' : step.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
    const rows = [{ label: 'Came in on a link', value: f.visitors }];
    if (funnelPath) {
      const opened = f.steps.find((row) => row.path === funnelPath && row.step === 'view');
      if (opened) rows.push({ label: `Opened ${funnelPath}`, value: opened.visitors });
      f.steps.filter((row) => row.path === funnelPath && row.step !== 'view').sort((a, b) => a.position - b.position).forEach((row) => rows.push({ label: name(row.step), value: row.visitors }));
    } else {
      f.steps.filter((row) => row.step === 'view' && row.path !== '/').forEach((row) => rows.push({ label: `Opened ${row.path}`, value: row.visitors }));
    }
    /* A sign-up flow has its own account step; without one, the count of new accounts stands in. */
    if (!funnelPath) rows.push({ label: 'Created an account', value: f.signups });
    rows.push({ label: 'Subscribed (paid)', value: f.customers });

    /* How many were lost getting to each step, and which step lost the most. */
    let worst = null;
    rows.forEach((row, i) => {
      const before = i ? rows[i - 1].value : 0;
      if (!i || before <= 0 || row.value >= before) return;
      const lost = before - row.value;
      row.note = `−${Math.round((lost / before) * 100)}%`;
      if (!worst || lost > worst.lost) worst = { lost, from: rows[i - 1].label, to: row.label, share: lost / before };
    });

    const switcher = flows.length > 1
      ? h('div', { class: 'cp-switch', role: 'group', 'aria-label': 'Which sign-up flow' }, flows.map((path) => h('button', { type: 'button', 'aria-pressed': String(path === funnelPath), onclick: () => { funnelPath = path; render(); } }, path)))
      : null;
    return section(
      'Where visitors drop off',
      h('span', { class: 'cp-inline' }, switcher, who),
      f.visitors > 0 ? cp.hbars(rows, num) : h('p', { class: 'cp-empty' }, 'Nothing yet. Each step a visitor reaches after clicking a creator link is counted here.'),
      worst ? h('p', { class: 'cp-muted cp-small' }, `Biggest drop: ${num(worst.lost)} of ${num(worst.lost / worst.share)} visitors (${Math.round(worst.share * 100)}%) left between "${worst.from}" and "${worst.to}".`) : null,
      h('p', { class: 'cp-muted cp-small' }, `Last ${f.days} days. Each visitor is counted once per step.`),
    );
  }

  /* Where the money comes from: plans that pay once a year, and plans that keep paying. */
  function planCard(t) {
    return h(
      'div',
      { class: 'cp-two cp-even' },
      h(
        'section',
        { class: 'cp-card' },
        cp.figure('Recurring sales from creators', `${cp.dollars(t.recurring_sales_month_cents || 0)} a month`),
        h('p', { class: 'cp-muted cp-small' }, `An estimate: each weekly subscriber counts as 4.2 payments a month${state.settings.commission_base === 'net' ? ', after store fees' : ''}. Creators earn about ${cp.dollars(t.recurring_commission_month_cents || 0)} a month of it.`),
      ),
      section(
        'Subscribers by plan',
        null,
        cp.hbars(
          [
            { label: 'Yearly', value: t.annual_subs || 0, note: `${cp.dollars(t.annual_sales_cents || 0)} in sales; the creator gets commission plus a flat amount for each new one` },
            { label: 'Weekly', value: t.recurring_subs || 0, note: 'Paying now' },
          ],
          num,
        ),
      ),
    );
  }

  /*
   * The question the program has to answer: is paying a share of sales
   * cheaper than paying for views? Both bars are for the same videos.
   */
  function cpmCard(t) {
    if (!t.views) return null;
    const cost = Math.max(0, t.commission_cents + t.bonus_cents);
    const flat = Math.round((t.views / 1000) * 100);
    const per = (cents) => money(Math.round((cents / t.views) * 1000));
    return section(
      'Against paying $1 per 1,000 views',
      h('span', { class: 'cp-muted' }, cost <= flat ? `You have saved ${cp.dollars(flat - cost)}` : `Costing ${cp.dollars(cost - flat)} more`),
      cp.hbars(
        [
          { label: 'This program has cost', value: cost, note: `${per(cost)} per 1,000 views` },
          { label: 'A $1 CPM would have cost', value: flat, note: '$1.00 per 1,000 views' },
        ],
        cp.dollars,
        cp.COLOR.paid,
      ),
      h('p', { class: 'cp-muted cp-small' }, `Creators' videos have brought in ${per(t.revenue_cents)} of sales per 1,000 views, and you have paid ${per(cost)} of it to creators.`),
    );
  }

  /* -------------------------------------------------------------- creators */

  function creators() {
    const setStatus = (c, status, label, cls = 'btn btn--ghost btn--sm') => {
      const button = h('button', { class: cls, type: 'button' }, label);
      button.addEventListener(
        'click',
        act(button, async () => {
          await ok(db.from('program_creators').update({ status, ...(status === 'active' && !c.approved_at ? { approved_at: new Date().toISOString() } : {}) }).eq('id', c.id));
          toast(`${c.display_name}: ${status}`);
          await reload();
        }),
      );
      return button;
    };

    /* Removing is the existing 'rejected' status: the link, tracking, prizes and payouts all require 'active'. */
    const kick = (c) =>
      confirmButton('Remove from the program', `Confirm: remove ${c.display_name}`, 'cp-link cp-bad', async () => {
        await ok(db.from('program_creators').update({ status: 'rejected' }).eq('id', c.id));
        toast(`${c.display_name} was removed from the program`);
        await reload();
      });

    const rateEditor = (c) => {
      const input = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', max: '100', step: '0.5', value: String(Math.round(rateOf(c) * 1000) / 10), 'aria-label': `Commission rate for ${c.display_name}` });
      const save = h('button', { class: 'cp-link', type: 'button' }, 'Save');
      save.addEventListener(
        'click',
        act(save, async () => {
          const value = Number(input.value);
          if (!(value >= 0 && value <= 100)) throw new Error('Enter a rate between 0 and 100.');
          await ok(db.from('program_creators').update({ commission_rate: value / 100 }).eq('id', c.id));
          toast(`${c.display_name} now earns ${value}% on new payments.`);
          await reload();
        }),
      );
      const clear = h('button', { class: 'cp-link', type: 'button' }, 'Use tier rate');
      clear.addEventListener('click', act(clear, async () => { await ok(db.from('program_creators').update({ commission_rate: null }).eq('id', c.id)); await reload(); }));
      return h('span', { class: 'cp-inline' }, input, '%', save, c.commission_rate == null ? h('span', { class: 'cp-muted cp-small' }, 'set by tier') : clear);
    };

    const pay = (c) => {
      if (c.payout_hold) return h('span', { class: 'cp-bad cp-small' }, 'On hold: nothing is paid');
      const amount = c.balance.available_cents;
      if (c.balance.in_transit_cents > 0) {
        return confirmButton('Retry payout', `Confirm retry ${money(c.balance.in_transit_cents)}`, 'btn btn--ghost btn--sm', () => send(c, 'stripe'));
      }
      if (amount <= 0 || amount < state.settings.min_payout_cents) return h('span', { class: 'cp-muted cp-small' }, amount > 0 ? 'Under minimum' : '');
      const NAMES = { paypal: 'PayPal', venmo: 'Venmo', zelle: 'Zelle' };
      if (c.payout_handle) {
        return h('span', { class: 'cp-inline' }, h('span', { class: 'cp-small' }, h('b', {}, NAMES[c.payout_method] || 'Pay'), ' ', h('code', { class: 'cp-mono' }, c.payout_handle)), confirmButton(`Mark ${money(amount)} paid`, `Confirm: you sent ${money(amount)} by ${NAMES[c.payout_method] || 'hand'}`, 'btn btn--primary btn--sm', () => send(c, 'manual')));
      }
      return h(
        'span',
        { class: 'cp-inline' },
        c.payouts_enabled ? confirmButton(`Pay ${money(amount)}`, `Confirm: send ${money(amount)}`, 'btn btn--primary btn--sm', () => send(c, 'stripe')) : h('span', { class: 'cp-muted cp-small' }, 'Has not said how to pay them'),
        confirmButton('Mark paid', `Confirm: ${money(amount)} paid outside Stripe`, 'cp-link', () => send(c, 'manual')),
      );
    };

    async function send(c, method) {
      const out = await cp.fn('creator-payout', { creator_id: c.id, method });
      toast(`${money(out.payout.amount_cents)} ${method === 'manual' ? 'recorded as paid to' : 'sent to'} ${c.display_name}.`);
      await reload();
    }

    /* Videos are credited by these accounts, so each one links to the profile for a look before approving. */
    const clean = (value) => String(value || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^.*[/@]/, '').toLowerCase().replace(/[^a-z0-9._]/g, '');
    const profile = (c, platform) => {
      const handle = clean(c[platform]);
      if (!handle) return null;
      const href = platform === 'tiktok' ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}/`;
      return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, `${platform === 'tiktok' ? 'TikTok' : 'Instagram'} @${handle}`);
    };
    /*
     * A message to a creator, sent by hand from the admin's own Instagram.
     * Instagram lets no website start a conversation, so the button does the
     * two things it can: it copies a ready message with the creator's name in
     * it, and opens the chat with them. The admin pastes and sends.
     */
    const DASH = 'https://getmindroll.com/creators/';
    const NOTES = [
      ['approved', 'You are approved', (n) => `Hey ${n}, this is Mindroll. You're approved for the creator program 🎉 Your dashboard is open here: ${DASH} Your first video earns double if you post it within 24 hours of opening the dashboard. Any questions, just message me here.`],
      ['talk', 'About your application', (n) => `Hey ${n}, this is Mindroll. Thanks for applying to the creator program. Do you have a minute to talk about it here?`],
      ['nudge', 'No video yet', (n) => `Hey ${n}, checking in from Mindroll. You're in the creator program but we haven't seen a first video yet. Is anything in the way? Your dashboard is here: ${DASH} Happy to help with ideas.`],
      ['discord', 'Join the Discord', (n) => `Hey ${n}, this is Mindroll. Join our creator Discord, it's where we post video ideas and pay updates. Open your dashboard and press Connect Discord: ${DASH}`],
    ];
    const dm = (c) => {
      const ig = clean(c.instagram);
      const tt = clean(c.tiktok);
      if (!ig && !tt) return null;
      const first = String(c.display_name || '').trim().split(/\s+/)[0] || 'there';
      const start = c.status === 'pending' ? 'talk' : !c.stats?.videos ? (c.approved_at && Date.now() - new Date(c.approved_at).getTime() > 3 * 864e5 ? 'nudge' : 'approved') : !c.discord_name ? 'discord' : 'approved';
      const pick = h('select', { class: 'cp-input mr-dm__pick', 'aria-label': `Message for ${c.display_name}` }, NOTES.map(([id, label]) => h('option', { value: id, selected: id === start }, label)));
      const send = (label, href, where) =>
        h('a', { class: 'btn btn--ghost btn--sm', href, target: '_blank', rel: 'noopener noreferrer', onclick: () => {
          const text = NOTES.find(([id]) => id === pick.value)[2](first);
          navigator.clipboard.writeText(text).then(() => toast(`Message copied. Paste it into the ${where} chat and send.`), () => toast('Could not copy the message. Copy it from the box under the button.', 'error'));
          preview.textContent = text;
          preview.hidden = false;
        } }, label);
      const preview = h('p', { class: 'cp-note mr-dm__text', hidden: true });
      return h('div', { class: 'mr-dm' }, h('div', { class: 'cp-inline' }, pick, ig ? send('Message on Instagram', `https://ig.me/m/${ig}`, 'Instagram') : null, tt ? send(ig ? 'TikTok' : 'Message on TikTok', `https://www.tiktok.com/@${tt}`, 'TikTok') : null), preview);
    };
    const handles = (c) => h('span', { class: 'cp-small cp-inline' }, profile(c, 'tiktok'), profile(c, 'instagram'), !clean(c.tiktok) && !clean(c.instagram) ? h('span', { class: 'cp-bad' }, 'No account linked') : null);

    const handleEditor = (c) => {
      const tiktok = h('input', { class: 'cp-input', value: clean(c.tiktok), placeholder: 'TikTok handle', 'aria-label': `TikTok handle for ${c.display_name}` });
      const instagram = h('input', { class: 'cp-input', value: clean(c.instagram), placeholder: 'Instagram handle', 'aria-label': `Instagram handle for ${c.display_name}` });
      const save = h('button', { class: 'cp-link', type: 'button' }, 'Save accounts');
      save.addEventListener(
        'click',
        act(save, async () => {
          try {
            await ok(db.from('program_creators').update({ tiktok: clean(tiktok.value) || null, instagram: clean(instagram.value) || null }).eq('id', c.id));
          } catch (error) {
            throw new Error(/duplicate|unique/i.test(error.message) ? 'Another creator has already linked that account.' : error.message);
          }
          toast(`Accounts saved for ${c.display_name}.`);
          await reload();
        }),
      );
      return h('span', { class: 'cp-inline' }, tiktok, instagram, save);
    };

    const topRevenue = Math.max(1, ...state.creators.map((c) => c.stats.revenue_cents));
    const revenueBar = (c) => {
      const bar = cp.hbars([{ label: '', value: c.stats.revenue_cents, note: `${num(c.stats.customers)} subscribers` }], (cents) => money(cents).replace(/\.00$/, ''));
      bar.querySelector('i').style.width = `${Math.max(0.6, (c.stats.revenue_cents / topRevenue) * 100).toFixed(2)}%`;
      bar.querySelector('.cp-hbars__label').remove();
      return bar;
    };

    /* Suspected cheating: nothing is paid, released or ranked while the hold is on. */
    const holdControl = (c) => {
      if (c.payout_hold) {
        const lift = confirmButton('Lift the hold', 'Confirm: release their money again', 'cp-link', async () => { await ok(db.from('program_creators').update({ payout_hold: false, hold_reason: null }).eq('id', c.id)); toast(`Hold lifted for ${c.display_name}.`); await reload(); });
        return h('span', { class: 'cp-inline' }, h('span', { class: 'cp-bad' }, `On hold${c.hold_reason ? `: ${c.hold_reason}` : ''}`), lift);
      }
      const why = h('input', { class: 'cp-input', placeholder: 'Why (only you see this)', maxlength: '200', 'aria-label': `Reason for holding ${c.display_name}` });
      const hold = confirmButton('Hold payouts', 'Confirm: stop all money to this creator', 'cp-link', async () => { await ok(db.from('program_creators').update({ payout_hold: true, hold_reason: why.value.trim() || null }).eq('id', c.id)); toast(`${c.display_name} is on hold. Nothing will be paid or released.`); await reload(); });
      return h('span', { class: 'cp-inline' }, why, hold);
    };
    /* Videos and views are only read from accounts that have been approved here or by the creator's manager. */
    const verifyControl = (c) => {
      const has = Boolean(c.tiktok || c.instagram);
      if (!has) return h('span', { class: 'cp-muted' }, 'No username added yet');
      const review = (approve) => async () => { await cp.rpc('creator_review_accounts', { p_creator: c.id, p_approve: approve }); toast(approve ? `${c.display_name}'s accounts are approved. Tracking starts on the hour.` : `Declined. ${c.display_name} can add the right usernames.`); await reload(); };
      if (c.handle_verified) {
        const undo = h('button', { class: 'cp-link', type: 'button' }, 'Stop tracking');
        undo.addEventListener('click', act(undo, async () => { await ok(db.from('program_creators').update({ handle_verified: false }).eq('id', c.id)); await reload(); }));
        return h('span', { class: 'cp-inline' }, pill('Approved, tracking', 'good'), undo);
      }
      const approve = h('button', { class: 'cp-link', type: 'button' }, 'Approve accounts');
      approve.addEventListener('click', act(approve, review(true)));
      return h('span', { class: 'cp-inline' }, pill('Waiting for approval', 'warn'), approve, confirmButton('Decline', 'Confirm: clear their usernames', 'cp-link', review(false)));
    };
    /* ManyChat: flagged once they have earned enough commission; you set it up and mark it done. */
    const manyNeed = state.settings.manychat_commission_cents || 0;
    const manyDue = (c) => manyNeed > 0 && !c.manychat_at && c.status === 'active' && (c.balance.commission_cents || 0) >= manyNeed;
    const manyControl = (c) => {
      if (!manyNeed) return null;
      const button = h('button', { class: 'cp-link', type: 'button' }, c.manychat_at ? 'Mark as not set up' : 'Mark ManyChat as set up');
      button.addEventListener('click', act(button, async () => { await ok(db.from('program_creators').update({ manychat_at: c.manychat_at ? null : new Date().toISOString() }).eq('id', c.id)); await reload(); }));
      return h('div', { class: 'cp-inline cp-small' }, h('span', { class: 'cp-muted' }, 'ManyChat'), c.manychat_at ? pill(`Set up ${day(c.manychat_at)}`, 'good') : manyDue(c) ? pill('Eligible: contact them', 'warn') : h('span', { class: 'cp-muted' }, `Unlocks at ${cp.dollars(manyNeed)} of commission (${cp.dollars(Math.max(0, c.balance.commission_cents || 0))} so far)`), button);
    };
    /* Lots of views and almost nobody clicking is the usual sign of bought views. */
    const odd = (c) => (c.stats.views >= 50000 && c.stats.clicks * 5000 < c.stats.views ? pill(`Check: ${compact(c.stats.views)} views, ${num(c.stats.clicks)} clicks`, 'warn') : null);

    /*
     * Who to call first. Followers count for half: the number read from the
     * account when we have it, otherwise what the applicant said. The rest is
     * how close their videos are to ours, how often they post, and whether
     * they have made paid videos before.
     */
    const NICHE = { books: ['Books and reading', 25], self_improvement: ['Self-improvement', 25], productivity: ['Productivity and study', 25], philosophy: ['Philosophy and psychology', 25], business: ['Business and money', 20], lifestyle: ['Lifestyle', 12], comedy: ['Comedy and entertainment', 5], other: ['Something else', 5] };
    const SAID = { under_1k: ['under 1K', 0], '1k_10k': ['1K to 10K', 1000], '10k_50k': ['10K to 50K', 10000], '50k_250k': ['50K to 250K', 50000], over_250k: ['over 250K', 250000] };
    const FREQ = { daily: ['Posts daily', 15], few_week: ['Posts a few times a week', 10], weekly: ['Posts weekly', 5], less: ['Posts rarely', 0] };
    const lead = (c) => {
      const found = [c.tiktok_followers, c.instagram_followers].filter((n) => n != null);
      const checked = found.length > 0;
      const followers = checked ? Math.max(...found) : SAID[c.followers_said]?.[1] ?? null;
      const size = followers == null ? 0 : followers >= 250000 ? 50 : followers >= 50000 ? 45 : followers >= 10000 ? 35 : followers >= 1000 ? 20 : 0;
      const score = size + (NICHE[c.niche]?.[1] ?? 0) + (FREQ[c.post_freq]?.[1] ?? 0) + (c.made_ugc ? 10 : 0);
      const answered = Boolean(c.niche || c.followers_said || c.post_freq || checked);
      /* Said one thing, the account shows far less. */
      const overstated = checked && c.followers_said && SAID[c.followers_said][1] > 0 && Math.max(...found) < SAID[c.followers_said][1] / 2;
      return { score, followers, checked, answered, overstated, grade: !answered ? ['Not rated', 'muted'] : score >= 60 ? ['High quality', 'good'] : score >= 35 ? ['Medium', 'warn'] : ['Low', 'muted'] };
    };
    const leadLine = (c) => {
      const l = lead(c);
      const check = h('button', { class: 'cp-link', type: 'button' }, c.followers_checked_at ? 'Check followers again' : 'Check followers');
      check.addEventListener('click', act(check, async () => {
        if (cp.demo) return toast('Sample data: nothing was checked.');
        const out = await cp.fn('creator-lead', { creator: c.id });
        toast(out?.skipped ? 'The follower check is not set up yet.' : out?.missed?.length ? `Could not read ${out.missed.join(' or ')}.` : 'Followers updated.');
        await reload();
      }));
      const counts = [c.tiktok_followers != null ? `${compact(c.tiktok_followers)} on TikTok` : null, c.instagram_followers != null ? `${compact(c.instagram_followers)} on Instagram` : null].filter(Boolean);
      return h(
        'div',
        { class: 'mr-lead' },
        h('div', { class: 'cp-inline' }, pill(l.grade[0], l.grade[1] === 'muted' ? undefined : l.grade[1]), l.answered ? h('b', {}, `${l.score}/100`) : null, l.overstated ? pill(`Said ${SAID[c.followers_said][0]}, account shows less`, 'warn') : null),
        h('p', { class: 'cp-small' }, counts.length ? h('b', {}, counts.join(' · ')) : c.followers_said ? `Says ${SAID[c.followers_said][0]} followers (not checked yet)` : 'Followers not known', c.followers_error ? h('span', { class: 'cp-bad' }, ` · ${c.followers_error}`) : null, ' · ', check),
        l.answered ? h('p', { class: 'cp-muted cp-small' }, [NICHE[c.niche]?.[0], FREQ[c.post_freq]?.[0], c.made_ugc == null ? null : c.made_ugc ? 'Has made brand videos' : 'No brand videos yet'].filter(Boolean).join(' · ')) : h('p', { class: 'cp-muted cp-small' }, 'Applied before the questions were added.'),
      );
    };
    const applicants = state.creators.filter((c) => c.status === 'pending').sort((x, y) => lead(y).score - lead(x).score || (lead(y).followers || 0) - (lead(x).followers || 0));
    const rest = state.creators.filter((c) => c.status !== 'pending');

    return [
      applicants.length
        ? section(
            'Applications',
            h('span', { class: 'cp-muted' }, `${applicants.length} waiting · best leads first`),
            h(
              'ul',
              { class: 'cp-apps' },
              applicants.map((c) =>
                h(
                  'li',
                  {},
                  h('div', {}, cp.person(c, { size: 'lg', badge: h('code', { class: 'cp-mono' }, c.code) }), h('p', { class: 'cp-muted cp-small' }, `${c.country || ''} · applied ${day(c.created_at)}${c.referred_by ? ` · invited by ${(state.creators.find((x) => x.id === c.referred_by) || {}).display_name || 'a creator'}` : ''}`), leadLine(c), c.note ? h('p', { class: 'cp-note' }, c.note) : null, dm(c)),
                  h('div', { class: 'cp-inline' }, setStatus(c, 'active', 'Approve', 'btn btn--primary btn--sm'), setStatus(c, 'rejected', 'Decline')),
                ),
              ),
            ),
          )
        : null,
      section(
        'Creators',
        h('span', { class: 'cp-muted' }, 'Revenue brought in'),
        rest.length
          ? h(
              'ul',
              { class: 'cp-rows' },
              rest.map((c) =>
                h(
                  'li',
                  {},
                  h('div', { class: 'mr-rowhead' }, cp.person(c, { size: 'lg', badge: c.status === 'active' ? pill(tierName(c), c.champion ? 'good' : undefined) : statusPill(c.status) }), ' ', c.cashout_requested_at ? pill('Asked to cash out', 'warn') : null, c.payout_hold ? pill('On hold', 'warn') : null, manyDue(c) ? pill('ManyChat eligible', 'good') : null, c.status === 'active' && !c.payout_hold ? odd(c) : null,  c.scan_error ? h('div', { class: 'cp-small cp-bad' }, `Last account check failed (${c.scan_error})`) : null),
                  revenueBar(c),
                  h('div', {}, pay(c)),
                  dm(c),
                  foldPlain(
                    'Details',
                    h('div', { class: 'cp-inline cp-small' }, h('span', { class: 'cp-muted' }, 'Earns'), rateEditor(c)),
                    h('div', { class: 'cp-inline cp-small' }, h('span', { class: 'cp-muted' }, 'Posts from'), handleEditor(c)),
                    h('div', { class: 'cp-inline cp-small' }, h('span', { class: 'cp-muted' }, 'Account'), verifyControl(c)),
                    manyControl(c),
                    h('div', { class: 'cp-inline cp-small' }, h('span', { class: 'cp-muted' }, 'Suspected cheating'), holdControl(c)),
                    h('p', { class: 'cp-small cp-muted' }, c.terms_accepted_at ? `Accepted the terms ${day(c.terms_accepted_at)}` : 'Has not accepted the terms yet'),
                    h('p', { class: 'cp-small cp-muted' }, c.discord_name ? `Discord: ${c.discord_name} (roles follow their rank)` : 'Discord not connected'),
                    h('p', { class: 'cp-small cp-muted' }, `Code ${c.code} · ${num(c.stats.clicks)} clicks · ${num(c.stats.signups)} sign-ups · ${money(c.balance.pending_cents)} still clearing · ${money(c.balance.paid_cents)} paid so far`),
                    c.status === 'active' ? setStatus(c, 'paused', 'Pause this creator', 'cp-link') : setStatus(c, 'active', c.status === 'rejected' ? (c.approved_at ? 'Let back in' : 'Approve') : 'Resume', 'cp-link'),
                    c.status !== 'rejected' ? kick(c) : h('p', { class: 'cp-small cp-muted' }, c.approved_at ? 'Removed from the program' : 'Application declined'),
                  ),
                ),
              ),
            )
          : h('p', { class: 'cp-empty' }, 'No creators yet. Applications appear above as they come in.'),
      ),
    ];
  }

  /* ----------------------------------------------------------------- links */

  /*
   * Every active creator's affiliate link: how many people clicked it, how many
   * made an account, how many subscribed, and how many creators joined the
   * program on that creator's invite link.
   */
  function linksTab() {
    const active = state.creators.filter((c) => c.status === 'active');
    const joinedOn = (c) => state.creators.filter((x) => x.referred_by === c.id);
    const sum = (pick) => active.reduce((n, c) => n + (pick(c) || 0), 0);
    const pct = (x, y) => (y > 0 ? `${Math.round((x / y) * 1000) / 10}%` : '–');
    const clicks = sum((c) => c.stats?.clicks);
    const signups = sum((c) => c.stats?.signups);
    const subs = sum((c) => c.stats?.customers);
    const joined = state.creators.filter((x) => x.referred_by).length;
    const tile = (tone, label, value, foot) => h('div', { class: 'mr-tile', 'data-tone': tone }, h('span', { class: 'mr-tile__label' }, label), h('b', { class: 'mr-tile__value' }, value), foot ? h('span', { class: 'mr-tile__foot' }, foot) : null);
    const copy = (text) => {
      const b = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; } setTimeout(() => { b.textContent = 'Copy'; }, 1500); } }, 'Copy');
      return b;
    };
    const linkOf = (c) => `https://getmindroll.com/start/?ref=${c.code}`;
    const inviteOf = (c) => `https://getmindroll.com/creators/?invite=${c.code}`;
    const ranked = [...active].sort((x, y) => (y.stats?.clicks || 0) - (x.stats?.clicks || 0));
    const invited = state.creators.filter((x) => x.referred_by).map((x) => ({ ...x, by: state.creators.find((c) => c.id === x.referred_by) }));
    const STATUS = { active: ['Accepted', 'good'], pending: ['Waiting for review', 'warn'], paused: ['Paused', 'muted'], rejected: ['Declined', 'bad'] };

    return [
      h(
        'div',
        { class: 'mr-grid' },
        tile('paper', 'Active links', num(active.length), 'one per approved creator'),
        tile('paper', 'Clicks', compact(clicks), 'people who opened a link'),
        tile('paper', 'Signed up', num(signups), `${pct(signups, clicks)} of clicks`),
        tile('amber', 'Subscribed', num(subs), `${pct(subs, clicks)} of clicks`),
      ),
      section(
        'Affiliate links',
        h('span', { class: 'cp-muted' }, `${num(active.length)} active`),
        table(
          [
            { label: 'Creator', cell: (c) => h('span', { class: 'cp-inline' }, h('b', {}, c.display_name), pill(tierName(c), c.champion ? 'good' : undefined)) },
            { label: 'Link', cell: (c) => h('span', { class: 'cp-inline' }, h('code', { class: 'cp-mono' }, linkOf(c).replace('https://', '')), copy(linkOf(c))) },
            { label: 'Clicks', num: true, cell: (c) => h('b', {}, num(c.stats?.clicks || 0)) },
            { label: 'Signed up', num: true, cell: (c) => num(c.stats?.signups || 0) },
            { label: 'Subscribed', num: true, cell: (c) => num(c.stats?.customers || 0) },
            { label: 'Click to subscriber', num: true, cell: (c) => pct(c.stats?.customers || 0, c.stats?.clicks || 0) },
            { label: 'Creators joined', num: true, cell: (c) => num(joinedOn(c).length) },
          ],
          ranked,
          'No active links yet. A creator gets their link the moment you approve them.',
        ),
        h('p', { class: 'cp-muted cp-small' }, 'Most clicked first. "Creators joined" counts people who applied to the program on that creator\'s invite link.'),
      ),
      section(
        'Joined on an invite link',
        h('b', {}, num(joined)),
        table(
          [
            { label: 'New creator', cell: (x) => h('b', {}, x.display_name) },
            { label: 'Invited by', cell: (x) => (x.by ? x.by.display_name : '–') },
            { label: 'Applied', cell: (x) => since(x.created_at) },
            { label: 'Status', cell: (x) => pill(...(STATUS[x.status] || [x.status, 'muted'])) },
          ],
          invited,
          'Nobody has joined on a creator\'s invite link yet.',
        ),
        h('p', { class: 'cp-muted cp-small' }, 'Each creator also has an invite link for bringing in other creators (getmindroll.com/creators/?invite=their-code). Clicks and sign-ups on invite links are on the Referrals page.'),
      ),
      (state.links || []).length
        ? section(
            'Links per video or niche',
            h('span', { class: 'cp-muted' }, 'Tagged links, best first'),
            table(
              [
                { label: 'Creator', cell: (l) => h('b', {}, l.creator) },
                { label: 'Link', cell: (l) => h('code', { class: 'cp-mono' }, l.tag) },
                { label: 'Clicks', num: true, cell: (l) => num(l.clicks) },
                { label: 'Signed up', num: true, cell: (l) => num(l.signups) },
                { label: 'Subscribed', num: true, cell: (l) => num(l.customers) },
                { label: 'Sales', num: true, cell: (l) => h('b', {}, cp.dollars(l.sales_cents)) },
              ],
              [...state.links].sort((x, y) => y.clicks - x.clicks || y.sales_cents - x.sales_cents).slice(0, 100),
              '',
            ),
          )
        : null,
    ];
  }

  /* --------------------------------------------------------------- managers */

  /*
   * Creator managers. Add one by email; when they sign in on the creator page
   * with Google or Apple they get a team dashboard. Drag a creator onto a
   * manager to put them on that team.
   */
  let managerDrag = null;
  function managersTab() {
    const managers = state.managers || [];
    const s = state.settings || {};
    const all = state.creators.filter((c) => c.status !== 'rejected');
    const byId = new Map(all.map((c) => [c.id, c]));
    const nameOf = (id) => (managers.find((m) => m.manager.id === id) || {}).manager?.display_name;
    const dollars0 = (cents) => `$${Math.round(Number(cents || 0) / 100).toLocaleString('en-US')}`;

    const assign = async (creatorId, managerId) => {
      const c = byId.get(creatorId);
      if (!c || (c.manager_id || null) === (managerId || null)) return;
      try {
        if (cp.demo) { c.manager_id = managerId || null; toast(managerId ? `${c.display_name} is now on ${nameOf(managerId)}'s team. (Sample data: nothing was saved.)` : `${c.display_name} has no manager now. (Sample data: nothing was saved.)`); return render(); }
        await cp.rpc('creator_admin_set_manager', { p_creator: creatorId, p_manager: managerId || null });
        toast(managerId ? `${c.display_name} is now on ${nameOf(managerId)}'s team.` : `${c.display_name} has no manager now.`);
        await reload();
      } catch (error) { toast(error.message || 'Something went wrong.', 'error'); }
    };
    const chip = (c) => {
      const picker = h('select', { class: 'mr-ref__move', 'aria-label': `Move ${c.display_name} to` }, h('option', { value: '' }, 'Move to…'), h('option', { value: 'none' }, 'No manager'), managers.filter((m) => m.manager.id !== c.manager_id).map((m) => h('option', { value: m.manager.id }, m.manager.display_name)));
      picker.addEventListener('change', () => { const v = picker.value; picker.value = ''; if (v) assign(c.id, v === 'none' ? null : v); });
      const el = h('div', { class: 'mr-ref__chip', draggable: 'true' }, h('div', { class: 'mr-ref__who' }, cp.person(c, { badge: c.status === 'active' ? pill(tierName(c), c.champion ? 'good' : 'muted') : statusPill(c.status) })), h('div', { class: 'mr-ref__foot' }, h('span', {}, `${compact(c.incentives?.window_views || 0)} views · ${num(c.stats?.customers || 0)} subs`), picker));
      el.addEventListener('dragstart', (e) => { managerDrag = c.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.id); } catch { /* kept in memory too */ } el.dataset.dragging = ''; });
      el.addEventListener('dragend', () => { managerDrag = null; delete el.dataset.dragging; view.querySelectorAll('[data-over]').forEach((z) => delete z.dataset.over); });
      return el;
    };
    const zone = (m) => {
      const id = m ? m.manager.id : null;
      const list = all.filter((c) => (c.manager_id || null) === id || (!m && c.manager_id && !managers.some((x) => x.manager.id === c.manager_id))).sort((x, y) => (y.incentives?.window_views || 0) - (x.incentives?.window_views || 0));
      const remove = m ? confirmButton('Remove', 'Confirm: remove this manager', 'cp-link', async () => { if (cp.demo) { state.managers = managers.filter((x) => x !== m); all.forEach((c) => { if (c.manager_id === id) c.manager_id = null; }); toast('Removed. (Sample data: nothing was saved.)'); return render(); } await cp.rpc('creator_admin_remove_manager', { p_manager: id }); toast(`${m.manager.display_name} is no longer a manager. Their creators stay in the program.`); await reload(); }) : null;
      const cutBox = m ? (() => {
        const input = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', max: '100', step: '1', value: String(Math.round(Number(m.manager.cut_rate || 0) * 1000) / 10), 'aria-label': `${m.manager.display_name}'s cut, percent` });
        const save = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Save');
        save.addEventListener('click', act(save, async () => {
          const rate = Math.max(0, Math.min(100, Number(input.value) || 0)) / 100;
          if (cp.demo) { m.manager.cut_rate = rate; toast('Saved. (Sample data: nothing was saved.)'); return render(); }
          await ok(db.from('creator_managers').update({ cut_rate: rate }).eq('id', id));
          toast(`${m.manager.display_name} now gets ${Math.round(rate * 1000) / 10}% of what their team leaves after the creators are paid.`);
          await reload();
        }));
        const p = m.pay || {};
        return h('div', { class: 'mr-ref__cut' }, h('label', {}, h('span', {}, h('b', {}, 'Their cut'), h('small', { class: 'cp-muted' }, `You keep the other ${Math.round((1 - Number(m.manager.cut_rate || 0)) * 1000) / 10}%`)), h('span', { class: 'cp-inline' }, input, '%', save)), h('p', { class: 'cp-muted cp-small' }, `Last 30 days: team brought in ${dollars0(p.brought_in_cents)}, creators were paid ${dollars0(p.paid_out_cents)}, ${dollars0(p.profit_cents)} left. Their cut ${dollars0(p.from_cut_cents)} + bonuses ${dollars0(Number(p.from_rankup_cents || 0) + Number(p.from_active_cents || 0) + Number(p.from_views_cents || 0))}.`));
      })() : null;
      const el = h(
        'section',
        { class: 'mr-ref__zone', 'data-manager': m ? '' : null },
        h(
          'header',
          {},
          m
            ? h('div', { class: 'mr-ref__owner' }, cp.avatar({ display_name: m.manager.display_name, tier_level: 5 }), h('div', {}, h('b', {}, m.manager.display_name), h('span', { class: 'cp-muted cp-small' }, m.email), h('span', { class: 'cp-small' }, m.signed_in ? pill('Has signed in', 'good') : pill('Has not signed in yet', 'warn'))))
            : h('div', {}, h('b', {}, 'No manager'), h('span', { class: 'cp-muted cp-small' }, 'Creators not on any team')),
          m ? h('div', { class: 'mr-ref__pay' }, h('b', {}, dollars0(m.pay?.total_cents)), h('span', { class: 'cp-muted cp-small' }, 'pay, 30 days'), remove) : null,
        ),
        cutBox,
        h('div', { class: 'mr-ref__drop' }, list.length ? list.map(chip) : h('p', { class: 'cp-muted cp-small' }, m ? 'Drop a creator here to put them on this team.' : 'Everyone is on a team.')),
      );
      el.addEventListener('dragover', (e) => { if (!managerDrag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.dataset.over = ''; });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) delete el.dataset.over; });
      el.addEventListener('drop', (e) => { e.preventDefault(); delete el.dataset.over; const cid = managerDrag || e.dataTransfer.getData('text/plain'); managerDrag = null; if (cid) assign(cid, id); });
      return el;
    };

    const name = h('input', { class: 'cp-input', placeholder: 'Name', maxlength: '60', 'aria-label': 'Manager name' });
    const email = h('input', { class: 'cp-input', type: 'email', placeholder: 'Email they sign in with (Google or Apple)', 'aria-label': 'Manager email', autocapitalize: 'none', spellcheck: 'false' });
    const add = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Add manager');
    add.addEventListener('click', act(add, async () => {
      if (!name.value.trim()) throw new Error('Give the manager a name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) throw new Error('That does not look like an email address.');
      if (cp.demo) { state.managers = [...managers, { manager: { id: `m${Date.now()}`, display_name: name.value.trim(), active: true }, email: email.value.trim().toLowerCase(), signed_in: false, creators: [], totals: {}, pay: { total_cents: 0 } }]; toast('Added. (Sample data: nothing was saved.)'); return render(); }
      await cp.rpc('creator_admin_add_manager', { p_email: email.value.trim(), p_name: name.value.trim() });
      toast(`${name.value.trim()} is a manager. They will see their team the next time they sign in.`);
      await reload();
    }));

    const pct = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', max: '100', step: '0.5', value: String(Math.round(Number(s.manager_rankup_rate ?? 0.1) * 1000) / 10), 'aria-label': 'Manager share of a rank-up bonus, percent' });
    const perActive = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', step: '1', value: String(Math.round(Number(s.manager_active_cents ?? 500) / 100)), 'aria-label': 'Dollars per active week' });
    const perViews = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', step: '1', value: String(Math.round(Number(s.manager_views_cents ?? 100) / 100)), 'aria-label': 'Dollars per 100K views' });
    const rateCap = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', max: '100', step: '0.5', value: String(Math.round(Number(s.manager_rate_cap ?? 0.25) * 1000) / 10), 'aria-label': 'Highest commission a manager can give' });
    const saveCap = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Save');
    saveCap.addEventListener('click', act(saveCap, async () => {
      const patch = { manager_rate_cap: Math.max(0, Math.min(100, Number(rateCap.value) || 0)) / 100 };
      if (cp.demo) { Object.assign(state.settings, patch); toast('Saved. (Sample data: nothing was saved.)'); return render(); }
      await ok(db.from('creator_settings').update(patch).eq('id', true));
      toast('Saved. Managers cannot give a creator more than that.');
      await reload();
    }));
    const changes = h('ul', { class: 'cp-rows' }, h('li', { class: 'cp-muted' }, cp.demo ? 'Nothing yet.' : 'Loading…'));
    if (!cp.demo) {
      db.from('creator_manager_log').select('*').order('created_at', { ascending: false }).limit(40).then(({ data: rows }) => {
        changes.replaceChildren(...((rows || []).length ? rows.map((r) => h('li', {}, h('b', {}, r.manager_name), ` · ${r.creator_name}: ${r.detail} `, h('span', { class: 'cp-muted cp-small' }, day(r.created_at)))) : [h('li', { class: 'cp-muted' }, 'No manager has changed anything yet.')]));
      });
    }
    const savePay = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Save pay rules');
    savePay.addEventListener('click', act(savePay, async () => {
      const patch = { manager_rankup_rate: Math.max(0, Math.min(100, Number(pct.value) || 0)) / 100, manager_active_cents: Math.max(0, Math.round((Number(perActive.value) || 0) * 100)), manager_views_cents: Math.max(0, Math.round((Number(perViews.value) || 0) * 100)) };
      if (cp.demo) { Object.assign(state.settings, patch); toast('Saved. (Sample data: nothing was saved.)'); return render(); }
      await ok(db.from('creator_settings').update(patch).eq('id', true));
      toast('Manager pay rules saved.');
      await reload();
    }));

    return [
      section('Add a manager', h('span', { class: 'cp-muted' }, `${num(managers.length)} manager${managers.length === 1 ? '' : 's'}`), h('div', { class: 'mr-addrow' }, name, email, add), h('p', { class: 'cp-muted cp-small' }, 'They sign in on the creator page with that email, using Google or Apple, and get a "My team" dashboard. A password sign-in is not accepted for managers.')),
      section('Teams', h('span', { class: 'cp-muted' }, 'Drag a creator onto a manager to move them'), h('div', { class: 'mr-ref__board' }, managers.map(zone), zone(null))),
      section(
        'What managers can do',
        h('span', { class: 'cp-muted' }, 'On their own team only'),
        h('p', { class: 'cp-muted cp-small' }, 'A manager can raise a creator\'s commission above their rank rate, move a creator to another manager, and remove a creator from the program. You can undo any of it from Creators.'),
        h('div', { class: 'mr-payrules' }, h('label', {}, h('span', {}, 'The highest commission a manager can give a creator'), h('span', { class: 'cp-inline' }, rateCap, '%', saveCap))),
        h('h3', { class: 'cp-small' }, 'What managers changed'),
        changes,
      ),
      section(
        'Manager bonuses',
        h('span', { class: 'cp-muted' }, 'On top of their cut'),
        h('p', { class: 'cp-muted cp-small' }, 'Each manager\'s cut is set on their own card above. It is a share of what their team leaves after the creators are paid, not of the sales: a creator who brings in $20,000 and is paid $10,000 leaves $10,000, so a 50% cut is $5,000. These three bonuses are the same for every manager.'),
        h('div', { class: 'mr-payrules' }, h('label', {}, h('span', {}, 'Share of each rank-up bonus a creator on their team earns'), h('span', { class: 'cp-inline' }, pct, '%')), h('label', {}, h('span', {}, 'For each active week a creator completes'), h('span', { class: 'cp-inline' }, '$', perActive)), h('label', {}, h('span', {}, 'For every 100K views the team gains'), h('span', { class: 'cp-inline' }, '$', perViews))),
        h('div', { class: 'cp-inline' }, savePay),
        h('p', { class: 'cp-muted cp-small' }, 'Managers see all of this on their My team page as an estimate for the last 30 days. Nothing is paid automatically: you pay managers yourself for now.'),
      ),
    ];
  }

  /* -------------------------------------------------------------- referrals */

  /*
   * Who brings creators in. Every creator and every manager has an invite
   * link; the ladder lists them all, best first, with how far their link gets:
   * opened, signed in, applied, accepted. Open a row to see the creators they
   * brought in and how close each one is to the views that pay the reward.
   */
  function referralsTab() {
    const s = state.settings || {};
    const goal = Number(s.referral_views || 100000);
    const bonus = Number(s.referral_bonus_cents || 0);
    const mgrBonus = Number(s.manager_referral_cents ?? 10000);
    const counts = state.referrals || {};
    const everyone = state.creators;
    const all = everyone.filter((c) => c.status !== 'rejected');
    const byId = new Map(everyone.map((c) => [c.id, c]));
    const managers = (state.managers || []).map((m) => m.manager).filter((m) => m && m.active !== false);
    const mgrIds = new Set(managers.map((m) => m.id));
    const countOf = (list, kind, id) => Number(((list || []).find((x) => x.kind === kind && x.ref_id === id) || {}).n || 0);
    const paidFor = new Set((state.bonuses || []).filter((b) => b.kind === 'referral' && b.ref).map((b) => b.ref));
    const mgrPaid = new Map((counts.manager_bonuses || []).map((b) => [b.creator_id, b]));
    const viewsOf = (c) => Number(c.stats?.views || 0);
    /* A creator's own referrer comes first; a manager is credited only when no creator is. */
    const byCreator = (c) => (c.referred_by && byId.has(c.referred_by) && c.referred_by !== c.id ? c.referred_by : null);
    const byManager = (c) => (!byCreator(c) && c.referred_manager && mgrIds.has(c.referred_manager) ? c.referred_manager : null);
    const accepted = (c) => c.status === 'active' || c.status === 'paused';
    const isPaid = (c) => paidFor.has(c.id) || mgrPaid.has(c.id);
    const stageOf = (c) => (isPaid(c) ? ['Reward paid', 'good'] : c.status === 'rejected' ? ['Declined', 'muted'] : c.status === 'pending' ? ['Waiting for approval', 'warn'] : c.status === 'paused' ? ['Paused', 'warn'] : viewsOf(c) >= goal ? ['Reached the goal', 'good'] : ['Posting', 'muted']);

    const move = async (creatorId, referrerId) => {
      try {
        const c = byId.get(creatorId);
        if (!c || creatorId === referrerId || (c.referred_by || null) === (referrerId || null)) return;
        // Nobody can sit under someone who is already under them.
        for (let up = referrerId, n = 0; up && n < 50; up = byId.get(up)?.referred_by, n++) if (up === creatorId) throw new Error(`${byId.get(referrerId).display_name} was referred by ${c.display_name}, so it cannot go the other way round.`);
        if (cp.demo) { c.referred_by = referrerId || null; toast(referrerId ? `${c.display_name} is now under ${byId.get(referrerId).display_name}. (Sample data: nothing was saved.)` : `${c.display_name} has no referrer now. (Sample data: nothing was saved.)`); return render(); }
        await cp.rpc('creator_admin_set_referrer', { p_creator: creatorId, p_referrer: referrerId || null });
        toast(referrerId ? `${c.display_name} is now under ${byId.get(referrerId).display_name}.` : `${c.display_name} has no referrer now.`);
        await reload();
      } catch (error) { toast(error.message || 'Something went wrong.', 'error'); }
    };

    /* One creator somebody brought in: where they are, and how far from the reward. */
    const recruit = (c, reward, canMove) => {
      const [label, tone] = stageOf(c);
      const share = isPaid(c) ? 1 : Math.max(0, Math.min(1, viewsOf(c) / (goal || 1)));
      const picker = canMove && c.status !== 'rejected'
        ? h('select', { class: 'mr-ref__move', 'aria-label': `Move ${c.display_name} under` }, h('option', { value: '' }, 'Move to…'), h('option', { value: 'none' }, 'No referrer'), all.filter((o) => o.status === 'active' && o.id !== c.id && o.id !== c.referred_by).map((o) => h('option', { value: o.id }, o.display_name)))
        : null;
      if (picker) picker.addEventListener('change', () => { const v = picker.value; picker.value = ''; if (v) move(c.id, v === 'none' ? null : v); });
      return h(
        'li',
        { class: 'mr-lad__kid', 'data-done': isPaid(c) ? '' : null },
        h('div', { class: 'mr-ref__who' }, cp.person(c), pill(label, tone === 'muted' ? undefined : tone)),
        h('div', { class: 'mr-ref__bar', role: 'img', 'aria-label': `${compact(viewsOf(c))} of ${compact(goal)} views` }, h('i', { style: `width:${(share * 100).toFixed(1)}%` })),
        h('div', { class: 'mr-ref__foot' }, h('span', {}, `${compact(viewsOf(c))} / ${compact(goal)} views · ${isPaid(c) ? `${cp.dollars(reward)} paid` : reward > 0 ? `${cp.dollars(reward)} when they get there` : 'no reward set'}`), picker),
      );
    };

    const rows = [
      ...all.filter((c) => c.status === 'active').map((c) => {
        const kids = everyone.filter((k) => byCreator(k) === c.id);
        return { kind: 'creator', id: c.id, who: c, name: c.display_name, badge: pill(tierName(c), c.champion ? 'good' : undefined), link: `getmindroll.com/creators/?invite=${c.code}`, kids, reward: bonus,
          earned: (state.bonuses || []).filter((b) => b.kind === 'referral' && b.creator_id === c.id).reduce((sum, b) => sum + Number(b.amount_cents || 0), 0) };
      }),
      ...managers.map((m) => {
        const kids = everyone.filter((k) => byManager(k) === m.id);
        return { kind: 'manager', id: m.id, who: { display_name: m.display_name, tier_level: 5 }, name: m.display_name, badge: pill('Manager', 'good'), link: m.code ? `getmindroll.com/creators/?team=${m.code}` : null, kids, reward: mgrBonus,
          earned: (counts.manager_bonuses || []).filter((b) => b.manager_id === m.id).reduce((sum, b) => sum + Number(b.amount_cents || 0), 0) };
      }),
    ].map((r) => {
      const applied = r.kids.length;
      return { ...r, kids: [...r.kids].sort((x, y) => viewsOf(y) - viewsOf(x)), referred: applied, clicks: countOf(counts.clicks, r.kind, r.id), signups: Math.max(countOf(counts.signups, r.kind, r.id), applied), accepted: r.kids.filter(accepted).length };
    }).sort((x, y) => y.referred - x.referred || y.accepted - x.accepted || y.signups - x.signups || y.clicks - x.clicks || x.name.localeCompare(y.name));

    const stat = (label, value, big) => h('span', { class: 'mr-lad__stat', 'data-big': big ? '' : null }, h('b', {}, value), h('small', {}, label));
    const row = (r, i) =>
      h(
        'li',
        {},
        h(
          'details',
          { class: 'mr-lad__row' },
          h(
            'summary',
            {},
            h('i', { class: 'mr-lad__rank' }, String(i + 1)),
            h('span', { class: 'mr-lad__who' }, cp.avatar(r.who), h('span', {}, h('b', {}, r.name), r.badge)),
            h('span', { class: 'mr-lad__stats' }, stat('referred', num(r.referred), true), stat('link clicks', num(r.clicks)), stat('signed up', num(r.signups)), stat('accepted', num(r.accepted)), stat('earned', cp.dollars(r.earned))),
          ),
          h(
            'div',
            { class: 'mr-lad__body' },
            r.link ? h('p', { class: 'cp-small cp-muted' }, 'Invite link: ', h('code', { class: 'cp-mono' }, r.link)) : null,
            r.kids.length ? h('ul', { class: 'mr-lad__kids' }, r.kids.map((c) => recruit(c, r.reward, r.kind === 'creator'))) : h('p', { class: 'cp-muted cp-small' }, 'Nobody has applied on this link yet.'),
          ),
        ),
      );

    const loose = all.filter((c) => !byCreator(c) && !byManager(c)).sort((x, y) => x.display_name.localeCompare(y.display_name));
    const sum = (key) => rows.reduce((n, r) => n + r[key], 0);
    const paidOut = rows.reduce((n, r) => n + r.earned, 0);
    const tile = (tone, label, value, foot) => h('div', { class: 'mr-tile', 'data-tone': tone }, h('span', { class: 'mr-tile__label' }, label), h('b', { class: 'mr-tile__value' }, value), foot ? h('span', { class: 'mr-tile__foot' }, foot) : null);

    return [
      h(
        'section',
        { class: 'mr-panel mr-ref__how' },
        h('ol', {}, h('li', {}, h('b', {}, '1'), h('span', {}, 'A creator or a manager shares their invite link')), h('li', {}, h('b', {}, '2'), h('span', {}, 'Someone applies on it and you accept them')), h('li', {}, h('b', {}, '3'), h('span', {}, `Their videos reach ${compact(goal)} views in total`)), h('li', { 'data-pay': '' }, h('b', {}, bonus === mgrBonus ? cp.dollars(bonus) : `${cp.dollars(bonus)} / ${cp.dollars(mgrBonus)}`), h('span', {}, bonus === mgrBonus ? 'goes straight to whoever invited them' : 'to the creator / the manager who invited them'))),
      ),
      h('div', { class: 'mr-grid' }, tile('paper', 'Invite link clicks', num(sum('clicks')), 'counted from the day this went live'), tile('paper', 'Signed up', num(sum('signups')), 'signed in on an invite link'), tile('paper', 'Accepted', num(sum('accepted')), `of ${num(sum('referred'))} who applied`), tile('amber', 'Paid to referrers', cp.dollars(paidOut), 'added when the views are next counted after the goal')),
      section(
        'Referral ladder',
        h('span', { class: 'cp-muted' }, `${num(rows.length)} creators and managers · most referred first`),
        h('ol', { class: 'mr-lad' }, rows.map(row)),
        h('p', { class: 'cp-muted cp-small' }, 'Referred: applied on the link. Signed up: signed in on the link, whether or not they finished applying. Accepted: approved into the program. Open a row for the creators and their progress.'),
      ),
      loose.length
        ? h('section', { class: 'cp-card' }, h('details', { class: 'mr-lad__row mr-lad__row--plain' }, h('summary', {}, h('span', { class: 'mr-lad__who' }, h('span', {}, h('b', {}, 'Joined without an invite link'))), h('span', { class: 'mr-lad__stats' }, stat('creators', num(loose.length), true))), h('div', { class: 'mr-lad__body' }, h('p', { class: 'cp-small cp-muted' }, 'Use "Move to…" to put a creator under whoever really brought them in.'), h('ul', { class: 'mr-lad__kids' }, loose.map((c) => recruit(c, bonus, true))))))
        : null,
    ];
  }

  /* ------------------------------------------------------------- UGC brief */

  /*
   * The brief creators read under "UGC Brief". Everything here edits a draft;
   * nothing a creator sees changes until Publish is pressed.
   */
  let briefEdit = null;
  let briefDirty = false;
  function briefTab() {
    const doc = state.briefDoc || {};
    const clone = (v) => JSON.parse(JSON.stringify(v));
    if (!briefEdit) briefEdit = clone(doc.draft || doc.published || cp.defaultBrief);
    const b = briefEdit;
    for (const key of ['examples', 'ctas', 'assets', 'tips']) { b[key] = b[key] || {}; b[key].items = b[key].items || []; }
    b.must = b.must || {};
    const unpublished = JSON.stringify(b) !== JSON.stringify(doc.published || null);
    const touch = () => { briefDirty = true; const el = view.querySelector('[data-brief-state]'); if (el) { el.textContent = 'Unpublished changes'; el.dataset.tone = 'warn'; } };
    const redraw = () => { briefDirty = true; render(); };

    const text = (obj, key, label, o = {}) => {
      const input = h(o.area ? 'textarea' : 'input', { class: 'cp-input', rows: o.area ? String(o.rows || 2) : null, type: o.area ? null : o.type || 'text', placeholder: o.placeholder || '', 'aria-label': label });
      input.value = obj[key] || '';
      input.addEventListener('input', () => { obj[key] = input.value; touch(); });
      return o.bare ? input : h('label', { class: 'mr-edit__field' }, h('span', {}, label), input);
    };
    const mini = (label, onclick, o = {}) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: o.disabled || null, 'aria-pressed': o.pressed == null ? null : String(!!o.pressed), title: o.title || null, onclick }, label);
    const move = (list, i, by) => { const j = i + by; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; redraw(); };
    const remove = (list, i) => confirmButton('Delete', 'Confirm delete', 'cp-link', async () => { list.splice(i, 1); redraw(); });

    const imageField = (obj, key, label) => {
      const src = cp.briefImage(obj[key]);
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
      const pick = mini(src ? 'Change image' : 'Add image', () => file.click());
      file.addEventListener('change', act(pick, async () => {
        const f = file.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) throw new Error('Images can be up to 5 MB.');
        if (cp.demo) throw new Error('This is a preview, so uploads are switched off.');
        const path = `brief/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-60)}`;
        const { error } = await db.storage.from('creator-briefs').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
        if (error) throw new Error(error.message);
        obj[key] = `upload:${path}`;
        redraw();
      }));
      return h('div', { class: 'mr-edit__image' }, src ? h('img', { src, alt: '' }) : h('span', { class: 'cp-muted cp-small' }, 'No image'), h('div', { class: 'cp-inline' }, pick, obj[key] ? mini('Remove', () => { obj[key] = null; redraw(); }) : null), file, h('span', { class: 'cp-visually-hidden' }, label));
    };

    const vids = b.examples.items;
    const videoRow = (v, i) => h(
      'li',
      { class: 'mr-edit__row', 'data-on': v.highlight ? 'highlight' : v.pinned ? 'pin' : null },
      imageField(v, 'image', `Thumbnail for ${v.title || 'video'}`),
      h('div', { class: 'mr-edit__fields' }, text(v, 'title', 'Title', { placeholder: 'What the video is' }), text(v, 'note', 'Description', { placeholder: 'What makes it work' }), text(v, 'url', 'Video link', { type: 'url', placeholder: 'https://' })),
      h(
        'div',
        { class: 'mr-edit__tools' },
        mini(v.pinned ? 'Pinned' : 'Pin', () => { v.pinned = !v.pinned; redraw(); }, { pressed: v.pinned, title: 'Pinned videos show first' }),
        mini(v.highlight ? 'Highlighted' : 'Highlight', () => { v.highlight = !v.highlight; redraw(); }, { pressed: v.highlight, title: 'Highlighted videos get a blue frame and a Featured tag' }),
        mini('Up', () => move(vids, i, -1), { disabled: i === 0 }),
        mini('Down', () => move(vids, i, 1), { disabled: i === vids.length - 1 }),
        remove(vids, i),
      ),
    );
    const lineList = (list, label, o = {}) => h(
      'ul',
      { class: 'mr-edit__list' },
      list.map((_, i) => {
        const holder = { get v() { return list[i]; }, set v(x) { list[i] = x; } };
        return h('li', { class: 'mr-edit__line' }, text(holder, 'v', `${label} ${i + 1}`, { area: true, rows: o.rows || 2, bare: true }), h('div', { class: 'mr-edit__tools' }, mini('Up', () => move(list, i, -1), { disabled: i === 0 }), mini('Down', () => move(list, i, 1), { disabled: i === list.length - 1 }), remove(list, i)));
      }),
    );
    const assetRow = (it, i) => h('li', { class: 'mr-edit__row' }, h('div', { class: 'mr-edit__fields' }, text(it, 'title', 'Title'), text(it, 'note', 'Description'), text(it, 'url', 'Link', { type: 'url', placeholder: 'https://' })), h('div', { class: 'mr-edit__tools' }, mini(it.lead ? 'Main button' : 'Make main', () => { it.lead = !it.lead; redraw(); }, { pressed: it.lead }), mini('Up', () => move(b.assets.items, i, -1), { disabled: i === 0 }), mini('Down', () => move(b.assets.items, i, 1), { disabled: i === b.assets.items.length - 1 }), remove(b.assets.items, i)));

    const validate = () => {
      if (!String(b.title || '').trim()) throw new Error('The brief needs a title.');
      vids.forEach((v, i) => {
        if (!String(v.title || '').trim()) throw new Error(`Video ${i + 1} needs a title.`);
        if (!cp.safeUrl(v.url)) throw new Error(`"${v.title}" needs a link that starts with https://`);
      });
      b.assets.items.forEach((it) => { if (!String(it.title || '').trim() || !cp.safeUrl(it.url)) throw new Error('Every asset needs a title and a link that starts with https://'); });
      b.ctas.items = b.ctas.items.map((t) => String(t || '').trim()).filter(Boolean);
      b.tips.items = b.tips.items.map((t) => String(t || '').trim()).filter(Boolean);
    };
    const save = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Save draft');
    save.addEventListener('click', act(save, async () => {
      validate();
      if (cp.demo) throw new Error('This is a preview, so saving is switched off.');
      await cp.rpc('creator_admin_save_brief', { p_brief: b });
      briefDirty = false;
      toast('Draft saved. Creators still see the published version.');
      await reload();
    }));
    const publish = confirmButton('Publish', 'Confirm: show this to every creator', 'btn btn--primary btn--sm', async () => {
      validate();
      if (cp.demo) throw new Error('This is a preview, so publishing is switched off.');
      await cp.rpc('creator_admin_save_brief', { p_brief: b });
      await cp.rpc('creator_admin_publish_brief');
      briefDirty = false;
      toast('Published. Every creator sees it now.');
      await reload();
    });
    const discard = unpublished && doc.published ? confirmButton('Discard changes', 'Confirm: go back to the published version', 'cp-link', async () => { briefEdit = clone(doc.published); briefDirty = false; if (!cp.demo) await cp.rpc('creator_admin_save_brief', { p_brief: briefEdit }); toast('Back to the published version.'); cp.demo ? render() : await reload(); }) : null;

    return [
      h(
        'section',
        { class: 'mr-panel mr-edit__bar' },
        h('div', {}, h('b', { 'data-brief-state': '', 'data-tone': unpublished ? 'warn' : 'good' }, unpublished ? 'Unpublished changes' : 'Published'), h('span', { class: 'cp-muted cp-small' }, doc.published_at ? `Last published ${since(doc.published_at)}` : 'Not published yet: creators see the built-in brief')),
        h('div', { class: 'cp-inline' }, discard, h('a', { class: 'cp-link', href: '/creators/#brief', target: '_blank', rel: 'noopener' }, 'See the live page'), save, publish),
      ),
      section('Heading', null, h('div', { class: 'mr-edit__fields' }, text(b, 'title', 'Title'), text(b, 'lead', 'Line under the title', { area: true }))),
      section(
        'Videos',
        h('span', { class: 'cp-muted' }, `${vids.length} · pinned show first`),
        h('div', { class: 'mr-edit__fields' }, text(b.examples, 'title', 'Section title'), text(b.examples, 'note', 'Text under it', { area: true, rows: 3 })),
        vids.length ? h('ul', { class: 'mr-edit__list' }, vids.map(videoRow)) : h('p', { class: 'cp-muted' }, 'No videos yet.'),
        h('div', { class: 'cp-inline' }, mini('Add a video', () => { vids.unshift({ title: '', note: '', url: '', image: null }); redraw(); })),
        text(b.examples, 'allUrl', '"All examples" link (leave empty to hide it)', { type: 'url', placeholder: 'https://' }),
      ),
      section(
        'CTAs',
        h('span', { class: 'cp-muted' }, `${b.ctas.items.length} scripts`),
        h('div', { class: 'mr-edit__fields' }, text(b.ctas, 'title', 'Section title'), text(b.ctas, 'note', 'Text under it', { area: true }), text(b.ctas, 'listUrl', 'Full CTA list link', { type: 'url', placeholder: 'https://' })),
        lineList(b.ctas.items, 'CTA', { rows: 3 }),
        h('div', { class: 'cp-inline' }, mini('Add a CTA', () => { b.ctas.items.push(''); redraw(); })),
      ),
      section(
        'Assets',
        null,
        text(b.assets, 'title', 'Section title'),
        h('ul', { class: 'mr-edit__list' }, b.assets.items.map(assetRow)),
        h('div', { class: 'cp-inline' }, mini('Add an asset link', () => { b.assets.items.push({ title: '', note: '', url: '' }); redraw(); })),
      ),
      section('One must-have', null, h('div', { class: 'mr-edit__row' }, imageField(b.must, 'image', 'Must-have image'), h('div', { class: 'mr-edit__fields' }, text(b.must, 'title', 'Section title'), text(b.must, 'text', 'Text', { area: true, rows: 3 }), text(b.must, 'url', 'Download link', { type: 'url', placeholder: 'https://' }), text(b.must, 'linkLabel', 'Words on the download link')))),
      section('Highly recommended', null, text(b.tips, 'title', 'Section title'), lineList(b.tips.items, 'Point', { rows: 2 }), h('div', { class: 'cp-inline' }, mini('Add a point', () => { b.tips.items.push(''); redraw(); }))),
      section('Closing', null, h('div', { class: 'mr-edit__fields' }, text(b, 'closing', 'Closing note', { area: true, rows: 3 }), text(b, 'questions', 'Last line (questions, contact)', { area: true })), h('p', { class: 'cp-muted cp-small' }, 'Put two stars either side of words to make them bold, like **this**.')),
    ];
  }

  /* -------------------------------------------------------------- rankings */

  /*
   * Every creator from best to worst over the last 30 days, and every video by
   * the views it gained. Sales belong to a creator's link, not to one video,
   * so videos are ranked on views.
   */
  let rankBy = 'sales';
  let videoPeriod = 'week';
  function rankings() {
    const MEASURES = { sales: ['Sales', (c) => c.incentives?.window_revenue_cents || 0, cp.dollars], views: ['Views', (c) => c.incentives?.window_views || 0, compact], videos: ['Videos', (c) => c.incentives?.window_posts || 0, num] };
    const [, pick] = MEASURES[rankBy];
    const ranked = state.creators.filter((c) => c.status === 'active').sort((x, y) => pick(y) - pick(x) || (y.stats?.revenue_cents || 0) - (x.stats?.revenue_cents || 0));
    const best = Math.max(1, ...ranked.map(pick));
    const sorter = h('div', { class: 'cp-switch', role: 'group', 'aria-label': 'Rank creators by' }, Object.entries(MEASURES).map(([id, [label]]) => h('button', { type: 'button', 'aria-pressed': String(rankBy === id), onclick: () => { rankBy = id; render(); } }, label)));
    const cell = (id) => (c) => {
      const [, value, fmt] = MEASURES[id];
      return id === rankBy ? h('div', { class: 'cp-rankbar' }, h('i', { style: `width:${Math.max(1, (value(c) / best) * 100).toFixed(1)}%` }), h('b', {}, fmt(value(c)))) : fmt(value(c));
    };

    const PERIODS = [['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
    const vids = state.campaigns?.top_videos?.[videoPeriod] || [];
    const periods = h('div', { class: 'cp-switch', role: 'group', 'aria-label': 'Period' }, PERIODS.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(videoPeriod === id), onclick: () => { videoPeriod = id; render(); } }, label)));

    return [
      section(
        'Creators, best to worst',
        sorter,
        table(
          [
            { label: '#', cell: (c) => String(ranked.indexOf(c) + 1) },
            { label: 'Creator', cell: (c) => h('span', { class: 'cp-inline' }, h('b', {}, c.display_name), pill(tierName(c), c.champion ? 'good' : undefined)) },
            { label: 'Sales, 30 days', num: rankBy !== 'sales', cell: cell('sales') },
            { label: 'Views, 30 days', num: rankBy !== 'views', cell: cell('views') },
            { label: 'Videos, 30 days', num: rankBy !== 'videos', cell: cell('videos') },
            { label: 'Subscribers', num: true, cell: (c) => num(c.stats?.customers || 0) },
          ],
          ranked,
          'No active creators yet. They are ranked here as soon as you approve them.',
        ),
        h('p', { class: 'cp-muted cp-small' }, 'The last 30 days, which is what tiers and Champion places are judged on.'),
      ),
      (state.links || []).length
        ? section(
            'Links, best first',
            h('span', { class: 'cp-muted' }, 'Each creator\'s tagged links'),
            table(
              [
                { label: 'Creator', cell: (l) => h('b', {}, l.creator) },
                { label: 'Link', cell: (l) => h('code', { class: 'cp-mono' }, l.tag) },
                { label: 'Clicks', num: true, cell: (l) => num(l.clicks) },
                { label: 'Signed up', num: true, cell: (l) => num(l.signups) },
                { label: 'Subscribed', num: true, cell: (l) => num(l.customers) },
                { label: 'Sales', num: true, cell: (l) => h('b', {}, cp.dollars(l.sales_cents)) },
              ],
              [...state.links].sort((x, y) => y.sales_cents - x.sales_cents || y.clicks - x.clicks).slice(0, 100),
              '',
            ),
            h('p', { class: 'cp-muted cp-small' }, 'A creator adds a tag to their link for a video or a niche (?ref=code&v=tag). The same tag can point at any page of the site, so a niche can have its own onboarding.'),
          )
        : null,
      section(
        'Videos, most views first',
        periods,
        table(
          [
            { label: '#', cell: (v) => String(vids.indexOf(v) + 1) },
            {
              label: 'Video',
              cell: (v) => {
                const href = cp.safeUrl(v.url);
                const title = v.title || v.url.replace(/^https:\/\/(www\.)?/, '');
                return h('div', { class: 'cp-video' }, watch(v.url, title), h('span', { class: 'cp-platform', 'data-platform': v.platform }, cp.PLATFORM[v.platform]), href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, title) : title);
              },
            },
            { label: 'Creator', cell: (v) => h('b', {}, v.creator) },
            { label: videoPeriod === 'all' ? 'Views' : 'Views gained', num: true, cell: (v) => h('b', {}, compact(v.gained)) },
            { label: 'Views in total', num: true, cell: (v) => compact(v.views) },
            { label: 'Likes', num: true, cell: (v) => compact(v.likes || 0) },
          ],
          vids,
          videoPeriod === 'all' ? 'No videos yet.' : 'No video has gained views in this period yet.',
        ),
        h('p', { class: 'cp-muted cp-small' }, 'The first row is the video every creator sees as the top video on their dashboard. Ranked by views: a sale is tied to the creator\'s link, so it cannot be traced to one video.'),
      ),
    ];
  }

  /* ------------------------------------------------------------- campaigns */

  /*
   * This week's leaderboards for every tier, the Champions, and the prize
   * fund that pays for both.
   */
  function campaigns() {
    const k = state.campaigns;
    if (!k) return h('p', { class: 'cp-empty' }, 'Campaigns are not set up yet.');
    const s = state.settings;
    const f = k.fund || {};
    const scale = k.scale == null ? 1 : Number(k.scale);
    const free = Math.max(0, f.free_cents || 0);
    const champs = state.creators.filter((c) => c.champion);
    const liveTiers = k.tiers.filter((t) => t.pool_cents > 0 && t.in_tier >= s.campaign_min_creators);
    const weekCost = liveTiers.reduce((sum, t) => sum + t.pool_cents, 0);
    const dayCost = champs.length * (s.champion_daily_cents || 0);
    const BOARD = { videos: ['Most videos', num], views: ['Most views', compact], sales: ['Most sales', cp.dollars] };

    const tierCard = (t) => {
      const live = t.pool_cents > 0 && t.in_tier >= s.campaign_min_creators;
      return h(
        'section',
        { class: 'cp-card' },
        h('div', { class: 'cp-card__head' }, cp.figure(t.name, live ? `${cp.dollars(Math.floor(t.pool_cents * scale))} this campaign` : `Up to ${cp.dollars(t.pool_cents)} every two weeks`), live ? pill('Live', 'good') : pill(`${t.in_tier} of ${s.campaign_min_creators} creators`, 'warn')),
        live
          ? h('div', { class: 'cp-three' }, Object.entries(BOARD).map(([id, [label, fmt]]) => h('div', {}, h('p', { class: 'cp-rowlabel cp-small' }, h('b', {}, label)), (t.boards?.[id] || []).length ? cp.hbars(t.boards[id].slice(0, 5).map((row) => ({ label: `${row.place}. ${row.name}`, value: Number(row.score) })), fmt, cp.COLOR.paid) : h('p', { class: 'cp-muted cp-small' }, 'No scores yet'))))
          : null,
        h('p', { class: 'cp-muted cp-small' }, live ? `${num(t.in_tier)} creators hold ${t.name}; ${num(t.entrants)} have joined this campaign. The cap is ${cp.dollars(t.pool_cents)}.` : `Opens when ${s.campaign_min_creators} creators hold ${t.name}.`),
      );
    };

    return [
      ...contestSection(),
      h('h2', { class: 'cp-subhead' }, 'Tier campaigns and Champions'),
      h(
        'div',
        { class: 'cp-two cp-even' },
        h(
          'section',
          { class: 'cp-card' },
          h('div', { class: 'cp-card__head' }, cp.figure('Prize fund', money(free), true), s.fund_pay_in_full ? pill('Paying in full', 'warn') : !liveTiers.length ? pill('No campaign running yet') : pill(`Paying about ${Math.round(scale * 100)}% of stated prizes`, scale >= 1 ? 'good' : 'warn')),
          cp.hbars(
            [
              { label: 'In the fund now', value: free },
              { label: 'One full round of live campaigns (two weeks)', value: weekCost, color: cp.COLOR.wait },
              { label: 'One day of Champion pay', value: dayCost, color: cp.COLOR.wait },
              { label: 'Paid from the fund so far', value: f.spent_cents || 0, color: cp.COLOR.paid },
            ],
            cp.dollars,
          ),
          h('p', { class: 'cp-muted cp-small' }, s.min_margin_rate == null ? 'There is no margin floor set, so prizes and Champion pay are paid in full.' : s.fund_pay_in_full ? `Prizes and Champion pay are paid in full whatever the fund holds, which can take you below ${Math.round(s.min_margin_rate * 100)}%. Change this in Settings.` : `The fund is what creators' sales have left above your ${Math.round(s.min_margin_rate * 100)}% that nobody claimed within 30 days. Prizes and Champion pay only come out of it, so they never take you below ${Math.round(s.min_margin_rate * 100)}%; when it is short they are scaled down. ${cp.dollars(Math.max(0, f.reserve_cents || 0))} more is held back for creators' own bonuses.`),
        ),
        section(
          'Champions',
          h('span', { class: 'cp-muted' }, `Top ${s.champion_slots} in ${(state.tiers[state.tiers.length - 1] || {}).name || 'the top tier'} by 30-day sales`),
          champs.length ? cp.hbars(champs.sort((x, y) => (y.incentives?.window_revenue_cents || 0) - (x.incentives?.window_revenue_cents || 0)).map((c) => ({ label: c.display_name, value: c.incentives?.window_revenue_cents || 0, note: `Champion pay so far: ${cp.dollars(c.incentives?.by_kind?.daily || 0)}` })), cp.dollars) : h('p', { class: 'cp-empty' }, 'No Champions yet. The first creators to reach the top tier take the places.'),
          h('p', { class: 'cp-muted cp-small' }, `A Champion earns ${Math.round(s.champion_rate * 1000) / 10}% and ${cp.dollars(s.champion_daily_cents)} from the prize fund for every day they post a video.`),
        ),
      ),
      ...k.tiers.filter((t) => t.pool_cents > 0).map(tierCard),
      cp.fold(
        'See past winners',
        table(
          [
            { label: 'Two weeks from', cell: (r) => day(r.week) },
            { label: 'Tier', cell: (r) => (state.tiers.find((t) => t.level === r.tier_level) || {}).name || '' },
            { label: 'Campaign', cell: (r) => BOARD[r.board][0] },
            { label: 'Place', cell: (r) => String(r.place) },
            { label: 'Creator', cell: (r) => h('b', {}, r.name) },
            { label: 'Score', num: true, cell: (r) => BOARD[r.board][1](r.score) },
            { label: 'Prize paid', num: true, cell: (r) => money(r.prize_cents) },
          ],
          k.results || [],
          'No campaign has finished yet. Prizes are worked out when each two-week campaign ends.',
        ),
      ),
    ];
  }


  /*
   * Campaigns run by hand: set a format, a deadline and fixed prizes, approve
   * the videos that follow the format, then pay the winners.
   */
  function contestSection() {
    const list = state.campaigns?.contests || [];
    const field = (label, input) => h('label', {}, label, input);
    const title = h('input', { class: 'cp-input', placeholder: 'Launch day: most videos in 24 hours', maxlength: '80', required: true, 'aria-label': 'Campaign name' });
    const tier = h('select', { class: 'cp-input', 'aria-label': 'Who can join' }, h('option', { value: '' }, 'Every tier'), state.tiers.map((t) => h('option', { value: String(t.level), selected: t.level === 1 }, `${t.name} only`)));
    const metric = h('select', { class: 'cp-input', 'aria-label': 'Winner' }, h('option', { value: 'all' }, 'All three (launch set)'), h('option', { value: 'subs' }, 'Most new subscribers'), h('option', { value: 'views' }, 'Most views'), h('option', { value: 'videos' }, 'Most videos posted'));
    /* The subscriber prize is the biggest, because that is the one that pays you back. */
    const PRIZES = { subs: [150, 100, 50], views: [100, 75, 50], videos: [75, 50, 25] };
    const NAMES = { subs: 'most new subscribers', views: 'most views', videos: 'most videos' };
    const startAt = h('input', { class: 'cp-input', type: 'datetime-local', 'aria-label': 'Start time' });
    const judge = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', max: '720', step: '1', value: '48' });
    const checked = h('input', { type: 'checkbox', checked: true });
    const hours = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '1', step: '1', value: '24' });
    const minViews = h('input', { class: 'cp-input cp-input--num cp-input--wide', type: 'number', min: '0', step: '100', value: '1000' });
    const prize = [150, 100, 50].map((v, i) => h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', step: '5', value: String(v), 'aria-label': `Prize for place ${i + 1}` }));
    const prizeNote = h('small', { class: 'cp-hint' });
    const syncPrizes = () => {
      const all = metric.value === 'all';
      prize.forEach((input, i) => { input.disabled = all; if (!all) input.value = String(PRIZES[metric.value][i]); });
      prizeNote.textContent = all ? `Starts three campaigns at once: subscribers $${PRIZES.subs.join(' / ')}, views $${PRIZES.views.join(' / ')}, videos $${PRIZES.videos.join(' / ')}. $${Object.values(PRIZES).flat().reduce((x, y) => x + y, 0)} at most.` : '';
    };
    metric.addEventListener('change', syncPrizes);
    syncPrizes();
    const rules = h('input', { class: 'cp-input', placeholder: 'The format to follow, in one line', maxlength: '300', 'aria-label': 'Rules' });
    const reference = h('input', { class: 'cp-input', type: 'url', placeholder: 'Link to the reference video (optional)', 'aria-label': 'Reference video' });
    const repeat = h('input', { type: 'checkbox' });
    const start = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Start campaign');
    const form = h('form', { class: 'cp-rowform cp-rowform--wrap' }, title, tier, metric, field('Starts (leave empty for now)', startAt), field('Runs for (hours)', hours), field('Count results for (hours) after it ends', judge), field('A video counts from (views)', minViews), field('1st $', prize[0]), field('2nd $', prize[1]), field('3rd $', prize[2]), rules, reference, h('label', { class: 'cp-check' }, checked, 'Only creators whose account we have checked can join'), h('label', { class: 'cp-check' }, repeat, 'Start it again each time it ends'), prizeNote, start);
    form.addEventListener(
      'submit',
      act(start, async () => {
        const length = Number(hours.value);
        if (!title.value.trim() || !(length > 0)) throw new Error('Give the campaign a name and a length in hours.');
        if (reference.value.trim() && !cp.safeUrl(reference.value.trim())) throw new Error('The reference link must start with https://');
        const begins = startAt.value ? new Date(startAt.value) : new Date();
        if (Number.isNaN(begins.getTime())) throw new Error('Check the start time.');
        const base = { tier_level: tier.value ? Number(tier.value) : null, min_views: Math.max(0, Math.round(Number(minViews.value))), starts_at: begins.toISOString(), ends_at: new Date(begins.getTime() + length * 36e5).toISOString(), rules: rules.value.trim() || null, reference_url: reference.value.trim() || null, repeat: repeat.checked, require_checked: checked.checked, judge_hours: Math.max(0, Math.round(Number(judge.value))) };
        const rows = metric.value === 'all'
          ? Object.keys(PRIZES).map((m) => ({ ...base, metric: m, title: `${title.value.trim()}: ${NAMES[m]}`.slice(0, 80), prizes: PRIZES[m].map((dollars) => dollars * 100) }))
          : [{ ...base, metric: metric.value, title: title.value.trim(), prizes: prize.map((input) => Math.max(0, Math.round(Number(input.value) * 100))) }];
        await ok(db.from('creator_contests').insert(rows));
        toast(startAt.value ? 'Scheduled. Creators can see it and join now; it starts at the time you set.' : 'Started. Creators can join it now.');
        await reload();
      }),
    );

    const card = (k) => {
      const fmt = k.metric === 'views' ? compact : num;
      const ended = !k.open && new Date(k.ends_at) <= new Date();
      const payable = ended && new Date(k.pay_from || k.ends_at) <= new Date();
      const at = (iso) => new Date(iso).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      const waiting = k.videos.filter((v) => !v.approved);
      const approve = (v) => {
        const button = h('button', { class: v.approved ? 'cp-link' : 'btn btn--primary btn--sm', type: 'button' }, v.approved ? 'Remove' : 'Approve');
        button.addEventListener('click', act(button, async () => {
          await ok(v.approved ? db.from('creator_contest_videos').delete().eq('contest_id', k.id).eq('video_id', v.id) : db.from('creator_contest_videos').insert({ contest_id: k.id, video_id: v.id }));
          await reload();
        }));
        return button;
      };
      const approveAll = h('button', { class: 'cp-link', type: 'button' }, `Approve all ${waiting.length}`);
      approveAll.addEventListener('click', act(approveAll, async () => { await ok(db.from('creator_contest_videos').insert(waiting.map((v) => ({ contest_id: k.id, video_id: v.id })))); await reload(); }));
      const total = k.prizes.reduce((sum, cents) => sum + cents, 0);
      const pay = confirmButton('Pay winners', `Confirm: pay up to ${cp.dollars(total)}`, 'btn btn--primary btn--sm', async () => {
        const out = await cp.rpc('creator_contest_settle', { p_contest: k.id });
        if (out.status !== 'settled') throw new Error(out.status === 'not_over' ? 'It has not ended yet.' : out.status === 'judging' ? 'Results are still being counted.' : 'That did not go through.');
        toast(`${money(out.paid_cents)} sent to the winners' wallets.`);
        await reload();
      });
      const stop = h('button', { class: 'cp-link', type: 'button' }, k.repeat ? 'Stop repeating' : 'Repeat when it ends');
      stop.addEventListener('click', act(stop, async () => { await ok(db.from('creator_contests').update({ repeat: !k.repeat }).eq('id', k.id)); await reload(); }));
      const remove = confirmButton('Delete', 'Confirm delete', 'cp-link', async () => { await ok(db.from('creator_contests').delete().eq('id', k.id)); await reload(); });
      const who = k.tier_level ? `${(state.tiers.find((t) => t.level === k.tier_level) || {}).name || 'One tier'} only` : 'Every tier';
      return h(
        'section',
        { class: 'cp-card' },
        h('div', { class: 'cp-card__head' }, cp.figure(`${who} · ${k.metric === 'subs' ? 'most new subscribers' : k.metric === 'views' ? 'most views' : 'most videos'}`, k.title), k.settled_at ? pill('Paid', 'good') : k.upcoming ? pill(`Starts ${at(k.starts_at)}`, 'warn') : k.open ? pill(`Live until ${at(k.ends_at)}`, 'good') : payable ? pill('Ended: pay the winners', 'warn') : pill(`Counting until ${at(k.pay_from)}`, 'warn')),
        h('p', { class: 'cp-facts' }, `${num(k.entrants)} joined · prizes ${k.prizes.map((cents) => cp.dollars(cents)).join(' / ')}${k.metric === 'subs' ? ' · new paying subscribers through each creator\'s link, refunds taken off' : ` · a video counts from ${compact(k.min_views)} views`}${k.require_checked ? ' · checked accounts only' : ''}${k.rules ? ` · ${k.rules}` : ''}`),
        k.results.length
          ? table([{ label: 'Place', cell: (r) => String(r.place) }, { label: 'Creator', cell: (r) => h('b', {}, r.name) }, { label: 'Score', num: true, cell: (r) => fmt(r.score) }, { label: 'Paid', num: true, cell: (r) => money(r.prize_cents) }], k.results, '')
          : k.standing.length
            ? cp.hbars(k.standing.slice(0, 8).map((row) => ({ label: `${row.place}. ${row.name}`, value: Number(row.score) })), fmt, cp.COLOR.paid)
            : h('p', { class: 'cp-muted cp-small' }, k.metric === 'subs' ? 'No new subscribers yet.' : k.videos.length ? 'No video counts yet. Approve the ones that follow the format.' : 'No videos posted yet.'),
        !k.settled_at && k.videos.length && k.metric !== 'subs'
          ? foldPlain(
              `Videos to check${waiting.length ? ` (${waiting.length} waiting)` : ''}`,
              waiting.length > 1 ? approveAll : null,
              table(
                [
                  { label: 'Video', cell: (v) => { const href = cp.safeUrl(v.url); const name = v.title || v.url.replace(/^https:\/\/(www\.)?/, ''); return h('div', { class: 'cp-video' }, watch(v.url, name), h('span', { class: 'cp-platform', 'data-platform': v.platform }, cp.PLATFORM[v.platform]), href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, name) : name); } },
                  { label: 'Creator', cell: (v) => h('b', {}, v.creator) },
                  { label: 'Views', num: true, cell: (v) => compact(v.views) },
                  { label: 'In the campaign', cell: (v) => h('span', { class: 'cp-inline' }, v.approved ? pill(v.views >= k.min_views ? 'Counts' : 'Approved, short of views', v.views >= k.min_views ? 'good' : 'warn') : pill('Waiting', 'warn'), approve(v)) },
                ],
                k.videos,
                '',
              ),
            )
          : null,
        h('div', { class: 'cp-inline' }, !k.settled_at && payable ? pay : null, k.repeat ? pill('Repeats', 'good') : null, stop, !k.settled_at ? remove : null),
      );
    };

    /* Reference videos and formats, shown to creators as "Formats that work". */
    const bTitle = h('input', { class: 'cp-input', placeholder: 'Name of the format', maxlength: '120', required: true, 'aria-label': 'Format name' });
    const bUrl = h('input', { class: 'cp-input', type: 'url', placeholder: 'Link to the reference video', 'aria-label': 'Reference video link' });
    const bNote = h('input', { class: 'cp-input', placeholder: 'What to copy, in one line', maxlength: '300', 'aria-label': 'Note' });
    const bTier = h('select', { class: 'cp-input', 'aria-label': 'Who sees it' }, h('option', { value: '' }, 'Every tier'), state.tiers.map((t) => h('option', { value: String(t.level) }, `${t.name} only`)));
    /* On a phone this offers the camera as well as the library. */
    const bFile = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,video/webm,video/*', 'aria-label': 'Upload a video' });
    const MAX_MB = 50;
    const bAdd = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Add');
    const bForm = h('form', { class: 'cp-rowform cp-rowform--wrap' }, bTitle, bUrl, bNote, bTier, h('label', {}, 'Or upload a video', bFile), bAdd, h('small', { class: 'cp-hint' }, `Record one or pick one from your device, up to ${MAX_MB} MB (MP4, MOV or WebM). A link, an upload, or both.`));
    bForm.addEventListener(
      'submit',
      act(bAdd, async () => {
        if (!bTitle.value.trim()) throw new Error('Give it a name.');
        if (bUrl.value.trim() && !cp.safeUrl(bUrl.value.trim())) throw new Error('The link must start with https://');
        const file = bFile.files && bFile.files[0];
        let path = null;
        if (file) {
          if (!/^video\//.test(file.type)) throw new Error('That file is not a video.');
          if (file.size > MAX_MB * 1024 * 1024) throw new Error(`That video is ${Math.round(file.size / 1048576)} MB. The limit is ${MAX_MB} MB; trim it or lower the quality.`);
          if (cp.demo) throw new Error('This is a preview, so nothing was uploaded.');
          const ext = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[file.type] || 'mp4';
          path = `${crypto.randomUUID()}.${ext}`;
          bAdd.textContent = 'Uploading…';
          const { error } = await db.storage.from('creator-briefs').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
          bAdd.textContent = 'Add';
          if (error) throw new Error(`The upload did not go through: ${error.message}`);
        }
        try {
          await ok(db.from('creator_briefs').insert({ title: bTitle.value.trim(), url: bUrl.value.trim() || null, video_path: path, note: bNote.value.trim() || null, tier_level: bTier.value ? Number(bTier.value) : null }));
        } catch (error) {
          if (path) await db.storage.from('creator-briefs').remove([path]);
          throw error;
        }
        toast('Added. Creators can see it now.');
        await reload();
      }),
    );
    const briefRow = (b) => {
      const toggle = h('button', { class: 'cp-link', type: 'button' }, b.active ? 'Hide' : 'Show');
      toggle.addEventListener('click', act(toggle, async () => { await ok(db.from('creator_briefs').update({ active: !b.active }).eq('id', b.id)); await reload(); }));
      const drop = confirmButton('Delete', 'Confirm delete', 'cp-link', async () => { await ok(db.from('creator_briefs').delete().eq('id', b.id)); if (b.video_path) await db.storage.from('creator-briefs').remove([b.video_path]); await reload(); });
      return h('span', { class: 'cp-inline' }, b.active ? pill('Showing', 'good') : pill('Hidden'), toggle, drop);
    };
    const library = section(
      'Reference videos',
      h('span', { class: 'cp-muted' }, `${(state.briefs || []).length} showing to creators`),
      foldPlain('+ Add a reference video', bForm),
      (state.briefs || []).length
        ? table(
            [
              { label: 'Format', cell: (b) => h('div', {}, cp.safeUrl(b.url) ? h('a', { href: cp.safeUrl(b.url), target: '_blank', rel: 'noopener noreferrer' }, b.title) : h('b', {}, b.title), b.note ? h('div', { class: 'cp-small cp-muted' }, b.note) : null, b.video_path ? h('div', { class: 'cp-small' }, cp.briefVideoUrl(b.video_path) ? h('a', { href: cp.briefVideoUrl(b.video_path), target: '_blank', rel: 'noopener noreferrer' }, 'Uploaded video') : 'Uploaded video') : null) },
              { label: 'Who sees it', cell: (b) => (b.tier_level ? `${(state.tiers.find((t) => t.level === b.tier_level) || {}).name || 'One tier'} only` : 'Every tier') },
              { label: '', cell: briefRow },
            ],
            state.briefs,
            '',
          )
        : null,
    );

    const w = state.campaigns?.top_video_winners;
    return [
      section('Your campaigns', h('span', { class: 'cp-muted' }, `${list.filter((k) => k.open).length} live · ${list.filter((k) => k.upcoming).length} coming up`), foldPlain('+ New campaign', form), h('p', { class: 'cp-muted cp-small' }, 'Creators in the tier see it straight away and press Join. Videos they post before it ends appear below for you to check against the format. When it has ended, press Pay winners. These prizes are a marketing cost: they are paid whatever the creator has sold.')),
      ...list.map(card),
      library,
      w
        ? section(
            'Top videos',
            h('span', { class: 'cp-inline' }, pill('Weekly', 'good'), h('span', { class: 'cp-muted' }, w.week ? `Week of ${day(w.week)}` : 'First winners are paid next Monday')),
            w.winners.length ? table([{ label: 'Place', cell: (r) => String(r.place) }, { label: 'Creator', cell: (r) => h('b', {}, r.creator) }, { label: 'Video', cell: (r) => (cp.safeUrl(r.url) ? h('a', { href: cp.safeUrl(r.url), target: '_blank', rel: 'noopener noreferrer' }, r.title || 'Open') : r.title || '') }, { label: 'Views gained', num: true, cell: (r) => compact(r.gained) }, { label: 'Paid', num: true, cell: (r) => money(r.prize_cents) }], w.winners, '') : null,
            h('p', { class: 'cp-muted cp-small' }, `A video qualifies with ${compact(w.min_views)} views gained in the week; each creator's best one is entered. They are ranked by the commission their creator earned that week, because a sale is tied to a creator's link and cannot be traced to one video. The pool is ${Math.round(w.pool_rate * 1000) / 10}% of what the winners' sales brought in, split ${w.split.join(' / ')}. Paid in full.`),
          )
        : null,
    ];
  }

  /* ---------------------------------------------------------------- videos */

  function videos() {
    const refreshAll = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Check accounts now');
    refreshAll.addEventListener('click', act(refreshAll, () => refresh()));

    async function refresh(videoId) {
      const out = await cp.fn('creator-refresh-views', videoId ? { video_id: videoId } : {});
      if (out.skipped) throw new Error('No stats API key is set yet, so views are manual for now. Set SCRAPECREATORS_API_KEY to switch on automatic refresh.');
      toast(videoId ? (out.failed ? 'That video could not be refreshed.' : 'Refreshed.') : `Checked ${out.scanned} creator${out.scanned === 1 ? '' : 's'}: ${out.added} new video${out.added === 1 ? '' : 's'}${out.failed ? `, ${out.failed} failed` : ''}.`, out.failed ? 'error' : 'ok');
      await reload();
    }

    const update = (video, patch, message) => async () => {
      await ok(db.from('creator_videos').update(patch).eq('id', video.id));
      toast(message);
      await reload();
    };

    const review = (video) => {
      const approve = h('button', { class: video.status === 'pending' ? 'btn btn--primary btn--sm' : 'cp-link', type: 'button' }, 'Approve');
      approve.addEventListener('click', act(approve, update(video, { status: 'approved', reject_reason: null }, 'Approved. Bonuses now count for this video.')));
      const reject = h('button', { class: 'cp-link', type: 'button' }, 'Reject');
      reject.addEventListener('click', act(reject, update(video, { status: 'rejected' }, 'Rejected.')));
      return h('span', { class: 'cp-inline' }, statusPill(video.status), video.status !== 'approved' ? approve : null, video.status !== 'rejected' ? reject : null);
    };

    const viewsCell = (video) => {
      const input = h('input', { class: 'cp-input cp-input--num cp-input--wide', type: 'number', min: '0', step: '1', value: String(video.effective_views), 'aria-label': 'Views' });
      const save = h('button', { class: 'cp-link', type: 'button' }, 'Set');
      save.addEventListener(
        'click',
        act(save, async () => {
          const value = Math.round(Number(input.value));
          if (!(value >= 0)) throw new Error('Enter a number of views.');
          await update(video, { views_override: value }, `Views set to ${num(value)} by hand.`)();
        }),
      );
      const auto = h('button', { class: 'cp-link', type: 'button' }, 'Back to auto');
      auto.addEventListener('click', act(auto, update(video, { views_override: null }, 'Using the fetched count again.')));
      const again = h('button', { class: 'cp-link', type: 'button' }, 'Refresh');
      again.addEventListener('click', act(again, () => refresh(video.id)));
      return h(
        'div',
        {},
        h('span', { class: 'cp-inline' }, input, save, video.views_override != null ? auto : again),
        h('div', { class: 'cp-small cp-muted' }, video.views_override != null ? `Set by hand. Fetched: ${num(video.views)}` : video.last_error ? h('span', { class: 'cp-bad' }, `Last refresh failed: ${video.last_error}`) : video.last_checked_at ? `Checked ${day(video.last_checked_at)}` : 'Not checked yet'),
      );
    };

    /* For the rare video the account check misses. */
    const addTo = h('select', { class: 'cp-input', 'aria-label': 'Creator' }, state.creators.filter((c) => c.status === 'active').map((c) => h('option', { value: c.id }, c.display_name)));
    const addUrl = h('input', { class: 'cp-input', type: 'url', placeholder: 'Video link', 'aria-label': 'Video link' });
    const addButton = h('button', { class: 'btn btn--ghost btn--sm', type: 'submit' }, 'Add video');
    const ADD = { bad_url: 'That does not look like a TikTok, Instagram or YouTube video link.', duplicate: 'That video is already here.', no_creator: 'Choose a creator.' };
    const addForm = h('form', { class: 'cp-rowform' }, addTo, addUrl, addButton);
    addForm.addEventListener(
      'submit',
      act(addButton, async () => {
        const reply = await cp.rpc('creator_admin_add_video', { p_creator: addTo.value, p_url: addUrl.value.trim() });
        if (reply !== 'added') throw new Error(ADD[reply] || 'That did not go through.');
        toast('Added. It counts straight away.');
        await reload();
      }),
    );

    const order = { pending: 0, approved: 1, rejected: 2 };
    const rows = [...state.videos].sort((a, b) => order[a.status] - order[b.status] || new Date(b.created_at) - new Date(a.created_at));

    return section(
      'Videos',
      refreshAll,
      table(
        [
          {
            label: 'Video',
            cell: (video) => {
              const href = cp.safeUrl(video.url);
              const title = video.title || video.url.replace(/^https:\/\/(www\.)?/, '');
              return h('div', { class: 'cp-video' }, watch(video.url, title), h('span', { class: 'cp-platform', 'data-platform': video.platform }, cp.PLATFORM[video.platform]), href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, title) : title);
            },
          },
          { label: 'Creator', cell: (video) => h('div', {}, h('b', {}, creatorOf(video.creator_id).display_name), video.author ? h('div', { class: 'cp-small cp-muted' }, video.source === 'admin' ? 'Added by hand' : `Found on @${video.author}`) : null) },
          { label: 'Views', num: true, cell: (video) => h('div', {}, h('b', {}, compact(video.effective_views)), h('div', { class: 'cp-small cp-muted' }, `${compact(video.likes || 0)} likes · ${compact(video.comments || 0)} comments`)) },
          { label: 'Bonuses', cell: (video) => h('div', {}, cp.milestones(video.effective_views, state.rules.filter((rule) => rule.active), video.status === 'approved'), foldPlain('Fix views', viewsCell(video))) },
          { label: 'Review', cell: review },
        ],
        rows,
        `No videos yet. A creator's post appears here by itself when it has #${state.settings.hashtag || 'mindroll'} in the caption.`,
      ),
      foldPlain('Add a video by hand', h('p', { class: 'cp-muted cp-small' }, 'Only for a video the automatic check missed. It counts without the hashtag.'), addForm),
    );
  }

  /*
   * The money at each tier's sales goal: of what subscribers pay, how much the
   * store takes, how much goes to the creator as commission and as bonuses if
   * they collect every one, and how much is kept. Worked from the rules as they
   * stand, so it shows straight away when a bonus is raised past what its goal
   * can pay for. Website sales of weekly plans, which is the tightest case for
   * commission.
   */
  function goalMath() {
    const s = state.settings;
    const floor = s.min_margin_rate;
    const fee = Number(s.web_fee_rate) || 0;
    const rules = (state.rules || []).filter((rule) => rule.active).sort((x, y) => x.threshold_views - y.threshold_views);
    /* The most view bonus a number of views can earn: the best rate any milestone pays. */
    const perView = rules.reduce((best, rule, i) => Math.max(best, rules.slice(0, i + 1).reduce((sum, r) => sum + r.amount_cents, 0) / rule.threshold_views), 0);
    const volume = (state.volume || []).filter((rule) => rule.active).reduce((sum, rule) => sum + rule.amount_cents, 0);
    const rows = state.tiers.filter((t) => t.min_revenue_cents > 0).map((t) => {
      const goal = t.min_revenue_cents;
      const price = goal / (1 - fee);
      const mult = Number(t.bonus_multiplier ?? 1);
      const commission = goal * t.commission_rate;
      const posting = 5 * s.active_bonus_cents * mult + volume * mult;
      const views = (t.min_views || 0) * perView;
      const bonuses = posting + views + t.rank_up_bonus_cents;
      const room = floor == null ? Infinity : goal - floor * price - commission;
      return { t, price, fees: price - goal, commission, bonuses, kept: goal - commission - bonuses, over: bonuses - room };
    });
    if (!rows.length) return null;
    const short = (cents) => cp.dollars(Math.round(cents / 100) * 100);
    return section(
      'The money at each sales goal',
      h('span', { class: 'cp-muted' }, 'A creator selling exactly the goal who collects every bonus'),
      h(
        'div',
        { class: 'cp-paygrid' },
        rows.map((row) =>
          h(
            'div',
            { class: 'cp-paygrid__tier' },
            h('p', { class: 'cp-rowlabel' }, h('span', {}, h('b', {}, row.t.name), h('span', { class: 'cp-muted' }, ` · subscribers pay ${short(row.price)}`)), pill(`You keep ${Math.round((row.kept / row.price) * 1000) / 10}%`, row.over > 0 ? 'warn' : 'good')),
            cp.segbar(
              [
                { label: 'You keep', value: Math.max(0, row.kept), color: cp.COLOR.paid },
                { label: 'Commission', value: row.commission, color: cp.COLOR.ready },
                { label: 'Bonuses', value: row.bonuses, color: cp.COLOR.wait, dark: true },
                { label: 'Store fee', value: row.fees, color: '#8A8F98' },
              ],
              short,
            ),
            row.over > 0 ? h('p', { class: 'cp-small cp-bad' }, `These bonuses are ${short(row.over)} more than this goal can pay for${floor == null ? '' : ` at a ${Math.round(floor * 100)}% floor`}. The floor still holds: the extra waits until the creator sells more. Raise the goal or trim the bonuses to make it all payable.`) : null,
          ),
        ),
      ),
      h('p', { class: 'cp-muted cp-small' }, 'Bonuses here are the most a creator can collect in the 30 days they rank up: five active weeks, every posting-volume step, the rank-up bonus, and every view bonus the tier\'s own view bar can earn. Website sales of weekly plans.'),
    );
  }

  /* --------------------------------------------------------------- bonuses */

  /*
   * Incentives: what each kind of bonus has cost, who earned it, and the rules
   * behind each one, folded under the figure they produce.
   */
  let period = 'month';
  function bonuses() {
    const key = period === 'month' ? 'month_by_kind' : 'by_kind';
    const of = (c, kind) => (c.incentives?.[key]?.[kind]) || 0;
    const totalOf = (kind) => state.creators.reduce((sum, c) => sum + of(c, kind), 0);
    const total = cp.KINDS.reduce((sum, [kind]) => sum + totalOf(kind), 0);
    const field = (label, input) => h('label', {}, label, input);
    const numInput = (value, attrs = {}) => h('input', { class: 'cp-input', type: 'number', min: '0', step: 'any', value: String(value), ...attrs });

    const toggleOf = (table) => (rule) => {
      const button = h('button', { class: 'cp-link', type: 'button' }, rule.active ? 'Switch off' : 'Switch on');
      button.addEventListener('click', act(button, async () => { await ok(db.from(table).update({ active: !rule.active }).eq('id', rule.id)); await reload(); }));
      return button;
    };

    /* -- view milestones */
    const views = numInput('', { min: '1', step: '1', placeholder: '100000', 'aria-label': 'Views' });
    const amount = numInput('', { min: '1', placeholder: '100', 'aria-label': 'Bonus in dollars' });
    const retro = h('input', { type: 'checkbox' });
    const addRule = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Add');
    const viewForm = h('form', { class: 'cp-rowform' }, field('At', views), field('views pay $', amount), h('label', { class: 'cp-check' }, retro, 'Also for videos already posted'), addRule);
    viewForm.addEventListener(
      'submit',
      act(addRule, async () => {
        const threshold = Math.round(Number(views.value));
        const cents = Math.round(Number(amount.value) * 100);
        if (!(threshold > 0 && cents > 0)) throw new Error('Enter a view count and a dollar amount.');
        await ok(db.from('creator_bonus_rules').insert({ label: `${compact(threshold)} views`, threshold_views: threshold, amount_cents: cents, ...(retro.checked ? { applies_from: '1970-01-01T00:00:00Z' } : {}) }));
        toast('Milestone added.');
        await reload();
      }),
    );
    const viewRules = [
      viewForm,
      h('ul', { class: 'cp-ladder' }, state.rules.map((rule) => h('li', { 'data-off': !rule.active || null }, h('b', {}, cp.dollars(rule.amount_cents)), h('span', {}, `at ${compact(rule.threshold_views)} views`), toggleOf('creator_bonus_rules')(rule)))),
    ];

    /* -- active creator */
    const s = state.settings;
    const days = numInput(s.active_min_days, { min: '1', max: '7', step: '1' });
    const activePay = numInput(s.active_bonus_cents / 100);
    const floor = numInput(s.count_min_views, { step: '1' });
    const saveActive = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Save');
    const activeForm = h('form', { class: 'cp-rowform' }, field('Post on', days), field('days in a week, pay $', activePay), field('A video counts from', floor), h('span', {}, 'views'), saveActive);
    activeForm.addEventListener(
      'submit',
      act(saveActive, async () => {
        await ok(db.from('creator_settings').update({ active_min_days: Math.round(Number(days.value)), active_bonus_cents: Math.round(Number(activePay.value) * 100), count_min_views: Math.round(Number(floor.value)) }).eq('id', true));
        toast('Saved.');
        await reload();
      }),
    );

    /* -- posting volume */
    const vids = numInput('', { min: '1', step: '1', placeholder: '20', 'aria-label': 'Videos' });
    const vidPay = numInput('', { min: '1', placeholder: '125', 'aria-label': 'Bonus in dollars' });
    const addVolume = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Add');
    const volumeForm = h('form', { class: 'cp-rowform' }, field('For', vids), field('videos in a month, pay $', vidPay), addVolume);
    volumeForm.addEventListener(
      'submit',
      act(addVolume, async () => {
        const count = Math.round(Number(vids.value));
        const cents = Math.round(Number(vidPay.value) * 100);
        if (!(count > 0 && cents > 0)) throw new Error('Enter a number of videos and a dollar amount.');
        await ok(db.from('creator_volume_rules').insert({ min_videos: count, amount_cents: cents }));
        toast('Volume bonus added.');
        await reload();
      }),
    );
    const volumeRules = [
      volumeForm,
      h('ul', { class: 'cp-ladder' }, state.volume.map((rule) => h('li', { 'data-off': !rule.active || null }, h('b', {}, cp.dollars(rule.amount_cents)), h('span', {}, `for ${rule.min_videos} videos`), toggleOf('creator_volume_rules')(rule)))),
    ];

    /* -- tiers */
    const tierRows = state.tiers.map((t) => ({
      t,
      name: h('input', { class: 'cp-input', value: t.name, maxlength: '24', 'aria-label': `Tier ${t.level} name` }),
      views: numInput(t.min_views ?? 0, { step: '1000', 'aria-label': `Tier ${t.level} views in a month`, disabled: t.level === 1 }),
      posts: numInput(t.min_posts ?? 0, { step: '1', 'aria-label': `Tier ${t.level} videos in a month`, disabled: t.level === 1 }),
      min: numInput(t.min_revenue_cents / 100, { 'aria-label': `Tier ${t.level} monthly sales`, disabled: t.level === 1 }),
      mult: numInput(Number(t.bonus_multiplier ?? 1), { step: '0.5', max: '100', 'aria-label': `Tier ${t.level} posting bonus multiplier` }),
      rate: numInput(Math.round(t.commission_rate * 1000) / 10, { max: '100', step: '0.5', 'aria-label': `Tier ${t.level} commission` }),
      bonus: numInput(t.rank_up_bonus_cents / 100, { 'aria-label': `Tier ${t.level} rank-up bonus`, disabled: t.level === 1 }),
      yearly: numInput((t.annual_flat_cents ?? 500) / 100, { step: '0.5', 'aria-label': `Tier ${t.level} pay for each yearly subscriber` }),
      pool: numInput((t.campaign_pool_cents ?? 0) / 100, { step: '50', 'aria-label': `Tier ${t.level} weekly campaign prizes` }),
      race: numInput((t.race_prize_cents ?? 0) / 100, { step: '500', 'aria-label': `Tier ${t.level} race to the podium prize`, disabled: t.level === 1 }),
      dayViews: numInput(t.active_day_views ?? 1000, { step: '500', 'aria-label': `Tier ${t.level} views a day needs for the active week` }),
    }));
    const saveTiers = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Save tiers');
    saveTiers.addEventListener(
      'click',
      act(saveTiers, async () => {
        let last = null;
        for (const row of tierRows) {
          const bars = [Math.round(Number(row.views.value)), Math.round(Number(row.posts.value)), Math.round(Number(row.min.value) * 100)];
          const rate = Number(row.rate.value) / 100;
          if (!row.name.value.trim() || !(rate >= 0 && rate <= 1) || bars.some((bar) => !(bar >= 0)) || !(Number(row.mult.value) >= 0)) throw new Error('Each tier needs a name, a rate from 0 to 100, and bars that are not negative.');
          /* A tier above the first must ask for at least as much as the one below, and more of something. */
          if (last && !(bars.every((bar, i) => bar >= last[i]) && bars.some((bar, i) => bar > last[i]))) throw new Error(`${row.name.value.trim()} must ask for more than the tier below it.`);
          last = bars;
        }
        for (const row of tierRows) {
          await ok(db.from('creator_tiers').update({ name: row.name.value.trim(), min_views: Math.round(Number(row.views.value)), min_posts: Math.round(Number(row.posts.value)), bonus_multiplier: Number(row.mult.value), min_revenue_cents: Math.round(Number(row.min.value) * 100), commission_rate: Number(row.rate.value) / 100, rank_up_bonus_cents: Math.round(Number(row.bonus.value) * 100), annual_flat_cents: Math.round(Number(row.yearly.value) * 100), campaign_pool_cents: Math.max(0, Math.round(Number(row.pool.value) * 100)), active_day_views: Math.max(0, Math.round(Number(row.dayViews.value))), race_prize_cents: Math.max(0, Math.round(Number(row.race.value) * 100)) }).eq('level', row.t.level));
        }
        toast('Tiers saved. New rates apply to payments from now on.');
        await reload();
      }),
    );
    const top = state.tiers[state.tiers.length - 1];
    const addTier = h('button', { class: 'cp-link', type: 'button' }, 'Add a tier');
    addTier.addEventListener('click', act(addTier, async () => {
      await ok(db.from('creator_tiers').insert({ level: (top?.level || 0) + 1, name: `Tier ${(top?.level || 0) + 1}`, min_views: top ? Math.max((top.min_views || 0) * 2, 100000) : 0, min_posts: top ? Math.max((top.min_posts || 0) * 2, 10) : 0, bonus_multiplier: top ? Number(top.bonus_multiplier ?? 1) + 1 : 1, min_revenue_cents: top ? top.min_revenue_cents : 0, commission_rate: top ? top.commission_rate : s.default_commission_rate, rank_up_bonus_cents: 0, annual_flat_cents: top ? top.annual_flat_cents ?? 500 : 500 }));
      await reload();
    }));
    const dropTier = top && top.level > 1 ? confirmButton('Remove top tier', `Confirm: remove ${top.name}`, 'cp-link', async () => { await ok(db.from('creator_tiers').delete().eq('level', top.level)); await reload(); }) : null;
    const tierRules = [
      h(
        'div',
        { class: 'cp-tablewrap' },
        h(
          'table',
          { class: 'cp-table cp-table--edit' },
          h('thead', {}, h('tr', {}, ['Tier', 'Views in 30 days', 'Videos in 30 days', 'Sales goal in 30 days ($)', 'Commission on every sale (%)', 'Each new yearly subscriber, on top ($)', 'Active week ×', 'Views a day needs to count', 'Rank-up bonus ($)', 'Campaign prizes every two weeks, up to ($)', 'Race to the podium: first to reach it ($)'].map((label) => h('th', { scope: 'col' }, label)))),
          h('tbody', {}, tierRows.map((row) => h('tr', {}, h('td', {}, row.name), h('td', {}, row.views), h('td', {}, row.posts), h('td', {}, row.min), h('td', {}, row.rate), h('td', {}, row.yearly), h('td', {}, row.mult), h('td', {}, row.dayViews), h('td', {}, row.bonus), h('td', {}, row.pool), h('td', {}, row.race)))),
        ),
      ),
      h('div', { class: 'cp-inline' }, saveTiers, addTier, dropTier),
    ];

    /* -- one-off */
    const who = h('select', { class: 'cp-input', 'aria-label': 'Creator', required: true }, h('option', { value: '' }, 'Choose a creator'), state.creators.filter((c) => c.status === 'active').map((c) => h('option', { value: c.id }, c.display_name)));
    const why = h('input', { class: 'cp-input', placeholder: 'Reason, shown to the creator', maxlength: '80', required: true, 'aria-label': 'Reason' });
    const much = numInput('', { min: '1', placeholder: '50', 'aria-label': 'Amount in dollars' });
    const grant = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Give bonus');
    const grantForm = h('form', { class: 'cp-rowform' }, who, why, field('$', much), grant);
    grantForm.addEventListener(
      'submit',
      act(grant, async () => {
        const cents = Math.round(Number(much.value) * 100);
        if (!who.value || !why.value.trim() || !(cents > 0)) throw new Error('Choose a creator, a reason and an amount.');
        const { data: session } = await db.auth.getSession();
        await ok(db.from('creator_bonuses').insert({ creator_id: who.value, kind: 'manual', label: why.value.trim(), amount_cents: cents, created_by: session.session.user.id }));
        toast('Bonus added to their ready balance.');
        await reload();
      }),
    );

    const withdraw = (bonus) => {
      if (bonus.payout_id) return pill('Paid', 'good');
      return h('span', { class: 'cp-inline' }, pill('Ready', 'good'), confirmButton('Withdraw', 'Confirm withdraw', 'cp-link', async () => { await ok(db.from('creator_bonuses').delete().eq('id', bonus.id)); toast('Bonus withdrawn.'); await reload(); }));
    };

    const RULES = { views: ['Paid once per video for each view milestone', viewRules], active: ['Paid every week (Monday to Sunday) a creator posts on enough different days. A day counts when the videos posted on it reach the tier\'s views between them (set per tier in the table under Rank-up). This is the Iron amount; higher tiers are paid it times their multiplier', [activeForm]], volume: ['Paid each month for the number of videos posted. These are the Iron amounts; higher tiers are paid them times their multiplier', volumeRules], rank_up: ['A creator holds the highest tier whose bars their last 30 days meet: sales, views gained and videos posted. Leave a bar at 0 to not use it. The sales goal is what pays for the tier, so raise a tier\'s bonuses and its goal together. Each tier sets the commission on weekly plans, the flat amount for a new yearly subscriber, and how many times bigger the weekly and monthly posting bonuses are. The rank-up bonus is paid the first time a tier is reached', tierRules], prize: ['Paid when each two-week campaign ends, to the top places on each tier\'s three leaderboards, out of the prize fund. Set each tier\'s cap in the tier table under Rank-up, and see the boards on the Campaigns tab', []], daily: ['Paid to each Champion for every day they post a video, out of the prize fund. Set the amount in Settings', []], contest: ['Prizes for the campaigns you run by hand on the Campaigns tab. Paid in full when you press Pay winners', []], top_video: ['Paid every Monday to the top videos of the week before: a share of what the winners\' sales brought in. Paid in full. Set the numbers in Settings', []], referral: ['Paid to a creator when someone they invited reaches the lifetime views set in Settings. Paid in full', []], iron_views: ['For creators at the first rank: a fixed amount for every step of views. The first step needs only views; each one after it needs one more subscriber. Paid in full. Set the numbers in Settings', []], first_top: ['Race to the podium: a one-off prize for the first creator ever to reach each rank, set per rank in the tier table under Rank-up. Paid in full, once per rank', []], first_sale: ['A creator\'s first weekly sale and first yearly sale are topped up to a bigger share of the sale, once each. Paid in full. Set the share in Settings', []], manual: ['Anything the rules do not cover', [grantForm]] };
    const card = ([kind, label]) => {
      const rules = cp.fold(kind === 'manual' ? 'Give a bonus' : 'Rules', h('p', { class: 'cp-muted cp-small' }, RULES[kind][0]), ...RULES[kind][1]);
      rules.classList.add('cp-fold--plain');
      return h('section', { class: 'cp-card' }, cp.figure(label, cp.dollars(totalOf(kind))), rules);
    };

    const ranked = state.creators
      .map((c) => ({ c, value: cp.KINDS.reduce((sum, [kind]) => sum + of(c, kind), 0) }))
      .filter((row) => row.value > 0)
      .sort((x, y) => y.value - x.value)
      .slice(0, 12)
      .map(({ c, value }) => ({ label: `${c.display_name} · ${tierName(c)}`, value, note: cp.KINDS.filter(([kind]) => of(c, kind) > 0).map(([kind, label]) => `${label} ${cp.dollars(of(c, kind))}`).join(' · ') }));

    const switcher = h(
      'div',
      { class: 'cp-switch', role: 'group', 'aria-label': 'Period' },
      [['month', 'This month'], ['all', 'All time']].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(period === id), onclick: () => { period = id; render(); } }, label)),
    );

    return [
      goalMath(),
      h(
        'div',
        { class: 'cp-two cp-even cp-top' },
        h('div', { class: 'cp-stack' }, h('section', { class: 'cp-card' }, h('div', { class: 'cp-card__head' }, cp.figure('Total bonuses', money(total), true), switcher)), ...cp.KINDS.map(card)),
        section('By creator', h('span', { class: 'cp-muted' }, period === 'month' ? 'Bonuses this month' : 'Bonuses, all time'), ranked.length ? cp.hbars(ranked, cp.dollars, cp.COLOR.wait) : h('p', { class: 'cp-empty' }, 'No bonuses yet.')),
      ),
      cp.fold(
        'See every bonus awarded',
        table(
          [
            { label: 'Date', cell: (b) => day(b.created_at) },
            { label: 'Creator', cell: (b) => h('b', {}, creatorOf(b.creator_id).display_name) },
            { label: 'Bonus', cell: (b) => b.label },
            { label: 'Type', cell: (b) => (cp.KINDS.find(([kind]) => kind === b.kind) || ['', 'Bonus'])[1] },
            { label: 'Amount', num: true, cell: (b) => money(b.amount_cents) },
            { label: 'Status', cell: withdraw },
          ],
          state.bonuses,
          'No bonuses awarded yet.',
        ),
      ),
    ];
  }

  /* --------------------------------------------------------------- payouts */

  function payouts() {
    return section(
      'Payouts',
      h('span', { class: 'cp-muted' }, 'Send the money by PayPal, Venmo or Zelle, then mark it paid on the Creators tab'),
      table(
        [
          { label: 'Date', cell: (p) => day(p.paid_at || p.created_at) },
          { label: 'Creator', cell: (p) => h('b', {}, creatorOf(p.creator_id).display_name) },
          { label: 'Amount', num: true, cell: (p) => h('b', {}, money(p.amount_cents)) },
          { label: 'Method', cell: (p) => (p.method === 'manual' ? 'PayPal, Venmo or Zelle' : 'Stripe') },
          { label: 'Reference', cell: (p) => h('code', { class: 'cp-mono cp-small' }, p.stripe_transfer_id || '') },
          { label: 'Status', cell: (p) => h('span', {}, statusPill(p.status), p.error ? h('div', { class: 'cp-small cp-bad' }, p.error) : null) },
        ],
        state.payouts,
        'No payouts yet.',
      ),
    );
  }

  /* -------------------------------------------------------------- settings */

  function settings() {
    const s = state.settings;
    const field = (label, input, hint) => h('label', { class: 'auth-field' }, h('span', {}, label), input, hint && h('small', { class: 'cp-hint' }, hint));
    const rate = h('input', { type: 'number', min: '0', max: '100', step: '0.5', value: String(Math.round(s.default_commission_rate * 1000) / 10) });
    const base = h('select', {}, h('option', { value: 'net', selected: s.commission_base === 'net' }, 'What you receive after store fees and tax'), h('option', { value: 'gross', selected: s.commission_base === 'gross' }, 'What the subscriber paid'));
    const hold = h('input', { type: 'number', min: '0', max: '365', step: '1', value: String(s.hold_days) });
    const min = h('input', { type: 'number', min: '0', step: '1', value: String(s.min_payout_cents / 100) });
    const track = h('input', { type: 'number', min: '1', max: '730', step: '1', value: String(s.track_days) });
    const cap = h('input', { type: 'number', min: '0', max: '99', step: '0.5', value: s.min_margin_rate == null ? '' : String(Math.round(s.min_margin_rate * 1000) / 10), placeholder: 'No floor' });
    const appFee = h('input', { type: 'number', min: '0', max: '99', step: '0.5', value: String(Math.round(s.app_store_fee_rate * 1000) / 10) });
    const webFee = h('input', { type: 'number', min: '0', max: '99', step: '0.1', value: String(Math.round(s.web_fee_rate * 1000) / 10) });
    const open = h('input', { type: 'checkbox', checked: s.applications_open });
    const tag = h('input', { type: 'text', maxlength: '30', value: s.hashtag || 'mindroll', autocapitalize: 'none', spellcheck: 'false' });
    const scan = h('input', { type: 'number', min: '15', max: '1440', step: '15', value: String(s.scan_minutes || 60) });
    const slots = h('input', { type: 'number', min: '0', max: '50', step: '1', value: String(s.champion_slots ?? 3) });
    const champRate = h('input', { type: 'number', min: '0', max: '100', step: '0.5', value: String(Math.round((s.champion_rate ?? 0.25) * 1000) / 10) });
    const champDaily = h('input', { type: 'number', min: '0', step: '1', value: String((s.champion_daily_cents ?? 15000) / 100) });
    const minCreators = h('input', { type: 'number', min: '1', step: '1', value: String(s.campaign_min_creators ?? 5) });
    const inFull = h('input', { type: 'checkbox', checked: !!s.fund_pay_in_full });
    const refPay = h('input', { type: 'number', min: '0', step: '5', value: String((s.referral_bonus_cents ?? 10000) / 100) });
    const refViews = h('input', { type: 'number', min: '0', step: '1000', value: String(s.referral_views ?? 100000) });
    const mgrRefPay = h('input', { type: 'number', min: '0', step: '5', value: String((s.manager_referral_cents ?? 10000) / 100) });
    const ironPay = h('input', { type: 'number', min: '0', step: '5', value: String((s.iron_step_cents ?? 5000) / 100) });
    const ironStep = h('input', { type: 'number', min: '1000', step: '1000', value: String(s.iron_step_views ?? 50000) });
    const ironCap = h('input', { type: 'number', min: '0', step: '10000', value: String(s.iron_cap_views ?? 1000000) });
    const ironMin = h('input', { type: 'number', min: '0', step: '500', value: String(s.iron_video_min_views ?? 2000) });
    const firstRate = h('input', { type: 'number', min: '0', max: '100', step: '5', value: String(Math.round((s.first_sale_rate ?? 0.5) * 100)) });
    const fvOn = h('input', { type: 'checkbox' });
    fvOn.checked = s.first_video_on !== false;
    const fvTimes = h('input', { type: 'number', min: '1', max: '10', step: '0.5', value: String(Number(s.first_video_multiplier ?? 2)) });
    const fvHours = h('input', { type: 'number', min: '1', max: '720', step: '1', value: String(s.first_video_hours ?? 24) });
    const fvDays = h('input', { type: 'number', min: '0', max: '90', step: '1', value: String(s.first_video_sale_days ?? 7) });
    const fvCap = h('input', { type: 'number', min: '0', step: '50', value: String((s.first_video_cap_cents ?? 100000) / 100) });
    const topMin = h('input', { type: 'number', min: '0', step: '1000', value: String(s.top_video_min_views ?? 100000) });
    const topRate = h('input', { type: 'number', min: '0', max: '100', step: '0.5', value: String(Math.round((s.top_video_pool_rate ?? 0.05) * 1000) / 10) });
    const terms = h('textarea', { rows: '12' }, s.terms_text || '');
    const again = h('input', { type: 'checkbox' });
    const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Save settings');
    const form = h(
      'form',
      { class: 'cp-form' },
      field('Commission is a share of', base),
      h('div', { class: 'cp-form__row' }, field('App Store fee (%)', appFee), field('Web checkout fee (%)', webFee), field('Fallback commission (%)', rate)),
      h('small', { class: 'cp-hint' }, 'Fees are used when RevenueCat does not report one. The fallback commission only applies if there are no tiers.'),
      field('Keep at least this share of every sale (%)', cap, 'Of the price the subscriber paid, after the store\'s fee and everything paid to the creator. Commission on a sale is trimmed to fit, and bonuses wait until the creator\'s sales cover them. Leave empty for no floor.'),
      field('Days before commission can be paid out', hold, 'Long enough for refunds to arrive first.'),
      field('Minimum payout ($)', min),
      field('Hashtag that makes a video count', tag, 'Without the #. Only posts from a creator\'s linked account with this tag in the caption are counted.'),
      field('Check creators\' accounts every (minutes)', scan, 'New videos and fresh view counts arrive this often. Each check uses one stats credit per linked account.'),
      field('Days a video keeps being tracked', track, 'After this its view count stops refreshing.'),
      h('div', { class: 'cp-form__row' }, field('Champion places', slots), field('Champion commission (%)', champRate), field('Champion pay a day ($)', champDaily)),
      h('small', { class: 'cp-hint' }, 'Champions are the creators in the top tier with the most sales over the last 30 days. 0 places switches Champion off.'),
      field('Creators a tier needs before its campaigns run', minCreators),
      h('label', { class: 'cp-check' }, inFull, 'Pay campaign prizes and Champion pay in full, even when that takes us below the share above'),
      h('small', { class: 'cp-hint' }, 'Off: they are paid from the prize fund and scaled down when it is short, so the share you keep never drops below the floor.'),
      h('div', { class: 'cp-form__row' }, field('Pay for inviting a creator ($)', refPay), field('Once the new creator has this many views', refViews)),
      h('div', { class: 'cp-form__row' }, field('Pay a manager for bringing in a creator ($)', mgrRefPay)),
      h('div', { class: 'cp-form__row' }, field('Top videos: views in the week to qualify', topMin), field('Prize pool, % of the winners\' sales', topRate)),
      h('div', { class: 'cp-form__row' }, field('Views pay for the first rank ($)', ironPay), field('for every (views)', ironStep), field('up to (views)', ironCap)),
      h('div', { class: 'cp-form__row' }, field('A video counts for views pay from (views)', ironMin), field('First weekly and first yearly sale pay (%)', firstRate)),
      h('small', { class: 'cp-hint' }, 'Views pay: the first step needs only views, and each step after it needs one more subscriber. $0 switches it off. Creator referrals, top-video prizes, views pay, the first-sale bonus and the campaigns you run by hand are paid in full, outside the share above.'),
      h('label', { class: 'cp-check' }, fvOn, 'First video boost: a new creator\'s first video pays more if they post it in time'),
      h('div', { class: 'cp-form__row' }, field('First video pays (times)', fvTimes), field('if posted within (hours)', fvHours), field('Sales count for (days after posting)', fvDays), field('Most extra per creator ($)', fvCap)),
      h('small', { class: 'cp-hint' }, 'The clock starts the first time a creator opens their dashboard after accepting the terms, and they see it counting down. That first video then pays the multiple: commission on every sale that comes in during the days after it was posted, and every bonus the video itself earns. Paid in full, outside the share above, up to the most per creator.'),
      field('Creator terms', terms, 'Every creator accepts these before their dashboard opens. Have the wording checked before you rely on it.'),
      h('label', { class: 'cp-check' }, again, 'I changed the terms: ask every creator to accept them again'),
      h('label', { class: 'cp-check' }, open, 'Accept new creator applications'),
      save,
    );
    form.addEventListener(
      'submit',
      act(save, async () => {
        const patch = {
          default_commission_rate: Number(rate.value) / 100,
          commission_base: base.value,
          hold_days: Math.round(Number(hold.value)),
          min_payout_cents: Math.round(Number(min.value) * 100),
          track_days: Math.round(Number(track.value)),
          hashtag: tag.value.trim().replace(/^#/, '').toLowerCase(),
          scan_minutes: Math.round(Number(scan.value)),
          applications_open: open.checked,
          min_margin_rate: cap.value === '' ? null : Number(cap.value) / 100,
          app_store_fee_rate: Number(appFee.value) / 100,
          web_fee_rate: Number(webFee.value) / 100,
          champion_slots: Math.round(Number(slots.value)),
          champion_rate: Number(champRate.value) / 100,
          champion_daily_cents: Math.round(Number(champDaily.value) * 100),
          campaign_min_creators: Math.round(Number(minCreators.value)),
          fund_pay_in_full: inFull.checked,
          terms_text: terms.value.trim(),
          ...(again.checked ? { terms_version: (s.terms_version || 1) + 1 } : {}),
          referral_bonus_cents: Math.max(0, Math.round(Number(refPay.value) * 100)),
          referral_views: Math.max(0, Math.round(Number(refViews.value))),
          ...('manager_referral_cents' in s ? { manager_referral_cents: Math.max(0, Math.round(Number(mgrRefPay.value) * 100)) } : {}),
          iron_step_cents: Math.max(0, Math.round(Number(ironPay.value) * 100)),
          iron_step_views: Math.max(1000, Math.round(Number(ironStep.value))),
          iron_cap_views: Math.max(0, Math.round(Number(ironCap.value))),
          iron_video_min_views: Math.max(0, Math.round(Number(ironMin.value))),
          first_sale_rate: Math.min(1, Math.max(0, Number(firstRate.value) / 100)),
          first_video_on: fvOn.checked,
          first_video_multiplier: Math.min(10, Math.max(1, Number(fvTimes.value) || 1)),
          first_video_hours: Math.min(720, Math.max(1, Math.round(Number(fvHours.value) || 24))),
          first_video_cap_cents: Math.max(0, Math.round(Number(fvCap.value) * 100)),
          first_video_sale_days: Math.min(90, Math.max(0, Math.round(Number(fvDays.value) || 0))),
          top_video_min_views: Math.max(0, Math.round(Number(topMin.value))),
          top_video_pool_rate: Math.min(1, Math.max(0, Number(topRate.value) / 100)),
        };
        if (!(patch.champion_slots >= 0 && patch.champion_slots <= 50) || !(patch.champion_rate >= 0 && patch.champion_rate <= 1) || !(patch.champion_daily_cents >= 0) || !(patch.campaign_min_creators >= 1)) throw new Error('Check the Champion and campaign numbers.');
        if (!(patch.default_commission_rate >= 0 && patch.default_commission_rate <= 1)) throw new Error('Commission must be between 0 and 100%.');
        if (!patch.terms_text) throw new Error('The creator terms cannot be empty.');
        if (!/^[a-z0-9_]{2,30}$/.test(patch.hashtag)) throw new Error('The hashtag can only use letters, numbers and underscores.');
        if (!(patch.scan_minutes >= 15 && patch.scan_minutes <= 1440)) throw new Error('Check accounts between every 15 minutes and once a day.');
        await ok(db.from('creator_settings').update(patch).eq('id', true));
        toast('Settings saved.');
        await reload();
      }),
    );
    /*
     * Where the Discord bot posts for the team (a new application, for now)
     * and which role it mentions. Read from the server when the card is opened,
     * so the lists are always the server's real channels and roles.
     */
    const alertsBody = h('div', { class: 'cp-form' }, h('p', { class: 'cp-muted' }, 'Loading the server\'s channels…'));
    const drawAlerts = (a) => {
      const pick = (list, chosen, auto, empty) => h('select', { class: 'cp-input' }, h('option', { value: '' }, auto ? `Automatic (${auto})` : empty), list.map((x) => h('option', { value: x.id, selected: x.id === chosen }, x.name)));
      const channel = pick(a.channels.map((c) => ({ id: c.id, name: `#${c.name}` })), a.chosen.channel, a.chosen.channel ? null : a.channel && `#${a.channel.name}`, 'No channel with "admin" in its name: choose one');
      const role = pick(a.roles.map((r) => ({ id: r.id, name: `@${r.name}` })), a.chosen.role, a.chosen.role ? null : a.role && `@${a.role.name}`, 'Nobody is mentioned');
      const save = async () => { await ok(db.from('creator_settings').update({ discord_alert_channel: channel.value || null, discord_alert_role: role.value || null }).eq('id', true)); toast('Saved.'); };
      channel.addEventListener('change', () => save().catch((e) => toast(e.message, 'error')));
      role.addEventListener('change', () => save().catch((e) => toast(e.message, 'error')));
      const test = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Send a test message');
      test.addEventListener('click', act(test, async () => { const out = await cp.fn('creator-discord', { action: 'test_alert' }); toast(out.channel ? `Sent to #${out.channel.name}.` : 'Sent.'); }));
      alertsBody.replaceChildren(
        h('p', { class: 'cp-muted' }, a.channel ? `New applications are posted in #${a.channel.name}${a.role ? ` and mention @${a.role.name}` : ''}.` : 'No channel is chosen yet, so nothing is posted.'),
        h('div', { class: 'cp-form__row' }, field('Channel', channel), field('Role to mention', role)),
        h('div', {}, test),
        h('small', { class: 'cp-hint' }, 'The bot must be allowed to see and write in the channel. Creators and managers who connected Discord are messaged directly when someone joins on their invite link.'),
      );
    };
    if (cp.demo) drawAlerts({ channels: [{ id: '1', name: 'admin' }, { id: '2', name: 'announcements' }], roles: [{ id: '1', name: 'Admin' }, { id: '2', name: 'Manager' }], channel: { id: '1', name: 'admin' }, role: { id: '1', name: 'Admin' }, chosen: { channel: null, role: null } });
    else cp.fn('creator-discord', { action: 'alerts' }).then(drawAlerts, (e) => alertsBody.replaceChildren(h('p', { class: 'cp-bad' }, e.message || 'Could not reach Discord.')));
    return [h('div', { class: 'cp-card cp-narrow cp-narrow--left' }, h('h2', {}, 'Discord alerts for the team'), alertsBody), h('div', { class: 'cp-card cp-narrow cp-narrow--left' }, h('h2', {}, 'Program settings'), form)];
  }

  /* ------------------------------------------------------------ sample data */

  function demoState() {
    const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
    const c = (id, name, code, status, o = {}) => ({
      id, display_name: name, code, status, country: 'US', email: `${code}@example.com`, commission_rate: o.rate ?? null, payouts_enabled: o.stripe ?? true, created_at: ago(o.age ?? 40), approved_at: ago(38),
      tiktok: `@${code}`, instagram: o.ig ? `@${code}` : null, youtube: null, note: o.note ?? null, cashout_requested_at: o.cashout ? ago(1) : null, scan_error: o.scanError ?? null,
      payout_method: o.stripe === false ? null : 'venmo', payout_handle: o.stripe === false ? null : `@${code}`,
      referred_by: o.by ?? null, manager_id: o.mgr ?? null, tier_level: o.tier ?? 1, champion: false, payout_hold: !!o.hold, hold_reason: o.hold || null, handle_verified: o.verified ?? true, terms_accepted_at: status === 'active' ? ago(37) : null,
      rate: o.rate ?? [0.1, 0.12, 0.15][(o.tier ?? 1) - 1], incentives: { tier_level: o.tier ?? 1, by_kind: o.kinds ?? {}, month_by_kind: o.month ?? {}, window_revenue_cents: Math.round((o.rev ?? 0) * 0.8), window_views: Math.round((o.views ?? 0) * 0.9), window_posts: o.videos ?? 0 },
      balance: { available_cents: o.ready ?? 0, pending_cents: o.pending ?? 0, paid_cents: o.paid ?? 0, in_transit_cents: 0, commission_cents: o.comm ?? 0, bonus_cents: o.bonus ?? 0 },
      stats: { clicks: o.clicks ?? 0, signups: o.signups ?? 0, customers: o.subs ?? 0, revenue_cents: o.rev ?? 0, videos: o.videos ?? 0, views: o.views ?? 0 },
    });
    return {
      settings: { default_commission_rate: 0.1, manager_referral_cents: 10000, commission_base: 'net', hold_days: 30, min_payout_cents: 2500, track_days: 60, applications_open: true, min_margin_rate: 0.7, manychat_commission_cents: 7500, active_min_days: 4, active_bonus_cents: 1000, hashtag: 'mindroll', scan_minutes: 60, count_min_views: 1000, annual_bonus_cents: 500, app_store_fee_rate: 0.15, web_fee_rate: 0.025, terms_version: 1, terms_text: 'By using the Mindroll creator panel you agree to the following.\n\n1. Your content. You give Mindroll a free licence to use your Mindroll videos, including as paid advertising.\n\n2. Fair play. No fake views, clicks or sales. If cheating is suspected, payouts are held.', referral_bonus_cents: 10000, referral_views: 100000, top_video_min_views: 100000, top_video_pool_rate: 0.05, champion_slots: 3, champion_rate: 0.25, champion_daily_cents: 15000, campaign_min_creators: 5, campaign_split: [50, 30, 20], fund_pay_in_full: false },
      tiers: [
        { level: 1, name: 'Iron', min_revenue_cents: 0, min_views: 0, min_posts: 0, bonus_multiplier: 1, commission_rate: 0.1, rank_up_bonus_cents: 0, annual_flat_cents: 500, campaign_pool_cents: 0, active_day_views: 1000, race_prize_cents: 0 },
        { level: 2, name: 'Silver', min_revenue_cents: 150000, min_views: 100000, min_posts: 4, bonus_multiplier: 5, commission_rate: 0.12, rank_up_bonus_cents: 2500, annual_flat_cents: 600, campaign_pool_cents: 150000, active_day_views: 2000, race_prize_cents: 100000 },
        { level: 3, name: 'Gold', min_revenue_cents: 500000, min_views: 1000000, min_posts: 9, bonus_multiplier: 10, commission_rate: 0.15, rank_up_bonus_cents: 15000, annual_flat_cents: 700, campaign_pool_cents: 500000, active_day_views: 5000, race_prize_cents: 300000 },
        { level: 4, name: 'Platinum', min_revenue_cents: 1000000, min_views: 2000000, min_posts: 14, bonus_multiplier: 25, commission_rate: 0.18, rank_up_bonus_cents: 27500, annual_flat_cents: 800, campaign_pool_cents: 1000000, active_day_views: 10000, race_prize_cents: 600000 },
        { level: 5, name: 'Diamond', min_revenue_cents: 1500000, min_views: 3000000, min_posts: 21, bonus_multiplier: 50, commission_rate: 0.2, rank_up_bonus_cents: 32000, annual_flat_cents: 900, campaign_pool_cents: 1500000, active_day_views: 100000, race_prize_cents: 1000000 },
      ],
      volume: [],
      creators: [
        Object.assign(c('c5', 'Jonah Reads', 'jonah', 'pending', { by: 'c1', age: 1, ig: true, note: '48K on TikTok, mostly book and study content. Posting three times a week.' }), { niche: 'books', followers_said: '50k_250k', post_freq: 'few_week', made_ugc: true, tiktok_followers: 48200, instagram_followers: 6100, followers_checked_at: ago(1) }),
        Object.assign(c('c6', 'Priya', 'priya', 'pending', { age: 2 }), { niche: 'comedy', followers_said: '10k_50k', post_freq: 'less', made_ugc: false, tiktok_followers: 640, followers_checked_at: ago(2) }),
        c('c1', 'Maya', 'maya', 'active', { mgr: 'm1', ready: 16160, pending: 5744, paid: 14200, comm: 20604, bonus: 15500, clicks: 6240, signups: 388, subs: 41, rev: 173354, videos: 4, views: 718400, ig: true, tier: 2, cashout: true, kinds: { views: 5000, rank_up: 2500 }, month: { views: 4000, rank_up: 2500 } }),
        c('c2', 'Theo Studies', 'theo', 'active', { by: 'c1', mgr: 'm1', ready: 3400, pending: 2800, paid: 2000, comm: 6200, bonus: 2000, clicks: 2210, signups: 142, subs: 16, rev: 62000, videos: 6, views: 264000, tier: 1, kinds: { views: 1000, manual: 1000 }, month: { views: 1000 } }),
        c('c3', 'Bookish Lina', 'lina', 'active', { by: 'c1', mgr: 'm2', verified: false, ready: 600, pending: 800, paid: 0, comm: 1400, bonus: 0, clicks: 704, signups: 36, subs: 5, rev: 14000, videos: 2, views: 31200, stripe: false }),
        Object.assign(c('c7', 'Noor Notes', 'noor', 'active', { mgr: 'm1', clicks: 980, signups: 51, subs: 7, rev: 21000, comm: 2100, videos: 5, views: 186000 }), { referred_manager: 'm1' }),
        Object.assign(c('c8', 'Eli Annotates', 'eli', 'active', { mgr: 'm1', clicks: 120, signups: 4, videos: 2, views: 38500 }), { referred_manager: 'm1' }),
        c('c4', 'Sam', 'sam', 'paused', { by: 'c2', clicks: 210, signups: 9, subs: 1, rev: 1699, comm: 170, pending: 170, videos: 1, views: 4100 }),
      ],
      pulse: { sales_today_cents: 21400, sales_7d_cents: 98200, sales_prev_7d_cents: 71400, subs_today: 6, subs_7d: 31, views_today: 61300, views_7d: 412000, videos_7d: 14, daily: Array.from({ length: 90 }, (_, i) => { const cents = Math.round((1800 + i * 190) * (1 + 0.45 * Math.sin(i * 1.7)) * (i % 7 === 5 ? 1.6 : 1)); return { day: ago(89 - i).slice(0, 10), sales_cents: cents, paid_cents: Math.round(cents * 0.14), subs: Math.round(cents / 2600), views: cents * 4 }; }) },
      sales: [['c1', 'purchase', 'weekly', 1949, 234, 0.02], ['c2', 'renewal', 'weekly', 1949, 195, 0.06], ['c1', 'purchase', 'annual', 8774, 1653, 0.2], ['c3', 'purchase', 'weekly', 1949, 195, 0.4], ['c1', 'refund', 'weekly', -1949, -234, 0.9], ['c2', 'purchase', 'weekly', 1949, 195, 1.3], ['c1', 'renewal', 'weekly', 1949, 234, 1.6]].map(([creator_id, kind, plan, base_cents, amount_cents, age], i) => ({ id: `s${i}`, creator_id, kind, plan, base_cents, amount_cents, occurred_at: ago(age) })),
      feed: [
        { at: ago(0.01), kind: 'growth', title: 'Bookish Lina', detail: 'the app that finally got me off my phone gained 61K views in a day', tab: 'rankings' },
        { at: ago(0.05), kind: 'applied', title: 'Jonah Reads', detail: 'Applied to join', tab: 'creators' },
        { at: ago(0.3), kind: 'cashout', title: 'Maya', detail: 'Asked to cash out', tab: 'creators' },
        { at: ago(0.9), kind: 'milestone', title: 'Maya', detail: 'I replaced doomscrolling with this for 30 days passed 500K views', tab: 'rankings' },
        { at: ago(1.2), kind: 'applied', title: 'Priya', detail: 'Applied to join', tab: 'creators' },
        { at: ago(2.5), kind: 'rank_up', title: 'Maya', detail: 'Reached Silver', tab: 'rankings' },
        { at: ago(6), kind: 'approved', title: 'Bookish Lina', detail: 'Accepted into the program', tab: 'creators' },
      ],
      fund: { rate: 0.7, room_cents: 31800, reserve_cents: 22300, spent_cents: 10000, free_cents: 9500 },
      campaigns: {
        week: ago(2).slice(0, 10), ends_at: ago(-4.2), scale: 0.06, fund: { rate: 0.7, room_cents: 31800, reserve_cents: 22300, spent_cents: 10000, free_cents: 9500 },
        tiers: [
          { level: 1, name: 'Iron', pool_cents: 0, in_tier: 2, entrants: 0, boards: {} },
          { level: 2, name: 'Silver', pool_cents: 150000, in_tier: 7, entrants: 6, boards: { videos: [{ place: 1, name: 'Theo Studies', score: 5 }, { place: 2, name: 'Maya', score: 3 }, { place: 3, name: 'Bookish Lina', score: 2 }], views: [{ place: 1, name: 'Maya', score: 212400 }, { place: 2, name: 'Noor', score: 150200 }, { place: 3, name: 'Theo Studies', score: 64100 }], sales: [{ place: 1, name: 'Noor', score: 61200 }, { place: 2, name: 'Bookish Lina', score: 40800 }, { place: 3, name: 'Theo Studies', score: 18700 }] } },
          { level: 3, name: 'Gold', pool_cents: 500000, in_tier: 1, entrants: 0, boards: {} },
          { level: 4, name: 'Platinum', pool_cents: 1000000, in_tier: 0, entrants: 0, boards: {} },
          { level: 5, name: 'Diamond', pool_cents: 1500000, in_tier: 0, entrants: 0, boards: {} },
        ],
        weeks: [{ week: ago(9).slice(0, 10), planned_cents: 150000, paid_cents: 10000 }],
        contests: [
          { id: 'k1', title: 'Launch day: most videos in 24 hours', rules: 'Use the hook from the reference video.', reference_url: null, tier_level: 1, metric: 'videos', min_views: 1000, starts_at: ago(0.4), ends_at: ago(-0.6), prizes: [7500, 5000, 2500], settled_at: null, open: true, upcoming: false, require_checked: true, judge_hours: 48, pay_from: ago(-2.6), entrants: 9,
            standing: [{ place: 1, name: 'Bookish Lina', score: 3 }, { place: 2, name: 'Theo Studies', score: 2 }],
            videos: [{ id: 'v8', title: 'the app that finally got me off my phone', url: 'https://www.instagram.com/reel/DBxy98z/', platform: 'instagram', views: 88200, creator: 'Bookish Lina', approved: true }, { id: 'v9', title: 'Day 1 of reading 5 minutes', url: 'https://www.tiktok.com/@theo/video/7520000000000000002', platform: 'tiktok', views: 640, creator: 'Theo Studies', approved: false }], results: [] },
        ],
        top_video_winners: { min_views: 100000, pool_rate: 0.05, split: [50, 30, 20], step_views: 50000, step_cents: 100, week: ago(9).slice(0, 10), winners: [{ place: 1, creator: 'Maya', title: 'I replaced doomscrolling with this for 30 days', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', gained: 308200, prize_cents: 5540 }] },
        results: [
          { week: ago(9).slice(0, 10), tier_level: 2, board: 'views', place: 1, name: 'Noor', score: 301000, prize_cents: 5000 },
          { week: ago(9).slice(0, 10), tier_level: 2, board: 'views', place: 2, name: 'Maya', score: 188000, prize_cents: 3000 },
          { week: ago(9).slice(0, 10), tier_level: 2, board: 'views', place: 3, name: 'Theo Studies', score: 90200, prize_cents: 2000 },
        ],
        top_videos: {
          day: [{ id: 'v8', url: 'https://www.instagram.com/reel/DBxy98z/', platform: 'instagram', title: 'the app that finally got me off my phone', creator: 'Bookish Lina', views: 88200, gained: 61300, likes: 7400 }],
          week: [{ id: 'v1', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', title: 'I replaced doomscrolling with this for 30 days', creator: 'Maya', views: 512300, gained: 204100, likes: 61200 }, { id: 'v8', url: 'https://www.instagram.com/reel/DBxy98z/', platform: 'instagram', title: 'the app that finally got me off my phone', creator: 'Bookish Lina', views: 88200, gained: 88200, likes: 7400 }],
          month: [{ id: 'v1', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', title: 'I replaced doomscrolling with this for 30 days', creator: 'Maya', views: 512300, gained: 512300, likes: 61200 }, { id: 'v2', url: 'https://www.instagram.com/reel/DAbc12x/', platform: 'instagram', title: 'One idea from Meditations that changed my mornings', creator: 'Maya', views: 148900, gained: 148900, likes: 12040 }],
          all: [{ id: 'v1', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', title: 'I replaced doomscrolling with this for 30 days', creator: 'Maya', views: 512300, gained: 512300, likes: 61200 }, { id: 'v2', url: 'https://www.instagram.com/reel/DAbc12x/', platform: 'instagram', title: 'One idea from Meditations that changed my mornings', creator: 'Maya', views: 148900, gained: 148900, likes: 12040 }, { id: 'v8', url: 'https://www.instagram.com/reel/DBxy98z/', platform: 'instagram', title: 'the app that finally got me off my phone', creator: 'Bookish Lina', views: 88200, gained: 88200, likes: 7400 }],
        },
      },
      links: [{ creator_id: 'c1', creator: 'Maya', tag: 'doomscroll', clicks: 3820, signups: 240, customers: 27, sales_cents: 112400, commission_cents: 13488 }, { creator_id: 'c1', creator: 'Maya', tag: 'meditations', clicks: 1410, signups: 96, customers: 9, sales_cents: 41200, commission_cents: 4944 }, { creator_id: 'c2', creator: 'Theo Studies', tag: 'study-with-me', clicks: 980, signups: 61, customers: 7, sales_cents: 28300, commission_cents: 2830 }],
      briefs: [{ id: 'f1', title: 'The "I replaced doomscrolling" hook', url: 'https://www.tiktok.com/@mindroll/video/7520000000000000100', note: 'Say the swap in the first two seconds.', tier_level: null, active: true }],
      funnel: {
        days: 30, visitors: 9154, signups: 575, customers: 63,
        steps: [
          { path: '/', step: 'view', position: 0, visitors: 9154 },
          { path: '/start', step: 'view', position: 0, visitors: 4210 },
          { path: '/start', step: 'hook', position: 1, visitors: 4102 },
          { path: '/start', step: 'goals', position: 2, visitors: 3320 },
          { path: '/start', step: 'books', position: 4, visitors: 2890 },
          { path: '/start', step: 'habits', position: 9, visitors: 2110 },
          { path: '/start', step: 'plan', position: 22, visitors: 1480 },
          { path: '/start', step: 'account', position: 30, visitors: 902 },
          { path: '/start', step: 'offer', position: 31, visitors: 588 },
          { path: '/start', step: 'checkout-click', position: 400, visitors: 141 },
          { path: '/pro', step: 'view', position: 0, visitors: 730 },
        ],
      },
      totals: { gross_cents: 277660, net_cents: 251053, revenue_cents: 251053, commission_cents: 28374, bonus_cents: 20500, paid_cents: 16200, views: 1017700, signups: 575, customers: 63, annual_subs: 22, recurring_subs: 31, recurring_sales_month_cents: 221209, recurring_commission_month_cents: 24100, annual_sales_cents: 168278 },
      videos: [
        { id: 'v9', creator_id: 'c2', url: 'https://www.tiktok.com/@theo/video/7520000000000000002', platform: 'tiktok', title: null, author: null, status: 'pending', views: 0, views_override: null, effective_views: 0, created_at: ago(0), last_checked_at: null },
        { id: 'v8', creator_id: 'c3', url: 'https://www.instagram.com/reel/DBxy98z/', platform: 'instagram', title: 'the app that finally got me off my phone', author: 'someone.else', status: 'pending', views: 88200, views_override: null, effective_views: 88200, created_at: ago(1), last_checked_at: ago(0) },
        { id: 'v1', creator_id: 'c1', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', title: 'I replaced doomscrolling with this for 30 days', author: 'maya', status: 'approved', views: 512300, views_override: null, effective_views: 512300, created_at: ago(21), last_checked_at: ago(0) },
        { id: 'v2', creator_id: 'c1', url: 'https://www.instagram.com/reel/DAbc12x/', platform: 'instagram', title: 'One idea from Meditations that changed my mornings', author: 'maya', status: 'approved', views: 141000, views_override: 148900, effective_views: 148900, created_at: ago(12), last_checked_at: ago(0) },
        { id: 'v3', creator_id: 'c2', url: 'https://youtube.com/shorts/Y2Ah_DFr8cw', platform: 'youtube', title: 'Five minutes a day, actually remembered', author: '@theostudies', status: 'approved', views: 54100, views_override: null, effective_views: 54100, created_at: ago(6), last_checked_at: ago(1), last_error: 'Video not found or private.' },
      ],
      rules: [
        { id: 'r2', label: '100K views', threshold_views: 100000, amount_cents: 1000, active: true, applies_from: '1970-01-01T00:00:00Z' },
        { id: 'r3', label: '500K views', threshold_views: 500000, amount_cents: 3000, active: true, applies_from: '1970-01-01T00:00:00Z' },
        { id: 'r4', label: '1M views', threshold_views: 1000000, amount_cents: 6000, active: true, applies_from: '1970-01-01T00:00:00Z' },
      ],
      referrals: { clicks: [{ kind: 'creator', ref_id: 'c1', n: 148 }, { kind: 'creator', ref_id: 'c2', n: 31 }, { kind: 'creator', ref_id: 'c3', n: 6 }, { kind: 'manager', ref_id: 'm1', n: 64 }, { kind: 'manager', ref_id: 'm2', n: 12 }], signups: [{ kind: 'creator', ref_id: 'c1', n: 9 }, { kind: 'creator', ref_id: 'c2', n: 2 }, { kind: 'manager', ref_id: 'm1', n: 5 }, { kind: 'manager', ref_id: 'm2', n: 1 }], manager_bonuses: [{ manager_id: 'm1', creator_id: 'c7', amount_cents: 10000, created_at: ago(4) }] },
      managers: [
        { manager: { id: 'm1', display_name: 'Alex Rivera', code: 'alex_rivera', active: true, cut_rate: 0.5 }, email: 'alex@example.com', signed_in: true, creators: [], totals: {}, pay: { total_cents: 341200, brought_in_cents: 812400, paid_out_cents: 187300, profit_cents: 625100, from_cut_cents: 312550, from_rankup_cents: 1750, from_active_cents: 5500, from_views_cents: 2100, referral_cents: 10000, referral_views: 100000, from_referral_cents: 10000, referrals: [{ id: 'c7', display_name: 'Noor Notes', status: 'active', views: 186000, paid: true }, { id: 'c8', display_name: 'Eli Annotates', status: 'active', views: 38500, paid: false }] } },
        { manager: { id: 'm2', display_name: 'Dana Cho', code: 'dana_cho', active: true }, email: 'dana@example.com', signed_in: false, creators: [], totals: {}, pay: { total_cents: 4100 } },
      ],
      bonuses: [
        { id: 'br1', creator_id: 'c1', kind: 'referral', amount_cents: 10000, label: 'Referred Theo Studies', ref: 'c2', created_at: ago(6) },
        { id: 'b1', creator_id: 'c1', kind: 'views', label: '500K views', rule_id: 'r3', amount_cents: 3000, payout_id: null, created_at: ago(3) },
        { id: 'b2', creator_id: 'c1', kind: 'views', label: '100K views', rule_id: 'r2', amount_cents: 1000, payout_id: null, created_at: ago(5) },
        { id: 'b5', creator_id: 'c2', kind: 'manual', label: 'Launch week', rule_id: null, amount_cents: 1000, payout_id: 'p3', created_at: ago(20) },
      ],
      payouts: [
        { id: 'p1', creator_id: 'c1', amount_cents: 9200, status: 'paid', method: 'stripe', stripe_transfer_id: 'tr_1QxSample', created_at: ago(16), paid_at: ago(16) },
        { id: 'p3', creator_id: 'c2', amount_cents: 2000, status: 'paid', method: 'manual', stripe_transfer_id: null, created_at: ago(18), paid_at: ago(18) },
        { id: 'p4', creator_id: 'c3', amount_cents: 3000, status: 'failed', method: 'stripe', error: 'The destination account cannot receive transfers yet.', created_at: ago(9) },
      ],
    };
  }

  /* Last, so every helper above exists before the first render. */
  if (cp.empty) {
    setWho('Preview');
    cp.loadEmpty().then((data) => { state = data.admin; render(); }, (error) => view.replaceChildren(h('p', { class: 'cp-empty' }, error.message)));
  } else if (cp.demo) {
    setWho('Sample data');
    state = demoState();
    render();
  } else if (!db) {
    view.replaceChildren(h('p', { class: 'cp-empty' }, 'This page could not load. Please refresh.'));
  } else {
    db.auth.onAuthStateChange((_event, session) => setTimeout(() => route(session), 0));
    db.auth.getSession().then(({ data }) => route(data.session));
  }
})();
