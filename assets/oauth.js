/**
 * The provider sign-in, for both pages that offer it.
 *
 * `/start` and `/account` each put Apple and Google in front of the reader, and
 * each had its own copy of the two things that are easy to get wrong: reading
 * why a provider refused, and noticing that a provider cannot work at all. Both
 * copies were wrong in the same way, so the logic lives here once and the pages
 * ask for it.
 *
 * Loaded as a plain script before `funnel.js` / `auth.js`, which is how every
 * other script on this site is loaded — the build's inliner rewrites
 * `<script src>` into its contents, so this costs a request in the deployed
 * site and nothing at all in the single-file builds.
 */
(function () {
  'use strict';

  /**
   * Why a provider refused, from wherever it put the reason.
   *
   * This is the bug that made sign-in look silently broken. supabase-js
   * defaults to the PKCE flow, and PKCE returns failures as **query
   * parameters** — `?error=...&error_description=...`. Both pages read only
   * `location.hash`, which is where the older implicit flow puts them. So every
   * refusal landed the reader back on a page that said nothing whatsoever, and
   * "nothing happened" is indistinguishable from a broken button.
   *
   * Reads both, because which one is used depends on a client setting that a
   * future edit could flip without anyone thinking about this file.
   */
  function readFailure() {
    for (const source of [window.location.search.slice(1), window.location.hash.slice(1)]) {
      if (!source) continue;
      const params = new URLSearchParams(source);
      const description = params.get('error_description');
      const code = params.get('error') || params.get('error_code');
      if (!description && !code) continue;

      /* `error_description` arrives percent-encoded with `+` for spaces.
         URLSearchParams has already decoded it; the `+` are its own. */
      const text = (description || code || '').trim();
      if (!text) continue;

      /* Provider text is machine-shaped ("server_error", "access_denied").
         A reader gets a sentence; the raw code goes to the console for us. */
      return {
        code,
        message: /[a-z]_[a-z]|^[a-z_]+$/.test(text)
          ? 'That sign-in did not complete. Please try again.'
          : text,
      };
    }
    return null;
  }

  /**
   * Take the failure out of the address bar, keeping everything else.
   *
   * The funnel returns to `?q=account`, so dropping the whole query string —
   * which the account page did — would land the reader on the wrong step.
   */
  function clean() {
    try {
      const url = new URL(window.location.href);
      for (const key of ['error', 'error_code', 'error_description', 'state']) {
        url.searchParams.delete(key);
      }
      url.hash = '';
      const query = url.searchParams.toString();
      window.history.replaceState(null, '', url.pathname + (query ? `?${query}` : ''));
    } catch {
      /* No history access. The message is already on the page either way. */
    }
  }

  /**
   * Whether a provider can actually complete, asked before the reader commits.
   *
   * A provider that is switched on in the dashboard but has no client secret
   * does not fail politely: `/authorize` answers 400 with a JSON body, and
   * because `signInWithOAuth` navigates rather than fetches, the reader lands
   * on a Supabase URL showing raw JSON. That is what "sign in with Apple is
   * broken" looked like from the outside.
   *
   * GoTrue sends CORS headers on that 400, so the page can read it. A provider
   * that is configured answers with a cross-origin 302 instead, which `fetch`
   * reports as an opaque redirect it is not allowed to look at — and being
   * refused a look is itself the signal that there was somewhere to go.
   *
   * Never fails closed: a network error or an unreadable response returns `ok`,
   * because blocking a working provider is far worse than letting a broken one
   * through to the error it would have shown anyway.
   */
  async function preflight(supabaseUrl, provider, redirectTo) {
    const endpoint =
      `${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize` +
      `?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`;

    try {
      const response = await fetch(endpoint, { redirect: 'manual', credentials: 'omit' });
      if (response.type === 'opaqueredirect' || response.ok || response.status === 0) {
        return { ok: true };
      }

      let reason = '';
      try {
        reason = (await response.json())?.msg || '';
      } catch {
        /* Not JSON; the status alone is enough to know it will not work. */
      }

      /* The dashboard's wording, turned into something a reader can act on.
         The operator's version goes to the console, where it belongs. */
      if (reason) console.warn(`[auth] ${provider}: ${reason}`);
      return {
        ok: false,
        reason,
        message: /secret|not enabled|unsupported provider/i.test(reason)
          ? `Sign in with ${label(provider)} is not available yet.`
          : `Sign in with ${label(provider)} is unavailable right now.`,
      };
    } catch {
      return { ok: true };
    }
  }

  /** The provider's name as a person writes it. */
  function label(provider) {
    return provider === 'apple' ? 'Apple' : provider === 'google' ? 'Google' : provider;
  }

  /**
   * Take a provider that cannot work off the screen.
   *
   * Not disabled — removed. A greyed-out "Sign in with Apple" is still a broken
   * button as far as the reader is concerned, and this is the screen an ad
   * campaign pays to reach. Removing also sidesteps `[hidden]` losing to any
   * class that sets `display`, which has caught this site twice.
   *
   * If that was the last provider, the email form is opened, because otherwise
   * the sign-in step would offer nothing at all.
   *
   * @param {Element} button the provider button to retire
   * @param {Element} scope  the step or panel holding the sign-in controls
   */
  function retire(button, scope) {
    const providers = button.closest('.signin__providers');
    button.remove();
    if (scope.querySelector('[data-oauth]')) return;

    /* Nothing left to choose between: the divider and the "use email instead"
       toggle are now describing a choice that no longer exists. */
    if (providers) providers.remove();
    const toggle = scope.querySelector('[data-email-toggle]');
    const form = scope.querySelector('.signin__emailform');
    if (form) form.hidden = false;
    if (toggle) toggle.remove();
  }

  window.mindrollOAuth = { readFailure, clean, preflight, label, retire };
})();
