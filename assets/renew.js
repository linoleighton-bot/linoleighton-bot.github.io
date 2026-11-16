/**
 * The welcome-back offer, for a subscription that ran out.
 *
 * Somebody whose subscription lapsed has already decided once that the product
 * was worth paying for. What stopped them was the renewal, so the answer is a
 * cheaper renewal rather than the same price again — which is exactly what the
 * app does when it finds a lapsed reader (`app/index.tsx` sends them to
 * `/win-back`), and deliberately the same offer: one RevenueCat offering,
 * `Abandon Offer 2`, serving a phone and a browser the same discount.
 *
 * Four rules keep this page on the right side of the line, and all four are
 * enforced here rather than promised in copy:
 *
 *  - **Only a lapsed reader sees it.** The page asks Supabase for this
 *    account's entitlement row before it shows anything. Somebody still
 *    subscribed is told so and sent to their account; somebody who never
 *    subscribed is sent to the ordinary plans. A discount handed to everyone
 *    is not a win-back, it is a price cut with extra steps.
 *  - **The price is RevenueCat's, not this file's.** Every figure on the page
 *    is read off the package the till is about to charge. An offering with no
 *    web product in it therefore shows *no discount at all* rather than a
 *    number nothing will honour.
 *  - **The saving is arithmetic.** The headline per cent is worked out from
 *    the two annualised prices and both are printed underneath it. With no
 *    standard price to compare against, no per cent is claimed.
 *  - **The clock is real.** The deadline is written to the browser the first
 *    time the offer is shown and never extended, so closing the tab does not
 *    buy more time. Mirrors `RETURN_OFFER_WINDOW_MS` in the app.
 */
(function () {
  'use strict';

  const root = document.querySelector('[data-renew]');
  if (!root) return;

  const url = root.dataset.supabaseUrl;
  const key = root.dataset.supabaseKey;
  const checkoutKey = root.dataset.checkoutKey;
  if (!url || !key || !checkoutKey) return;

  const offeringId = root.dataset.offering || '';
  const fallbackOfferingId = root.dataset.offeringFallback || '';
  const windowDays = Number(root.dataset.windowDays) || 7;

  let wantedPackages = [];
  try {
    wantedPackages = JSON.parse(root.dataset.packages || '[]');
  } catch {
    wantedPackages = [];
  }

  /* The deadline, per browser. Not per device and not per account: a browser
     is the only thing this page can write to, and the app keeps its own. */
  const DEADLINE = 'mindroll.renew.deadline';

  const el = (name) => root.querySelector(`[data-renew-${name}]`);
  const states = new Map(
    [...root.querySelectorAll('[data-renew-state]')].map((node) => [node.dataset.renewState, node]),
  );

  const show = (name) => {
    for (const [id, node] of states) node.hidden = id !== name;
  };

  const status = el('status');
  const say = (message, kind = 'error') => {
    if (!status) return;
    status.textContent = message || '';
    status.dataset.kind = kind;
    status.hidden = !message;
  };

  /* Every place that figure appears, not just the first: the price is printed
     in the headline and again in the small print, and a page that disagrees
     with itself about what it charges is a refund. */
  const text = (name, value) => {
    for (const node of root.querySelectorAll(`[data-renew-${name}]`)) node.textContent = value;
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

  /* --------------------------------------------------------------- money */

  /* ISO 8601 durations, as the Web Billing SDK reports a billing period.
     Anything it does not recognise annualises as itself, which understates a
     saving rather than inventing one. */
  const YEARS_IN = { Y: 1, M: 1 / 12, W: 1 / 52, D: 1 / 365 };

  function yearsPerPeriod(duration) {
    const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(String(duration || ''));
    if (!match) return null;
    const years =
      Number(match[1] || 0) * YEARS_IN.Y +
      Number(match[2] || 0) * YEARS_IN.M +
      Number(match[3] || 0) * YEARS_IN.W +
      Number(match[4] || 0) * YEARS_IN.D;
    return years > 0 ? years : null;
  }

  /** What a package charges, as far as a comparison needs it. */
  function priceOf(pkg) {
    const product = pkg?.webBillingProduct;
    const price = product?.currentPrice;
    if (!price || typeof price.amountMicros !== 'number') return null;
    const years = yearsPerPeriod(product.normalPeriodDuration) ?? 1;
    return {
      formatted: price.formattedPrice || null,
      amount: price.amountMicros / 1_000_000,
      perYear: price.amountMicros / 1_000_000 / years,
      currency: price.currency || null,
      years,
    };
  }

  /**
   * The saving, in whole per cent, rounded down, and null under five.
   *
   * The same rule the app applies in `winback.ts`: a saving too small to be
   * worth a headline is not given one, and nothing is stated that the two
   * prices on the page do not show.
   */
  function percentSaved(standard, discounted) {
    if (!standard || !discounted || standard.perYear <= 0) return null;
    const saved = Math.floor(((standard.perYear - discounted.perYear) / standard.perYear) * 100);
    return saved >= 5 ? saved : null;
  }

  const periodWord = (years) => {
    if (!years) return 'period';
    if (Math.abs(years - 1) < 0.01) return 'year';
    if (Math.abs(years - 1 / 12) < 0.01) return 'month';
    if (Math.abs(years - 1 / 52) < 0.01) return 'week';
    return 'period';
  };

  /* ------------------------------------------------------------ the clock */

  const WINDOW_MS = windowDays * 24 * 60 * 60 * 1000;

  /**
   * This browser's deadline, created the first time the offer is shown.
   *
   * Returned as it was stored, expired or not. Nothing here extends a clock:
   * an offer that has run out stays run out, which is the whole difference
   * between a deadline and a decoration.
   */
  function deadline() {
    try {
      const stored = Number(window.localStorage.getItem(DEADLINE));
      if (Number.isFinite(stored) && stored > 0) return stored;
      const fresh = Date.now() + WINDOW_MS;
      window.localStorage.setItem(DEADLINE, String(fresh));
      return fresh;
    } catch {
      /* Storage blocked. The offer stands for this visit; a clock we cannot
         persist is one we must not pretend to have kept. */
      return Date.now() + WINDOW_MS;
    }
  }

  const pad = (n) => String(n).padStart(2, '0');

  function timeLeft(ms) {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days > 0) return `${days}d ${hours}:${pad(minutes)}:${pad(seconds)}`;
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
  }

  let ticking = null;
  function startClock(ends, onEnd) {
    const clock = el('clock');
    const tick = () => {
      const left = ends - Date.now();
      if (clock) clock.textContent = timeLeft(left);
      if (left <= 0) {
        window.clearInterval(ticking);
        ticking = null;
        onEnd();
      }
    };
    tick();
    ticking = window.setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------ the offer */

  const STILL_PAYING = new Set([
    'active',
    'trialing',
    'grace_period',
    'billing_issue',
    'cancelled_active',
  ]);

  /**
   * Whether this account has actually lapsed.
   *
   * Read from `subscription_entitlements`, the row RevenueCat's webhook
   * writes and the app reads, so the browser and the phone cannot disagree
   * about who is subscribed. A row still in a paying state means the reader
   * has nothing to win back; no row at all means they never subscribed, and
   * the ordinary plans are the honest page for them.
   */
  async function standing(user) {
    const client = await supabaseClient();
    const { data, error } = await client
      .from('subscription_entitlements')
      .select('state, plan, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return 'new';
    if (STILL_PAYING.has(data.state) || data.plan === 'pro') return 'paying';
    return 'lapsed';
  }

  let configured = null;

  /** The offering this page sells, asked for by name and never guessed at. */
  function pickOffering(offerings) {
    const sellable = (id) => {
      const offering = id ? offerings?.all?.[id] : null;
      const packages = (offering?.availablePackages || []).filter((p) => p.webBillingProduct);
      return packages.length ? { offering, packages } : null;
    };
    return sellable(offeringId) || sellable(fallbackOfferingId);
  }

  /** The package to charge: the preferred identifiers in order, then whatever is there. */
  function pickPackage(packages) {
    for (const wanted of wantedPackages) {
      const found = packages.find((p) => p.identifier === wanted);
      if (found) return found;
    }
    return packages[0] || null;
  }

  /** The full price to compare against: the offering the site ordinarily sells. */
  function standardPrice(offerings) {
    const candidates = [offerings?.all?.default, offerings?.current].filter(Boolean);
    for (const offering of candidates) {
      const packages = (offering.availablePackages || []).filter((p) => p.webBillingProduct);
      const annual = packages.find((p) => p.identifier === '$rc_annual') || packages[0];
      const price = priceOf(annual);
      if (price) return price;
    }
    return null;
  }

  /* ----------------------------------------------------------- the till */

  /* The SDK styles its own root `height: 100%`, so the box it mounts into
     needs a height to inherit. Matched to the form rather than pinned: a
     wallet button, a declined card and a 3-D Secure step are all different
     heights. Same approach as `plans.js`. */
  function fitTill(node) {
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
  }

  /*
   * Waits for the webhook to write the subscription, for up to fifteen
   * seconds. The app decides who is Pro from `subscription_entitlements`, and
   * that row lands a moment after the payment; returning before it does would
   * show somebody who has just paid the paywall again.
   */
  async function entitlementWritten(user) {
    const client = await supabaseClient();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const { data } = await client
        .from('subscription_entitlements')
        .select('plan')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data?.plan === 'pro') return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  /* A reader sent here by the web app goes back to it once they have paid. */
  const FROM_APP = 'mindroll.app.buying';
  function cameFromApp() {
    try {
      const yes = sessionStorage.getItem(FROM_APP) === '1';
      sessionStorage.removeItem(FROM_APP);
      return yes;
    } catch {
      return false;
    }
  }

  let buying = false;

  async function buy(user, pkg) {
    if (buying) return;
    buying = true;

    const till = el('till');
    const button = el('buy');
    if (button) button.disabled = true;
    say('');

    const unfit = fitTill(till);
    till.hidden = false;

    try {
      const result = await configured.purchase({
        rcPackage: pkg,
        htmlTarget: till,
        customerEmail: user.email || undefined,
      });
      const active = Object.keys(result?.customerInfo?.entitlements?.active || {});
      unfit();
      till.hidden = true;
      if (!active.length) {
        throw new Error('The payment went through but the plan did not open. Email us and we will fix it.');
      }

      if (ticking) window.clearInterval(ticking);
      /* The offer has been taken. Leaving the deadline behind would hold a
         spent clock against them if they ever lapse again. */
      try {
        window.localStorage.removeItem(DEADLINE);
      } catch {
        /* Nothing to clear. */
      }

      if (cameFromApp()) {
        show('bought');
        say('You are back in. Taking you to Mindroll…', 'ok');
        await entitlementWritten(user);
        window.location.assign('/app/');
        return;
      }
      show('bought');
    } catch (error) {
      unfit();
      till.hidden = true;
      if (button) button.disabled = false;
      buying = false;

      const code = error?.errorCode ?? error?.code;
      const cancelled =
        code === window.Purchases?.ErrorCode?.UserCancelledError ||
        /cancel/i.test(String(error?.message || ''));
      if (cancelled) {
        say('');
        return;
      }
      console.error('[renew]', error);
      say(
        /card|declin|insufficient|expired|cvc|postal|billing/i.test(String(error?.message || ''))
          ? error.message
          : 'We could not open the checkout just now. Nothing has been charged — please try again.',
      );
    }
  }

  /* ---------------------------------------------------------------- flow */

  async function offer(user) {
    const Purchases = await purchasesSdk();
    if (!configured) configured = Purchases.configure({ apiKey: checkoutKey, appUserId: user.id });

    const offerings = await configured.getOfferings();
    const picked = pickOffering(offerings);
    if (!picked) {
      /* The offering holds nothing this browser can buy. Say nothing about a
         discount — the ordinary plans are the honest page. */
      show('none');
      return;
    }

    const pkg = pickPackage(picked.packages);
    const price = priceOf(pkg);
    if (!pkg || !price) {
      show('none');
      return;
    }

    const standard = standardPrice(offerings);
    const saved = percentSaved(standard, price);

    text('price', price.formatted || '');
    text('period', periodWord(price.years));
    const wasRow = el('was-row');
    if (standard?.formatted && standard.perYear > price.perYear) {
      text('was', standard.formatted);
      if (wasRow) wasRow.hidden = false;
    } else if (wasRow) {
      wasRow.hidden = true;
    }

    const saveRow = el('save-row');
    if (saved) {
      text('save', `${saved}%`);
      if (saveRow) saveRow.hidden = false;
    } else if (saveRow) {
      saveRow.hidden = true;
    }

    const ends = deadline();
    if (ends - Date.now() <= 0) {
      show('ended');
      return;
    }

    show('offer');
    startClock(ends, () => show('ended'));

    const button = el('buy');
    if (button) button.addEventListener('click', () => buy(user, pkg));
  }

  async function begin() {
    show('loading');
    try {
      const client = await supabaseClient();
      const { data } = await client.auth.getSession();
      const user = data.session?.user ?? null;

      if (!user) {
        show('signin');
        return;
      }

      const where = await standing(user);
      if (where === 'paying') {
        show('paying');
        return;
      }
      if (where === 'new') {
        show('none');
        return;
      }

      await offer(user);
    } catch (error) {
      console.error('[renew]', error);
      show('none');
      say('We could not load your offer just now. The usual plans are below.');
    }
  }

  /* ------------------------------------------------------------ sign-in */

  const oauth = window.mindrollOAuth;
  const signin = states.get('signin');

  for (const button of signin ? signin.querySelectorAll('[data-oauth]') : []) {
    button.addEventListener('click', async () => {
      const provider = button.dataset.oauth;
      const name = oauth ? oauth.label(provider) : provider;
      const returnTo = `${location.origin}${root.dataset.return || '/renew'}`;

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

  const failure = oauth?.readFailure();
  if (failure) {
    show('signin');
    say(failure.message);
    oauth.clean();
  } else {
    begin();
  }
})();
