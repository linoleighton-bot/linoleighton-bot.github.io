/*
 * Accounts, on the website.
 *
 * The same Supabase project the app uses, so an account made here is the
 * account the app signs into. That is the whole point of this file: a purchase
 * made in a browser has to belong to somebody the app can recognise, and the
 * only identity both sides share is the Supabase `user.id`.
 *
 * `supabase-js` is vendored into `assets/vendor/` rather than fetched from a
 * CDN. The privacy policy names no third parties and this is not the thing to
 * break that promise for; a local copy also means the page works on a bad
 * connection and cannot change underneath us.
 *
 * Everything below degrades to nothing. With no project configured the markup
 * is never rendered, and with the script blocked the page is still the page.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-account]');
  if (!root) return;

  const url = root.dataset.supabaseUrl;
  const key = root.dataset.supabaseKey;
  if (!url || !key || !window.supabase) return;

  const client = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      /*
       * The session lives in this tab's storage and the URL is cleaned after
       * a redirect, so an access token never stays in the address bar to be
       * copied into a bug report or a shared link.
       */
      detectSessionInUrl: true,
    },
  });

  const el = (name) => root.querySelector(`[data-${name}]`);
  const signedOut = el('signed-out');
  const signedIn = el('signed-in');
  const form = el('auth-form');
  const status = el('auth-status');
  const who = el('auth-who');

  const busy = (on) => {
    root.toggleAttribute('data-busy', on);
    for (const control of root.querySelectorAll('button, input')) control.disabled = on;
  };

  /** One place to say what happened, so a failure is never silent. */
  const say = (message, kind = 'error') => {
    if (!status) return;
    status.textContent = message || '';
    status.dataset.kind = kind;
    status.hidden = !message;
  };

  /*
   * Render from the session, never from what a button just did.
   *
   * A click that appears to succeed is not a signed-in user — a confirmation
   * email may still be pending, or the session may have failed to persist. The
   * only thing trusted here is what the client reports afterwards.
   */
  function render(session) {
    const user = session?.user ?? null;
    if (signedOut) signedOut.hidden = Boolean(user);
    if (signedIn) signedIn.hidden = !user;
    if (who && user) who.textContent = user.email || 'Signed in';
    root.dataset.state = user ? 'signed-in' : 'signed-out';
    if (user) void loadAccount(user);
  }

  /**
   * Who they are and what they are paying for.
   *
   * Two reads, and neither is allowed to break the page: a profile row may not
   * exist yet, and an entitlement row only appears once the webhook has seen a
   * purchase. Both absences are normal states, not errors — a new free account
   * has neither, and it must still see a working account page.
   */
  async function loadAccount(user) {
    const greeting = el('auth-greeting');

    /*
     * `try`, not `.catch()`.
     *
     * A Supabase query builder is a *thenable*, not a Promise: it implements
     * `then` so it can be awaited, and has no `catch`. Calling `.catch()` on
     * one throws a TypeError before the request is even sent — which is a
     * blank account page, not a failed query.
     */
    const read = async (build) => {
      try {
        return (await build()).data ?? null;
      } catch {
        return null;
      }
    };

    const profile = await read(() =>
      client.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    );

    if (greeting && profile?.display_name) {
      greeting.textContent = `Hello, ${profile.display_name}`;
    }

    const card = el('plan-card');
    const row = await read(() =>
      client
        .from('subscription_entitlements')
        .select('plan,state,expires_at,will_renew,is_trial,store')
        .eq('user_id', user.id)
        .maybeSingle(),
    );

    if (!card) return;
    card.hidden = false;

    const name = el('plan-name');
    const badge = el('plan-badge');
    const detail = el('plan-detail');
    const manage = el('plan-manage');

    /*
     * The next step, which is not the same for everybody.
     *
     * Somebody paying gets a way into the app. Somebody on the free plan gets
     * the offer — the paywall on its own, not the thirty-one question funnel
     * that used to sit behind the only button on this page.
     */
    const openApp = el('open-app');
    const seePlans = el('see-plans');
    const buildPlan = el('build-plan');
    const show = (node, on) => {
      if (node) node.hidden = !on;
    };

    /* No row at all is the commonest case: an account that has never paid. */
    if (!row || row.plan !== 'pro') {
      if (name) name.textContent = 'Free';
      if (badge) badge.hidden = true;
      if (detail) {
        detail.textContent =
          'You can read the whole catalogue on the free plan. Pro adds audio, downloads and unlimited saves.';
      }
      if (manage) manage.hidden = true;
      show(seePlans, true);
      show(openApp, false);
      show(buildPlan, true);
      return;
    }

    show(openApp, true);
    show(seePlans, false);
    show(buildPlan, false);

    if (name) name.textContent = 'Mindroll Pro';
    if (badge) {
      badge.hidden = false;
      badge.textContent = row.is_trial ? 'Trial' : 'Active';
    }

    if (detail) {
      const when = row.expires_at ? new Date(row.expires_at).toLocaleDateString() : null;
      const verb = row.will_renew ? 'Renews' : 'Ends';
      detail.textContent = when
        ? `${verb} on ${when}.`
        : 'Your subscription is active.';
    }

    /*
     * Send them to the right place to cancel.
     *
     * A subscription bought through the App Store can only be managed in the
     * App Store — pointing an Apple subscriber at a web billing portal is a
     * support email, and pointing a web subscriber at Apple is worse, because
     * Apple will tell them they have no subscription at all.
     */
    if (manage) {
      manage.hidden = false;
      if (row.store === 'app_store') manage.href = root.dataset.manageIos || manage.href;
      else if (row.store === 'play_store') manage.href = root.dataset.managePlay || manage.href;
      else manage.href = `mailto:${root.dataset.support}?subject=Manage%20my%20subscription`;
    }
  }

  /*
   * A provider that refuses sends the reader back here with the reason in the
   * URL fragment and no session. Without this the page simply looks like the
   * sign-in did nothing.
   */
  const oauth = window.mindrollOAuth;
  const failure = oauth?.readFailure();
  if (failure) {
    say(failure.message);
    /* Clears the error and keeps the rest of the query string — the old code
       replaced the whole URL with its pathname, which on a page reached with
       parameters quietly threw them away. */
    oauth.clean();
  }

  client.auth.getSession().then(({ data }) => render(data.session));
  client.auth.onAuthStateChange((_event, session) => render(session));

  /* -------------------------------------------------------- providers */

  /*
   * Apple and Google, which is how the app signs people in.
   *
   * `redirectTo` must be on Supabase's allow-list for the project, or the
   * provider returns the user to the site root with an error in the URL and no
   * session. That is a dashboard setting, not something this file can arrange.
   */
  const returnTo = `${location.origin}/account`;

  /*
   * A provider that cannot complete is disabled before anyone clicks it.
   *
   * See `oauth.js`: a provider enabled without a client secret answers the
   * authorize endpoint with a 400, and because signing in *navigates*, the
   * reader lands on the auth server showing raw JSON rather than on a sign-in
   * screen. Unawaited on purpose — the buttons work until a check says one
   * does not, so a slow or blocked check costs nothing.
   */
  const unusable = new Map();
  for (const button of root.querySelectorAll('[data-oauth]')) {
    if (!oauth) break;
    const provider = button.dataset.oauth;
    oauth.preflight(url, provider, returnTo).then((verdict) => {
      if (verdict.ok) return;
      unusable.set(provider, verdict.message);
      oauth.retire(button, root);
    });
  }

  for (const button of root.querySelectorAll('[data-oauth]')) {
    button.addEventListener('click', async () => {
      const provider = button.dataset.oauth;
      const name = oauth ? oauth.label(provider) : provider;

      if (unusable.has(provider)) {
        say(`${unusable.get(provider)} Use your email address instead.`);
        return;
      }

      busy(true);
      say(`Taking you to ${name}…`, 'busy');

      try {
        if (oauth) {
          const verdict = await oauth.preflight(url, provider, returnTo);
          if (!verdict.ok) {
            unusable.set(provider, verdict.message);
            busy(false);
            oauth.retire(button, root);
            say(`${verdict.message} Use your email address instead.`);
            return;
          }
        }

        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: returnTo },
        });
        if (error) throw error;
        /* On success the browser leaves this page, so nothing follows. */
      } catch (error) {
        busy(false);
        say(error?.message || `We could not reach ${name}. Try email instead.`);
      }
    });
  }

  /* The email half, kept out of the way until it is asked for. */
  const emailToggle = el('email-toggle');
  const emailForm = root.querySelector('.signin__emailform');
  if (emailToggle && emailForm) {
    emailToggle.addEventListener('click', () => {
      const open = emailForm.hidden;
      emailForm.hidden = !open;
      emailToggle.setAttribute('aria-expanded', String(open));
      emailToggle.textContent = open ? 'Use a provider instead' : 'Use email instead';
      if (open) emailForm.querySelector('input[name="email"]')?.focus();
    });
  }

  /* --------------------------------------------------------- password */

  /*
   * A reset link, sent to whatever is in the email field.
   *
   * Deliberately says the same thing whether or not the address has an
   * account: telling a stranger which email addresses are registered is an
   * account-enumeration hole, and it buys the person nothing.
   */
  const reset = el('auth-reset');
  if (reset && form) {
    reset.addEventListener('click', async () => {
      const email = form.querySelector('input[name="email"]').value.trim();
      if (!email) return say('Put your email address in first, then tap this again.');

      busy(true);
      try {
        await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/account`,
        });
        say(`If there is an account for ${email}, a reset link is on its way.`, 'ok');
      } catch {
        say('We could not send that just now. Try again in a moment.');
      } finally {
        busy(false);
      }
    });
  }

  /* ------------------------------------------------------------ email */

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      say('');

      const email = form.querySelector('[name="email"]')?.value.trim();
      const password = form.querySelector('[name="password"]')?.value;

      /*
       * Which button was pressed decides what this is.
       *
       * One form, two submit buttons — signing in and creating an account ask
       * for exactly the same two fields, and a mode toggle above them is a
       * control the reader has to understand before they can type anything.
       */
      const mode = event.submitter?.value === 'sign-up' ? 'sign-up' : 'sign-in';

      if (!email || !password) return say('Enter your email and password.');
      if (mode === 'sign-up' && password.length < 8) {
        return say('Use at least eight characters.');
      }

      busy(true);
      try {
        const result =
          mode === 'sign-up'
            ? await client.auth.signUp({ email, password })
            : await client.auth.signInWithPassword({ email, password });

        if (result.error) return say(result.error.message);

        /*
         * Signing up does not always sign you in. With email confirmation on,
         * Supabase returns a user and no session, and saying "welcome back"
         * to somebody who must still click a link in their inbox is how a
         * sign-up silently fails.
         */
        if (mode === 'sign-up' && !result.data.session) {
          return say('Check your email to confirm the account, then sign in.', 'notice');
        }
      } catch (error) {
        say(error?.message || 'That did not work. Try again.');
      } finally {
        busy(false);
      }
    });
  }

  /* ----------------------------------------------------------- sign out */

  const out = el('auth-signout');
  if (out) {
    out.addEventListener('click', async () => {
      busy(true);
      try {
        await client.auth.signOut();
        say('');
      } finally {
        busy(false);
      }
    });
  }

  /*
   * Expose the client for the checkout to reuse.
   *
   * Checkout needs the signed-in user's id, and creating a second client would
   * mean a second session that can disagree with this one.
   */
  window.mindrollAuth = { client, session: () => client.auth.getSession() };
})();
