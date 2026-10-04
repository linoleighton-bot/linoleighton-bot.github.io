/**
 * Buying Pro without leaving the page it was offered on.
 *
 * The pricing on the home page used to be two links into `/start?q=offer`.
 * That page is ours rather than Stripe's, so nobody was ever handed to a
 * differently-branded checkout — but it is still a navigation, and a
 * navigation at the moment somebody has decided to pay is somewhere to stop.
 * The card fields now open underneath the two cards.
 *
 * **Nothing loads until it is wanted.** Supabase auth and the Web Billing SDK
 * are most of a megabyte between them, and this is the page advertising lands
 * on, where load time is the conversion lever. Both are fetched on the first
 * press of a plan button and not before, so the marketing page costs what it
 * always did for the large majority who never press one.
 *
 * A subscription attaches to an account, so a visitor who has never signed in
 * is signed in here too — inline, in the same panel, rather than as a detour
 * they have to find their way back from.
 */
(function () {
  'use strict';

  const root = document.querySelector('[data-plans]');
  if (!root) return;

  const url = root.dataset.supabaseUrl;
  const key = root.dataset.supabaseKey;
  const checkoutKey = root.dataset.checkoutKey;
  if (!url || !key || !checkoutKey) return;

  let packages = {};
  try {
    packages = JSON.parse(root.dataset.packages || '{}');
  } catch {
    return;
  }

  const panel = root.querySelector('[data-plans-panel]');
  const signin = root.querySelector('[data-plans-signin]');
  const till = root.querySelector('[data-plans-till]');
  const status = root.querySelector('[data-plans-status]');
  const buttons = [...root.querySelectorAll('[data-plan]')];
  if (!panel || !signin || !till || !buttons.length) return;

  /* The plan the reader pressed, kept across an OAuth round trip. */
  const REMEMBER = 'mindroll.plans.chosen';

  const say = (message, kind = 'error') => {
    if (!status) return;
    status.textContent = message || '';
    status.dataset.kind = kind;
    status.hidden = !message;
  };

  const show = (node, on) => {
    if (node) node.hidden = !on;
  };

  /* ------------------------------------------------------------- loading */

  const script = (src) =>
    new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((s) => s.src.endsWith(src));
      if (existing) {
        if (existing.dataset.loaded) return resolve();
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', reject);
        return;
      }
      const tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.addEventListener('load', () => {
        tag.dataset.loaded = 'yes';
        resolve();
      });
      tag.addEventListener('error', () => reject(new Error(`Could not load ${src}`)));
      document.head.appendChild(tag);
    });

  let clientPromise = null;
  const supabaseClient = () => {
    if (clientPromise) return clientPromise;
    clientPromise = script('/assets/vendor/supabase.js').then(() =>
      window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    );
    return clientPromise;
  };

  let purchasesPromise = null;
  const purchasesSdk = () => {
    if (purchasesPromise) return purchasesPromise;
    purchasesPromise = script('/assets/vendor/purchases.js').then(() => {
      if (!window.Purchases?.Purchases) throw new Error('The checkout loaded but did not start.');
      return window.Purchases.Purchases;
    });
    return purchasesPromise;
  };

  /* ------------------------------------------------------------ checkout */

  /**
   * Give the checkout a box with a height in it.
   *
   * The SDK styles its own root `height: 100%`, so it inherits whatever it is
   * mounted into and an empty `<div>` is nothing to inherit — the form renders
   * at full size and is then clipped to a sliver. Matched to the form with a
   * ResizeObserver rather than pinned, because a wallet button, a declined
   * card and a 3-D Secure step are all different heights.
   */
  const fitTill = (node) => {
    const inner = () => node.querySelector('.rc-checkout-form-container') || node.firstElementChild;

    if (typeof ResizeObserver === 'undefined') {
      node.style.height = '36rem';
      return () => {
        node.style.height = '';
      };
    }

    const observer = new ResizeObserver(() => {
      const box = inner();
      if (!box) return;
      const height = Math.ceil(box.getBoundingClientRect().height);
      if (height > 0 && Math.abs(height - node.offsetHeight) > 2) node.style.height = `${height}px`;
    });
    observer.observe(node);

    const start = Date.now();
    const wait = window.setInterval(() => {
      const box = inner();
      if (box) {
        observer.observe(box);
        window.clearInterval(wait);
      } else if (Date.now() - start > 15000) {
        window.clearInterval(wait);
      }
    }, 120);

    return () => {
      window.clearInterval(wait);
      observer.disconnect();
      node.style.height = '';
    };
  };

  let configured = null;

  async function buy(user, planId) {
    const Purchases = await purchasesSdk();
    /* The App User ID is the Supabase user id, which is what ties a payment
       taken here to the account the app signs into. */
    if (!configured) configured = Purchases.configure({ apiKey: checkoutKey, appUserId: user.id });

    const offerings = await configured.getOfferings();
    const current = offerings?.current;
    if (!current) throw new Error('No plans are available right now.');

    const wanted = packages[planId];
    const pkg =
      current.availablePackages.find((p) => p.identifier === wanted) ||
      current.availablePackages.find((p) => p.webBillingProduct);
    if (!pkg) throw new Error('That plan is not available right now.');

    say('');
    show(signin, false);
    show(till, true);
    const unfit = fitTill(till);

    try {
      const result = await configured.purchase({
        rcPackage: pkg,
        htmlTarget: till,
        customerEmail: user.email || undefined,
      });
      const active = Object.keys(result?.customerInfo?.entitlements?.active || {});
      unfit();
      show(till, false);
      if (!active.length) throw new Error('The payment went through but the plan did not open. Email us and we will fix it.');
      say('You are in. Open Mindroll on your phone and sign in with the same account.', 'ok');
      for (const button of buttons) button.disabled = true;
    } catch (error) {
      unfit();
      show(till, false);
      throw error;
    }
  }

  /* --------------------------------------------------------------- flow */

  /*
   * One checkout at a time.
   *
   * Two things can start one: pressing a plan, and coming back from a
   * provider onto `#plans` with a plan remembered. Both firing meant the SDK
   * mounted twice into the same element and the second form drew straight
   * through the first. Whichever gets there first wins and the other is a
   * no-op until it finishes.
   */
  let opening = false;
  let chosenPlan = null;

  async function start(planId) {
    if (opening) return;
    opening = true;
    chosenPlan = planId;

    show(panel, true);
    say('One moment…', 'busy');

    try {
      const client = await supabaseClient();
      const { data } = await client.auth.getSession();
      const user = data.session?.user ?? null;

      if (!user) {
        say('');
        show(signin, true);
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        /* Signing in is the next move, and it is a round trip — the flag has
           to come off or the plan they return to cannot open. */
        opening = false;
        return;
      }

      await buy(user, planId);
      opening = false;
    } catch (error) {
      opening = false;
      const code = error?.errorCode ?? error?.code;
      const cancelled =
        code === window.Purchases?.ErrorCode?.UserCancelledError ||
        /cancel/i.test(String(error?.message || ''));
      if (cancelled) {
        say('');
        return;
      }
      console.error('[plans]', error);
      say(
        /card|declin|insufficient|expired|cvc|postal|billing/i.test(String(error?.message || ''))
          ? error.message
          : 'We could not open the checkout just now. Nothing has been charged — please try again.',
      );
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => start(button.dataset.plan));
  }

  /* ---------------------------------------------------------- providers */

  const oauth = window.mindrollOAuth;

  for (const button of signin.querySelectorAll('[data-oauth]')) {
    button.addEventListener('click', async () => {
      const provider = button.dataset.oauth;
      const name = oauth ? oauth.label(provider) : provider;
      /* Back to the pricing, not to the top of the page. */
      const returnTo = `${location.origin}/#plans`;

      /*
       * Remembered here and nowhere else.
       *
       * This is the only moment the reader leaves the page with a plan in
       * mind, so it is the only thing that should cause one to re-open when
       * they return. Written on every press of a plan it meant a later bare
       * visit to `/#plans` opened a checkout nobody had asked for.
       */
      try {
        window.sessionStorage.setItem(REMEMBER, chosenPlan || '');
      } catch {
        /* Private window: they land back on the pricing and press again. */
      }

      for (const control of signin.querySelectorAll('button')) control.disabled = true;
      say(`Taking you to ${name}…`, 'busy');

      try {
        if (oauth) {
          const verdict = await oauth.preflight(url, provider, returnTo);
          if (!verdict.ok) {
            oauth.retire(button, signin);
            for (const control of signin.querySelectorAll('button')) control.disabled = false;
            say(`${verdict.message} Try the other one.`);
            return;
          }
        }
        const client = await supabaseClient();
        const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: returnTo } });
        if (error) throw error;
      } catch (error) {
        for (const control of signin.querySelectorAll('button')) control.disabled = false;
        say(error?.message || `We could not reach ${name}. Try the other one.`);
      }
    });
  }

  /*
   * Coming back from a provider.
   *
   * A refusal arrives in the query string under PKCE and in the fragment
   * under the older flow, and reading only one of them is how a failed
   * sign-in looks like a button that did nothing. On success the reader is
   * put straight back onto the plan they pressed before they left.
   */
  const failure = oauth?.readFailure();
  if (failure) {
    show(panel, true);
    show(signin, true);
    say(failure.message);
    oauth.clean();
  } else if (location.hash === '#plans') {
    let remembered = null;
    try {
      remembered = window.sessionStorage.getItem(REMEMBER);
    } catch {
      /* Nothing remembered; the reader picks again. */
    }
    if (remembered) {
      /* Consumed on sight: a reload should not re-open a checkout. */
      try {
        window.sessionStorage.removeItem(REMEMBER);
      } catch {
        /* Nothing to clear. */
      }
      supabaseClient()
        .then((client) => client.auth.getSession())
        .then(({ data }) => {
          if (data.session?.user) start(remembered);
        })
        .catch(() => {
          /* Offline or blocked. The buttons still work. */
        });
    }
  }
})();
