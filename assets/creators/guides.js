/*
 * The three guides a manager (and an admin) can read inside the dashboard:
 * how the program is structured, how a creator is paid at each rank, and how
 * a referral pays. Every figure comes from the `ctx` the dashboard passes in,
 * so the guides always state what the program pays today. A part whose
 * numbers are missing is left out rather than guessed.
 *
 *   window.mindrollCreators.guides = { structure(ctx), payByRank(ctx), referral(ctx) }
 *
 * Each returns an array of <section class="mr-panel mr-guide"> nodes.
 */
(() => {
  const cp = window.mindrollCreators;
  if (!cp) return;
  const h = cp.h;
  const SVG = 'http://www.w3.org/2000/svg';
  const s = cp.s || ((tag, attrs, ...kids) => {
    const el = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs || {})) if (value != null) el.setAttribute(name, value);
    el.append(...kids.filter(Boolean));
    return el;
  });
  const num = cp.num || ((n) => Number(n || 0).toLocaleString('en-US'));
  const compact = cp.compact || num;
  const pct = cp.pct || ((rate) => `${Math.round(Number(rate) * 1000) / 10}%`);
  const dollars = cp.dollars || ((cents) => `$${(Number(cents || 0) / 100).toLocaleString('en-US')}`);

  const list = (v) => (Array.isArray(v) ? v : []);
  const pos = (v) => Number(v) > 0;
  /* "10% to 20%", or just "10%" when every value is the same. */
  const range = (values, fmt) => {
    const all = values.map(Number).filter((n) => n > 0);
    if (!all.length) return null;
    const lo = Math.min(...all), hi = Math.max(...all);
    return lo === hi ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
  };
  const panel = (eyebrow, title, ...body) => h('section', { class: 'mr-panel mr-guide' }, h('p', { class: 'mr-guide__eyebrow' }, eyebrow), h('h2', {}, title), ...body);
  const note = (...kids) => h('p', { class: 'mr-guide__note' }, ...kids);
  const tiersOf = (ctx) => list(ctx.tiers).slice().sort((a, b) => Number(a.level) - Number(b.level));
  const champOf = (ctx) => (ctx.champion && pos(ctx.champion.slots) ? ctx.champion : null);
  const refOf = (ctx) => (ctx.referral && pos(ctx.referral.bonus_cents) ? ctx.referral : null);
  const weekOf = (ctx, t) => Math.round(Number((ctx.active && ctx.active.base_amount_cents) || 0) * Number(t.bonus_multiplier ?? 1));

  /* Column chart, drawn the way the pitch draws its own: blue gradient columns, value above, name below. */
  let chartCount = 0;
  const columns = (rows, fmt, label) => {
    const W = 320, H = 172, top0 = 26, base = H - 26;
    const slot = W / rows.length, bw = Math.min(40, slot * 0.62);
    const most = Math.max(...rows.map((r) => r.value)) || 1;
    const id = `mrguide${(chartCount += 1)}`;
    const grid = [0.25, 0.5, 0.75, 1].map((f) => s('line', { x1: 0, x2: W, y1: base - (base - top0) * f, y2: base - (base - top0) * f, class: 'mr-guide-col__grid' }));
    const bars = rows.map((r, i) => {
      const x = slot * i + (slot - bw) / 2;
      const hgt = Math.max(3, ((base - top0) * r.value) / most);
      const y = base - hgt;
      return s(
        'g',
        {},
        s('path', { d: `M${x},${base} V${y + 5} Q${x},${y} ${x + 5},${y} H${x + bw - 5} Q${x + bw},${y} ${x + bw},${y + 5} V${base} Z`, fill: `url(#${id})` }, s('title', {}, `${r.name}: ${fmt(r.value)}`)),
        s('text', { x: x + bw / 2, y: y - 7, class: 'mr-guide-col__value', 'text-anchor': 'middle' }, fmt(r.value)),
        s('text', { x: x + bw / 2, y: H - 8, class: 'mr-guide-col__name', 'text-anchor': 'middle' }, r.name),
      );
    });
    return s(
      'svg',
      { viewBox: `0 0 ${W} ${H}`, class: 'mr-guide-col', role: 'img', 'aria-label': `${label}: ${rows.map((r) => `${r.name} ${fmt(r.value)}`).join(', ')}` },
      s('defs', {}, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0%', 'stop-color': '#5B8CFF' }), s('stop', { offset: '100%', 'stop-color': '#1E4FD6' }))),
      ...grid,
      s('line', { x1: 0, x2: W, y1: base, y2: base, class: 'mr-guide-col__base' }),
      ...bars,
    );
  };

  /* ---------------------------------------------------------- structure */

  function structure(ctx = {}) {
    const tiers = tiersOf(ctx);
    const champ = champOf(ctx);
    const ref = refOf(ctx);
    const m = ctx.manager || null;
    const rates = range([...tiers.map((t) => t.commission_rate), champ ? champ.rate : 0], pct);

    const bands = [
      ['App users', 'Pay for Mindroll. Every dollar in the program starts here.'],
      ref ? ['Recruiters', `Any creator or manager who invites a creator. ${dollars(ref.bonus_cents)} once that creator reaches ${compact(ref.views)} views.`] : null,
      ['Creators', rates ? `${rates} of what their subscribers pay, plus bonuses.` : 'A share of what their subscribers pay, plus bonuses.'],
      ['Creator managers', `A cut of the profit their team brings in${m && pos(m.cut_rate) ? ` (${pct(m.cut_rate)})` : ''}, plus team bonuses.`],
      ['Mindroll', 'Keeps what is left after everyone above is paid.'],
    ].filter(Boolean);
    const funnel = h(
      'div',
      { class: 'mr-guide-funnel' },
      h('small', {}, 'Top of the funnel'),
      bands.map(([name, line], i) => h('div', { class: 'mr-guide-funnel__band', style: `--w:${100 - i * 9}%`, 'data-step': String(i + 1), 'data-last': i === bands.length - 1 || null }, h('b', {}, name), h('span', {}, line))),
      h('small', {}, 'Bottom of the funnel'),
    );

    const level = (label, boxes, tone) => h('div', { class: 'mr-guide-chain__level', 'data-tone': tone || null }, h('small', {}, label), h('div', { class: 'mr-guide-chain__row' }, boxes.map(([name, line, on]) => h('div', { class: 'mr-guide-chain__box', 'data-on': on || null }, h('b', {}, name), line ? h('span', {}, line) : null))));
    const chain = h(
      'div',
      { class: 'mr-guide-chain' },
      level('Mindroll', [['Mindroll', 'Approves creators, sets the pay rules, sends payouts']], 'top'),
      level('Creator managers', [['Manager', null], ['Manager', 'Recruits and runs a team', true], ['Manager', null]]),
      level("Creators on one manager's team", [['Creator', null], ['Creator', 'Posts with #Mindroll, shares their link', true], ['Creator', null]]),
      level('App users', [['Paying user', null], ['Paying user', 'Subscribed through the creator’s link', true], ['Paying user', null]]),
    );

    const t0 = tiers[0];
    const SALES = 100000; /* the worked example: $1,000 of sales */
    const mine = t0 && pos(t0.commission_rate) ? Math.round(SALES * Number(t0.commission_rate)) : 0;
    const example = mine
      ? panel(
        'Example',
        `${dollars(SALES)} of sales after store fees, split`,
        h('div', { class: 'mr-guide-split', role: 'img', 'aria-label': `Of ${dollars(SALES)}, the creator earns ${dollars(mine)} and ${dollars(SALES - mine)} is left.` }, h('i', { style: `--w:${(mine / SALES) * 100}%` }), h('i', {})),
        h(
          'ul',
          { class: 'mr-guide-rows' },
          h('li', { 'data-key': 'creator' }, h('span', {}, `Creator on ${pct(t0.commission_rate)}${t0.name ? ` (${t0.name})` : ''}`), h('b', {}, dollars(mine))),
          h('li', { 'data-key': 'rest' }, h('span', {}, 'Left for manager pay, bonuses and Mindroll'), h('b', {}, dollars(SALES - mine))),
        ),
        note('An example. The creator’s share is their commission rate; it is the same whether or not they have a manager.'),
      )
      : null;

    const pay = m
      ? [
        pos(m.cut_rate) && [pct(m.cut_rate), 'of the profit their team brings in'],
        pos(m.rankup_rate) && [pct(m.rankup_rate), 'of each rank-up bonus a creator on their team earns'],
        pos(m.active_cents) && [dollars(m.active_cents), 'for each active week a creator on their team has'],
        pos(m.views_cents) && [dollars(m.views_cents), 'for every 100K views their team gets'],
        pos(m.referral_cents) && [dollars(m.referral_cents), `for each creator they recruit${ref ? ` who reaches ${compact(ref.views)} views` : ''}`],
      ].filter(Boolean)
      : [];
    const managerPay = pay.length
      ? panel(
        'Creator managers',
        'How a manager is paid',
        h('div', { class: 'mr-guide-facts' }, pay.map(([value, line]) => h('div', {}, h('b', {}, value), h('span', {}, line)))),
        note('Manager pay is paid by Mindroll. It is not taken out of a creator’s pay.', pos(m.rate_cap) ? ` A manager can give a creator on their team up to ${pct(m.rate_cap)} commission.` : ''),
      )
      : null;

    return [
      panel('How it works', 'The funnel: who is paid at each level', funnel, note('Money comes in at the top from app users and moves down. Each level is paid its share, and Mindroll keeps what is left.')),
      panel('The same thing as a chart', 'Who sits where', chain, note('The funnel turned upside down. The blue boxes follow one manager, one of their creators, and one of that creator’s subscribers.')),
      example,
      managerPay,
    ].filter(Boolean);
  }

  /* --------------------------------------------------------- pay by rank */

  function payByRank(ctx = {}) {
    const tiers = tiersOf(ctx);
    const champ = champOf(ctx);
    const ref = refOf(ctx);
    const high = tiers.slice().reverse();
    const ladder = (key) => high.filter((t) => pos(t[key])).map((t) => [t.name, dollars(t[key])]);
    const leaf = (title, line, o = {}) => h('div', { class: 'mr-guide-tree__leaf', 'data-big': o.big || null, 'data-only': o.only || null }, h('b', {}, title), line ? h('span', {}, line) : null, o.rows && o.rows.length ? h('ul', { class: 'mr-guide-ladder' }, o.rows.map(([k, v]) => h('li', {}, h('span', {}, k), h('b', {}, v)))) : null);
    const group = (title, leaves) => { const all = leaves.filter(Boolean); return all.length ? h('div', { class: 'mr-guide-tree__group' }, h('h3', {}, title), all) : null; };

    const rates = range([...tiers.map((t) => t.commission_rate), champ ? champ.rate : 0], pct);
    const yearly = range(tiers.map((t) => t.annual_flat_cents), dollars);
    const weekly = range(tiers.map((t) => weekOf(ctx, t)), dollars);
    const days = Number((ctx.active && ctx.active.min_days) || 0);
    const rules = list(ctx.rules).filter((r) => pos(r.amount_cents)).slice().sort((a, b) => Number(a.threshold_views) - Number(b.threshold_views));
    const split = list(ctx.campaigns && ctx.campaigns.split);
    const pools = ladder('campaign_pool_cents'), races = ladder('race_prize_cents'), ups = ladder('rank_up_bonus_cents');

    const groups = [
      group('From sales', [
        rates && leaf('Commission', `${rates} of what your subscribers pay, for as long as they stay.`, { big: true }),
        yearly && leaf('Yearly subscriber', `${yearly} for each new yearly subscriber.`),
      ]),
      group('From rank', [
        pools.length && leaf('Campaigns', `A prize pool for each rank${split.length ? `, split ${split.map((x) => `${x}%`).join(' / ')} between the winners` : ''}.`, { big: true, rows: pools }),
        races.length && leaf('Race to the podium', 'A one-off prize for the first creator ever to reach the rank.', { big: true, rows: races }),
        ups.length && leaf('Rank-up bonus', 'Paid once, the first time you reach the rank.', { rows: ups }),
      ]),
      group('From posting', [
        weekly && leaf('Active week bonus', `${weekly} each week${days ? ` you post on ${num(days)} or more days` : ''}.`),
        champ && pos(champ.daily_cents) && leaf('Champion daily pay', `${dollars(champ.daily_cents)} for each day a Champion posts.`, { only: true }),
      ]),
      group('From views', [
        rules.length && leaf('View bonus, per video', null, { rows: rules.map((r) => [r.label || `${compact(r.threshold_views)} views`, dollars(r.amount_cents)]) }),
      ]),
      group('From recruiting', [
        ref && leaf('Recruiting reward', `${dollars(ref.bonus_cents)} for each creator you bring in, once they reach ${compact(ref.views)} views.`),
      ]),
    ].filter(Boolean);
    const tree = groups.length
      ? panel('Every way to earn', 'A creator’s pay', h('div', { class: 'mr-guide-tree' }, h('div', { class: 'mr-guide-tree__top' }, 'A creator’s pay'), h('div', { class: 'mr-guide-tree__groups' }, groups)), note('Grouped by what earns it. The tinted boxes are the biggest payers.'))
      : null;

    const need = (t) => {
      const parts = [pos(t.min_revenue_cents) && `${dollars(t.min_revenue_cents)} in sales`, pos(t.min_views) && `${compact(t.min_views)} views`, pos(t.min_posts) && `${num(t.min_posts)} videos`].filter(Boolean);
      return parts.length ? `Held while the last 30 days show ${parts.join(', ')}.` : 'Where everyone starts.';
    };
    const stat = (value, label) => h('div', { class: 'mr-guide-rank__stat' }, h('b', {}, value), h('span', {}, label));
    const rankCard = (t) => {
      const rows = [
        ['Active week', weekOf(ctx, t)],
        ['Rank-up', Number(t.rank_up_bonus_cents || 0)],
        ['Campaigns', Number(t.campaign_pool_cents || 0)],
        ['Race prize', Number(t.race_prize_cents || 0)],
      ].filter(([, value]) => value > 0).map(([name, value]) => ({ name, value }));
      return h(
        'article',
        { class: 'mr-guide-rank' },
        h('header', {}, h('h3', {}, t.name), h('p', {}, need(t))),
        h('div', { class: 'mr-guide-rank__stats' }, stat(pct(t.commission_rate), 'commission'), pos(t.annual_flat_cents) ? stat(dollars(t.annual_flat_cents), 'per yearly subscriber') : null),
        rows.length ? columns(rows, dollars, `${t.name} bonuses`) : h('p', { class: 'mr-guide__note' }, 'No rank bonuses at this rank yet.'),
      );
    };
    const champCard = champ && tiers.length
      ? h(
        'article',
        { class: 'mr-guide-rank', 'data-champ': '' },
        h('header', {}, h('h3', {}, 'Champion'), h('p', {}, `The ${num(champ.slots)} top-earning ${tiers[tiers.length - 1].name} creators. Nothing else to hit.`)),
        h('div', { class: 'mr-guide-rank__stats' }, pos(champ.rate) ? stat(pct(champ.rate), 'commission') : null, pos(champ.daily_cents) ? stat(dollars(champ.daily_cents), 'each day they post') : null),
      )
      : null;
    const ranks = tiers.length
      ? panel('Rank by rank', 'What each rank pays', h('div', { class: 'mr-guide-ranks' }, tiers.map(rankCard), champCard), note('Each chart has its own scale, so compare columns inside a rank, not across ranks. Campaigns is the whole prize pool for the rank, shared by the winners.'))
      : null;

    const s2 = ctx.settings || {};
    const hold = pos(s2.hold_days) || pos(s2.min_payout_cents)
      ? h('section', { class: 'mr-panel mr-guide' }, note([pos(s2.hold_days) && `Commission clears into the wallet after a ${num(s2.hold_days)}-day hold, so refunds can land first.`, pos(s2.min_payout_cents) && `The smallest cash-out is ${dollars(s2.min_payout_cents)}.`].filter(Boolean).join(' ')))
      : null;
    return [tree, ranks, hold].filter(Boolean);
  }

  /* ------------------------------------------------------------ referral */

  /* A simple figure: legs, arms, body, head. `who` is 'you' (the referrer) or 'new' (the recruit). */
  const person = (cx, who, arms, grin) => [
    s('path', { class: 'mr-guide-scene__leg', d: `M${cx - 12} 138 L${cx - 14} 190 M${cx + 12} 138 L${cx + 14} 190` }),
    s('path', { class: `mr-guide-scene__arm mr-guide-scene__arm--${who}`, d: arms }),
    s('rect', { class: `mr-guide-scene__body--${who}`, x: cx - 28, y: 66, width: 56, height: 74, rx: 22 }),
    s('circle', { class: 'mr-guide-scene__skin', cx, cy: 40, r: 22 }),
    s('circle', { class: 'mr-guide-scene__ink', cx: cx - 7, cy: 36, r: 2 }),
    s('circle', { class: 'mr-guide-scene__ink', cx: cx + 7, cy: 36, r: 2 }),
    s('path', { class: 'mr-guide-scene__smile', d: grin ? `M${cx - 9} 44 Q${cx} 56 ${cx + 9} 44` : `M${cx - 8} 45 Q${cx} 53 ${cx + 8} 45` }),
  ];
  const label = (cls, x, y, text) => s('text', { class: cls, x, y, 'text-anchor': 'middle' }, text);
  const scene = (title, line, alt, ...kids) => h('figure', { class: 'mr-guide-scene' }, h('b', {}, title), h('span', {}, line), s('svg', { viewBox: '0 0 360 270', role: 'img', 'aria-label': alt }, ...kids));

  function referral(ctx = {}) {
    const ref = refOf(ctx);
    if (!ref) return [];
    const m = ctx.manager || null;
    const goal = Number(ref.views || 0);
    const prize = dollars(ref.bonus_cents);
    const goalText = goal > 0 ? compact(goal) : null;
    const part = Math.round(goal * 0.62);

    const scenes = h(
      'div',
      { class: 'mr-guide-scenes' },
      scene(
        'You hand them your invite link',
        'They must sign up with it.',
        'You hand a new creator your invite link.',
        ...person(90, 'you', 'M66 82 L50 130 M114 82 L152 90'),
        ...person(270, 'new', 'M246 82 L208 90 M294 82 L310 130'),
        s('rect', { class: 'mr-guide-scene__card', x: 150, y: 68, width: 60, height: 44, rx: 8 }),
        label('mr-guide-scene__cardtext', 180, 87, 'INVITE'),
        label('mr-guide-scene__cardtext', 180, 101, 'LINK'),
        label('mr-guide-scene__name', 90, 218, 'You'),
        label('mr-guide-scene__name', 270, 218, 'New creator'),
      ),
      scene(
        'They post with #Mindroll',
        'A bar under their name counts the views.',
        `The new creator posts with #Mindroll. A progress bar under their name counts views${goalText ? ` toward ${goalText}` : ''}.`,
        ...person(180, 'new', 'M156 82 L140 130 M204 82 L230 70'),
        s('rect', { class: 'mr-guide-scene__ink', x: 222, y: 36, width: 26, height: 42, rx: 5 }),
        s('polygon', { class: 'mr-guide-scene__paper', points: '231,50 231,64 242,57' }),
        s('rect', { class: 'mr-guide-scene__body--you', x: 256, y: 24, width: 92, height: 28, rx: 14 }),
        label('mr-guide-scene__on', 302, 43, '#Mindroll'),
        label('mr-guide-scene__name', 180, 216, 'New creator'),
        s('rect', { class: 'mr-guide-scene__track', x: 70, y: 226, width: 220, height: 12, rx: 6 }),
        s('rect', { class: 'mr-guide-scene__body--you', x: 70, y: 226, width: 136, height: 12, rx: 6 }),
        goal > 0 ? label('mr-guide-scene__small', 180, 258, `${compact(part)} / ${goalText} views`) : null,
      ),
      scene(
        `They hit ${goalText || 'the goal'}. You get ${prize}`,
        'Added to your wallet.',
        `The new creator reaches ${goalText || 'the views goal'} and ${prize} is added to your wallet.`,
        ...person(90, 'you', 'M66 82 L40 44 M114 82 L140 44', true),
        label('mr-guide-scene__name', 90, 218, 'You'),
        s('rect', { class: 'mr-guide-scene__body--new', x: 190, y: 14, width: 130, height: 26, rx: 13 }),
        label('mr-guide-scene__on', 255, 32, `${goalText || 'Goal'} reached`),
        s('path', { class: 'mr-guide-scene__flow', d: 'M255 44 V70' }),
        s('polygon', { class: 'mr-guide-scene__body--new', points: '248,68 262,68 255,79' }),
        s('rect', { class: 'mr-guide-scene__wallet', x: 190, y: 82, width: 130, height: 80, rx: 14 }),
        label('mr-guide-scene__money', 255, 132, `+${prize}`),
        label('mr-guide-scene__name', 255, 186, 'Your wallet'),
      ),
    );

    const meter = (name, tag, tone, share, line) => h('div', { class: 'mr-guide-invite', 'data-tone': tone }, h('div', {}, h('b', {}, name), h('em', {}, tag)), h('div', { class: 'mr-guide-invite__bar' }, h('i', { style: `--w:${share}%` })), h('small', {}, line));
    const examples = goal > 0
      ? panel(
        'Example',
        'What the progress bar looks like',
        h(
          'div',
          { class: 'mr-guide-invites' },
          meter('Example creator 1', `${prize} added to your wallet`, 'paid', 100, `${goalText} / ${goalText} views with #Mindroll`),
          meter('Example creator 2', `${compact(goal - Math.round(goal * 0.38))} views to go`, 'going', 38, `${compact(Math.round(goal * 0.38))} / ${goalText} views with #Mindroll`),
          meter('Example creator 3', 'Signed up, not in the program yet', 'waiting', 0, `0 / ${goalText} views. The bar starts once they have joined.`),
        ),
        note('Made-up examples, not real creators.'),
      )
      : null;

    const rules = [
      ['Sign up with the link', 'The new creator must sign up through the referrer’s invite link. Without it, no referral counts.'],
      ['Join the program', 'The progress bar appears under their name once they are inside the program.'],
      goalText && [`${goalText} views with #Mindroll`, `Only views on videos posted with #Mindroll count toward the ${goalText}.`],
      [`${prize} to the referrer`, `When the views are reached, ${prize} is added to the wallet of the person who referred them.`],
      m && ['A manager’s link also builds their team', `A creator who joins through a manager’s invite link lands on that manager’s team.${pos(m.referral_cents) ? ` The manager’s reward is ${dollars(m.referral_cents)}.` : ''}`],
    ].filter(Boolean);

    return [
      panel('Referrals', 'How a referral pays', scenes, note('Blue is the person who refers. Green is the creator they bring in.')),
      examples,
      panel('The rules', 'What has to happen', h('div', { class: 'mr-guide-facts mr-guide-facts--text' }, rules.map(([title, line]) => h('div', {}, h('b', {}, title), h('span', {}, line))))),
    ].filter(Boolean);
  }

  /* ------------------------------------------------------------ welcome */

  /*
   * "Start here": the page a creator sees the first time their dashboard
   * opens. What happens, how pay works (views pay, base pay and commission,
   * stacked), and the first job: one video out, made in the editor. Every
   * figure comes from `ctx.data`, the creator's own dashboard data; a pay lane
   * whose numbers are missing is left out.
   *
   *   ctx = { data, go(pane), editor: 'make' | 'brief' | 'videos', canBuild, tour(), boost: node|null, done() }
   */
  function welcome(ctx = {}) {
    const data = ctx.data || {};
    const creator = data.creator || {};
    const inc = data.incentives || {};
    const tiers = tiersOf(inc);
    const t0 = tiers[0] || null;
    const top = tiers[tiers.length - 1] || null;
    const champ = champOf(inc);
    const iron = inc.iron && inc.iron.on && pos(inc.iron.step_cents) && pos(inc.iron.step_views) ? inc.iron : null;
    const week0 = t0 ? weekOf(inc, t0) : 0;
    const weekTop = top ? weekOf(inc, top) : 0;
    const minDays = Number((inc.active && inc.active.min_days) || 0);
    const volume = list(inc.volume && inc.volume.rules).filter((r) => pos(r.base_amount_cents ?? r.amount_cents));
    const floor = inc.margin && Number(inc.margin.rate) > 0 && Number(inc.margin.rate) < 1 ? Number(inc.margin.rate) : null;
    const tag = `#${String((data.settings && data.settings.hashtag) || 'mindroll').replace(/^./, (c) => c.toUpperCase())}`;
    const videos = list(data.videos).length;
    const linked = !!(creator.tiktok_handle || creator.instagram_handle);
    const editorName = ctx.editor === 'make' ? 'the editor' : ctx.editor === 'brief' ? 'the UGC brief' : 'Videos';
    const go = (pane) => () => { if (ctx.done) ctx.done(); if (ctx.go) ctx.go(pane); };
    const rates = range(tiers.map((t) => t.commission_rate), pct);
    const hasViews = !!iron, hasBase = week0 > 0, hasSale = !!rates;
    const perK = iron ? Number(iron.step_cents) / (Number(iron.step_views) / 1000) : 0;
    const perKText = perK ? `$${(perK / 100).toFixed(2)}` : null;

    /* --- 1. the top: who this is for and the one thing to do */
    const hero = h(
      'section',
      { class: 'mr-panel mr-guide mr-welcome__hero' },
      h('p', { class: 'mr-guide__eyebrow' }, 'Start here · about 3 minutes'),
      h('h2', {}, `Welcome in${creator.display_name ? `, ${creator.display_name}` : ''}. Let's get your first video out.`),
      h('p', { class: 'mr-welcome__lead' }, `You make short videos about Mindroll. We pay you ${[hasViews ? 'for the views' : null, hasBase ? 'for posting steadily' : null, 'a share of every payment from the people who subscribe through your link, for as long as they stay'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ', and $1')}. This page shows how that works, then walks you through your first video. ${ctx.editor === 'make' ? 'The editor does the editing for you.' : ''}`),
      h('div', { class: 'mr-welcome__cta' },
        h('button', { class: 'btn btn--primary', type: 'button', onclick: go(ctx.editor || 'videos') }, ctx.editor === 'make' ? 'Make my first video' : 'Start my first video'),
        ctx.tour ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { if (ctx.done) ctx.done(); ctx.tour(); } }, 'Show me around first') : null),
      h('ol', { class: 'mr-welcome__toc' }, ['How it works', 'How you get paid', 'Your first video'].map((x, i) => h('li', {}, h('b', {}, String(i + 1)), x))),
    );

    /* --- 2. the diagram: from a video to money in the wallet */
    const LANE = { views: 'Views pay', base: 'Base pay', sale: 'Commission' };
    const step = (n, title, line, lanes) => h('li', { class: 'mr-welcome-flow__step' },
      h('span', { class: 'mr-welcome-flow__dot', 'aria-hidden': 'true' }, String(n)),
      h('div', {}, h('b', {}, title), h('span', {}, line), lanes && lanes.length ? h('p', { class: 'mr-welcome-flow__lanes' }, lanes.map((k) => h('em', { 'data-lane': k }, LANE[k]))) : null));
    const flow = panel(
      'How it works',
      'One video, from your phone to your wallet',
      h('ol', { class: 'mr-welcome-flow' },
        step(1, 'You film', ctx.editor === 'make' ? 'Pick a format that already worked. The editor tells you what to film, clip by clip, and puts it together.' : 'Copy a format that already worked, from the UGC brief.'),
        step(2, 'You post', `From the account you linked, with ${tag} in the caption and your link in your bio. We find the video by itself.`, hasBase ? ['base'] : []),
        step(3, 'People watch', 'Views are counted on your dashboard as they come in.', iron ? ['views'] : []),
        step(4, 'Some subscribe', 'Viewers tap your link and subscribe to Mindroll. They are tied to you for good.', ['sale']),
        step(5, 'They keep paying, you keep earning', 'Every week a subscriber stays, a share of what they pay goes to you again.', ['sale']),
        step(6, 'Cash out', `Earnings clear into your wallet${pos(data.settings && data.settings.hold_days) ? ` after ${num(data.settings.hold_days)} days` : ''}. Cash out to PayPal, Venmo or Zelle${pos(data.settings && data.settings.min_payout_cents) ? ` from ${dollars(data.settings.min_payout_cents)}` : ''}.`)),
      note('The coloured tags show which part of your pay each step earns. All three are explained next.'),
    );

    /* --- 3. the pay: three lanes, stacked */
    const lanes = [
      iron ? h('article', { class: 'mr-welcome-lane', 'data-lane': 'views' },
        h('small', {}, 'Views pay · our CPM'),
        h('b', {}, `${perKText} per 1,000 views`),
        h('p', {}, `${dollars(iron.step_cents)} for every ${compact(iron.step_views)} views across your videos, up to ${dollars(Math.floor(Number(iron.cap_views) / Number(iron.step_views)) * Number(iron.step_cents))}.`),
        h('ul', {},
          h('li', {}, `The first ${dollars(iron.step_cents)} needs views only.`),
          h('li', {}, `Each ${dollars(iron.step_cents)} after that also needs 1 more subscriber through your link. That keeps the money on videos that actually work.`),
          pos(iron.video_min_views) ? h('li', {}, `A video counts from ${compact(iron.video_min_views)} views.`) : null,
          t0 ? h('li', {}, `For ${t0.name} creators, while you build up.`) : null)) : null,
      week0 > 0 ? h('article', { class: 'mr-welcome-lane', 'data-lane': 'base' },
        h('small', {}, 'Base pay · the posting package'),
        h('b', {}, weekTop > week0 ? `${dollars(week0)} to ${dollars(weekTop)} a week` : `${dollars(week0)} a week`),
        h('p', {}, `Post on ${minDays || 'enough'} different days in a week and you are paid the week's base.`),
        h('ul', {},
          t0 && top && weekTop > week0 ? h('li', {}, `${t0.name} starts at ${dollars(week0)}; it grows with your rank, up to ${dollars(weekTop)} at ${top.name}.`) : null,
          t0 && pos(t0.active_day_views) ? h('li', {}, `A day counts once that day's videos reach your rank's views between them (${compact(t0.active_day_views)} at ${t0.name}).`) : null,
          volume.length ? h('li', {}, `Plus a monthly volume bonus: ${volume.map((r) => `${num(r.min_videos)} videos${pos(r.min_sales) ? ` and ${num(r.min_sales)} sale${Number(r.min_sales) === 1 ? '' : 's'}` : ''} ${dollars(r.base_amount_cents ?? r.amount_cents)}`).join(', ')}.`) : null,
          h('li', {}, floor != null ? 'Paid out of the sales you bring in. If your sales do not cover it yet, it waits and is paid as soon as they do.' : 'Paid out of the sales you bring in, so it can wait until they cover it.'))) : null,
      rates ? h('article', { class: 'mr-welcome-lane', 'data-lane': 'sale' },
        h('small', {}, 'Commission · the part that keeps paying'),
        h('b', {}, `${rates} of every payment`),
        h('p', {}, 'A share of what each subscriber pays, after store fees, every week they stay. Not once: every renewal.'),
        h('ul', {},
          t0 ? h('li', {}, `You start at ${pct(t0.commission_rate)}${t0.name ? ` (${t0.name})` : ''}. More sales, views and videos in 30 days move you up.`) : null,
          t0 && pos(t0.annual_flat_cents) ? h('li', {}, `A yearly subscriber also pays you a flat ${dollars(t0.annual_flat_cents)}${top && Number(top.annual_flat_cents) > Number(t0.annual_flat_cents) ? ` (up to ${dollars(top.annual_flat_cents)})` : ''}.`) : null,
          Number(inc.first_sale_rate) > 0 ? h('li', {}, `Your first weekly sale and your first yearly sale each pay ${pct(inc.first_sale_rate)}.`) : null,
          champ ? h('li', {}, `The top ${num(champ.slots)} creators are Champions at ${pct(champ.rate)}.`) : null)) : null,
    ].filter(Boolean);

    /* The shape of the money over 12 weeks: a one-off deal next to the stack. Drawn, not measured: no amounts on it. */
    const shape = (() => {
      const W = 640, H = 200, L = 8, R = 8, top0 = 10, base = 150, weeks = 12;
      const colW = (W - L - R) / weeks;
      const bw = colW * 0.66;
      const x = (i) => L + colW * i + (colW - bw) / 2;
      const unit = (base - top0) / 7.4;
      /* Illustrative heights in arbitrary units. */
      const views = [3.2, 2.2, 1.2, 0.6, 0.3, 0, 0, 0, 0, 0, 0, 0].map((v) => (iron ? v : 0));
      const basePay = Array.from({ length: weeks }, () => (week0 > 0 ? 0.9 : 0));
      const sale = Array.from({ length: weeks }, (_, i) => Math.min(6, 0.45 * (i + 1)));
      const once = [4.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const cols = [];
      for (let i = 0; i < weeks; i += 1) {
        let y = base;
        [['sale', sale[i]], ['base', basePay[i]], ['views', views[i]]].forEach(([k, v]) => {
          if (!v) return;
          const hgt = v * unit;
          y -= hgt;
          cols.push(s('rect', { x: x(i) + bw * 0.38, y, width: bw * 0.62, height: hgt, class: 'mr-welcome-shape__bar', 'data-lane': k }));
        });
        if (once[i]) cols.push(s('rect', { x: x(i), y: base - once[i] * unit, width: bw * 0.32, height: once[i] * unit, class: 'mr-welcome-shape__bar', 'data-lane': 'once' }));
        cols.push(s('text', { x: x(i) + bw / 2, y: base + 18, class: 'mr-welcome-shape__wk', 'text-anchor': 'middle' }, `W${i + 1}`));
      }
      return h('figure', { class: 'mr-welcome-shape' },
        h('figcaption', {}, h('b', {}, 'Why the stack pays more over time'), h('small', {}, 'Your first 12 weeks, posting steadily, next to a one-off fee for one video. A drawing of when the money arrives, not real amounts. Commission keeps coming only while your subscribers stay.')),
        h('div', { class: 'mr-welcome-shape__legend' },
          h('span', { 'data-lane': 'once' }, 'A one-off fee per video'),
          iron ? h('span', { 'data-lane': 'views' }, 'Views pay') : null,
          week0 > 0 ? h('span', { 'data-lane': 'base' }, 'Base pay (while you keep posting)') : null,
          h('span', { 'data-lane': 'sale' }, 'Commission')),
        s('svg', { viewBox: `0 0 ${W} ${H - 30}`, role: 'img', 'aria-label': 'A one-off fee is paid once in week 1 and then stops. With Mindroll, views pay arrives in the first weeks, base pay arrives every week you post, and commission grows each week as subscribers stack up, and keeps paying.' },
          s('line', { x1: 0, x2: W, y1: base, y2: base, class: 'mr-guide-col__base' }), ...cols));
    })();

    const pay = panel(
      'How you get paid',
      hasViews && hasBase ? 'Yes, we pay CPM. Yes, there is base pay. We just stack them.' : hasViews ? 'Yes, we pay CPM. Then we stack commission on top.' : hasBase ? 'Yes, there is base pay. Then we stack commission on top.' : 'Paid on every subscriber, every week they stay.',
      h('p', { class: 'mr-welcome__lead' }, `Most UGC deals pick one: a rate per 1,000 views, or a flat fee per video or package. Both stop the day the video stops. ${hasViews || hasBase ? `Here you get ${[hasViews ? 'views pay' : null, hasBase ? 'base pay' : null].filter(Boolean).join(' and ')} to start, and commission on top that keeps paying after the views slow down.` : 'Here commission keeps paying after the views slow down.'}`),
      h('div', { class: 'mr-welcome-lanes' }, lanes),
      shape,
      h('div', { class: 'mr-welcome-why' },
        [['Paid for results, not just posts', 'One video that brings in subscribers pays you every week they stay. A flat fee pays once.'],
          ['Your rate goes up', rates ? `Commission moves from ${rates.replace(' to ', ' up to ')} as you rank up${hasBase ? ', and base pay grows with it' : ''}${champ ? `; Champions get ${pct(champ.rate)}` : ''}. It is not a fixed deal.` : 'Your rate rises as you rank up. It is not a fixed deal.'],
          ['Everything is on your dashboard', 'Every view, subscriber, bonus and payment shows up here, live. Nothing to chase.']]
          .map(([b, line]) => h('div', {}, h('b', {}, b), h('span', {}, line)))),
      note('Nothing here is guaranteed: no views and no sales means no pay. Bonuses are paid out of the sales you bring in, so a bonus can wait until your sales cover it.'),
    );

    /* --- 3b. a first-month calculator from the live numbers */
    const calc = (() => {
      if (!iron && !(week0 > 0)) return null;
      const field = (label, min, max, stepBy, value, fmt) => {
        const out = h('output', {}, fmt(value));
        const input = h('input', { type: 'range', min, max, step: stepBy, value, 'aria-label': label });
        return { input, out, row: h('label', { class: 'mr-welcome-calc__field' }, h('span', {}, label, out), input) };
      };
      const fv = iron ? field(`Views across your videos (${dollars(Math.floor(Number(iron.cap_views) / Number(iron.step_views)) * Number(iron.step_cents))} at ${compact(iron.cap_views)}, the most)`, 0, Number(iron.cap_views) || 1000000, 10000, 150000, compact) : null;
      /* What a subscriber pays each week, for the worked example. */
      const SUB_WEEK = 1500;
      const rate0 = t0 ? Number(t0.commission_rate) || 0 : 0;
      const fs = field(`Subscribers through your link (${dollars(SUB_WEEK)} a week each)`, 0, 30, 1, 3, num);
      const fw = week0 > 0 ? field(`Weeks you post on ${minDays || 'enough'} days${t0 && pos(t0.active_day_views) ? ` (${compact(t0.active_day_views)}+ views a day)` : ''}`, 0, 4, 1, 4, num) : null;
      const rows = h('ul', { class: 'mr-guide-rows mr-welcome-calc__rows' });
      const total = h('b', {});
      const lock = h('p', { class: 'mr-welcome-calc__lock' });
      const paint = () => {
        const v = fv ? Number(fv.input.value) : 0;
        const subs = Number(fs.input.value);
        const w = fw ? Number(fw.input.value) : 0;
        if (fv) fv.out.textContent = compact(v);
        fs.out.textContent = num(subs);
        if (fw) fw.out.textContent = num(w);
        /* Each slider stands on its own: views pay from views alone, commission from subscribers alone. */
        const steps = iron ? Math.floor(Math.min(v, Number(iron.cap_views) || v) / Number(iron.step_views)) : 0;
        const viewsCents = steps * Number(iron ? iron.step_cents : 0);
        const baseCents = w * week0;
        const weekly = Math.round(subs * SUB_WEEK * rate0);
        const saleCents = weekly * 4;
        rows.replaceChildren(...[
          iron ? h('li', { 'data-lane': 'views' }, h('span', {}, 'Views pay'), h('b', {}, dollars(viewsCents))) : null,
          week0 > 0 ? h('li', { 'data-lane': 'base' }, h('span', {}, 'Base pay'), h('b', {}, dollars(baseCents))) : null,
          rate0 ? h('li', { 'data-lane': 'sale' }, h('span', {}, `Commission: ${num(subs)} × ${pct(rate0)} of ${dollars(SUB_WEEK)} × 4 weeks`), h('b', {}, dollars(saleCents))) : null,
        ].filter(Boolean));
        total.textContent = dollars(viewsCents + baseCents + saleCents);
        lock.textContent = rate0 && subs > 0 ? `After this month, those ${num(subs)} subscriber${subs === 1 ? '' : 's'} keep paying you ${dollars(weekly)} a week for as long as they stay.` : '';
      };
      [fv, fs, fw].filter(Boolean).forEach((f) => f.input.addEventListener('input', paint));
      paint();
      return panel(
        'Try it',
        `Your first month${t0 ? ` at ${t0.name}` : ''}, worked out`,
        h('div', { class: 'mr-welcome-calc' },
          h('div', { class: 'mr-welcome-calc__fields' }, [fv, fs, fw].filter(Boolean).map((f) => f.row)),
          h('div', { class: 'mr-welcome-calc__out' }, h('small', {}, 'Your first month'), total, rows, lock)),
        note(`An example using today's rates, with every subscriber on a ${dollars(SUB_WEEK)} weekly plan for the whole month. Not a promise: what you earn depends on your real views and sales.`),
      );
    })();

    /* --- 4. the first job */
    const job = (done, title, line, label, pane) => h('li', { class: 'mr-welcome-job', 'data-done': done || null },
      h('span', { class: 'mr-welcome-job__tick', 'aria-hidden': 'true' }, done ? '✓' : ''),
      h('div', {}, h('b', {}, title), h('span', {}, line)),
      done ? h('em', {}, 'Done') : h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: go(pane) }, label));
    const editorLine = ctx.editor === 'make'
      ? (ctx.canBuild === false ? 'Pick a format and film one short clip per step. This browser cannot build the video: open this page in Safari or Chrome (not inside TikTok, Instagram or Discord) to finish it.' : 'Pick a format and film one short clip per step on your phone. The editor joins the clips and adds the words, pictures and music. Your clips stay on your device.')
      : ctx.editor === 'brief' ? 'Read the brief and copy a format that already worked.' : 'Copy a format that already worked.';
    const reward = [
      data.first_video && data.first_video.state === 'open' && Number(data.first_video.multiplier) > 1 ? `Your first video pays ${Number(data.first_video.multiplier)}x if you post it before the clock runs out.` : null,
      'Your wallet unlocks the moment your first video is in.',
      iron ? `Your first ${dollars(iron.step_cents)} of views pay needs views only, no subscriber.` : null,
    ].filter(Boolean);
    const first = h(
      'section',
      { class: 'mr-panel mr-guide mr-welcome__first' },
      h('p', { class: 'mr-guide__eyebrow' }, 'Your first job'),
      h('h2', {}, 'Get one video out'),
      ctx.boost || null,
      h('ol', { class: 'mr-welcome-jobs' },
        job(linked, 'Link your TikTok or Instagram', linked ? `Linked: ${[creator.tiktok_handle && `@${creator.tiktok_handle}`, creator.instagram_handle && `@${creator.instagram_handle}`].filter(Boolean).join(' and ')}.` : 'So your videos are found and counted for you.', 'Link it', 'connect'),
        job(videos > 0, ctx.editor === 'make' ? 'Make it in the editor' : 'Make it', editorLine, ctx.editor === 'make' ? 'Open the editor' : `Open ${editorName}`, ctx.editor || 'videos'),
        job(videos > 0, 'Post it', `From the linked account, with ${tag} in the caption and your link in your bio.`, 'Get my link', 'links'),
        job(videos > 0, 'See it on your dashboard', 'It shows up under Videos by itself, with its views.', 'Videos', 'videos')),
      h('div', { class: 'mr-welcome__reward' }, h('b', {}, 'What you get for it'), h('ul', {}, reward.map((r) => h('li', {}, r)))),
      h('div', { class: 'mr-welcome__cta' }, h('button', { class: 'btn btn--primary', type: 'button', onclick: go(ctx.editor || 'videos') }, ctx.editor === 'make' ? 'Open the editor' : 'Start my first video')),
    );

    return [hero, flow, pay, calc, first].filter(Boolean);
  }

  cp.guides = { structure, payByRank, referral, welcome };
})();
