/*
 * The creator dashboard at /creators.
 *
 * One page, four states, decided by what the database says about the caller:
 * signed out (the pitch and sign-in), no application yet (the form), applied
 * but not active (a status note), active (the dashboard). All of it comes from
 * one call, `creator_dashboard()`, which returns the caller's rows and nobody
 * else's.
 */
(() => {
  'use strict';
  const cp = window.mindrollCreators;
  if (!cp || cp.root.dataset.creators !== 'dashboard') return;
  const { h, money, num, compact, pct, day, toast, act, section, table, statusPill, pill } = cp;
  const view = cp.root.querySelector('[data-view]');
  const who = cp.root.querySelector('[data-who]');
  const show = (...nodes) => view.replaceChildren(...nodes.flat().filter(Boolean));
  /* Set data-app-code="true" on the page once the app has its creator-code field. */
  const APP_CODE = cp.root.dataset.appCode === 'true';
  /* ?invite=code on the link another creator shared. Kept through sign-in. */
  const INVITE = (() => {
    const fromUrl = (new URLSearchParams(location.search).get('invite') || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
    try {
      if (fromUrl) localStorage.setItem('mindroll.invite', fromUrl);
      return fromUrl || localStorage.getItem('mindroll.invite') || null;
    } catch {
      return fromUrl || null;
    }
  })();

  /* ?team=code on a manager's link: the same, for a manager bringing a creator in. */
  const TEAM = (() => {
    const fromUrl = (new URLSearchParams(location.search).get('team') || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
    try {
      if (fromUrl) localStorage.setItem('mindroll.team', fromUrl);
      return fromUrl || localStorage.getItem('mindroll.team') || null;
    } catch {
      return fromUrl || null;
    }
  })();
  /* An invite link being opened is counted once per browser, and only when the link itself was opened. */
  if (!cp.demo) {
    const asked = new URLSearchParams(location.search);
    for (const [param, kind] of [['invite', 'creator'], ['team', 'manager']]) {
      const code = (asked.get(param) || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
      if (!code) continue;
      const key = `mindroll.invite.seen.${kind}.${code}`;
      let seen = false;
      try { seen = Boolean(localStorage.getItem(key)); localStorage.setItem(key, '1'); } catch { /* private window: counted each time */ }
      if (!seen) cp.rpc('creator_invite_click', { p_code: code, p_kind: kind }).catch(() => {});
    }
  }
  /* Once they have signed in, the invite they came on is recorded, whether or not they finish applying. */
  let inviteNoted = false;
  const noteInvite = async () => {
    if (inviteNoted || cp.demo || (!INVITE && !TEAM)) return;
    inviteNoted = true;
    await cp.rpc('creator_invite_signup', INVITE ? { p_code: INVITE, p_kind: 'creator' } : { p_code: TEAM, p_kind: 'manager' }).catch(() => { inviteNoted = false; });
  };

  const COUNTRIES = [
    ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['IE', 'Ireland'],
    ['NZ', 'New Zealand'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
    ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['BE', 'Belgium'], ['AT', 'Austria'],
    ['CH', 'Switzerland'], ['PT', 'Portugal'], ['PL', 'Poland'], ['SG', 'Singapore'], ['JP', 'Japan'], ['MX', 'Mexico'],
    ['BR', 'Brazil'], ['IN', 'India'], ['PH', 'Philippines'], ['ZA', 'South Africa'], ['AE', 'United Arab Emirates'],
  ];

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
      return renderSignedOut();
    }
    setWho(user.email || 'Signed in');
    await load();
    stopLive = cp.live.start(() => load(true));
  }

  let lastStamp = null;
  let liveData = null;
  async function load(quiet = false) {
    try {
      const [data, brief, team, picture, discordName, boost, added] = await Promise.all([cp.rpc('creator_dashboard'), cp.rpc('creator_brief').catch(() => null), cp.rpc('creator_manager_dashboard').catch(() => null), cp.rpc('creator_my_picture').catch(() => null), cp.rpc('creator_my_discord').catch(() => null), cp.rpc('creator_first_video').catch(() => null), cp.rpc('creator_my_addition').catch(() => false)]);
      /* Their TikTok or Instagram profile picture, copied over once their accounts are approved. */
      if (data?.creator) { data.creator.avatar_url = picture; data.creator.discord_name = discordName; }
      if (team && !data?.creator) team.discord_name = discordName;
      /* The team added this email: they are let in as soon as they add their account, even when applications are closed. */
      if (data && !data.creator && added === true) { data.added = true; data.applications_open = true; if (!applyDraft.added) { applyDraft.added = true; applyDraft.step = 3; } }
      if (data) { data.brief = brief || null; data.team = team || null; data.first_video = keepBoost(boost); }
      const stamp = JSON.stringify(data);
      const apply = () => {
        const countOf = (d) => { try { return d?.creator?.status === 'active' && d.creator.terms_accepted !== false ? feedOf(d).length : null; } catch { return null; } };
        const before = quiet ? countOf(liveData) : null;
        lastStamp = stamp;
        liveData = data;
        if (!data.creator && data.team && !wantsToApply) renderManager(data);
        else if (!data.creator) { noteInvite(); renderApply(data); }
        else if (data.creator.status !== 'active') renderWaiting(data.creator);
        else if (data.creator.terms_accepted === false) renderTerms(data);
        else renderDashboard(data);
        cp.live.drawn();
        const after = countOf(data);
        if (before != null && after != null && after > before) cp.toast(after - before === 1 ? 'New notification' : `${after - before} new notifications`);
      };
      if (quiet) {
        if (stamp === lastStamp) return;
        if (cp.live.busy() || tourStep !== null) return cp.live.offer(apply);
        return apply();
      }
      apply();
      if (data.creator?.status === 'active' && data.creator.terms_accepted !== false) {
        void settleStripeReturn(data);
        void finishDiscord().then((linked) => linked && load());
      }
    } catch (error) {
      if (quiet) return;
      show(h('div', { class: 'cp-card' }, h('h2', {}, 'We could not load your dashboard'), h('p', { class: 'cp-muted' }, error.message), h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: load }, 'Try again')));
    }
  }

  function setWho(label) {
    who.replaceChildren();
    if (!label) return;
    who.append(h('span', { class: 'cp-who__name' }, label));
    if (!cp.demo) {
      who.append(h('button', { class: 'cp-link', type: 'button', onclick: () => cp.client.auth.signOut() }, 'Sign out'));
    }
  }

  /* ------------------------------------------------------------ signed out */

  function renderSignedOut() {
    show(
      h(
        'div',
        { class: 'cp-pitch' },
        h(
          'div',
          { class: 'cp-pitch__copy' },
          h('p', { class: 'cp-eyebrow' }, 'Mindroll creator program'),
          h('h1', {}, 'Make videos about ideas. Earn on every reader you bring.'),
          h('p', { class: 'cp-lead' }, 'Commission on every subscriber you bring in, for as long as they stay, plus cash bonuses as you grow.'),
          h(
            'ol',
            { class: 'cp-steps' },
            h('li', {}, h('b', {}, 'Join'), 'Four quick questions and your TikTok or Instagram. Takes a minute.'),
            h('li', {}, h('b', {}, 'Post'), 'Put #Mindroll in the caption and your link in your bio. Your videos show up here by themselves.'),
            h('li', {}, h('b', {}, 'Get paid'), 'Commission and bonuses are paid to you by PayPal, Venmo or Zelle.'),
          ),
        ),
        h('div', { class: 'cp-pitch__panel' }, cp.signInPanel({ title: 'Creator sign-in', lead: 'New here? Sign in to apply. It is the same account as the Mindroll app.' })),
      ),
    );
  }

  /* ----------------------------------------------------------- application */

  /*
   * Onboarding. It follows a call with the team, so it only asks the creator
   * to link where they post: TikTok, Instagram, or both. Their name and code
   * come from the handle, and the country is asked for when they add a bank.
   * Sending it saves the application and emails the team straight away.
   */
  /* A manager who is not (yet) a creator themselves: their team, and a way to apply. */
  let wantsToApply = false;
  /* What the applicant has answered so far; kept while they move between the steps. */
  const applyDraft = { step: 0 };
  function renderManager(data) {
    show(h('div', { class: 'mr-shell mr-shell--solo' }, h('div', { class: 'mr-main' }, h('header', { class: 'mr-head' }, h('h1', {}, 'My team'), h('div', { class: 'mr-head__tools' }, h('button', { class: 'mr-tool', type: 'button', onclick: () => { wantsToApply = true; renderApply(data); } }, 'Become a creator too'))), discordBox(data.team.discord_name, () => { data.team.discord_name = 'you'; toast('Connected. (Sample data: nothing was saved.)'); renderManager(data); }, true), ...cp.teamView(data.team, { review: (v, ok, reason) => reviewVideo(data, v, ok, reason), accounts: (c, ok) => reviewAccounts(data, c, ok), manage: teamActions(data) }))));
  }

  function renderApply(data) {
    if (!data.applications_open) {
      return show(h('div', { class: 'cp-card cp-narrow' }, h('h1', {}, 'Applications are closed'), h('p', { class: 'cp-muted' }, 'We are not taking new creators at the moment. Check back soon.')));
    }
    /* One application per browser. It is a courtesy lock, not security: the account, the handle and the hourly limit are checked on the server. */
    const APPLIED = 'mindroll.applied';
    const appliedHere = () => { try { return !!localStorage.getItem(APPLIED); } catch { return false; } };
    if (appliedHere() && !cp.demo && !data.added) {
      return show(h('div', { class: 'cp-card cp-narrow' }, h('h1', {}, 'You have already applied'), h('p', { class: 'cp-muted' }, 'An application has already been sent from this device. If you used a different account, sign in with that one to see it.'), h('p', { class: 'cp-muted' }, 'Questions? ', h('a', { href: 'mailto:teammindroll@gmail.com' }, 'teammindroll@gmail.com'))));
    }
    /*
     * Four short screens, one question each, so it reads as a few taps on a
     * phone and not as a form: what they post about, how big their audience is,
     * how often they post, then the accounts. The first three are what the team
     * uses to decide who to call first.
     */
    const NICHES = [['books', '📚 Books and reading'], ['self_improvement', '🌱 Self-improvement'], ['productivity', '⏱️ Productivity and study'], ['business', '💼 Business and money'], ['philosophy', '🧠 Philosophy and psychology'], ['lifestyle', '✨ Lifestyle'], ['comedy', '😂 Comedy and entertainment'], ['other', 'Something else']];
    const SIZES = [['under_1k', 'Under 1,000'], ['1k_10k', '1,000 to 10,000'], ['10k_50k', '10,000 to 50,000'], ['50k_250k', '50,000 to 250,000'], ['over_250k', 'More than 250,000']];
    const FREQS = [['daily', 'Every day'], ['few_week', 'A few times a week'], ['weekly', 'About once a week'], ['less', 'Less than that']];
    const answers = applyDraft;
    const field = (label, input) => h('label', { class: 'auth-field' }, h('span', {}, label), input);
    const handle = (name) => h('input', { name, maxlength: '80', placeholder: '@yourhandle', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', value: answers[name] || '' });
    const REPLY = { no_handle: 'Add your TikTok or your Instagram.', handle_taken: 'That account is already linked to another creator. Check the spelling, or email us.', closed: 'Applications are closed at the moment.', busy: 'We are getting a lot of applications right now. Please try again in an hour.' };
    const TOTAL = 4;
    const go = (n) => { answers.step = Math.max(0, Math.min(TOTAL - 1, n)); renderApply(data); };
    const choices = (key, list, then) => h('div', { class: 'mr-apply__opts', role: 'radiogroup' }, list.map(([value, label]) => h('button', { class: 'mr-apply__opt', type: 'button', role: 'radio', 'aria-checked': String(answers[key] === value), onclick: () => { answers[key] = value; then ? then() : renderApply(data); } }, label)));
    const step = answers.step || 0;
    const frame = (title, lead, ...body) =>
      show(
        h(
          'div',
          { class: 'cp-card cp-narrow mr-apply' },
          h('div', { class: 'mr-apply__top' }, step > 0 ? h('button', { class: 'cp-link', type: 'button', onclick: () => go(step - 1) }, '← Back') : h('span', {}), h('span', { class: 'cp-muted cp-small' }, `Step ${step + 1} of ${TOTAL}`)),
          h('div', { class: 'mr-apply__bar', role: 'presentation' }, h('i', { style: `width:${((step + 1) / TOTAL) * 100}%` })),
          data.added ? h('p', { class: 'mr-apply__added' }, 'The Mindroll team added you. Add your account and you are in straight away.') : null,
          h('h1', {}, title),
          lead ? h('p', { class: 'cp-muted' }, lead) : null,
          ...body,
        ),
      );

    if (step === 0) return frame('What do you post about?', 'Pick the one closest to your videos.', choices('niche', NICHES, () => go(1)));
    if (step === 1) return frame('How many followers does your biggest account have?', 'A rough number is fine. We check the account anyway.', choices('followers', SIZES, () => go(2)));
    if (step === 2) {
      const next = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => { if (answers.freq && answers.ugc != null) go(3); else toast('Answer both to continue.', 'error'); } }, 'Continue');
      return frame('How often do you post?', null, choices('freq', FREQS), h('h2', { class: 'mr-apply__q' }, 'Have you made videos for a brand before?'), h('div', { class: 'mr-apply__opts mr-apply__opts--two', role: 'radiogroup' }, [[true, 'Yes'], [false, 'Not yet']].map(([value, label]) => h('button', { class: 'mr-apply__opt', type: 'button', role: 'radio', 'aria-checked': String(answers.ugc === value), onclick: () => { answers.ugc = value; renderApply(data); } }, label))), next);
    }

    const tiktok = handle('tiktok');
    const instagram = handle('instagram');
    const yes = h('input', { type: 'radio', name: 'spoke', value: 'yes' });
    const no = h('input', { type: 'radio', name: 'spoke', value: 'no' });
    const repName = h('input', { name: 'representative', maxlength: '80', placeholder: 'Their name', autocomplete: 'off' });
    const repField = field('Who did you talk with?', repName);
    repField.hidden = true;
    const syncRep = () => { repField.hidden = !yes.checked; };
    yes.addEventListener('change', syncRep);
    no.addEventListener('change', syncRep);
    for (const input of [tiktok, instagram]) input.addEventListener('input', () => { answers[input.name] = input.value; });
    /* Left empty by people; filled in by scripts that fill every field. */
    const trap = h('input', { name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'cp-trap' });
    const status = h('p', { class: 'auth-status', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Join the program');
    const fail = (message) => {
      status.textContent = message;
      status.dataset.kind = 'error';
      status.hidden = false;
    };
    const form = h(
      'form',
      { class: 'cp-form', novalidate: true },
      field('TikTok', tiktok),
      field('Instagram', instagram),
      h('p', { class: 'cp-hint' }, 'You only need one of the two.'),
      h('fieldset', { class: 'cp-choice' }, h('legend', {}, 'Have you talked with a Mindroll representative?'), h('label', { class: 'cp-check' }, yes, 'Yes'), h('label', { class: 'cp-check' }, no, 'No')),
      repField,
      trap,
      status,
      submit,
    );
    form.addEventListener(
      'submit',
      act(submit, async () => {
        status.hidden = true;
        if (!tiktok.value.trim() && !instagram.value.trim()) return fail(REPLY.no_handle);
        if (!yes.checked && !no.checked) return fail('Tell us whether you have talked with a representative.');
        if (yes.checked && !repName.value.trim()) return fail('Enter the name of the person you talked with.');
        if (trap.value) return renderWaiting({ status: 'pending' });
        if (cp.demo) return renderWaiting({ status: 'pending' }, 'This is a preview, so nothing was saved or emailed.');
        const note = yes.checked ? `Talked with a representative: ${repName.value.trim()}` : 'Has not talked with a representative';
        await noteInvite();
        const reply = await cp.rpc('creator_apply', { p_tiktok: tiktok.value, p_instagram: instagram.value, p_note: note, p_invite: INVITE });
        if (reply === 'applied' || reply === 'exists') {
          try { localStorage.setItem(APPLIED, String(Date.now())); } catch { /* private window */ }
          /* The answers and the follower check are extras: the application stands without them. */
          if (reply === 'applied') {
            await cp.rpc('creator_apply_details', { p_niche: answers.niche || null, p_followers: answers.followers || null, p_freq: answers.freq || null, p_ugc: answers.ugc ?? null }).catch(() => {});
            cp.fn('creator-lead').catch(() => {});
          }
          return load();
        }
        fail(REPLY[reply] || 'That did not go through. Please try again.');
      }),
    );
    frame('Where do you post?', 'Add the TikTok or Instagram account you will post from.', form);
  }

  function renderWaiting(creator, previewNote) {
    const COPY = {
      pending: ['You are all set', 'Your accounts have gone to the Mindroll team. This page becomes your dashboard as soon as we approve you.'],
      rejected: ['Your application was not accepted', 'You are not in the Mindroll creator program. Email us if you think this is a mistake.'],
      paused: ['Your creator account is paused', 'Email us if you think this is a mistake.'],
    };
    /* Let in once, then removed by the team: say so plainly. */
    COPY.removed = ['You no longer have access', 'Your place in the Mindroll creator program has ended, so this dashboard is closed. Email us if you think this is a mistake.'];
    const [title, body] = COPY[creator.status === 'rejected' && creator.terms_accepted ? 'removed' : creator.status] || COPY.pending;
    show(
      h('div', { class: 'cp-card cp-narrow' }, statusPill(creator.status), h('h1', {}, title), h('p', { class: 'cp-muted' }, body), previewNote && h('p', { class: 'cp-hint' }, previewNote), previewNote && h('p', {}, h('a', { class: 'btn btn--primary btn--sm', href: '/creators/?dashboard' }, 'See the dashboard after approval')), h('p', { class: 'cp-muted' }, 'Questions? ', h('a', { href: 'mailto:teammindroll@gmail.com' }, 'teammindroll@gmail.com'))),
    );
    /*
     * Email the team. The function sends once per application, so calling it
     * on every visit only matters when an earlier attempt did not get through.
     * The application is saved either way and shows in the admin dashboard.
     */
    if (creator.status === 'pending' && !cp.demo) cp.fn('creator-apply-notify').catch(() => {});
  }

  /* The one-page terms. Accepted once after approval, before the panel opens. */
  function renderTerms(data) {
    const agree = h('input', { type: 'checkbox' });
    const accept = h('button', { class: 'btn btn--primary', type: 'button', disabled: true }, 'Accept and open my dashboard');
    agree.addEventListener('change', () => { accept.disabled = !agree.checked; });
    accept.addEventListener(
      'click',
      act(accept, async () => {
        if (cp.demo) {
          data.creator.terms_accepted = true;
          return renderDashboard(data);
        }
        const reply = await cp.rpc('creator_accept_terms');
        if (reply !== 'accepted') throw new Error('That did not go through. Please try again.');
        await load();
      }),
    );
    show(
      h(
        'div',
        { class: 'cp-card cp-narrow cp-terms' },
        h('p', { class: 'cp-eyebrow' }, 'You are in'),
        h('h1', {}, 'Creator terms'),
        h('p', { class: 'cp-muted' }, 'One page. Read it, accept it, and your dashboard opens.'),
        h('div', { class: 'cp-terms__text' }, String(data.settings?.terms_text || '').split(/\n\s*\n/).map((para) => h('p', {}, para))),
        h('label', { class: 'cp-check' }, agree, 'I have read and agree to these terms'),
        accept,
      ),
    );
  }

  /* -------------------------------------------------------------- dashboard */

  /*
   * Pictures first. Each card answers one question with one graph, and the
   * exact figures sit behind hover, focus and the folded "every payment"
   * tables at the bottom, so nothing is lost by leaving them off the page.
   */
  /* Which of the two panes is showing, and the data to redraw it from. */
  /* The same plain scheme as the admin: one accent for every chart and button. */
  Object.assign(cp.COLOR, { ready: '#2F6BFF', paid: '#111827', wait: '#F5A524' });
  const PANES = [['home', 'Home', 'home'], ['brief', 'UGC Brief', 'book'], ['alerts', 'Notifications', 'bell'], ['campaigns', 'Campaigns', 'flag'], ['videos', 'Videos', 'play'], ['links', 'Links', 'link'], ['wallet', 'Wallet', 'wallet'], ['pay', 'Ranks', 'trophy'], ['race', 'Race', 'medal'], ['invite', 'Invite', 'users'], ['connect', 'Connect accounts', 'plug']];
  const ICONS = {
    home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    bell: 'M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7zm4 10a2 2 0 0 0 4 0',
    users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6',
    play: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm5 4.5v7l6-3.5z',
    flag: 'M5 21V4h11l-2 4 2 4H5',
    trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4m-4 3h8',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zm13 7h.01',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10M9 8h5',
    badge: 'M12 3l2.4 1.9 3-.3.9 2.9 2.5 1.7-1.1 2.8 1.1 2.8-2.5 1.7-.9 2.9-3-.3L12 21l-2.4-1.9-3 .3-.9-2.9-2.5-1.7 1.1-2.8-1.1-2.8 2.5-1.7.9-2.9 3 .3zM9 12l2 2 4-4',
    plug: 'M9 3v5m6-5v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
    medal: 'M8 3h8l-2.5 6h-3zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm0-8v4m-1.5-3.2L12 13',
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
  const keep = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* private window */ } return null; };
  const helpOn = () => keep('mindroll.creator.help') === 'on';

  let pane = PANES.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  let lastData = null;
  function openPane(id) {
    pane = id;
    try { history.replaceState(null, '', id === 'home' ? location.pathname + location.search : `#${id}`); } catch { /* a sandboxed frame may refuse */ }
    renderDashboard(lastData);
    window.scrollTo(0, 0);
  }

  /* What has happened for this creator, newest first, worked out from what the dashboard already holds. */
  function feedOf(data) {
    const items = [];
    (data.bonuses || []).forEach((b) => items.push({ at: b.created_at, glyph: b.kind === 'rank_up' || b.kind === 'first_top' ? 'trophy' : b.kind === 'referral' ? 'users' : b.kind === 'contest' || b.kind === 'prize' || b.kind === 'top_video' ? 'flag' : 'wallet', label: ({ rank_up: 'You ranked up', referral: 'Invite paid', contest: 'Campaign win', prize: 'Campaign win', top_video: 'Top video', views: 'Video bonus', active: 'Active week', daily: 'Champion pay', manual: 'Bonus' })[b.kind] || 'Bonus', title: `+${cp.dollars(b.amount_cents)}`, detail: b.label, to: 'wallet' }));
    (data.payouts || []).filter((p) => p.status === 'paid').forEach((p) => items.push({ at: p.paid_at || p.created_at, glyph: 'wallet', label: 'You were paid', title: cp.dollars(p.amount_cents), detail: 'Sent to you', to: 'wallet' }));
    (data.contests || []).filter((k) => k.open || k.upcoming).forEach((k) => items.push({ at: k.upcoming ? new Date().toISOString() : k.starts_at, glyph: 'flag', label: k.upcoming ? 'Campaign starting soon' : 'Campaign is live', title: k.title, detail: `Win up to ${cp.dollars(k.prizes[0] || 0)}`, to: 'campaigns' }));
    return items.filter((e) => e.at).sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 60);
  }
  function alertsView(data) {
    const feed = feedOf(data);
    const seen = Number(keep('mindroll.creator.seen') || 0);
    keep('mindroll.creator.seen', String(Date.now()));
    if (!feed.length) return [h('div', { class: 'mr-blank' }, icon('bell'), h('b', {}, 'Nothing yet'), h('span', {}, 'Bonuses, wins and payments will show up here.'))];
    return [h('section', { class: 'mr-panel' }, h('ul', { class: 'mr-alerts' }, feed.map((e) => h('li', { class: 'mr-alert', 'data-new': new Date(e.at).getTime() > seen || null }, h('i', {}, icon(e.glyph)), h('div', {}, h('small', {}, e.label), h('b', {}, e.title), h('span', {}, e.detail)), h('time', {}, ago(e.at)), h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => openPane(e.to) }, 'Open')))))];
  }

  function walletCard(data) {
    const { balance } = data;
    const short = (cents) => money(cents).replace(/\.00$/, '');
    return h(
      'section',
      { class: 'cp-card' },
      h('div', { class: 'cp-card__head' }, cp.figure('Your wallet', money(Math.max(0, balance.available_cents)), true), h('span', { class: 'cp-muted' }, `${short(balance.commission_cents + balance.bonus_cents)} earned in total`)),
      cp.segbar(
        [
          { label: 'Paid to you', value: balance.paid_cents + balance.in_transit_cents, color: cp.COLOR.paid },
          { label: 'In your wallet', value: Math.max(0, balance.available_cents), color: cp.COLOR.ready },
          { label: 'Still clearing', value: Math.max(0, balance.pending_cents), color: cp.COLOR.wait, dark: true },
        ],
        short,
      ),
      payoutFoot(data),
    );
  }

  /*
   * What posting pays this week and this month, at the creator's own rank. The
   * amounts already carry the rank's multiplier, and the rank above is shown
   * beside them so there is a reason to climb.
   */
  function homeBonusCard(data) {
    const inc = data.incentives;
    if (!inc) return null;
    const tiers = inc.tiers || [];
    const tier = tiers.find((t) => t.level === inc.tier_level) || tiers[0];
    const above = tiers.find((t) => t.level === (inc.tier_level || 1) + 1);
    const times = (t) => Number(t?.bonus_multiplier ?? 1);
    const rows = [];
    const row = (title, pays, have, need, unit, foot) => h('li', {}, h('div', { class: 'mr-earn__head' }, h('span', {}, h('b', {}, title), h('small', {}, foot)), h('b', { class: 'mr-earn__pay' }, pays)), h('div', { class: 'cp-progress__bar', role: 'img', 'aria-label': `${have} of ${need} ${unit}` }, h('span', { style: `width:${Math.min(100, Math.round((have / Math.max(1, need)) * 100))}%` })), h('small', { class: 'cp-muted' }, have >= need ? 'Done' : `${num(have)} of ${num(need)} ${unit} · ${num(need - have)} to go`));
    const a = inc.active;
    if (a && a.amount_cents > 0 && !data.creator.champion) {
      const dayViews = a.day_views ?? a.count_min_views ?? 0;
      rows.push(row(`Post on ${num(a.min_days)} days this week`, cp.dollars(a.amount_cents), Math.min(a.days, a.min_days), a.min_days, 'days', dayViews > 0 ? `A day counts when that day's videos reach ${compact(dayViews)} views` : 'Paid every week you do it'));
    }
    const rules = inc.volume?.rules || [];
    if (rules.length) {
      const videos = inc.volume.videos || 0;
      /* Each level is a checkpoint on one dotted line, evenly spaced, with what it pays under it. */
      /* A level is complete when both its videos and its sales are in. */
      const sales = Number(inc.volume.sales || 0);
      const met = (r) => videos >= r.min_videos && sales >= Number(r.min_sales || 0);
      const done = rules.filter(met).length;
      const next = rules.find((r) => !met(r));
      const minViews = a?.count_min_views ?? 1000;
      /* Checkpoints sit in equal columns; the line behind them fills as far as the videos have got. */
      const at = (k) => (2 * k + 1) / (2 * rules.length);
      let fill = 1;
      for (let k = 0; k < rules.length; k += 1) {
        const from = k ? rules[k - 1].min_videos : 0;
        if (videos < rules[k].min_videos) { const start = k ? at(k - 1) : 0; fill = start + (at(k) - start) * Math.max(0, (videos - from) / Math.max(1, rules[k].min_videos - from)); break; }
        fill = k === rules.length - 1 ? 1 : at(k);
      }
      const steps = [
        h('div', { class: 'mr-steps__line', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round(fill * 100)}%` })),
        ...rules.map((r) => {
          const reached = met(r);
          const locked = !reached && videos >= r.min_videos;
          const needs = Number(r.min_sales || 0);
          return h('div', { class: 'mr-steps__step', 'data-done': reached || null }, h('div', { class: 'mr-steps__dot', 'aria-hidden': 'true', 'data-locked': locked || null }, reached ? '✓' : locked ? '\u{1F512}' : ''), h('b', {}, cp.dollars(r.amount_cents)), h('small', {}, `${num(r.min_videos)} videos`), h('small', {}, needs ? `+ ${num(needs)} sales` : 'no sales'));
        }),
      ];
      rows.push(
        h(
          'li',
          { class: 'mr-earn__wide' },
          h('div', { class: 'mr-earn__head' }, h('span', {}, h('b', {}, 'Post videos this month'), h('small', {}, [`A video counts from ${compact(minViews)} views`, (inc.tier_level || 1) === 1 ? 'paid even before your first sale' : null].filter(Boolean).join(' · '))), h('b', { class: 'mr-earn__count' }, `${done} of ${rules.length} complete`)),
          h('div', { class: 'mr-steps', role: 'img', 'aria-label': `${videos} videos and ${sales} sales this month. ${done} of ${rules.length} levels complete.`, style: `grid-template-columns:repeat(${rules.length}, 1fr)` }, steps),
          h('small', { class: 'cp-muted' }, next ? `${num(videos)} video${videos === 1 ? '' : 's'} and ${num(sales)} sale${sales === 1 ? '' : 's'} this month · ${[next.min_videos > videos ? `${num(next.min_videos - videos)} more video${next.min_videos - videos === 1 ? '' : 's'}` : null, Number(next.min_sales || 0) > sales ? `${num(next.min_sales - sales)} more sale${next.min_sales - sales === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ')} for the next ${cp.dollars(next.amount_cents)}` : `${num(videos)} videos · every level earned this month`),
        ),
      );
    }
    if (!rows.length) return null;
    const climb = above && a && a.base_amount_cents > 0 && times(above) > times(tier) ? `At ${above.name} the weekly bonus is ${cp.dollars(Math.round(a.base_amount_cents * times(above)))}.` : null;
    return h('section', { class: 'mr-panel mr-earn' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Bonuses you can earn'), h('span', {}, pill(`${data.creator.champion ? 'Champion' : tier?.name || 'Iron'} rates`, 'good'))), h('ul', { class: 'mr-earn__list' }, rows), h('p', { class: 'cp-muted cp-small' }, climb ? `${climb} ` : '', h('button', { class: 'cp-link', type: 'button', onclick: () => openPane('pay') }, 'See what every rank pays')));
  }

  /* The wallet opens once the creator has a video in the program (waiting for review counts). */
  function walletLock() {
    return h('section', { class: 'mr-lock' }, h('span', { class: 'mr-lock__icon', 'aria-hidden': 'true' }, '\u{1F512}'), h('h2', {}, 'Post your first video to unlock your wallet'), h('p', {}, 'Your wallet opens as soon as your first video is in. Anything you earn before then is kept safe and shows up here the moment it unlocks.'), h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openPane('videos') }, 'Post my first video'));
  }

  /* One screen that says where the creator stands: what to do next, the wallet, and four big numbers. */
  function homeView(data) {
    const { creator, balance, stats } = data;
    const inc = data.incentives;
    const tier = inc.tiers.find((t) => t.level === inc.tier_level) || inc.tiers[0];
    const big = (cents) => { const v = Math.round(cents / 100); return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`; };
    const weeks = weekly(data);
    const top = Math.max(1, ...weeks.map((w) => w.value));
    const tile = (tone, label, value, foot, to) => h('button', { class: 'mr-tile', 'data-tone': tone, type: 'button', onclick: () => openPane(to) }, h('span', { class: 'mr-tile__label' }, label), h('b', { class: 'mr-tile__value' }, value), foot ? h('span', { class: 'mr-tile__foot' }, foot) : null);
    const live = (data.contests || []).filter((k) => k.open || k.upcoming);
    return [
      discordBox(creator.discord_name, () => { creator.discord_name = creator.display_name; toast('Connected. (Sample data: nothing was saved.)'); renderDashboard(data); }),
      firstVideoBox(data),
      creator.payout_hold ? h('div', { class: 'cp-card cp-notice', role: 'status' }, h('b', {}, 'Your payouts are on hold'), h('p', { class: 'cp-muted' }, 'We are checking your account. Nothing is paid out until that is done. Questions: ', h('a', { href: 'mailto:teammindroll@gmail.com' }, 'teammindroll@gmail.com'))) : null,
      h(
        'section',
        { class: 'mr-grid' },
        h('div', { class: 'mr-tile mr-tile--hero', 'data-tone': 'ink' }, h('span', { class: 'mr-tile__label' }, 'Your wallet'), h('b', { class: 'mr-tile__value' }, big(Math.max(0, balance.available_cents))), h('div', { class: 'mr-tile__row' }, h('span', {}, h('b', {}, big(balance.commission_cents + balance.bonus_cents)), 'earned in total'), h('span', {}, h('b', {}, big(Math.max(0, balance.pending_cents))), 'still clearing'), h('span', {}, h('b', {}, big(balance.paid_cents)), 'paid to you')), h('div', { class: 'mr-spark', role: 'img', 'aria-label': 'What you earned each week for the last eight weeks' }, weeks.map((w, i) => h('i', { title: `${w.label}: ${big(w.value)}`, style: `height:${Math.max(4, (w.value / top) * 100).toFixed(1)}%`, 'data-today': i === weeks.length - 1 || null })))),
        tile('paper', 'Your rank', creator.champion ? 'Champion' : tier.name, `${pct(creator.rate)} of every sale`, 'pay'),
        tile('paper', 'Subscribers', num(stats.customers || 0), `${cp.dollars(stats.recurring_month_cents || 0)} a month coming in`, 'links'),
        tile('paper', 'Views', compact(stats.views || 0), `${num(stats.videos || 0)} video${stats.videos === 1 ? '' : 's'}`, 'videos'),
        tile('amber', 'Earned this week', big(weeks[weeks.length - 1].value), 'See your wallet', 'wallet'),
      ),
      homeBonusCard(data),
      ironCard(data),
      h('div', { class: 'mr-two' }, tierCard(data, tier), h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Live now'), h('button', { class: 'cp-link', type: 'button', onclick: () => openPane('campaigns') }, 'Campaigns')), live.length ? h('ul', { class: 'mr-live' }, live.map((k) => h('li', {}, h('i', { 'data-upcoming': k.upcoming || null }), h('span', {}, h('b', {}, k.title), h('small', {}, `Win up to ${cp.dollars(k.prizes[0] || 0)}${k.joined ? (k.place ? ` · you are ${ordinal(k.place)}` : ' · you are in') : ''}`)), h('b', {}, k.joined ? 'Joined' : 'Join')))) : h('p', { class: 'mr-quiet' }, 'No campaign running right now.'))),
      topVideosCard(data),
      data.videos.length ? null : howCard(data),
      raceStrip(data),
    ];
  }

  /*
   * The demo run: a short walk through every page, one step at a time. It
   * opens each page and says what it is for and what to do there. It starts by
   * itself the first time, and the Tour button runs it again.
   */
  let tourStep = null;
  function tourSteps(data) {
    const { creator } = data;
    const inc = data.incentives;
    const tag = tagOf(data);
    const tiers = inc.tiers;
    const up = tiers.filter((t) => t.level > 1);
    const first = up[0];
    const top = tiers[tiers.length - 1];
    const ch = inc.champion;
    const r = data.referrals;
    const min = data.settings.min_payout_cents || 0;
    return [
      ['home', 'Welcome to your dashboard', [`This is Home. The big number is your wallet: money you can cash out.`, `Under it: your rank, how many people subscribed through you, your views, and what you earned this week.`]],
      ['links', 'Step 1: your link and hashtag', [`Put your link in your bio. Everyone who subscribes through it earns you ${pct(creator.rate)} of every sale, every week they stay.`, Number(inc.first_sale_rate) > 0 ? `Your first weekly sale and your first yearly sale each pay ${pct(inc.first_sale_rate)}.` : null, `Put ${tag} in the caption of every video. That is how we find it.`, creator.handle_verified === false ? `Add mindroll-${creator.code} to your bio too, so we can check the account is yours.` : null]],
      ['videos', 'Step 2: post', [`Post from the account you linked. Your videos show up here by themselves, with their views.`, (data.briefs || []).length ? `"Formats that work" are videos to copy. Follow them and you are not guessing.` : `We will put videos to copy here. Follow them and you are not guessing.`, inc.iron?.on && inc.iron.eligible ? `While you are ${tiers[0].name} you also get views pay: ${cp.dollars(inc.iron.step_cents)} for every ${compact(inc.iron.step_views)} views. The first ${cp.dollars(inc.iron.step_cents)} needs only views; each one after needs 1 more subscriber.` : null]],
      ['campaigns', 'Step 3: win campaigns', [`Campaigns are contests with cash prizes. Press Join, post in the format, and the top three get paid.`, `There is usually one running, so check here often.`]],
      ['pay', 'How ranks work', [`Everyone starts at ${tiers[0].name} and earns ${pct(tiers[0].commission_rate)} of every sale.`, first ? `Move up by earning more, getting more views and posting more in 30 days. ${first.name} takes ${cp.dollars(earned(first.min_revenue_cents, tiers[0].commission_rate))} in commission, ${compact(first.min_views)} views and ${num(first.min_posts)} videos.` : null, up.length ? `Each rank pays more: ${up.map((t) => `${t.name} ${pct(t.commission_rate)}`).join(', ')}. The weekly posting bonus grows too.` : null, `Your rank follows your last 30 days, so keep going to keep it.`, ch?.slots > 0 ? `The top ${ch.slots} ${top.name} creators are Champions: ${pct(ch.rate)} and ${cp.dollars(ch.daily_cents)} for every day they post.` : null, ]],
      ...(raceOf(data).some((r) => !r.winner) ? [['race', 'Race to the podium', [`A one-time race: the first creator to reach each rank wins a cash prize.`, [...raceOf(data)].reverse().map((r) => `${r.name} ${cp.dollars(r.cents)}`).join(', ') + '.', `One winner per rank. Once a prize is won it is gone.`]]] : []),
      ['wallet', 'Getting paid', [`Tell us where to send your money: PayPal, Venmo or Zelle.`, `Commission clears after ${data.settings.hold_days} days. Once you have ${cp.dollars(min)} ready, press Cash out.`]],
      ['invite', 'Bring a friend', [r && r.bonus_cents > 0 ? `Share your invite link. When a creator you brought in reaches ${compact(r.views)} views, you get ${cp.dollars(r.bonus_cents)}.` : `Share your invite link with other creators.`]],
      ['alerts', 'You are set', [`Every bonus, win and payment shows up here in Notifications.`, `That is everything. Post your first video and put your link in your bio.`]],
    ];
  }
  function startTour() {
    tourStep = 0;
    openPane(tourSteps(lastData)[0][0]);
  }
  function tourCard(data) {
    const steps = tourSteps(data);
    const [, title, lines] = steps[tourStep];
    const move = (to) => () => {
      if (to < 0) return;
      if (to >= steps.length) { tourStep = null; keep('mindroll.creator.toured', '1'); return openPane('home'); }
      tourStep = to;
      openPane(steps[to][0]);
    };
    const end = () => { tourStep = null; keep('mindroll.creator.toured', '1'); renderDashboard(data); };
    return h(
      'aside',
      { class: 'mr-tour', role: 'dialog', 'aria-label': 'Demo run' },
      h('div', { class: 'mr-tour__top' }, h('small', {}, `Demo run · ${tourStep + 1} of ${steps.length}`), h('button', { class: 'cp-link', type: 'button', onclick: end }, 'Skip')),
      h('div', { class: 'mr-tour__dots', 'aria-hidden': 'true' }, steps.map((_, i) => h('i', { 'data-on': i <= tourStep || null }))),
      h('b', {}, title),
      lines.filter(Boolean).map((line) => h('p', {}, line)),
      h('div', { class: 'mr-tour__nav' }, tourStep > 0 ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: move(tourStep - 1) }, 'Back') : h('span', {}), h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: move(tourStep + 1) }, tourStep === steps.length - 1 ? 'Finish' : 'Next')),
    );
  }

  function renderDashboard(data) {
    const hasTeam = PANES.some(([id]) => id === 'team');
    if (data.team && !hasTeam) PANES.splice(1, 0, ['team', 'My team', 'badge']);
    if (!data.team && hasTeam) PANES.splice(PANES.findIndex(([id]) => id === 'team'), 1);
    if (location.hash === '#team' && data.team && !renderDashboard.opened) { renderDashboard.opened = true; pane = 'team'; }
    if (!PANES.some(([id]) => id === pane)) pane = 'home';
    const { creator, stats } = data;
    lastData = data;
    /* First visit: start the demo run. */
    if (tourStep === null && !keep('mindroll.creator.toured') && !renderDashboard.started) {
      renderDashboard.started = true;
      tourStep = 0;
      pane = tourSteps(data)[0][0];
    }
    const feed = feedOf(data);
    const seen = Number(keep('mindroll.creator.seen') || 0);
    const count = {
      alerts: feed.filter((e) => new Date(e.at).getTime() > seen).length,
      campaigns: (data.contests || []).filter((k) => (k.open || k.upcoming) && !k.joined).length,
    };
    const body = {
      home: () => homeView(data),
      brief: () => briefView(data),
      team: () => cp.teamView(data.team, { review: (v, ok, reason) => reviewVideo(data, v, ok, reason), accounts: (c, ok) => reviewAccounts(data, c, ok), manage: teamActions(data) }),
      connect: () => connectView(data),
      alerts: () => alertsView(data),
      campaigns: () => campaignsView(data),
      videos: () => [briefsCard(data), ironCard(data), videosCard(data), viewsCard(data)],
      links: () => [howCard(data), linksCard(data), section('From click to subscriber', null, cp.hbars([{ label: 'Clicked your link', value: stats.clicks }, { label: 'Signed up', value: stats.signups }, { label: 'Subscribed', value: stats.customers }], num))],
      wallet: () => (data.videos || []).length ? [firstVideoBox(data), walletCard(data), section('Earned each week', null, cp.timeChart('columns', weekly(data), (cents) => money(cents).replace(/\.00$/, ''), 'Earned each week')), planCards(data), incentiveCards(data)[1], detailTables(data)] : [firstVideoBox(data), walletLock()],
      pay: () => [...payView(data), ironCard(data), incentiveCards(data)[0], raceStrip(data)],
      race: () => raceView(data),
      invite: () => [...(referralCard(data) || []), manychatCard(data)],
    }[pane]();
    cp.root.dataset.help = helpOn() ? 'on' : 'off';
    const nav = h('nav', { class: 'mr-side', 'aria-label': 'Your dashboard' }, PANES.map(([id, label, glyph]) => h('button', { class: 'mr-nav', type: 'button', 'data-star': id === 'brief' || null, 'data-glow': id === 'connect' || null, 'aria-current': id === pane ? 'page' : null, onclick: () => openPane(id) }, icon(glyph), h('span', {}, label), id === 'brief' ? h('em', {}, 'Read first') : count[id] ? h('b', {}, String(count[id])) : null)));
    const bellButton = pane === 'alerts' ? null : h('button', { class: 'mr-bell', type: 'button', 'aria-label': `Notifications${count.alerts ? `, ${count.alerts} new` : ''}`, onclick: () => openPane('alerts') }, icon('bell'), count.alerts ? h('b', {}, String(count.alerts)) : null);
    const head = h('header', { class: 'mr-head' }, h('div', { class: 'mr-head__who' }, creator.avatar_url ? cp.avatar({ ...creator, tier_level: data.incentives?.tier_level }, 'lg') : null, h('h1', {}, pane === 'home' ? `Hi, ${creator.display_name}` : PANES.find(([id]) => id === pane)[1])), h('div', { class: 'mr-head__tools' }, bellButton));
    show(h('div', { class: 'mr-shell', 'data-tour': tourStep !== null || null }, nav, h('div', { class: 'mr-main' }, head, ...[body].flat().filter(Boolean))), tourStep !== null ? tourCard(data) : null);
    cp.tabbar({ label: 'Your dashboard', items: PANES.map(([id, label, glyph]) => [id, label, glyph, count[id], id === 'brief' ? 'Read first' : null]), main: ['home', 'videos', 'wallet', 'campaigns'], current: pane, open: openPane, icon });
    cp.live.drawn();
  }

  /* " Platinum pays $6 and Diamond $7." - the tiers above theirs that pay more per yearly subscriber. */
  function yearlyLadder(inc) {
    const better = (inc?.tiers || []).filter((t) => t.level > inc.tier_level && t.annual_flat_cents > (inc.annual_bonus_cents || 0));
    return better.length ? ` ${better.map((t) => `${t.name} pays ${cp.dollars(t.annual_flat_cents)}`).join(' and ')}.` : '';
  }

  const tagOf = (data) => `#${(data.settings.hashtag || 'mindroll').replace(/^./, (c) => c.toUpperCase())}`;
  const accountsOf = (creator) => [creator.tiktok_handle && `@${creator.tiktok_handle} on TikTok`, creator.instagram_handle && `@${creator.instagram_handle} on Instagram`].filter(Boolean);

  /* The instructions: the three things a creator does, each with what to copy. */
  function howCard(data) {
    const { creator } = data;
    const tag = tagOf(data);
    const link = `https://getmindroll.com/start/?ref=${creator.code}`;
    const accounts = accountsOf(creator);
    const step = (n, title, body, extra) => h('li', { class: 'cp-how__step' }, h('span', { class: 'cp-how__n', 'aria-hidden': 'true' }, String(n)), h('div', {}, h('b', {}, title), h('p', { class: 'cp-muted cp-small' }, body), extra));
    return h(
      'section',
      { class: 'cp-card' },
      h('div', { class: 'cp-card__head' }, h('h2', {}, 'How it works')),
      h(
        'ol',
        { class: 'cp-how' },
        step(1, 'Post about Mindroll', accounts.length ? `From ${accounts.join(' or ')}.` : 'From the account you linked.'),
        step(2, `Put ${tag} in the caption`, 'That is how we find the video. It shows up here by itself, and a video without the tag does not count.', h('div', { class: 'cp-copyrow' }, h('code', { class: 'cp-mono' }, tag), copyButton(tag, 'Copy'))),
        step(3, 'Share your link', 'Put it in your bio. Everyone who subscribes through it earns you commission.', h('div', { class: 'cp-copyrow' }, h('code', { class: 'cp-mono' }, link.replace('https://', '')), copyButton(link, 'Copy'))),
        creator.handle_verified === false ? step(4, 'Show us the account is yours', 'Add this to your bio until we have checked it. You can take it out afterwards.', h('div', { class: 'cp-copyrow' }, h('code', { class: 'cp-mono' }, `mindroll-${creator.code}`), copyButton(`mindroll-${creator.code}`, 'Copy'))) : null,
      ),
    );
  }

  /*
   * The two kinds of subscriber, side by side. Weekly and monthly subscribers
   * pay again and again, so they are shown as income per month; yearly ones pay
   * a flat amount each, set by the creator's tier.
   */
  function planCards(data) {
    const { stats } = data;
    const bonus = data.incentives?.annual_bonus_cents || 0;
    const recurring = weekly({ commissions: data.commissions.filter((row) => row.plan !== 'annual'), bonuses: [] });
    const people = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
    return h(
      'div',
      { class: 'cp-two cp-even' },
      h(
        'section',
        { class: 'cp-card' },
        h('div', { class: 'cp-card__head' }, cp.figure('Recurring income', `${cp.dollars(stats.recurring_month_cents || 0)} a month`), h('span', { class: 'cp-muted' }, people(stats.recurring_subs || 0, 'weekly subscriber'))),
        recurring.some((week) => week.value > 0) ? cp.timeChart('columns', recurring, cp.dollars, 'Paid to you each week by weekly subscribers', cp.dollars, cp.COLOR.paid) : null,
        h('p', { class: 'cp-muted cp-small' }, 'An estimate: each weekly subscriber pays about 4.2 times a month, for as long as they stay.'),
      ),
      h(
        'section',
        { class: 'cp-card' },
        h('div', { class: 'cp-card__head' }, cp.figure('Yearly subscribers', num(stats.annual_subs || 0)), bonus ? h('span', { class: 'cp-rate' }, `${cp.dollars(bonus)} each`) : null),
        cp.hbars([{ label: 'Earned', value: Math.max(0, stats.annual_commission_cents || 0) }], cp.dollars),
        h('p', { class: 'cp-muted cp-small' }, `Every new yearly subscriber pays you a flat ${cp.dollars(bonus)} on top of your commission.${yearlyLadder(data.incentives)}`),
      ),
    );
  }

  /*
   * The incentives: where they stand on the tier ladder, this week's and this
   * month's posting bonuses, and what each kind of bonus has paid so far.
   */
  function incentiveCards(data) {
    const inc = data.incentives;
    if (!inc) return [];
    const tier = inc.tiers.find((t) => t.level === inc.tier_level) || inc.tiers[0];
    const earned = cp.KINDS.map(([kind, label]) => ({ label, value: inc.by_kind[kind] || 0 })).filter((row) => row.value > 0);
    const posting = [];
    if (inc.active.amount_cents > 0) {
      posting.push(
        h('p', { class: 'cp-rowlabel' }, h('b', {}, 'Active creator, this week'), h('span', { class: 'cp-muted' }, `${inc.active.days} of ${inc.active.min_days} days counted`)),
        cp.ladder(inc.active.days, [{ at: inc.active.min_days, label: `${cp.dollars(inc.active.amount_cents)} a week`, tip: [money(inc.active.amount_cents), `every week you post on ${inc.active.min_days} days`] }], { unit: 'days' }),
      );
    }
    if (inc.volume.rules.length) {
      posting.push(
        h('p', { class: 'cp-rowlabel' }, h('b', {}, 'Posting volume, this month'), h('span', { class: 'cp-muted' }, `${inc.volume.videos} video${inc.volume.videos === 1 ? '' : 's'}`)),
        cp.ladder(inc.volume.videos, inc.volume.rules.map((rule) => ({ at: rule.min_videos, label: `${rule.min_videos} · ${cp.dollars(rule.amount_cents)}`, tip: [money(rule.amount_cents), `for ${rule.min_videos} videos`] })), { unit: 'videos' }),
      );
    }
    return [
      h(
        'div',
        { class: 'cp-two cp-even' },
        tier ? tierCard(data, tier) : null,
        posting.length ? h('section', { class: 'cp-card' }, h('div', { class: 'cp-card__head' }, h('h2', {}, 'Posting bonuses'), (inc.active.day_views ?? inc.active.count_min_views) > 0 ? h('span', { class: 'cp-muted' }, `A day counts at ${compact(inc.active.day_views ?? inc.active.count_min_views)} views`) : null), posting, (inc.active.day_views ?? 0) > 0 ? h('p', { class: 'cp-muted cp-small' }, `Post on ${inc.active.min_days} different days in a week. A day counts once the videos you posted that day reach ${num(inc.active.day_views)} views between them.`) : null) : null,
      ),
      earned.length || inc.margin?.rate != null
        ? section(
            'Bonuses you have earned',
            null,
            earned.length ? cp.hbars(earned, cp.dollars, cp.COLOR.wait) : null,
            inc.margin?.rate != null ? h('p', { class: 'cp-muted cp-small' }, `Bonuses are paid out of the sales you bring in. ${(data.claimable_cents ?? inc.margin.room_cents) > 0 ? `Your sales cover ${cp.dollars(data.claimable_cents ?? inc.margin.room_cents)} more in bonuses right now.` : 'Any bonus you have reached is paid as soon as your next sales cover it.'}`) : null,
          )
        : null,
    ];
  }

  /* The bars a tier asks for over 30 days, as [label, the last 30 days, the bar, how to print it, unit]. */
  /*
   * Tiers are judged on the sales a creator brings in, but a creator is shown
   * what that means for them: the commission it earns at the rate they are on.
   * The progress it shows is the same either way.
   */
  const earned = (salesCents, rate = lastData?.creator?.rate ?? 0.1) => Math.round(salesCents * rate);
  const barsOf = (inc, t) => [
    t.min_revenue_cents > 0 && ['Commission', earned(inc.window_revenue_cents || 0), earned(t.min_revenue_cents), cp.dollars, 'in commission'],
    t.min_views > 0 && ['Views', inc.window_views || 0, t.min_views, compact, 'views'],
    t.min_posts > 0 && ['Videos', inc.window_posts || 0, t.min_posts, num, 'videos'],
  ].filter(Boolean);
  const needs = (t) => [t.min_revenue_cents > 0 && `${cp.dollars(earned(t.min_revenue_cents, t.commission_rate))} in commission`, t.min_views > 0 && `${compact(t.min_views)} views`, t.min_posts > 0 && `${num(t.min_posts)} videos`].filter(Boolean).join(', ') || 'Where everyone starts';

  /* One plain bar: how far along, and the two numbers. Blue once it is done. */
  const progress = (label, have, need, fmt = num) => {
    const share = need > 0 ? Math.max(0, Math.min(1, have / need)) : 1;
    return h('div', { class: 'cp-prog', 'data-done': have >= need || null }, h('p', { class: 'cp-rowlabel cp-small' }, h('span', {}, label), h('span', {}, h('b', {}, fmt(have)), h('span', { class: 'cp-muted' }, ` / ${fmt(need)}`))), h('div', { class: 'cp-bar', role: 'img', 'aria-label': `${label}: ${fmt(have)} of ${fmt(need)}` }, h('i', { style: `width:${(share * 100).toFixed(1)}%` })));
  };
  const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

  /*
   * Your tier. It follows the last 30 days, so the card shows what those 30
   * days hold against the next tier up. At the top tier the next step is
   * Champion, which has no bar: it is a place among the top few by sales.
   */
  function tierCard(data, tier) {
    const inc = data.incentives;
    const days = inc.window_days || 30;
    const next = inc.tiers.find((t) => t.level === inc.tier_level + 1);
    const rows = next ? barsOf(inc, next) : [];
    const ch = inc.champion;
    let body;
    if (next && rows.length) {
      body = [h('p', { class: 'cp-rowlabel' }, h('b', {}, `To reach ${next.name}`), h('span', { class: 'cp-muted' }, `your last ${days} days`)), rows.map(([label, have, need, fmt]) => progress(label, have, need, fmt))];
    } else if (ch?.slots > 0 && ch.is) {
      body = h('p', { class: 'cp-muted' }, `You are one of the top ${ch.slots} ${tier.name} creators. That pays ${pct(ch.rate)} commission and ${cp.dollars(ch.daily_cents)} for every day you post a video, for as long as you hold your place.`);
    } else if (ch?.slots > 0 && ch.place) {
      body = [h('p', { class: 'cp-rowlabel' }, h('b', {}, 'To become a Champion'), h('span', { class: 'cp-muted' }, `you are ${ordinal(ch.place)} in ${tier.name}`)), progress(`Commission to take ${ordinal(ch.slots)} place`, earned(inc.window_revenue_cents || 0), earned((ch.bar_cents || 0) + 100), cp.dollars), h('p', { class: 'cp-muted cp-small' }, `The ${ch.slots} top-earning ${tier.name} creators are Champions: ${pct(ch.rate)} commission and ${cp.dollars(ch.daily_cents)} for every day they post.`)];
    } else {
      body = h('p', { class: 'cp-muted' }, 'You are at the top tier.');
    }
    return h(
      'section',
      { class: 'cp-card' },
      h('div', { class: 'cp-card__head' }, cp.figure('Your tier', ch?.is ? 'Champion' : tier.name), h('span', { class: 'cp-rate' }, `${pct(data.creator.rate)} commission`)),
      body,
      h('p', { class: 'cp-muted cp-small' }, tier.level > 1 ? `Keep your last ${days} days at ${needs(tier)} to stay ${tier.name}.` : `Reach a tier's numbers and you move up straight away.`),
      h('p', {}, h('button', { class: 'cp-link', type: 'button', onclick: () => openPane('pay') }, 'See what every tier pays')),
    );
  }

  /*
   * Views pay, for creators at the first rank: a fixed amount for every step of
   * views. The first step needs only views; each one after it also needs one
   * more subscriber, so the card says plainly when it is the subscriber that is missing.
   */
  function ironCard(data) {
    const i = data.incentives?.iron;
    if (!i || !i.on || !i.eligible) return null;
    const step = Number(i.step_views);
    const views = Number(i.views);
    const paid = Number(i.steps_paid);
    const most = Math.floor(Number(i.cap_views) / step);
    const each = cp.dollars(i.step_cents);
    const locked = Number(i.steps_by_views) > Number(i.steps_allowed);
    const done = paid >= most;
    const nextAt = (paid + 1) * step;
    const need = Number(i.steps_by_views) - Number(i.steps_allowed);
    return h(
      'section',
      { class: 'mr-panel' },
      h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Views pay'), h('b', {}, cp.dollars(i.paid_cents))),
      done
        ? h('p', { class: 'mr-quiet' }, `You have earned all ${cp.dollars(most * i.step_cents)} of it.`)
        : locked
          ? h('div', { class: 'cp-card cp-notice' }, h('b', {}, `Locked at ${cp.dollars(i.paid_cents)}`), h('p', {}, `You have the views. Get ${need === 1 ? '1 more subscriber' : `${need} more subscribers`} through your link to unlock ${need === 1 ? `the next ${each}` : `${cp.dollars(need * i.step_cents)}`}.`))
          : progress(`Views to your next ${each}`, Math.min(views, nextAt), nextAt, compact),
      h('p', { class: 'cp-facts' }, `${each} for every ${compact(step)} views, up to ${cp.dollars(most * i.step_cents)}. The first ${each} needs only views; each one after needs 1 more subscriber. Videos count from ${compact(i.video_min_views)} views. For ${data.incentives.tiers[0].name} creators.`),
    );
  }

  /*
   * Race to the podium: a one-off prize for the first creator to reach each
   * rank. One banner for the whole race, then one per rank in the same shape:
   * the number in the middle, the words either side.
   */
  /* Biggest prize first. */
  const raceOf = (data) => (data.incentives?.race?.prizes || []).filter((r) => Number(r.cents) > 0).sort((x, y) => Number(y.cents) - Number(x.cents));
  /* The metal each rank is named after, by its place in the ladder. */
  const METAL = [null, 'iron', 'silver', 'gold', 'platinum', 'diamond'];
  function raceBanner(label, left, amount, right, foot, state, level) {
    return h('section', { class: 'mr-prize', 'data-won': state === 'won' ? '' : null, 'data-mine': state === 'mine' ? '' : null, 'data-metal': METAL[level] || null }, h('small', {}, label), h('div', { class: 'mr-prize__row' }, h('span', {}, left), h('b', {}, amount), h('span', {}, right)), foot ? h('em', {}, foot) : null);
  }
  /* --------------------------------------------------------- connect accounts */

  async function reviewVideo(data, video, approve, reason) {
    if (!approve && !reason) throw new Error('Say why you are declining it, so the creator knows what to fix.');
    if (cp.demo) { video.status = approve ? 'approved' : 'rejected'; video.reject_reason = approve ? null : reason; toast(`${approve ? 'Approved' : 'Declined'}. (Sample data: nothing was saved.)`); return data.creator ? renderDashboard(data) : renderManager(data); }
    await cp.rpc('creator_review_video', { p_video: video.id, p_approve: approve, p_reason: reason || null });
    toast(approve ? 'Approved. It counts for the creator now.' : 'Declined. The creator will see your reason.');
    await load();
  }

  /* A manager approves or declines the accounts one of their creators added. */
  /* A manager's changes to their own team. The server refuses anything outside their team or the allowed range. */
  function teamActions(data) {
    const redraw = () => (data.creator ? renderDashboard(data) : renderManager(data));
    const info = () => (data.team.manage ||= { rate_cap: 0.25, managers: [], rates: {} });
    const WHY = { not_yours: 'That creator is not on your team any more.', too_low: 'That is below what their rank already pays.', too_high: 'That is above the most a manager can give.', no_manager: 'That manager is not available.' };
    return {
      setRate: async (c, rate) => {
        if (cp.demo) { const r = (info().rates[c.id] ||= { rate: 0.1, rank_rate: 0.1, custom: false }); Object.assign(r, rate == null ? { rate: r.rank_rate, custom: false } : { rate, custom: true }); toast('Saved. (Sample data: nothing was saved.)'); return redraw(); }
        const reply = await cp.rpc('creator_manager_set_rate', { p_creator: c.id, p_rate: rate });
        if (reply !== 'saved' && reply !== 'cleared') throw new Error(WHY[reply] || 'That did not save.');
        toast(reply === 'saved' ? `${c.display_name} now earns ${Math.round(rate * 1000) / 10}% on every sale.` : `${c.display_name} is back on their rank rate.`);
        await load();
      },
      move: async (c, to, name) => {
        if (cp.demo) { data.team.creators = data.team.creators.filter((x) => x !== c); toast('Moved. (Sample data: nothing was saved.)'); return redraw(); }
        const reply = await cp.rpc('creator_manager_move', { p_creator: c.id, p_to: to });
        if (reply !== 'moved') throw new Error(WHY[reply] || 'That did not go through.');
        toast(`${c.display_name} moved to ${name}'s team.`);
        await load();
      },
      remove: async (c) => {
        if (cp.demo) { data.team.creators = data.team.creators.filter((x) => x !== c); toast('Removed. (Sample data: nothing was saved.)'); return redraw(); }
        const reply = await cp.rpc('creator_manager_remove', { p_creator: c.id });
        if (reply !== 'removed') throw new Error(WHY[reply] || 'That did not go through.');
        toast(`${c.display_name} was removed from the program.`);
        await load();
      },
    };
  }

  async function reviewAccounts(data, c, approve) {
    if (cp.demo) { if (approve) c.handle_verified = true; else Object.assign(c, { tiktok: null, instagram: null, handle_verified: false }); toast(`${approve ? 'Approved' : 'Declined'}. (Sample data: nothing was saved.)`); return data.creator ? renderDashboard(data) : renderManager(data); }
    await cp.rpc('creator_review_accounts', { p_creator: c.id, p_approve: approve });
    toast(approve ? 'Approved. Their videos are tracked from the next hour.' : 'Declined. They can add the right usernames.');
    await load();
  }

  /*
   * How a creator's videos reach us: they name their TikTok or Instagram account,
   * and every #mindroll video on it is found by itself with its views (read from
   * the public account, no sign-in), or they send each video's link. Either way
   * a video is reviewed before it counts.
   */
  /*
   * Connect to Discord. The creator approves the link on Discord's own page and comes back through
   * /creators/discord/, which leaves Discord's answer in sessionStorage for finishDiscord() below.
   * Once linked, their rank and account roles in the Mindroll server follow the program by themselves.
   */
  const DISCORD_APP = '1572701230185058336';
  const DISCORD_SERVER = 'https://discord.com/channels/1572693376145293373';
  function startDiscord() {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem('mindroll.discord.state', state); } catch { /* the return is refused without it */ }
    location.assign(`https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: DISCORD_APP, response_type: 'token', redirect_uri: `${location.origin}/creators/discord/`, scope: 'identify guilds.join', state, prompt: 'consent' })}`);
  }

  /*
   * The first thing a new creator (or a manager) is asked to do: connect
   * Discord. It is where instructions and daily updates are posted and where
   * the bot tells them about sales, bonuses and people joining on their link.
   * Shown at the top of the page until they have connected.
   */
  function discordBox(connected, onSample, manager = false) {
    if (connected) return null;
    const connect = h('button', { class: 'btn', type: 'button' }, 'Connect Discord');
    connect.addEventListener('click', () => (cp.demo ? onSample() : startDiscord()));
    return h(
      'section',
      { class: 'mr-boost', 'data-discord': '', role: 'status' },
      h('div', { class: 'mr-boost__text' }, h('small', {}, 'Do this first'), h('h2', {}, 'Connect to the Discord'), h('p', {}, manager ? 'For instructions and daily updates, and a message the moment someone joins on your invite link.' : 'For more instructions and daily updates. You also get a message for every sale, bonus and payout.'), connect),
      h('div', { class: 'mr-boost__clock' }, h('span', {}, 'Takes'), h('b', {}, '1 tap'), h('span', {}, 'you join the server straight away')),
    );
  }

  function discordPanel(data) {
    const creator = data.creator;
    const name = creator.discord_name;
    const connect = h('button', { class: 'btn btn--primary', type: 'button' }, 'Connect to Discord');
    connect.addEventListener('click', () => {
      if (cp.demo) { creator.discord_name = creator.display_name; toast('Connected. (Sample data: nothing was saved.)'); return renderDashboard(data); }
      startDiscord();
    });
    const off = cp.confirmButton('Disconnect', 'Confirm: disconnect Discord', 'cp-link', async () => {
      if (cp.demo) { creator.discord_name = null; return renderDashboard(data); }
      await cp.fn('creator-discord', { action: 'unlink' });
      toast('Discord disconnected. Your Mindroll roles there were removed.');
      await load();
    });
    return h(
      'section',
      { class: 'mr-panel' },
      h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Discord'), h('span', { class: 'cp-muted' }, name ? 'Connected' : 'Not connected')),
      name
        ? h('div', {}, h('p', {}, 'Connected as ', h('b', {}, name), '. Your rank role in the Mindroll Discord updates by itself when your rank changes.'), h('div', { class: 'mr-connect__save' }, h('a', { class: 'btn btn--ghost', href: DISCORD_SERVER, target: '_blank', rel: 'noopener noreferrer' }, 'Open the Mindroll Discord'), off))
        : h('div', {}, h('p', { class: 'cp-muted' }, 'Join the Mindroll creator Discord in one tap. You get your rank role straight away, and it updates by itself as you rank up. Campaigns and winners are posted there first.'), h('div', { class: 'mr-connect__save' }, connect)),
    );
  }

  /* Back from Discord: hand its answer to the server once, then show the result. */
  async function finishDiscord() {
    let back = null, state = null;
    try {
      back = JSON.parse(sessionStorage.getItem('mindroll.discord') || 'null');
      state = sessionStorage.getItem('mindroll.discord.state');
      sessionStorage.removeItem('mindroll.discord');
      sessionStorage.removeItem('mindroll.discord.state');
    } catch { return false; }
    if (!back) return false;
    if (back.error) { toast(back.error === 'access_denied' ? 'Discord was not connected.' : 'Discord did not finish connecting. Try again.'); return false; }
    if (!back.token || !state || back.state !== state) { toast('Discord did not finish connecting. Try again.'); return false; }
    try {
      const out = await cp.fn('creator-discord', { action: 'link', access_token: back.token });
      toast(out.manager ? `Discord connected as ${out.name}. You will get a message when someone joins on your invite link.` : out.in_server ? `Discord connected as ${out.name}. Your roles are set.` : `Discord connected as ${out.name}. Join the server to get your roles.`);
      return true;
    } catch (cause) {
      toast(cause.message || 'Discord did not finish connecting. Try again.');
      return false;
    }
  }

  function connectView(data) {
    const creator = data.creator;
    const clean = (v) => String(v || '').trim().replace(/^@/, '');
    const mine = (data.videos || []).filter((v) => v.status !== 'approved' || Date.now() - new Date(v.created_at).getTime() < 14 * 864e5).slice(0, 12);
    const STATUS = { pending: ['Waiting for review', 'warn'], approved: ['Approved', 'good'], rejected: ['Declined', 'bad'] };
    const tag = data.settings?.hashtag || 'mindroll';
    const every = Number(data.settings?.scan_minutes) || 60;
    const approved = creator.handle_verified !== false;
    const field = (platform, label, handle) => {
      const input = h('input', { class: 'cp-input', type: 'text', value: handle ? `@${handle}` : '', placeholder: '@username', 'aria-label': `${label} username`, autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: '80' });
      const card = h(
        'div',
        { class: 'mr-connect__card', 'data-platform': platform, 'data-on': handle && approved ? '' : null, 'data-wait': handle && !approved ? '' : null },
        h('div', { class: 'mr-connect__top' }, h('i', { 'aria-hidden': 'true' }, platform === 'tiktok' ? 'TT' : 'IG'), h('div', {}, h('b', {}, label), h('span', { class: 'cp-muted cp-small' }, !handle ? 'Not added yet' : approved ? 'Tracking on' : 'Waiting for approval'))),
        input,
      );
      return { card, input };
    };
    const ttHandle = clean(creator.tiktok_handle || creator.tiktok), igHandle = clean(creator.instagram_handle || creator.instagram);
    const tt = field('tiktok', 'TikTok', ttHandle);
    const ig = field('instagram', 'Instagram', igHandle);
    const tracked = Boolean(ttHandle || igHandle);
    const checked = creator.last_scanned_at ? new Date(creator.last_scanned_at).getTime() : 0;
    const mins = checked ? Math.max(0, Math.round((Date.now() - checked) / 6e4)) : null;
    const ago = mins === null ? '' : mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} days ago`;
    const when = !tracked ? 'Add a username and send it for approval.'
      : !approved ? 'Waiting for your manager or Mindroll to approve these accounts. Tracking starts as soon as they do.'
      : mins === null ? 'Approved. The first check runs at the top of the hour.'
      : `Last checked ${ago}. Views update ${every === 60 ? 'every hour, on the hour' : `about every ${every < 60 ? `${every} minutes` : `${Math.round(every / 60)} hours`}`}.`;
    const save = h('button', { class: 'btn btn--primary', type: 'button' }, tracked ? 'Save accounts' : 'Send for approval');
    const SAVED = { no_handle: 'Add at least one username.', bad_handle: 'That username is too long.', handle_taken: 'Another creator has already added that account. Check the spelling, or message your manager.', not_creator: 'Your account has to be accepted first.', same: 'Those are the accounts we already track.' };
    save.addEventListener('click', act(save, async () => {
      const t = tt.input.value.trim(), i = ig.input.value.trim();
      if (!t && !i) throw new Error(SAVED.no_handle);
      if (cp.demo) { Object.assign(creator, { tiktok: t || null, instagram: i || null, tiktok_handle: clean(t) || null, instagram_handle: clean(i) || null, last_scanned_at: null, handle_verified: false }); toast('Sent for approval. (Sample data: nothing was saved.)'); return renderDashboard(data); }
      const reply = await cp.rpc('creator_set_accounts', { p_tiktok: t || null, p_instagram: i || null });
      if (reply !== 'saved') throw new Error(SAVED[reply] || 'That did not save.');
      toast('Sent for approval. Tracking starts once your accounts are approved.');
      await load();
    }));
    const url = h('input', { class: 'cp-input', type: 'url', inputmode: 'url', placeholder: 'Paste the TikTok or Instagram link to your video', 'aria-label': 'Video link', autocapitalize: 'none', spellcheck: 'false' });
    const send = h('button', { class: 'btn btn--primary', type: 'button' }, 'Send for review');
    const REPLY = { bad_url: 'That does not look like a TikTok, Instagram or YouTube video link.', duplicate: 'That video has already been sent.', not_creator: 'Your account has to be accepted first.', too_many: 'That is the limit for today. Send the rest tomorrow.' };
    send.addEventListener('click', act(send, async () => {
      const value = url.value.trim();
      if (!/^https:\/\//i.test(value)) throw new Error('Paste the full link, starting with https://');
      if (cp.demo) { data.videos = [{ id: `v${Date.now()}`, url: value, platform: /instagram/.test(value) ? 'instagram' : 'tiktok', title: null, status: 'pending', created_at: new Date().toISOString(), views: 0 }, ...(data.videos || [])]; toast('Sent for review. (Sample data: nothing was saved.)'); return renderDashboard(data); }
      const reply = await cp.rpc('creator_submit_video', { p_url: value });
      if (reply !== 'added') throw new Error(REPLY[reply] || 'That did not send.');
      toast('Sent for review. You will see it here once it is approved.');
      await load();
    }));
    const rule = (mark, title, text) => h('li', {}, h('i', { 'aria-hidden': 'true' }, mark), h('div', {}, h('b', {}, title), h('span', {}, text)));
    const discord = discordPanel(data);
    const aside = h(
      'aside',
      { class: 'mr-connect__aside', 'aria-label': 'How your videos are counted' },
      h('h2', {}, 'How your videos are counted'),
      h(
        'ul',
        {},
        rule('#', `Connected: use #${tag}`, `Put #${tag} in the caption. We pick the video up by itself and update its views every hour.`),
        rule('!', `No #${tag}, no automatic stats`, 'A video without the hashtag is not picked up from your account, and its views are not counted.'),
        rule('+', 'Not connected, or forgot the hashtag', 'Send each video\'s link yourself for review. It counts once it is approved.'),
      ),
    );
    return [
      h('section', { class: 'mr-briefhero mr-connect__hero' }, h('p', { class: 'mr-brief__eyebrow' }, 'Connect accounts'), h('h2', {}, 'Get your videos counted'), h('p', {}, `Add your TikTok or Instagram username. Once it is approved, every video you post with #${tag} in the caption shows up here by itself, with its views. Only videos with #${tag} count. No password and no sign-in: we only read what is public.`)),
      h('div', { class: 'mr-connect__layout' }, h('div', { class: 'mr-connect__main' },
      h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Your accounts'), h('span', { class: 'cp-muted' }, !tracked ? 'Not tracking yet' : approved ? 'Automatic' : 'Waiting for approval')), h('div', { class: 'mr-connect__grid' }, tt.card, ig.card), h('div', { class: 'mr-connect__save' }, save, h('p', { class: 'cp-muted cp-small' }, when)), h('p', { class: 'cp-muted cp-small' }, 'Your account has to be public for us to see your videos.')),
      discord,
      h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Or send one video for review'), h('span', { class: 'cp-muted' }, 'One link at a time')), h('div', { class: 'mr-connect__send' }, url, send), h('p', { class: 'cp-muted cp-small' }, `Put #${tag} in the caption and your link in your bio before you send it.`)),
      h(
        'section',
        { class: 'mr-panel' },
        h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Your recent videos'), h('b', {}, num(mine.length))),
        mine.length
          ? h('ul', { class: 'mr-connect__list' }, mine.map((v) => { const [label, tone] = STATUS[v.status] || [v.status, 'muted']; return h('li', {}, h('div', {}, cp.safeUrl(v.url) ? h('a', { href: cp.safeUrl(v.url), target: '_blank', rel: 'noopener noreferrer' }, v.title || v.url.replace(/^https:\/\/(www\.)?/, '').slice(0, 60)) : h('span', {}, v.title || 'Video'), v.status === 'rejected' && v.reject_reason ? h('p', { class: 'cp-small cp-bad' }, `Why: ${v.reject_reason}`) : null), pill(label, tone)); }))
          : h('p', { class: 'cp-muted' }, 'Nothing sent yet.'),
      )
      ), aside),
    ];
  }

  /* ------------------------------------------------------------- UGC brief */

  /* What to make and how to make it: the brief every creator gets, kept in the dashboard. */
  function briefView(data) {
    const brief = data.brief || cp.defaultBrief;
    const out = (href, ...kids) => (cp.safeUrl(href) ? h('a', { href: cp.safeUrl(href), target: '_blank', rel: 'noopener noreferrer' }, ...kids) : h('span', {}, ...kids));
    const copyButton = (text) => {
      const b = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; } setTimeout(() => { b.textContent = 'Copy'; }, 1400); } }, 'Copy');
      return b;
    };
    const block = (eyebrow, title, ...body) => h('section', { class: 'mr-panel mr-brief' }, h('p', { class: 'mr-brief__eyebrow' }, eyebrow), h('h2', {}, title), ...body);
    const link = `https://getmindroll.com/start/?ref=${data.creator.code}`;
    const ex = brief.examples || {}, ctas = brief.ctas || {}, assets = brief.assets || {}, must = brief.must || {}, tips = brief.tips || {};
    const videos = cp.briefVideos(brief);
    const card = (v) => {
      const src = cp.briefImage(v.image);
      const a = out(v.url, h('span', { class: 'mr-brief__thumb' }, src ? h('img', { src, alt: '', loading: 'lazy' }) : null, h('i', { 'aria-hidden': 'true' }, '▶'), v.pinned ? h('em', {}, 'Pinned') : v.highlight ? h('em', {}, 'Featured') : null), h('b', {}, v.title), v.note ? h('small', {}, v.note) : null);
      if (v.highlight) a.dataset.highlight = '';
      return a;
    };
    return [
      h('section', { class: 'mr-briefhero' }, h('p', { class: 'mr-brief__eyebrow' }, 'Read this before you film'), h('h2', {}, brief.title), h('p', {}, brief.lead)),
      videos.length || ex.allUrl
        ? block('Examples', ex.title, ex.note ? h('p', { class: 'cp-muted' }, cp.rich(ex.note)) : null, h('div', { class: 'mr-brief__cards' }, videos.map(card), ex.allUrl ? out(ex.allUrl, h('span', { class: 'mr-brief__thumb mr-brief__thumb--more' }, h('i', { 'aria-hidden': 'true' }, '+')), h('b', {}, 'All examples'), h('small', {}, 'Opens in Google Drive')) : null))
        : null,
      (ctas.items || []).length
        ? block('CTAs', ctas.title, h('p', { class: 'cp-muted' }, cp.rich(ctas.note), ctas.listUrl ? [' ', out(ctas.listUrl, 'Full CTA list'), '.'] : null), h('ul', { class: 'mr-brief__list' }, ctas.items.map((text) => h('li', {}, h('span', {}, `"${text}"`), copyButton(text)))))
        : null,
      (assets.items || []).length
        ? block('Assets', assets.title, h('div', { class: 'mr-brief__assets' }, assets.items.map((it) => { const a = out(it.url, h('b', {}, it.title), it.note ? h('small', {}, it.note) : null); if (it.lead) a.dataset.lead = ''; return a; })))
        : null,
      must.title || must.image
        ? block('One must-have', must.title, h('div', { class: 'mr-brief__must' }, cp.briefImage(must.image) ? h('img', { src: cp.briefImage(must.image), alt: must.title || '', loading: 'lazy' }) : null, h('div', {}, h('p', {}, cp.rich(must.text)), must.url ? out(must.url, must.linkLabel || 'Download the image') : null)))
        : null,
      (tips.items || []).length
        ? block('Highly recommended', tips.title, h('ul', { class: 'mr-brief__list' }, tips.items.map((text) => h('li', {}, h('span', {}, cp.rich(text))))), h('p', { class: 'cp-inline cp-small' }, h('span', { class: 'cp-muted' }, 'Your link: '), h('code', { class: 'cp-mono' }, link.replace('https://', '')), copyButton(link)))
        : null,
      brief.closing || brief.questions ? h('section', { class: 'mr-panel mr-brief' }, brief.closing ? h('p', {}, cp.rich(brief.closing)) : null, brief.questions ? h('p', { class: 'cp-muted cp-small' }, brief.questions) : null) : null,
    ];
  }

  function raceView(data) {
    const prizes = raceOf(data);
    if (!prizes.length) return [h('div', { class: 'mr-blank' }, icon('medal'), h('b', {}, 'No race on right now'))];
    const open = prizes.filter((r) => !r.winner);
    const total = prizes.reduce((sum, r) => sum + Number(r.cents), 0);
    const left = open.reduce((sum, r) => sum + Number(r.cents), 0);
    return [
      raceBanner('Race to the podium', 'First to', cp.dollars(total), 'each rank', open.length ? `${cp.dollars(left)} still to win. One winner per rank, one time only.` : 'Every prize has been won.'),
      h('div', { class: 'mr-race' }, prizes.map((r) => (r.you
        ? raceBanner('You won', 'First to', cp.dollars(r.cents), r.name, 'It is in your wallet.', 'mine', r.level)
        : r.winner
          ? raceBanner('Claimed', 'Won by', cp.dollars(r.cents), r.winner, `First creator to reach ${r.name}.`, 'won', r.level)
          : raceBanner('Up for grabs', 'First to', cp.dollars(r.cents), r.name, 'Be the first creator to get there.', null, r.level)))),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => openPane('pay') }, 'See what each rank takes'),
    ];
  }
  /* A one-line way into the race from Home, kept at the bottom so it is seen without being in the way. */
  function raceStrip(data) {
    const open = raceOf(data).filter((r) => !r.winner).reverse();
    if (!open.length) return null;
    return h('button', { class: 'mr-racestrip', type: 'button', onclick: () => openPane('race') }, h('small', {}, 'Race to the podium'), h('b', {}, cp.dollars(open.reduce((sum, r) => sum + Number(r.cents), 0))), h('span', {}, `still to win. First to ${open[0].name} takes ${cp.dollars(open[0].cents)}.`), h('em', {}, 'See the race'));
  }

  /*
   * The first-video boost. The clock starts the first time a creator opens the
   * dashboard after accepting the terms; the first video posted before it runs
   * out is paid more. The database owns the clock: the page only counts down to
   * the deadline it was given, measured against the server's time, not the phone's.
   */
  let boostClock = null;
  function keepBoost(boost) {
    if (!boost) return null;
    const { now, ...rest } = boost;
    if (!boostClock || boostClock.ends_at !== boost.ends_at) boostClock = { ends_at: boost.ends_at, local: Date.now() + (new Date(boost.ends_at) - new Date(now)) };
    return rest;
  }
  const clockText = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const p = (n) => String(n).padStart(2, '0'); return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`; };
  setInterval(() => {
    document.querySelectorAll('[data-boost-ends]').forEach((el) => {
      const left = Number(el.dataset.boostEnds) - Date.now();
      el.textContent = clockText(left);
      if (left <= 0 && !el.dataset.done) { el.dataset.done = ''; load(true); }
    });
  }, 1000);
  function firstVideoBox(data) {
    const f = data.first_video;
    if (!f) return null;
    const times = `${Number(f.multiplier)}x`;
    const what = Number(f.sale_days) > 0 ? `${times} commission on every sale in the ${num(f.sale_days)} days after you post it, and ${times} on every bonus the video earns` : `${times} on every bonus the video earns`;
    const example = Number(f.step_cents) > 0 ? ` For example, ${cp.dollars(f.step_cents)} at ${compact(f.step_views)} views becomes ${cp.dollars(f.step_cents * Number(f.multiplier))}.` : '';
    if (f.state === 'open') {
      const ends = cp.demo ? Date.now() + 23.4 * 36e5 : boostClock?.local || new Date(f.ends_at).getTime();
      if (ends <= Date.now()) return null;
      return h(
        'section',
        { class: 'mr-boost', role: 'status' },
        h('div', { class: 'mr-boost__text' }, h('small', {}, 'New creator boost'), h('h2', {}, `Your first video pays ${times}`), h('p', {}, `Post your first video before the clock runs out and it pays ${times}: ${what}.${example}`), h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openPane('videos') }, 'Post my first video')),
        h('div', { class: 'mr-boost__clock' }, h('span', {}, 'Ends in'), h('b', { 'data-boost-ends': String(ends), 'aria-live': 'off' }, clockText(ends - Date.now())), h('span', {}, `${num(f.hours)} hours from when you started`)),
      );
    }
    if (f.state === 'locked' && f.video) {
      /* Shown for a month after it was locked in, then it steps out of the way. */
      if (Date.now() - new Date(f.started_at).getTime() > 30 * 864e5) return null;
      const waiting = f.video.status !== 'approved';
      return h(
        'section',
        { class: 'mr-boost', 'data-locked': '', role: 'status' },
        h('div', { class: 'mr-boost__text' }, h('small', {}, 'New creator boost'), h('h2', {}, waiting ? `Locked in: your first video will pay ${times}` : `Your first video is paying ${times}`), h('p', {}, waiting ? 'You posted in time. It is waiting for review, and the boost starts the moment it is approved.' : `It pays ${times}: ${what}, up to ${cp.dollars(f.cap_cents)} extra.${example}`)),
        h('div', { class: 'mr-boost__clock' }, h('span', {}, 'Boost paid so far'), h('b', {}, cp.dollars(f.earned_cents || 0)), h('span', {}, `${compact(f.video.views || 0)} views on it`)),
      );
    }
    return null;
  }

  /* ManyChat is set up for a creator by the team once they have earned enough commission. */
  function manychatCard(data) {
    const need = data.settings.manychat_commission_cents || 0;
    if (!need) return null;
    const have = Math.max(0, data.balance.commission_cents || 0);
    return h(
      'section',
      { class: 'cp-card' },
      h('div', { class: 'cp-card__head' }, cp.figure('ManyChat', data.creator.manychat_at ? 'Set up' : have >= need ? 'Unlocked' : `Unlocks at ${cp.dollars(need)}`), data.creator.manychat_at ? pill('Done', 'good') : have >= need ? pill('We will contact you', 'good') : null),
      data.creator.manychat_at || have >= need ? null : progress('Commission you have earned', have, need, cp.dollars),
      h('p', { class: 'cp-muted cp-small' }, 'ManyChat messages your link to anyone who comments a keyword on your Instagram post, which turns far more viewers into subscribers. We set it up for you, free, once you have earned this much in commission.'),
    );
  }

  /* Reference videos and formats the team has put up to copy. */
  function briefsCard(data) {
    const list = data.briefs || [];
    if (!list.length) return null;
    return section(
      'Formats that work',
      h('span', { class: 'cp-muted' }, 'Copy these'),
      h(
        'ul',
        { class: 'cp-briefs' },
        list.map((b) => {
          const file = cp.briefVideoUrl(b.video_path);
          return h(
            'li',
            {},
            file ? h('video', { src: file, controls: true, preload: 'metadata', playsinline: true, 'aria-label': b.title }) : null,
            h('div', {}, h('b', {}, b.title), b.note ? h('p', { class: 'cp-muted cp-small' }, b.note) : null, cp.safeUrl(b.url) ? h('a', { class: 'btn btn--ghost btn--sm', href: cp.safeUrl(b.url), target: '_blank', rel: 'noopener noreferrer' }, file ? 'Open the original' : 'Watch') : null),
          );
        }),
      ),
    );
  }

  /*
   * A link per video or niche. The tag on the end says which one a visitor
   * came from, so the creator can see which of their videos actually sells.
   */
  function linksCard(data) {
    const { creator } = data;
    const links = data.links || [];
    const clean = (value) => value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    const linkOf = (tag) => `https://getmindroll.com/start/?ref=${creator.code}${tag ? `&v=${tag}` : ''}`;
    const input = h('input', { class: 'cp-input', placeholder: 'Name it, e.g. morning-hook', maxlength: '24', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Name for the link' });
    const out = h('code', { class: 'cp-mono' }, linkOf('').replace('https://', ''));
    const copy = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Copy');
    input.addEventListener('input', () => { out.textContent = linkOf(clean(input.value)).replace('https://', ''); });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(linkOf(clean(input.value)));
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1600);
      } catch {
        toast('Copy it by hand: select the text.', 'error');
      }
    });
    return section(
      'A link for each video',
      h('span', { class: 'cp-muted' }, 'See which one sells'),
      h('p', { class: 'cp-muted' }, 'Give a video or a niche its own link. Clicks, sign-ups and what you earned are then counted for that link by itself.'),
      h('div', { class: 'cp-copyrow' }, input, out, copy),
      links.length
        ? table(
            [
              { label: 'Link', cell: (row) => h('code', { class: 'cp-mono' }, row.tag) },
              { label: 'Clicks', num: true, cell: (row) => num(row.clicks) },
              { label: 'Signed up', num: true, cell: (row) => num(row.signups) },
              { label: 'Subscribed', num: true, cell: (row) => num(row.customers) },
              { label: 'You earned', num: true, cell: (row) => h('b', {}, cp.dollars(row.commission_cents)) },
              { label: '', cell: (row) => copyButton(linkOf(row.tag), 'Copy link') },
            ],
            [...links].sort((x, y) => y.commission_cents - x.commission_cents || y.clicks - x.clicks),
            '',
          )
        : null,
    );
  }

  /* Bring in another creator: the link to share, what it pays, and how each one is doing. */
  function referralCard(data) {
    const r = data.referrals;
    if (!r || !(r.bonus_cents > 0)) return null;
    const link = `https://getmindroll.com/creators/?invite=${r.code}`;
    const goal = Number(r.views || 0);
    const list = r.creators || [];
    const accepted = list.filter((c) => c.status === 'active');
    const paid = list.filter((c) => c.paid);
    const stage = (c) => (c.paid ? 3 : c.status !== 'active' ? 0 : Number(c.views) >= goal ? 2 : 1);
    const tile = (tone, label, value, foot) => h('div', { class: 'mr-tile', 'data-tone': tone }, h('span', { class: 'mr-tile__label' }, label), h('b', { class: 'mr-tile__value' }, value), foot ? h('span', { class: 'mr-tile__foot' }, foot) : null);
    const row = (c) => {
      const at = stage(c);
      const share = Math.max(0, Math.min(1, Number(c.views) / (goal || 1)));
      const STEPS = ['Applied', 'Accepted', `${compact(goal)} views`, `${cp.dollars(r.bonus_cents)} paid`];
      return h(
        'li',
        { class: 'mr-ref__row', 'data-done': c.paid ? '' : null },
        h('div', { class: 'mr-ref__who' }, h('b', {}, c.name), c.paid ? pill(`${cp.dollars(r.bonus_cents)} paid`, 'good') : c.status !== 'active' ? pill('Waiting for approval', 'warn') : pill(`${compact(Math.max(0, goal - Number(c.views)))} views to go`, 'muted')),
        h('ol', { class: 'mr-ref__steps' }, STEPS.map((label, i) => h('li', { 'data-on': i === 0 || i <= at ? '' : null }, label))),
        h('div', { class: 'mr-ref__bar', role: 'img', 'aria-label': `${compact(c.views)} of ${compact(goal)} views` }, h('i', { style: `width:${((c.paid ? 1 : share) * 100).toFixed(1)}%` })),
        h('span', { class: 'cp-muted cp-small' }, `${compact(c.views)} / ${compact(goal)} views across their videos`),
      );
    };
    return [
      h(
        'section',
        { class: 'mr-briefhero mr-ref__hero' },
        h('p', { class: 'mr-brief__eyebrow' }, 'Invite a creator'),
        h('h2', {}, `Get ${cp.dollars(r.bonus_cents)} for every creator you bring in`),
        h('p', {}, `Share your invite link. When they join, get accepted and their videos reach ${compact(goal)} views in total, ${cp.dollars(r.bonus_cents)} goes into your wallet.`),
        h('div', { class: 'cp-copyrow' }, h('code', { class: 'cp-mono' }, link.replace('https://', '')), copyButton(link, 'Copy')),
      ),
      h(
        'section',
        { class: 'mr-panel mr-ref__how' },
        h('ol', {}, h('li', {}, h('b', {}, '1'), h('span', {}, 'They apply with your link')), h('li', {}, h('b', {}, '2'), h('span', {}, 'They get accepted')), h('li', {}, h('b', {}, '3'), h('span', {}, `Their videos reach ${compact(goal)} views`)), h('li', { 'data-pay': '' }, h('b', {}, cp.dollars(r.bonus_cents)), h('span', {}, 'lands in your wallet'))),
      ),
      h('div', { class: 'mr-grid' }, tile('paper', 'Invited', num(list.length), 'applied with your link'), tile('paper', 'Accepted', num(accepted.length), 'in the program'), tile('paper', 'Paid out', num(paid.length), `reached ${compact(goal)} views`), tile('amber', 'Earned from invites', cp.dollars(r.earned_cents || 0), `${cp.dollars(r.bonus_cents)} each`)),
      h('section', { class: 'mr-panel' }, h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Creators you invited'), h('b', {}, num(list.length))), list.length ? h('ul', { class: 'mr-ref__list' }, list.map(row)) : h('p', { class: 'cp-muted' }, 'Nobody yet. Send your link to a creator and they will show up here the moment they apply.')),
    ];
  }

  /* What the creator has won in campaigns over the last two weeks, added up. It is already in their wallet. */
  function winsCard(data) {
    const wins = (data.bonuses || []).filter((b) => ['contest', 'prize', 'top_video'].includes(b.kind) && Date.now() - new Date(b.created_at).getTime() < 14 * 864e5);
    if (!wins.length) return null;
    const total = wins.reduce((sum, b) => sum + b.amount_cents, 0);
    return h(
      'section',
      { class: 'mr-panel mr-wins' },
      h('div', { class: 'mr-panel__head' }, h('h2', {}, 'Your wins, last 2 weeks'), h('b', {}, cp.dollars(total))),
      h('ul', { class: 'mr-leaders' }, wins.map((b, i) => h('li', {}, h('i', {}, String(i + 1)), h('span', {}, h('b', {}, b.label), h('small', {}, ago(b.created_at))), h('b', {}, `+${cp.dollars(b.amount_cents)}`)))),
      h('div', { class: 'mr-wins__foot' }, h('span', {}, `${wins.length} win${wins.length === 1 ? '' : 's'} · ${cp.dollars(total)} added to your wallet`), h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => openPane('wallet') }, 'Open wallet')),
    );
  }

  /* Campaigns the team runs by hand: a set format, a deadline, fixed prizes. */
  function contestCards(data) {
    const timeLeft = (iso) => {
      const hours = Math.max(0, (new Date(iso).getTime() - Date.now()) / 36e5);
      return hours >= 48 ? `${Math.round(hours / 24)} days left` : hours >= 1 ? `${Math.round(hours)} h left` : `${Math.max(1, Math.round(hours * 60))} min left`;
    };
    return (data.contests || []).map((k) => {
      const fmt = k.metric === 'views' ? compact : num;
      const bySubs = k.metric === 'subs';
      const judging = !k.open && !k.upcoming && !k.settled;
      const when = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      const join = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Join campaign');
      const REPLY = { wrong_tier: 'This campaign is for another tier.', ended: 'This campaign has ended.', not_active: 'Your creator account is not active.', not_checked: `We have not checked your account yet. Put your link and mindroll-${data.creator.code} in your bio and we will check it.` };
      join.addEventListener(
        'click',
        act(join, async () => {
          if (cp.demo) throw new Error('This is a preview, so nothing was joined.');
          const reply = await cp.rpc('creator_join_contest', { p_contest: k.id });
          if (reply !== 'joined') throw new Error(REPLY[reply] || 'That did not go through.');
          toast('You are in. Post in the format and your videos show up here.');
          await load();
        }),
      );
      const ref = cp.safeUrl(k.reference_url);
      return h(
        'section',
        { class: 'cp-card cp-camp', 'data-joined': k.joined || null },
        h('div', { class: 'cp-card__head' }, cp.figure(k.upcoming ? 'Starting soon' : k.open ? 'Live campaign' : k.settled ? 'Finished' : 'Ended, counting the results', k.title), k.upcoming ? pill(`Starts ${when(k.starts_at)}`, 'warn') : k.open ? pill(timeLeft(k.ends_at), 'good') : k.settled ? pill('Paid', 'good') : pill(`Winners paid from ${when(k.pay_from)}`, 'warn')),
        h('ul', { class: 'cp-prizes' }, k.prizes.map((cents, i) => h('li', {}, h('span', { class: 'cp-muted' }, ordinal(i + 1)), h('b', {}, cp.dollars(cents))))),
        h('p', { class: 'cp-rowlabel' }, h('b', {}, 'To win')),
        h(
          'ul',
          { class: 'cp-needs' },
          h('li', { 'data-ok': true }, h('span', { 'aria-hidden': 'true' }, '•'), bySubs ? 'Most new subscribers through your link wins' : k.metric === 'views' ? 'Most views across your videos wins' : 'Most videos posted wins, and there is no limit on how many you post'),
          bySubs ? h('li', { 'data-ok': true }, h('span', { 'aria-hidden': 'true' }, '•'), 'Everyone who subscribes through your link while it is running counts; refunds do not') : h('li', { 'data-ok': true }, h('span', { 'aria-hidden': 'true' }, '•'), `Each video needs ${compact(k.min_views)} views to count, and views keep counting until ${when(k.pay_from)}`),
          k.require_checked ? h('li', { 'data-ok': data.creator.handle_verified || null }, h('span', { 'aria-hidden': 'true' }, data.creator.handle_verified ? '✓' : '○'), `Your link and mindroll-${data.creator.code} in your bio, checked by us`) : null,
          k.rules ? h('li', { 'data-ok': true }, h('span', { 'aria-hidden': 'true' }, '•'), k.rules) : null,
          ref ? h('li', { 'data-ok': true }, h('span', { 'aria-hidden': 'true' }, '•'), h('span', {}, 'Follow this format: ', h('a', { href: ref, target: '_blank', rel: 'noopener noreferrer' }, 'watch the reference video'))) : null,
          bySubs ? null : h('li', { 'data-ok': true }, h('span', { 'aria-hidden': 'true' }, '•'), 'We check each video against the format before it counts'),
          h('li', { 'data-ok': true }, h('span', { 'aria-hidden': 'true' }, '•'), 'Prizes go into your wallet'),
        ),
        k.joined && bySubs
          ? h('p', { class: 'cp-rowlabel' }, h('b', {}, 'You are in'), h('span', { class: 'cp-muted' }, k.place ? `You are ${ordinal(k.place)} with ${num(k.score)} new subscriber${Number(k.score) === 1 ? '' : 's'}` : k.upcoming ? 'It has not started yet' : 'No subscribers yet'))
          : k.joined
          ? [
              h('p', { class: 'cp-rowlabel' }, h('b', {}, 'Your videos in this campaign'), h('span', { class: 'cp-muted' }, k.place ? `You are ${ordinal(k.place)} with ${fmt(k.score)}` : 'Not scored yet')),
              k.videos.length
                ? h('ul', { class: 'cp-winners' }, k.videos.map((v) => h('li', {}, h('span', {}, h('b', {}, v.title || 'Your video')), h('span', { class: 'cp-muted' }, `${compact(v.views)} views`), v.approved ? (v.views >= k.min_views ? pill('Counts', 'good') : pill(`Needs ${compact(k.min_views)} views`, 'warn')) : pill('Being checked', 'warn'))))
                : h('p', { class: 'cp-empty' }, `Nothing yet. Post with ${tagOf(data)} before it ends and the video appears here.`),
            ]
          : k.open || k.upcoming
            ? h('div', { class: 'cp-card__foot' }, join, h('span', { class: 'cp-muted cp-small' }, `${num(k.entrants)} joined`))
            : null,
        k.settled ? null : h('p', { class: 'cp-muted cp-small' }, judging ? 'Posting has closed. Results are counted for a little longer so late views and refunds are included.' : 'The better these campaigns do, the bigger the prizes in the next ones.'),
        k.results.length
          ? [h('p', { class: 'cp-rowlabel' }, h('b', {}, 'Winners')), h('ul', { class: 'cp-winners' }, k.results.map((row) => h('li', { 'data-mine': row.you || null }, h('span', { class: 'cp-muted' }, ordinal(row.place)), h('span', {}, h('b', {}, row.name, row.you ? ' (you)' : '')), h('span', { class: 'cp-muted' }, fmt(row.score)), h('b', {}, cp.dollars(row.prize_cents)))))]
          : k.top.length
            ? cp.hbars(k.top.slice(0, 5).map((row) => ({ label: `${row.place}. ${row.name}${row.you ? ' (you)' : ''}`, value: Number(row.score), color: row.you ? cp.COLOR.ready : cp.COLOR.paid })), fmt)
            : null,
      );
    });
  }

  /* The best video across every creator, for today, this week and this month. */
  function topVideosCard(data) {
    const top = data.top_videos;
    if (!top) return null;
    const slot = (label, list) => {
      const video = (list || [])[0];
      if (!video) return h('div', { class: 'cp-topvid' }, h('p', { class: 'cp-figure__label' }, label), h('p', { class: 'cp-muted cp-small' }, 'No video yet. It could be yours.'));
      const href = cp.safeUrl(video.url);
      const title = video.title || `${cp.PLATFORM[video.platform]} video`;
      return h('div', { class: 'cp-topvid', 'data-mine': video.creator_id === data.creator.id || null }, h('p', { class: 'cp-figure__label' }, label), h('p', { class: 'cp-topvid__views' }, `+${compact(video.gained)}`, h('small', {}, ' views')), href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, title) : h('span', {}, title), h('p', { class: 'cp-muted cp-small' }, `${video.creator}${video.creator_id === data.creator.id ? ' (you)' : ''} · ${cp.PLATFORM[video.platform]}`));
    };
    const w = data.top_video_winners;
    const won = (w?.winners || []).length
      ? [
          h('p', { class: 'cp-rowlabel' }, h('b', {}, 'Last week\'s winners'), h('span', { class: 'cp-muted' }, 'Paid into their wallets')),
          h('ul', { class: 'cp-winners' }, w.winners.map((row) => h('li', { 'data-mine': row.creator_id === data.creator.id || null }, h('span', { class: 'cp-muted' }, ordinal(row.place)), h('span', {}, h('b', {}, row.creator, row.creator_id === data.creator.id ? ' (you)' : ''), cp.safeUrl(row.url) ? h('a', { href: cp.safeUrl(row.url), target: '_blank', rel: 'noopener noreferrer' }, row.title || 'Watch the video') : null), h('span', { class: 'cp-muted' }, `+${compact(row.gained)} views`), h('b', {}, cp.dollars(row.prize_cents))))),
        ]
      : null;
    const rule = w ? h('p', { class: 'cp-muted cp-small' }, `Every week the top ${w.split.length} videos win a prize. A video needs ${compact(w.min_views)} views in the week to qualify.`) : null;
    return section('Top videos', pill('Weekly', 'good'), h('div', { class: 'cp-three' }, slot('Today', top.day), slot('This week', top.week), slot('This month', top.month)), won, rule);
  }

  /*
   * Campaigns: this week's three leaderboards for the creator's tier. Each has
   * a prize for its top places, a Join button, and where everyone stands.
   */
  const BOARDS = { videos: ['Most videos posted', num, 'videos'], views: ['Most views', compact, 'views'], sales: ['Most earned from sales', cp.dollars, 'earned'] };
  function campaignsView(data) {
    const k = data.campaigns;
    if (!k) return [h('p', { class: 'cp-empty' }, 'Campaigns are not set up yet.')];
    const inc = data.incentives;
    const scale = k.scale == null ? 1 : Number(k.scale);
    const full = (place) => Math.round((((k.pool_cents || 0) / 3) * (k.split[place - 1] || 0)) / 100);
    const now = (place) => Math.floor(full(place) * scale);
    const hours = Math.max(0, Math.round((new Date(k.ends_at).getTime() - Date.now()) / 36e5));
    const left = hours >= 48 ? `${Math.round(hours / 24)} days left` : hours >= 1 ? `${hours} h left` : 'Ends within the hour';
    const need = (ok, text) => h('li', { 'data-ok': ok || null }, h('span', { 'aria-hidden': 'true' }, ok ? '✓' : '○'), text);
    const hasPool = k.pool_cents > 0;
    const boardRate = (inc.tiers.find((t) => t.level === k.tier_level) || {}).commission_rate ?? 0.1;
    const joinedAny = k.boards.some((b) => b.joined);

    const head = h(
      'section',
      { class: 'cp-card' },
      h('div', { class: 'cp-card__head' }, cp.figure(`${k.tier_name} tier campaigns`, hasPool ? left : 'Locked'), k.live ? pill('Live', 'good') : pill(hasPool ? `${k.in_tier} of ${k.min_creators} creators` : 'Not open yet', 'warn')),
      h('p', { class: 'cp-rowlabel' }, h('b', {}, 'To join')),
      h(
        'ul',
        { class: 'cp-needs' },
        need(hasPool, hasPool ? `Hold ${k.tier_name}` : `Reach ${k.unlock?.name || 'the next tier'}${k.unlock ? `: ${cp.dollars(earned(k.unlock.min_revenue_cents))} in commission over 30 days` : ''}`),
        need(k.live, `${k.min_creators} creators in your tier${hasPool ? ` (${k.in_tier} so far)` : ''}`),
        need(joinedAny, 'Press Join on a campaign below'),
      ),
      !hasPool && k.unlock ? progress(`Commission towards ${k.unlock.name}`, earned(inc.window_revenue_cents || 0), earned(k.unlock.min_revenue_cents), cp.dollars) : null,
      h('p', { class: 'cp-muted cp-small' }, hasPool ? `Three campaigns run at a time and each lasts two weeks. The top ${k.split.length} in each win a prize, paid into your wallet when it ends. Rank up while one is running and you move straight onto the higher tier's boards with everything you have scored, for its bigger prizes.` : `Campaigns start at ${k.unlock?.name || 'the next tier'}: three leaderboards every two weeks with prizes for the top ${k.split.length}${k.unlock ? `, up to ${cp.dollars(k.unlock.pool_cents)} between them` : ''}.`),
    );
    /* What every tier's three weekly campaigns pay, place by place, with the week's total. */
    const prizeCards = inc.tiers.filter((t) => t.campaign_pool_cents > 0).map((t) => {
      const each = (place) => Math.round(((t.campaign_pool_cents / 3) * (k.split[place - 1] || 0)) / 100);
      const spots = k.split.map((_, i) => i + 1);
      const perBoard = Math.round(t.campaign_pool_cents / 3);
      return h(
        'section',
        { class: 'cp-card', 'data-mine': t.level === k.tier_level || null },
        h('div', { class: 'cp-card__head' }, cp.figure(`${t.name} campaigns`, `${cp.dollars(t.campaign_pool_cents)} every two weeks`, true), pill('Every 2 weeks', 'good')),
        h(
          'div',
          { class: 'cp-tablewrap' },
          h(
            'table',
            { class: 'cp-table' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Campaign'), spots.map((place) => h('th', { scope: 'col', class: 'is-num' }, `${ordinal(place)} place`)), h('th', { scope: 'col', class: 'is-num' }, 'Each campaign'))),
            h('tbody', {}, Object.values(BOARDS).map(([title]) => h('tr', {}, h('th', { scope: 'row' }, title), spots.map((place) => h('td', { class: 'is-num' }, cp.dollars(each(place)))), h('td', { class: 'is-num' }, h('b', {}, cp.dollars(perBoard)))))),
            h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'All three together'), spots.map((place) => h('td', { class: 'is-num' }, h('b', {}, cp.dollars(Math.round((t.campaign_pool_cents * (k.split[place - 1] || 0)) / 100))))), h('td', { class: 'is-num' }, h('b', {}, cp.dollars(t.campaign_pool_cents))))),
          ),
        ),
        h('p', { class: 'cp-muted cp-small' }, `New campaigns start every second Monday. Hold ${t.name} (${cp.dollars(earned(t.min_revenue_cents, (inc.tiers.find((x) => x.level === t.level - 1) || t).commission_rate))} in commission over 30 days) to play for these.`),
      );
    });
    const prizeNote = h('p', { class: 'cp-muted cp-small' }, 'Prizes are paid when a campaign ends, from the program\'s prize fund, so one can pay less than shown while the fund is small.');
    if (!hasPool) return [winsCard(data), ...contestCards(data), head, ...prizeCards, prizeNote].filter(Boolean);

    const card = (b) => {
      const [title, rawFmt, unit] = BOARDS[b.board];
      const fmt = b.board === 'sales' ? (v) => cp.dollars(earned(v, boardRate)) : rawFmt;
      const join = h('button', { class: 'btn btn--primary btn--sm', type: 'button', disabled: !k.live }, 'Join campaign');
      const REPLY = { not_live: `This opens when ${k.min_creators} creators hold ${k.tier_name}.`, locked: 'Your tier has no campaigns yet.', not_active: 'Your creator account is not active.' };
      join.addEventListener(
        'click',
        act(join, async () => {
          if (cp.demo) throw new Error('This is a preview, so nothing was joined.');
          const reply = await cp.rpc('creator_join_campaign', { p_board: b.board });
          if (reply !== 'joined') throw new Error(REPLY[reply] || 'That did not go through.');
          toast('You are in. Good luck.');
          await load();
        }),
      );
      const places = k.split.map((_, i) => i + 1);
      return h(
        'section',
        { class: 'cp-card cp-camp', 'data-joined': b.joined || null },
        h('div', { class: 'cp-card__head' }, h('h2', {}, title), b.joined ? pill(b.place ? `You are ${ordinal(b.place)}` : 'Joined', 'good') : null),
        h('ul', { class: 'cp-prizes' }, places.map((place) => h('li', {}, h('span', { class: 'cp-muted' }, ordinal(place)), h('b', {}, cp.dollars(now(place)))))),
        scale < 1 ? h('p', { class: 'cp-muted cp-small' }, `An estimate for this campaign, set for good when it ends. Up to ${places.map((place) => cp.dollars(full(place))).join(' / ')} as the program's sales grow.`) : null,
        b.joined ? h('p', { class: 'cp-rowlabel cp-small' }, h('span', {}, 'Your score so far'), h('b', {}, `${fmt(b.score)} ${unit}`)) : h('div', { class: 'cp-card__foot' }, join, h('span', { class: 'cp-muted cp-small' }, `${num(b.entrants)} joined`)),
        b.top.length
          ? cp.hbars(b.top.slice(0, 5).map((row) => ({ label: `${row.place}. ${row.name}${row.you ? ' (you)' : ''}`, value: Number(row.score), color: row.you ? cp.COLOR.ready : cp.COLOR.paid })), fmt)
          : h('p', { class: 'cp-empty' }, 'Nobody has scored yet.'),
      );
    };

    const last = k.last || [];
    return [
      winsCard(data),
      ...contestCards(data),
      head,
      h('div', { class: 'cp-three cp-three--cards' }, k.boards.map(card)),
      last.length
        ? section(
            'Last campaign\'s winners',
            h('span', { class: 'cp-muted' }, k.tier_name),
            table(
              [
                { label: 'Campaign', cell: (row) => BOARDS[row.board][0] },
                { label: 'Place', cell: (row) => ordinal(row.place) },
                { label: 'Creator', cell: (row) => h('b', {}, row.name, row.you ? ' (you)' : '') },
                { label: 'Score', num: true, cell: (row) => (row.board === 'sales' ? cp.dollars(earned(row.score, boardRate)) : BOARDS[row.board][1](row.score)) },
                { label: 'Prize', num: true, cell: (row) => h('b', {}, cp.dollars(row.prize_cents)) },
              ],
              last,
              '',
            ),
          )
        : null,
      h('h2', { class: 'cp-subhead' }, 'What every tier plays for, each week'),
      ...prizeCards,
      prizeNote,
    ].filter(Boolean);
  }

  /*
   * The pay structure: every tier side by side. One small chart per measure,
   * each on its own scale, with the creator's own tier marked.
   */
  function payView(data) {
    const inc = data.incentives;
    const tiers = inc.tiers;
    const mine = inc.tier_level;
    const mult = (t) => Number(t.bonus_multiplier ?? 1);
    const baseActive = inc.active.base_amount_cents ?? inc.active.amount_cents;
    const baseRules = inc.volume.rules.map((rule) => ({ min: rule.min_videos, cents: rule.base_amount_cents ?? rule.amount_cents }));
    const volumeAll = (t) => baseRules.reduce((sum, rule) => sum + Math.round(rule.cents * mult(t)), 0);
    /* A month at each tier's own sales goal: what the tier is built to pay. */
    const WEEKS = 4, days = inc.window_days || 30;
    /* Iron has no goal; $600 is about where its own posting bonuses are fully covered. */
    const salesOf = (t) => t.min_revenue_cents || 60000;
    const sample = (t) => [
      { label: 'Commission', value: Math.round(salesOf(t) * t.commission_rate), color: cp.COLOR.ready },
      { label: 'Posting bonuses', value: WEEKS * Math.round(baseActive * mult(t)) + volumeAll(t), color: cp.COLOR.wait, dark: true },
    ];
    const total = (t) => sample(t).reduce((sum, part) => sum + part.value, 0);
    const champ = inc.champion?.slots > 0 ? inc.champion : null;
    const topTier = tiers[tiers.length - 1];

    /*
     * Laid out as a rate sheet, from the Figma design: one ruled row per tier,
     * highest first, with the creator's own row marked. Type and two colours
     * do the work; there are no cards, badges or pills here.
     */
    const isChamp = !!champ?.is;
    const me = tiers.find((t) => t.level === mine) || tiers[0];
    const next = isChamp ? null : tiers.find((t) => t.level === mine + 1);
    const gap = next ? barsOf(inc, next).map(([label, have, need, fmt, unit]) => ({ label, left: Math.max(0, need - have), fmt, unit })).filter((row) => row.left > 0) : [];
    const sales = gap.find((row) => row.label === 'Commission');
    const others = gap.filter((row) => row.label !== 'Commission');
    const steps = [...tiers.map((t) => ({ name: t.name, rate: t.commission_rate, now: t.level === mine && !isChamp, done: t.level < mine || isChamp })), ...(champ ? [{ name: 'Champion', rate: champ.rate, now: isChamp, done: false }] : [])];
    const at = Math.max(0, steps.findIndex((step) => step.now));

    const COLS = ['Each new yearly subscriber', 'Active week', 'Posting, a month', 'Rank-up', 'Campaigns, every 2 weeks'];
    const cellsOf = (t, rankUp) => [
      cp.dollars(t.annual_flat_cents ?? inc.annual_bonus_cents ?? 0),
      baseActive > 0 ? cp.dollars(Math.round(baseActive * mult(t))) : null,
      baseActive > 0 || baseRules.length ? `up to ${cp.dollars(WEEKS * Math.round(baseActive * mult(t)) + volumeAll(t))}` : null,
      rankUp,
      t.campaign_pool_cents > 0 ? `up to ${cp.dollars(t.campaign_pool_cents)}` : null,
    ];
    const sheetRow = ({ name, need, rate, cells, flag, kind }) =>
      h(
        'tr',
        { 'data-kind': kind || null },
        h('th', { scope: 'row' }, h('span', { class: 'cp-sheet__name' }, name, flag ? h('em', {}, flag) : null), h('span', { class: 'cp-sheet__need' }, need)),
        h('td', { class: 'cp-sheet__rate', 'data-label': 'Commission' }, pct(rate)),
        cells.map((value, i) => h('td', { 'data-label': COLS[i], 'data-empty': value == null || null }, value ?? '–')),
      );
    const rows = [
      champ && topTier ? sheetRow({ name: 'Champion', need: `The ${champ.slots} top-earning ${topTier.name} creators. Nothing else to hit.`, rate: champ.rate, cells: [cellsOf(topTier)[0], null, champ.daily_cents > 0 ? `up to ${cp.dollars(champ.daily_cents * 30)}` : null, champ.daily_cents > 0 ? `${cp.dollars(champ.daily_cents)} each day you post` : null, cellsOf(topTier)[4]], flag: isChamp ? 'You are here' : null, kind: isChamp ? 'champ you' : 'champ' }) : null,
      ...[...tiers].reverse().map((t) => sheetRow({ name: t.name, need: t.level > 1 ? [t.min_revenue_cents > 0 && `${cp.dollars(earned(t.min_revenue_cents, (tiers.find((x) => x.level === t.level - 1) || t).commission_rate))} in commission`, t.min_views > 0 && `${compact(t.min_views)} views`, t.min_posts > 0 && `${num(t.min_posts)} videos`].filter(Boolean).join(' · ') : 'Where everyone starts', rate: t.commission_rate, cells: cellsOf(t, t.rank_up_bonus_cents > 0 ? cp.dollars(t.rank_up_bonus_cents) : null), flag: t.level === mine && !isChamp ? 'You are here' : next && t.level === next.level ? 'Next' : null, kind: t.level === mine && !isChamp ? 'you' : null })),
    ];
    const most = Math.max(1, ...tiers.map(total));

    return [
      h(
        'section',
        { class: 'cp-sheetpage' },
        h(
          'div',
          { class: 'cp-sheethead' },
          h('div', {}, h('p', { class: 'cp-kicker' }, 'Pay structure'), h('h2', { class: 'cp-sheethead__title' }, `You’re ${isChamp ? 'a Champion' : me.name}.`), h('p', { class: 'cp-sheethead__lead' }, `${pct(data.creator.rate)} of every sale, for as long as your subscribers stay.`)),
          next
            ? h('div', { class: 'cp-sheethead__next' }, h('p', { class: 'cp-kicker' }, `Next: ${next.name}`), h('p', { class: 'cp-sheethead__gap' }, sales ? `${cp.dollars(Math.ceil(sales.left / 100) * 100)} to go` : others.length ? `${others[0].fmt(others[0].left)} ${others[0].unit} to go` : 'Almost there'), h('p', { class: 'cp-muted cp-small' }, sales ? `in commission over your last ${days} days${others.length ? `, plus ${others.map((row) => `${row.fmt(row.left)} ${row.unit}`).join(' and ')}` : ''}` : `over your last ${days} days`))
            : champ && champ.place && !isChamp
              ? h('div', { class: 'cp-sheethead__next' }, h('p', { class: 'cp-kicker' }, 'Next: Champion'), h('p', { class: 'cp-sheethead__gap' }, `${ordinal(champ.place)} in ${me.name}`), h('p', { class: 'cp-muted cp-small' }, `The top ${champ.slots} earners are Champions`))
              : null,
        ),
        h('div', { class: 'cp-climbline', style: `--at:${(((at + 0.5) / steps.length) * 100).toFixed(2)}%` }, h('ol', {}, steps.map((step) => h('li', { 'data-now': step.now || null, 'data-done': step.done || null }, h('b', {}, step.name), h('span', {}, pct(step.rate)))))),
        h(
          'div',
          { class: 'cp-tablewrap' },
          h('table', { class: 'cp-sheet' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Tier'), h('th', { scope: 'col' }, 'Commission'), COLS.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows)),
        ),
        h('p', { class: 'cp-sheetnote' }, `Your tier follows your last ${days} days: reach a tier’s commission, views and videos and you move up straight away. Commission is a share of every sale, weekly or yearly; a new yearly subscriber pays the flat amount on top.${baseRules.length ? ` Posting pays at ${baseRules.map((rule) => rule.min).join(', ')} videos in a month.` : ''} Rank up part-way through an active week and the days you have done are paid straight away. An active week is one where you post on ${inc.active.min_days} different days, and a day counts once that day’s videos reach ${tiers.map((t) => `${compact(t.active_day_views ?? 1000)} (${t.name})`).join(', ')} views between them.${champ ? ` A Champion is paid ${cp.dollars(champ.daily_cents)} for each day they post a video, in place of the active week.` : ''}${champ ? ' Champion pay and campaign prizes are paid from the program’s prize fund and can be lower while it is small.' : ''}`),

        h('p', { class: 'cp-kicker cp-kicker--gap' }, 'A month at each tier'),
        h('h2', { class: 'cp-sheethead__sub' }, 'Hit your tier’s goal, post every week.'),
        h('div', { class: 'cp-monthbars', role: 'img', 'aria-label': tiers.map((t) => `${t.name} ${cp.dollars(total(t))}`).join(', ') }, tiers.map((t) => h('div', { 'data-you': (t.level === mine && !isChamp) || null }, h('b', {}, cp.dollars(total(t))), h('i', { style: `--h:${Math.max(0.03, total(t) / most).toFixed(3)}` }), h('span', {}, t.name), h('small', {}, `${pct(t.commission_rate)} commission`)))),
        h('p', { class: 'cp-sheetnote' }, `Commission at the tier’s goal plus ${WEEKS} active weeks. View bonuses, yearly subscribers and the rank-up bonus are on top.${inc.margin?.rate != null ? ' Bonuses are paid out of the sales you bring in: reach one before your sales cover it and it waits, then pays by itself.' : ''}`),
      ),
    ];
  }

  const planName = (id) => (/week/i.test(id || '') ? 'Weekly' : /annual|year/i.test(id || '') ? 'Annual' : id || 'Pro');

  /* Commission and bonuses, added up into the last eight weeks. */
  function weekly(data) {
    const WEEK = 7 * 864e5;
    const end = Date.now();
    const buckets = Array.from({ length: 8 }, (_, i) => ({ start: end - (8 - i) * WEEK, value: 0 }));
    const add = (iso, cents) => {
      const i = Math.floor((new Date(iso).getTime() - buckets[0].start) / WEEK);
      if (i >= 0 && i < 8) buckets[i].value += cents;
    };
    data.commissions.forEach((row) => add(row.occurred_at, row.amount_cents));
    data.bonuses.forEach((row) => add(row.created_at, row.amount_cents));
    return buckets.map((bucket, i) => ({
      label: i === 7 ? 'This week' : new Date(bucket.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      value: Math.max(0, bucket.value),
    }));
  }

  function copyButton(value, label) {
    const button = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, label);
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = label), 1600);
      } catch {
        toast('Copy it by hand: select the text.', 'error');
      }
    });
    return button;
  }

  /* How the creator is paid (PayPal, Venmo or Zelle) and the cash-out button, under the wallet. */
  const METHODS = { paypal: ['PayPal', 'PayPal email'], venmo: ['Venmo', '@username'], zelle: ['Zelle', 'Phone number or email'] };
  let editingPayout = false;
  function payoutFoot(data) {
    const { creator } = data;
    if (!creator.payout_handle || editingPayout) {
      const method = h('select', { class: 'cp-input', 'aria-label': 'How to pay you' }, Object.entries(METHODS).map(([id, [label]]) => h('option', { value: id, selected: id === (creator.payout_method || 'venmo') }, label)));
      const handle = h('input', { class: 'cp-input', maxlength: '120', value: creator.payout_handle || '', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Your account' });
      const hint = () => { handle.placeholder = METHODS[method.value][1]; };
      method.addEventListener('change', hint);
      hint();
      const save = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Save');
      save.addEventListener(
        'click',
        act(save, async () => {
          if (handle.value.trim().length < 3) throw new Error('Enter the account to send your money to.');
          if (cp.demo) throw new Error('This is a preview, so nothing was saved.');
          const reply = await cp.rpc('creator_set_payout', { p_method: method.value, p_handle: handle.value });
          if (reply !== 'saved') throw new Error('That did not save. Check the account and try again.');
          editingPayout = false;
          toast('Saved. That is where we will send your money.');
          await load();
        }),
      );
      return h('div', { class: 'cp-card__foot' }, h('span', { class: 'cp-muted cp-small' }, 'Get paid by'), method, handle, save);
    }
    const min = data.settings.min_payout_cents || 0;
    const ready = data.balance.available_cents >= Math.max(min, 1);
    const cash = h('button', { class: 'btn btn--primary btn--sm', type: 'button', disabled: !ready || creator.payout_hold }, 'Cash out');
    const REPLY = { below_minimum: `You can cash out from ${cp.dollars(min)}.`, no_bank: 'Tell us how to pay you first.', not_active: 'Your creator account is not active.', on_hold: 'Your payouts are on hold while we check your account.' };
    cash.addEventListener(
      'click',
      act(cash, async () => {
        const reply = await cp.rpc('creator_request_cashout');
        if (reply !== 'requested') throw new Error(REPLY[reply] || 'That did not go through.');
        toast(`Cash-out requested. We will send it by ${METHODS[creator.payout_method]?.[0] || 'your chosen method'}.`);
        await load();
      }),
    );
    const change = h('button', { class: 'cp-link', type: 'button', onclick: () => { editingPayout = true; renderDashboard(lastData); } }, 'Change');
    return h(
      'div',
      { class: 'cp-card__foot' },
      creator.cashout_requested_at ? pill('Cash-out requested', 'warn') : cash,
      !creator.cashout_requested_at && !ready ? h('span', { class: 'cp-muted cp-small' }, `Cash out from ${cp.dollars(min)}`) : null,
      h('span', { class: 'cp-muted cp-small' }, `${METHODS[creator.payout_method]?.[0] || 'Paid'} · ${creator.payout_handle}`),
      change,
    );
  }

  /*
   * Ask Stripe whether the account can be paid yet, then redraw if that changed.
   *
   * Not only on the way back from onboarding: Stripe often finishes verifying
   * minutes or days later, so an unfinished account is re-checked on every visit.
   */
  async function settleStripeReturn(data) {
    const back = new URLSearchParams(location.search).get('stripe');
    if (back) history.replaceState(null, '', location.pathname);
    if (!back && !(data.creator.stripe_connected && !data.creator.payouts_enabled)) return;
    try {
      if (back === 'refresh') {
        const out = await cp.fn('creator-connect', { action: 'onboard' });
        if (out.url) location.href = out.url;
        return;
      }
      const out = await cp.fn('creator-connect', { action: 'status' });
      if (back) toast(out.payouts_enabled ? 'Payouts are set up.' : 'Stripe still needs a few details.', out.payouts_enabled ? 'ok' : 'error');
      if (out.payouts_enabled !== data.creator.payouts_enabled) await load();
    } catch (error) {
      if (back) toast(error.message, 'error');
    }
  }

  function viewsCard(data) {
    const days = (data.views_daily || []).map((d) => ({ label: day(d.day).replace(/ \d{4}$/, ''), value: Number(d.views) }));
    const body = days.some((d) => d.value > 0)
      ? cp.timeChart('line', days, num, 'Total video views', compact)
      : h('p', { class: 'cp-empty' }, `Your views are charted here once you post with ${tagOf(data)}.`);
    return h('section', { class: 'cp-card' }, cp.figure('Video views', compact(data.stats.views)), body);
  }

  /* "12 min ago", for how fresh the numbers are. */
  function ago(iso) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 60 * 36) return `${Math.round(mins / 60)} h ago`;
    return `${Math.round(mins / 1440)} days ago`;
  }

  /*
   * Videos are found on the creator's linked accounts by the hashtag, so there
   * is nothing to add by hand. Each row: the video, its views and engagement,
   * and how far it is along the view bonuses.
   */
  function videosCard(data) {
    const tag = tagOf(data);
    const tags = (data.links || []).map((l) => l.tag);
    const tagPicker = (video) => {
      const all = [...new Set([...tags, video.link_tag].filter(Boolean))];
      if (!all.length) return h('span', {});
      const select = h('select', { class: 'cp-input cp-input--tag', 'aria-label': 'Which link this video used' }, h('option', { value: '' }, 'No link set'), all.map((tag) => h('option', { value: tag, selected: tag === video.link_tag }, tag)));
      select.addEventListener('change', async () => {
        try {
          if (cp.demo) throw new Error('This is a preview, so nothing was saved.');
          const reply = await cp.rpc('creator_tag_video', { p_video: video.id, p_tag: select.value || null });
          if (reply !== 'saved') throw new Error('That did not save.');
          toast('Saved.');
        } catch (error) {
          toast(error.message, 'error');
        }
      });
      return select;
    };
    const row = (video) => {
      const href = cp.safeUrl(video.url);
      const title = video.title || video.url.replace(/^https:\/\/(www\.)?/, '');
      const engagement = [[video.likes, 'likes'], [video.comments, 'comments'], [video.shares, 'shares']].filter(([count]) => count > 0).map(([count, word]) => `${compact(count)} ${word}`).join(' · ');
      return h(
        'li',
        {},
        h('div', { class: 'cp-video' }, h('span', { class: 'cp-platform' }, cp.PLATFORM[video.platform]), h('div', { class: 'cp-video__text' }, href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, title) : h('span', {}, title), engagement ? h('small', { class: 'cp-muted' }, engagement) : null)),
        h('div', { class: 'cp-vids__views' }, compact(video.views), h('small', {}, 'views')),
        cp.milestones(video.views, data.rules, video.status === 'approved'),
        video.status === 'approved' ? tagPicker(video) : h('span', { class: 'cp-inline' }, statusPill('pending')),
      );
    };
    const checked = data.creator.last_scanned_at;
    const every = data.settings.scan_minutes;
    const accounts = accountsOf(data.creator);
    return section(
      'Your videos',
      h('span', { class: 'cp-muted' }, checked ? `Updated ${ago(checked)}` : every ? `Checked every ${every >= 60 ? `${Math.round(every / 60)} h` : `${every} min`}` : null),
      data.videos.length
        ? h('ul', { class: 'cp-vids' }, data.videos.map(row))
        : h('p', { class: 'cp-empty' }, `Nothing yet. Post${accounts.length ? ` from ${accounts.join(' or ')}` : ''} with ${tag} in the caption and the video appears here by itself.`),
      data.videos.length && data.rules.length ? h('p', { class: 'cp-muted cp-small' }, `Each bar is a view bonus. Only videos with ${tag} in the caption are counted.`) : null,
    );
  }

  /* The exact figures, for anyone who wants them. */
  function detailTables(data) {
    const titleOf = (id) => {
      const video = data.videos.find((v) => v.id === id);
      return video ? video.title || `${cp.PLATFORM[video.platform]} video` : '';
    };
    return cp.fold(
      'See every payment',
      h('h3', {}, 'Commission'),
      table(
        [
          { label: 'Date', cell: (row) => day(row.occurred_at) },
          { label: 'What', cell: (row) => `${({ purchase: 'New subscriber', renewal: 'Renewal', refund: 'Refund' })[row.kind]} · ${planName(row.product_id)}` },
          { label: 'They paid', num: true, cell: (row) => money(row.base_cents) },
          { label: 'You earn', num: true, cell: (row) => h('b', {}, money(row.amount_cents)) },
          { label: 'Status', cell: (row) => (row.paid ? pill('Paid', 'good') : new Date(row.available_at) > new Date() ? pill(`Clears ${day(row.available_at)}`, 'warn') : pill('Ready', 'good')) },
        ],
        data.commissions,
        'No commission yet.',
      ),
      h('h3', {}, 'Bonuses'),
      table(
        [
          { label: 'Date', cell: (row) => day(row.created_at) },
          { label: 'Bonus', cell: (row) => row.label },
          { label: 'Video', cell: (row) => titleOf(row.video_id) },
          { label: 'Amount', num: true, cell: (row) => h('b', {}, money(row.amount_cents)) },
          { label: 'Status', cell: (row) => (row.paid ? pill('Paid', 'good') : pill('Ready', 'good')) },
        ],
        data.bonuses,
        'No bonuses yet.',
      ),
      h('h3', {}, 'Payouts'),
      table(
        [
          { label: 'Date', cell: (row) => day(row.paid_at || row.created_at) },
          { label: 'Amount', num: true, cell: (row) => h('b', {}, money(row.amount_cents)) },
          { label: 'Sent by', cell: (row) => (row.method === 'manual' ? 'PayPal, Venmo or Zelle' : 'Stripe') },
          { label: 'Status', cell: (row) => statusPill(row.status) },
        ],
        data.payouts,
        'No payouts yet.',
      ),
    );
  }

  /* ------------------------------------------------------------ sample data */

  function demoData() {
    const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
    const curve = Array.from({ length: 30 }, (_, i) => ({ day: ago(29 - i).slice(0, 10), views: i === 29 ? 3426000 : Math.round(60_000 + 3_366_000 / (1 + Math.exp(-(i - 16) / 3.2))) }));
    /* A steady climb of sign-ups and renewals over eight weeks, at 12% of what is left after store fees. */
    const commissions = [];
    for (let i = 0; i < 240; i += 1) {
      const age = Math.round(55 * (1 - Math.sqrt(i / 240)));
      const annual = i % 3 === 0;
      commissions.push({ id: `m${i}`, kind: i % 4 === 1 ? 'renewal' : 'purchase', product_id: annual ? 'mindroll_annual' : 'mindroll_weekly', plan: annual ? 'annual' : 'weekly', base_cents: annual ? 8774 : 1949, rate: 0.2, amount_cents: annual ? 2655 : 390, occurred_at: ago(age), available_at: ago(age - 30), paid: age > 40 });
    }
    commissions.push({ id: 'mr', kind: 'refund', product_id: 'mindroll_weekly', plan: 'weekly', base_cents: -1949, rate: 0.2, amount_cents: -390, occurred_at: ago(9), available_at: ago(9), paid: false });
    commissions.sort((x, y) => new Date(y.occurred_at) - new Date(x.occurred_at));
    return {
      creator: { id: 'c1', code: 'maya', display_name: 'Maya', status: 'active', rate: 0.2, champion: false, terms_accepted: true, payout_hold: false, handle_verified: true, country: 'US', tiktok_handle: 'maya.reads', instagram_handle: 'maya.reads', stripe_connected: false, payouts_enabled: false, payout_method: 'venmo', payout_handle: '@maya-reads', cashout_requested_at: null, last_scanned_at: ago(0.008) },
      settings: { hold_days: 30, min_payout_cents: 2500, commission_base: 'net', track_days: 60, hashtag: 'mindroll', scan_minutes: 60, manychat_commission_cents: 7500 },
      balance: { available_cents: 114600, pending_cents: 86400, paid_cents: 289000, in_transit_cents: 0, commission_cents: 372000, bonus_cents: 118000 },
      stats: { clicks: 48200, signups: 3120, customers: 214, revenue_cents: 1860000, videos: 24, views: 3426000, annual_subs: 43, annual_commission_cents: 114165, recurring_subs: 171, recurring_month_cents: 279900, recurring_sales_month_cents: 1399800 },
      incentives: {
        tier_level: 5, window_days: 30, window_revenue_cents: 1860000, window_views: 3426000, window_posts: 24, multiplier: 50, margin: { rate: 0.7, budget_cents: 524600, spent_cents: 450000, room_cents: 74600 }, tier_basis_cents: 1860000, month_revenue_cents: 1860000, annual_bonus_cents: 900, 
        tiers: [
          { level: 1, name: 'Iron', min_revenue_cents: 0, min_views: 0, min_posts: 0, bonus_multiplier: 1, commission_rate: 0.1, rank_up_bonus_cents: 0, annual_flat_cents: 500, campaign_pool_cents: 0, active_day_views: 1000, race_prize_cents: 0 },
          { level: 2, name: 'Silver', min_revenue_cents: 150000, min_views: 100000, min_posts: 4, bonus_multiplier: 5, commission_rate: 0.12, rank_up_bonus_cents: 2500, annual_flat_cents: 600, campaign_pool_cents: 150000, active_day_views: 2000, race_prize_cents: 100000 },
          { level: 3, name: 'Gold', min_revenue_cents: 500000, min_views: 1000000, min_posts: 9, bonus_multiplier: 10, commission_rate: 0.15, rank_up_bonus_cents: 15000, annual_flat_cents: 700, campaign_pool_cents: 500000, active_day_views: 5000, race_prize_cents: 300000 },
          { level: 4, name: 'Platinum', min_revenue_cents: 1000000, min_views: 2000000, min_posts: 14, bonus_multiplier: 25, commission_rate: 0.18, rank_up_bonus_cents: 27500, annual_flat_cents: 800, campaign_pool_cents: 1000000, active_day_views: 10000, race_prize_cents: 600000 },
          { level: 5, name: 'Diamond', min_revenue_cents: 1500000, min_views: 3000000, min_posts: 21, bonus_multiplier: 50, commission_rate: 0.2, rank_up_bonus_cents: 32000, annual_flat_cents: 900, campaign_pool_cents: 1500000, active_day_views: 100000, race_prize_cents: 1000000 },
        ],
        active: { days: 3, min_days: 4, amount_cents: 50000, base_amount_cents: 1000, count_min_views: 1000, day_views: 100000 },
        volume: { videos: 16, sales: 1, rules: [{ id: 'r1', min_videos: 10, min_sales: 0, amount_cents: 4000, base_amount_cents: 4000 }, { id: 'r2', min_videos: 15, min_sales: 2, amount_cents: 8000, base_amount_cents: 8000 }, { id: 'r3', min_videos: 25, min_sales: 6, amount_cents: 12000, base_amount_cents: 12000 }] },
        by_kind: { contest: 40000, rank_up: 59500, views: 13000, prize: 3000, top_video: 2500 },
        champion: { is: false, slots: 3, rate: 0.25, daily_cents: 15000, top_tier: 5, place: 4, bar_cents: 2140000 },
        iron: { on: true, eligible: false, step_views: 50000, step_cents: 5000, cap_views: 1000000, video_min_views: 2000, views: 3426000, subs: 214, steps_paid: 20, paid_cents: 100000, steps_by_views: 20, steps_allowed: 20 }, first_sale_rate: 0.5, first_sale_used: [1, 2], race: { prizes: [{ level: 2, name: 'Silver', cents: 100000, winner: 'Noor', you: false }, { level: 3, name: 'Gold', cents: 300000, winner: 'Maya', you: true }, { level: 4, name: 'Platinum', cents: 600000, winner: null, you: false }, { level: 5, name: 'Diamond', cents: 1000000, winner: null, you: false }] },
      },
      campaigns: {
        week: ago(2).slice(0, 10), ends_at: new Date(Date.now() + 4.2 * 864e5).toISOString(), tier_level: 5, tier_name: 'Diamond', in_tier: 6, min_creators: 5, live: true, pool_cents: 1500000, scale: 0.2, split: [50, 30, 20],
        unlock: null,
        boards: [
          { board: 'videos', joined: true, entrants: 6, score: 3, place: 2, top: [{ place: 1, name: 'Theo Studies', score: 5 }, { place: 2, name: 'Maya', score: 3, you: true }, { place: 3, name: 'Bookish Lina', score: 2 }, { place: 4, name: 'Noor', score: 1 }] },
          { board: 'views', joined: true, entrants: 5, score: 212400, place: 1, top: [{ place: 1, name: 'Maya', score: 212400, you: true }, { place: 2, name: 'Noor', score: 150200 }, { place: 3, name: 'Theo Studies', score: 64100 }] },
          { board: 'sales', joined: false, entrants: 4, score: 0, place: null, top: [{ place: 1, name: 'Noor', score: 61200 }, { place: 2, name: 'Bookish Lina', score: 40800 }, { place: 3, name: 'Theo Studies', score: 18700 }] },
        ],
        last: [
          { board: 'views', place: 1, name: 'Noor', score: 301000, prize_cents: 5000 }, { board: 'views', place: 2, name: 'Maya', score: 188000, prize_cents: 3000, you: true }, { board: 'views', place: 3, name: 'Theo Studies', score: 90200, prize_cents: 2000 },
        ],
      },
      links: [{ tag: 'doomscroll', clicks: 3820, signups: 240, customers: 27, sales_cents: 112400, commission_cents: 13488 }, { tag: 'meditations', clicks: 1410, signups: 96, customers: 9, sales_cents: 41200, commission_cents: 4944 }, { tag: 'five-minutes', clicks: 620, signups: 31, customers: 2, sales_cents: 3998, commission_cents: 480 }],
      briefs: [{ id: 'f1', title: 'The "I replaced doomscrolling" hook', url: 'https://www.tiktok.com/@mindroll/video/7520000000000000100', note: 'Say the swap in the first two seconds, show the app by second five.' }, { id: 'f2', title: 'One idea from one book', url: 'https://www.tiktok.com/@mindroll/video/7520000000000000101', note: 'Name the book, give the idea, end on what you did with it.' }],
      contests: [
        { id: 'k2', title: 'Launch day: most new subscribers', rules: null, reference_url: null, tier_level: null, metric: 'subs', min_views: 0, starts_at: ago(0.4), ends_at: new Date(Date.now() + 14 * 36e5).toISOString(), prizes: [15000, 10000, 5000], settled: false, open: true, upcoming: false, require_checked: true, pay_from: new Date(Date.now() + 62 * 36e5).toISOString(), joined: true, entrants: 12, score: 4, place: 1, top: [{ place: 1, name: 'Maya', score: 4, you: true }, { place: 2, name: 'Noor', score: 3 }, { place: 3, name: 'Bookish Lina', score: 1 }], videos: [], results: [] },
        { id: 'k1', title: 'Launch day: most videos in 24 hours', rules: 'Use the hook from the reference video in your first three seconds.', reference_url: 'https://www.tiktok.com/@mindroll/video/7520000000000000100', tier_level: 2, metric: 'videos', min_views: 1000, starts_at: ago(0.4), ends_at: new Date(Date.now() + 14 * 36e5).toISOString(), prizes: [7500, 5000, 2500], settled: false, open: true, upcoming: false, require_checked: true, pay_from: new Date(Date.now() + 62 * 36e5).toISOString(), joined: true, entrants: 9, score: 2, place: 2,
          top: [{ place: 1, name: 'Noor', score: 3 }, { place: 2, name: 'Maya', score: 2, you: true }, { place: 3, name: 'Theo Studies', score: 1 }],
          videos: [{ id: 'v4', title: 'POV: you finally remember what you read #Mindroll', views: 3100, approved: true }, { id: 'v5', title: 'Stop highlighting. Do this instead #Mindroll', views: 1840, approved: true }, { id: 'v6', title: 'Day 1 of reading 5 minutes #Mindroll', views: 420, approved: false }], results: [] },
      ],
      first_video: { state: 'open', started_at: new Date(Date.now() - 0.6 * 36e5).toISOString(), ends_at: new Date(Date.now() + 23.4 * 36e5).toISOString(), hours: 24, multiplier: 2, cap_cents: 100000, sale_days: 7, step_views: 50000, step_cents: 5000, video: null, earned_cents: 0 },
      team: {
        manager: { id: 'm1', display_name: 'Maya\'s team', code: 'maya_team', active: true, cut_rate: 0.5 },
        manage: { rate_cap: 0.25, managers: [{ id: 'm2', name: 'Jordan' }], rates: {} },
        tiers: [{ level: 1, name: 'Iron' }, { level: 2, name: 'Silver' }, { level: 3, name: 'Gold' }, { level: 4, name: 'Platinum' }, { level: 5, name: 'Diamond' }],
        totals: { creators: 5, pending: 1, active_7d: 4, views_30d: 2184000, videos_30d: 61, sales_30d: 812400, commission_30d: 112300, net_30d: 786100, bonus_30d: 67380, active_weeks_30d: 11, subscribers: 187 },
        pay: { referral_cents: 10000, referral_views: 100000, from_referral_cents: 10000, referrals: [{ id: 'x1', display_name: 'Noor Notes', status: 'active', views: 186000, paid: true }, { id: 'x2', display_name: 'Eli Annotates', status: 'active', views: 38500, paid: false }], cut_rate: 0.5, brought_in_cents: 812400, paid_out_cents: 187300, profit_cents: 625100, from_cut_cents: 312550, rankup_rate: 0.1, rankup_paid_cents: 17500, from_rankup_cents: 1750, rankups: [{ level: 2, name: 'Silver', bonus_cents: 2500, yours_cents: 250, count_30d: 1 }, { level: 3, name: 'Gold', bonus_cents: 15000, yours_cents: 1500, count_30d: 1 }, { level: 4, name: 'Platinum', bonus_cents: 27500, yours_cents: 2750, count_30d: 0 }, { level: 5, name: 'Diamond', bonus_cents: 32000, yours_cents: 3200, count_30d: 0 }], active_cents: 500, views_cents: 100, from_active_cents: 5500, from_views_cents: 2100, bonus_total_cents: 9350, total_cents: 321900 },
        videos: [
          { id: 'tv1', url: 'https://www.tiktok.com/@noor.reads/video/7400000000000000001', platform: 'tiktok', status: 'pending', source: 'auto', created_at: new Date(Date.now() - 2 * 36e5).toISOString(), creator: { display_name: 'Noor', tiktok: '@noor.reads', instagram: '@noor.reads', tier_level: 3 } },
          { id: 'tv2', url: 'https://www.instagram.com/reel/C9aaaaaaaaa/', platform: 'instagram', status: 'pending', source: 'creator', created_at: new Date(Date.now() - 5 * 36e5).toISOString(), creator: { display_name: 'Bookish Lina', instagram: '@bookish.lina', tier_level: 1 } },
        ],
        creators: [
          { id: 't1', display_name: 'Noor', tiktok: '@noor.reads', instagram: '@noor.reads', status: 'active', tier_level: 3, videos_30d: 22, views_30d: 1204000, subscribers: 96, commission_30d: 61200, net_30d: 428400, bonus_30d: 36720, last_posted_at: new Date(Date.now() - 0.2 * 864e5).toISOString() },
          { id: 't2', display_name: 'Theo Studies', tiktok: '@theostudies', handle_verified: false, status: 'active', tier_level: 2, videos_30d: 17, views_30d: 612000, subscribers: 51, commission_30d: 31400, net_30d: 219800, bonus_30d: 18840, last_posted_at: new Date(Date.now() - 1.3 * 864e5).toISOString() },
          { id: 't3', display_name: 'Bookish Lina', instagram: '@bookish.lina', status: 'active', tier_level: 1, videos_30d: 14, views_30d: 298000, subscribers: 29, commission_30d: 14900, net_30d: 104300, bonus_30d: 8940, last_posted_at: new Date(Date.now() - 5.5 * 864e5).toISOString() },
          { id: 't4', display_name: 'Sam', tiktok: '@samwrites', status: 'active', tier_level: 1, videos_30d: 8, views_30d: 70000, subscribers: 11, commission_30d: 4800, net_30d: 33600, bonus_30d: 2880, last_posted_at: new Date(Date.now() - 12 * 864e5).toISOString() },
          { id: 't5', display_name: 'Jonah Reads', tiktok: '@jonahreads', status: 'active', tier_level: 1, videos_30d: 0, views_30d: 0, subscribers: 0, commission_30d: 0, net_30d: 0, bonus_30d: 0, last_posted_at: null },
          { id: 't6', display_name: 'Priya', tiktok: '@priya.pages', status: 'pending', tier_level: 1, videos_30d: 0, views_30d: 0, subscribers: 0, commission_30d: 0, net_30d: 0, bonus_30d: 0, last_posted_at: null },
        ],
      },
      referrals: { code: 'maya', bonus_cents: 10000, views: 100000, earned_cents: 10000, creators: [{ name: 'Noor', status: 'active', views: 246600, paid: true }, { name: 'Jonah Reads', status: 'active', views: 38200, paid: false }, { name: 'Priya', status: 'pending', views: 0, paid: false }] },
      top_video_winners: { min_views: 100000, pool_rate: 0.05, split: [50, 30, 20], step_views: 0, step_cents: 0, week: ago(9).slice(0, 10), winners: [{ place: 1, creator_id: 'c9', creator: 'Noor', title: 'Reading 5 minutes a day did this', url: 'https://www.tiktok.com/@noor/video/7521000000000000009', platform: 'tiktok', gained: 612000, prize_cents: 9450 }, { place: 2, creator_id: 'c1', creator: 'Maya', title: 'I replaced doomscrolling with this for 30 days', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', gained: 308200, prize_cents: 5540 }, { place: 3, creator_id: 'c2', creator: 'Theo Studies', title: 'Five minutes a day, actually remembered', url: 'https://youtube.com/shorts/Y2Ah_DFr8cw', platform: 'youtube', gained: 121000, prize_cents: 3360 }] },
      top_videos: {
        day: [{ id: 'x1', url: 'https://www.tiktok.com/@noor/video/7521000000000000009', platform: 'tiktok', title: 'Reading 5 minutes a day did this', creator: 'Noor', creator_id: 'c9', views: 96400, gained: 61300 }],
        week: [{ id: 'v1', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', title: 'I replaced doomscrolling with this for 30 days', creator: 'Maya', creator_id: 'c1', views: 512300, gained: 204100 }],
        month: [{ id: 'v1', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', title: 'I replaced doomscrolling with this for 30 days', creator: 'Maya', creator_id: 'c1', views: 512300, gained: 512300 }],
      },
      rules: [
        { id: 'r2', label: '100K views', threshold_views: 100000, amount_cents: 1000 },
        { id: 'r3', label: '500K views', threshold_views: 500000, amount_cents: 3000 },
        { id: 'r4', label: '1M views', threshold_views: 1000000, amount_cents: 6000 },
      ],
      videos: [
        { id: 'v1', url: 'https://www.tiktok.com/@maya/video/7517114944362499342', platform: 'tiktok', title: 'I replaced doomscrolling with this for 30 days', status: 'approved', views: 2104000, likes: 251200, comments: 804, shares: 3420, created_at: ago(21), bonus_cents: 4000 },
        { id: 'v2', url: 'https://www.instagram.com/reel/DAbc12x/', platform: 'instagram', title: 'One idea from Meditations that changed my mornings', status: 'approved', views: 823400, likes: 66100, comments: 233, shares: 610, created_at: ago(12), bonus_cents: 1000 },
        { id: 'v3', url: 'https://www.tiktok.com/@maya.reads/video/7519000000000000003', platform: 'tiktok', title: 'Five minutes a day, actually remembered #mindroll', status: 'approved', views: 402500, likes: 23100, comments: 96, shares: 0, created_at: ago(6), bonus_cents: 0 },
        { id: 'v4', url: 'https://www.tiktok.com/@maya/video/7520000000000000001', platform: 'tiktok', title: 'POV: you finally remember what you read #Mindroll', status: 'approved', views: 96100, likes: 7400, comments: 11, shares: 18, created_at: ago(1), bonus_cents: 0 },
      ],
      bonuses: [
        { id: 'w1', kind: 'contest', label: 'Launch day: most new subscribers, 1st place', amount_cents: 15000, video_id: null, paid: false, created_at: ago(2) },
        { id: 'w2', kind: 'contest', label: 'Launch day: most views, 2nd place', amount_cents: 7500, video_id: null, paid: false, created_at: ago(2.1) },
        { id: 'b1', kind: 'views', label: '1M views', amount_cents: 6000, video_id: 'v1', paid: false, created_at: ago(3) },
        { id: 'w3', kind: 'contest', label: 'Weekend sprint: most videos, 1st place', amount_cents: 7500, video_id: null, paid: false, created_at: ago(6) },
        { id: 'b4', kind: 'rank_up', label: 'Reached Diamond', amount_cents: 32000, video_id: null, paid: false, created_at: ago(8) },
        { id: 'w4', kind: 'contest', label: 'Hook challenge: most views, 1st place', amount_cents: 10000, video_id: null, paid: false, created_at: ago(11) },
        { id: 'b2', kind: 'views', label: '500K views', amount_cents: 3000, video_id: 'v2', paid: false, created_at: ago(12) },
        { id: 'b6', kind: 'top_video', label: 'Top video, 2nd, last week', amount_cents: 2500, video_id: 'v1', paid: true, created_at: ago(16) },
        { id: 'b5', kind: 'rank_up', label: 'Reached Platinum', amount_cents: 27500, video_id: null, paid: true, created_at: ago(24) },
      ],
      commissions,
      payouts: [
        { id: 'p1', amount_cents: 9200, status: 'paid', method: 'stripe', created_at: ago(16), paid_at: ago(16) },
        { id: 'p2', amount_cents: 5000, status: 'paid', method: 'stripe', created_at: ago(46), paid_at: ago(46) },
      ],
      views_daily: curve,
    };
  }

  /* Last, so every helper above exists before the first render. */
  if (cp.empty && !new URLSearchParams(location.search).has('dashboard')) {
    /* The local preview starts where a new creator does: with the application. */
    setWho('Preview');
    who.append(h('a', { class: 'cp-link', href: '/creators/?dashboard' }, 'Skip to the dashboard'));
    renderApply({ applications_open: true, default_rate: 0.1 });
  } else if (cp.empty) {
    setWho('Preview');
    who.append(h('a', { class: 'cp-link', href: '/creators/' }, 'Back to the application'));
    cp.loadEmpty().then((data) => (data.dashboard.creator.terms_accepted === false ? renderTerms(data.dashboard) : renderDashboard(data.dashboard)), (error) => show(h('p', { class: 'cp-empty' }, error.message)));
  } else if (cp.demo) {
    setWho('Sample data');
    renderDashboard(demoData());
  } else if (!cp.client) {
    show(h('p', { class: 'cp-empty' }, 'This page could not load. Please refresh.'));
  } else {
    cp.client.auth.onAuthStateChange((_event, session) => {
      /* Deferred: Supabase forbids calling the client from inside this callback. */
      setTimeout(() => route(session), 0);
    });
    cp.client.auth.getSession().then(({ data }) => route(data.session));
  }
})();
