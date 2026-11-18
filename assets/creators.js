/*
 * The creator dashboard.
 *
 * One page to make a creator, hand them a link, and see what that link
 * brought in. The link is the ordinary funnel with a code on it —
 * `/start/?c=alex` — not a copy of the funnel and not a subdomain. That
 * matters more than it looks:
 *
 *  - A copy would drift. Two funnels mean two sets of fixes, and the one the
 *    creators send people to is the one that would rot.
 *  - A subdomain needs a DNS record each, Pages serves one domain, and
 *    `localStorage` does not cross origins — so the code captured on landing
 *    would be gone by the time the account is made, which is the one moment
 *    attribution has to survive.
 *
 * So every creator sends people through the same funnel everyone else sees,
 * and the only difference is a code that rides along to the account.
 *
 * Everything here is read and written as the signed-in person. The tables are
 * behind `is_admin()`, so a reader who finds this page sees the same thing an
 * anonymous visitor does: nothing. The gate is the database's, not this
 * file's — a page that hides a button is not access control.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-creators]');
  if (!root) return;

  const url = root.dataset.supabaseUrl;
  const key = root.dataset.supabaseKey;
  const origin = root.dataset.origin || location.origin;
  if (!url || !key || !window.supabase) return;

  const client = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const el = (name) => root.querySelector(`[data-${name}]`);
  const show = (node, on) => node && node.toggleAttribute('hidden', !on);

  const paneLoading = el('pane-loading');
  const paneSignedOut = el('pane-signed-out');
  const paneDenied = el('pane-denied');
  const paneReady = el('pane-ready');
  const tbody = el('rows');
  const empty = el('empty');
  const form = el('add-form');
  const codeInput = el('code');
  const nameInput = el('name');
  const status = el('status');
  const totalRow = el('totals');

  const say = (message, kind) => {
    if (!status) return;
    status.textContent = message || '';
    status.dataset.kind = kind || '';
  };

  /** A code has to survive being typed into a DM, so keep it plain. */
  const slug = (value) =>
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);

  const linkFor = (code) => `${origin}/start/?c=${encodeURIComponent(code)}`;

  const money = (value) => {
    const amount = Number(value || 0);
    return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  };

  /*
   * Which pane to show.
   *
   * Three states worth telling apart, because the fix for each is different:
   * nobody is signed in, somebody is signed in who is not an admin, and the
   * dashboard proper. Collapsing the middle one into "no creators yet" is how
   * an empty table gets mistaken for a working one.
   */
  /*
   * The unlock link, built for whoever is actually signed in.
   *
   * The id has to be theirs, not one baked in at build time — the owner may
   * sign in with a different account than the one this page was built
   * expecting, and an unlock that marks the wrong row leaves them staring at
   * the same locked page with no idea why.
   */
  function offerUnlock(user) {
    const ref = (() => {
      try {
        return new URL(url).hostname.split('.')[0];
      } catch {
        return null;
      }
    })();
    const sql = `update public.profiles set role = 'admin' where id = '${user.id}';`;
    const link = root.querySelector('[data-unlock]');
    const who = root.querySelector('[data-unlock-who]');
    if (link && ref) {
      link.setAttribute(
        'href',
        `https://supabase.com/dashboard/project/${ref}/sql/new?content=${encodeURIComponent(sql)}`,
      );
    }
    if (who) who.textContent = `This will mark ${user.email || 'this account'} as the owner.`;
  }

  async function gate() {
    const { data } = await client.auth.getUser();
    const user = data?.user || null;
    if (!user) return { state: 'signed-out' };

    const { data: profile } = await client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    return profile?.role === 'admin' ? { state: 'ready', user } : { state: 'denied', user };
  }

  function rowMarkup(row) {
    const link = linkFor(row.code);
    const off = row.active === false;
    return (
      `<tr${off ? ' class="is-off"' : ''}>` +
      `<td class="cd__who"><b>${escapeHtml(row.name)}</b><span>${escapeHtml(row.code)}</span></td>` +
      `<td class="cd__link">` +
      `<input type="text" readonly value="${escapeHtml(link)}" data-link aria-label="Link for ${escapeHtml(row.name)}" />` +
      `<button type="button" class="cd__copy" data-copy="${escapeHtml(link)}">Copy</button>` +
      `</td>` +
      `<td class="cd__n">${Number(row.clicks || 0)}</td>` +
      `<td class="cd__n">${Number(row.signups || 0)}</td>` +
      `<td class="cd__n">${Number(row.subscribers || 0)}</td>` +
      `<td class="cd__n cd__money">${money(row.revenue)}</td>` +
      `<td class="cd__act">` +
      `<button type="button" class="cd__toggle" data-toggle="${escapeHtml(row.code)}" data-next="${off ? 'on' : 'off'}">` +
      `${off ? 'Turn on' : 'Pause'}</button>` +
      `</td>` +
      `</tr>`
    );
  }

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);

  async function load() {
    const { data, error } = await client
      .from('creator_stats')
      .select('code,name,active,clicks,signups,subscribers,revenue')
      .order('revenue', { ascending: false });

    if (error) {
      say(`Could not read the figures: ${error.message}`, 'bad');
      return;
    }

    const rows = data || [];
    tbody.innerHTML = rows.map(rowMarkup).join('');
    show(empty, rows.length === 0);

    if (totalRow) {
      const sum = (field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
      totalRow.innerHTML =
        `<td class="cd__who"><b>All creators</b><span>${rows.length} total</span></td>` +
        `<td></td>` +
        `<td class="cd__n">${sum('clicks')}</td>` +
        `<td class="cd__n">${sum('signups')}</td>` +
        `<td class="cd__n">${sum('subscribers')}</td>` +
        `<td class="cd__n cd__money">${money(sum('revenue'))}</td>` +
        `<td></td>`;
    }
  }

  root.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        const was = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = was; }, 1400);
      } catch {
        /* Clipboard refused — the field beside it is selectable, so say so. */
        say('Could not copy. Select the link and copy it by hand.', 'bad');
      }
      return;
    }

    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const code = toggle.dataset.toggle;
      const active = toggle.dataset.next === 'on';
      toggle.disabled = true;
      const { error } = await client.from('ugc_creators').update({ active }).eq('code', code);
      toggle.disabled = false;
      if (error) say(`Could not change ${code}: ${error.message}`, 'bad');
      else {
        say(`${code} is ${active ? 'live again' : 'paused'}. Existing links still work.`, 'ok');
        load();
      }
    }
  });

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = String(nameInput?.value || '').trim();
      const code = slug(codeInput?.value || name);

      if (!name) return say('Give the creator a name.', 'bad');
      if (!code) return say('That code has no letters or numbers in it.', 'bad');

      say('Adding…');
      const { error } = await client.from('ugc_creators').insert({ code, name });

      if (error) {
        say(
          error.code === '23505'
            ? `The code “${code}” is already taken. Pick another.`
            : `Could not add: ${error.message}`,
          'bad',
        );
        return;
      }

      if (nameInput) nameInput.value = '';
      if (codeInput) codeInput.value = '';
      say(`${name} is live. Their link is ${linkFor(code)}`, 'ok');
      load();
    });
  }

  /* Keep the code field in step with the name until it is typed in directly. */
  if (nameInput && codeInput) {
    let touched = false;
    codeInput.addEventListener('input', () => { touched = true; });
    nameInput.addEventListener('input', () => {
      if (!touched) codeInput.value = slug(nameInput.value);
    });
  }

  (async () => {
    const { state } = await gate();
    show(paneLoading, false);
    show(paneSignedOut, state === 'signed-out');
    show(paneDenied, state === 'denied');
    if (state === 'denied') offerUnlock((await client.auth.getUser()).data.user);
    show(paneReady, state === 'ready');
    if (state === 'ready') load();
  })();
})();
