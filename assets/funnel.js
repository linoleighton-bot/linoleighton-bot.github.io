/*
 * The funnel.
 *
 * Every step is already in the document — this hides all but one, remembers the
 * answers, and at the end hands them to Supabase and the reader to a checkout.
 * With this file blocked the page is still the whole questionnaire, stacked and
 * readable, which is the reason the steps are rendered server-side at all.
 *
 * Three things it is careful about, because each one costs a paying reader:
 *
 *  - **Answers survive a reload.** People close a tab mid-funnel, follow a link
 *    and come back. Losing nine answers to a refresh loses the person too.
 *  - **The account is made before the payment.** A purchase has to belong to
 *    somebody the app can recognise, and the only identity the browser and the
 *    app share is the Supabase user id.
 *  - **The answers are written the moment the account exists**, not after the
 *    payment. Somebody who signs up and does not subscribe has still told us
 *    what they want, and the app should open on their plan rather than ask
 *    every question a second time.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-funnel]');
  const dataEl = document.getElementById('funnel-data');
  if (!root || !dataEl) return;

  let boot;
  try {
    boot = JSON.parse(dataEl.textContent);
  } catch {
    return; // Leave the page as the plain stacked questionnaire.
  }

  const stepEls = new Map([...root.querySelectorAll('[data-step]')].map((el) => [el.dataset.step, el]));
  const order = boot.steps.map((s) => s.id).filter((id) => stepEls.has(id));
  const byId = Object.fromEntries(boot.steps.map((s) => [s.id, s]));

  const backBtn = root.querySelector('[data-back]');
  const countEl = root.querySelector('[data-count]');
  const labelEl = root.querySelector('[data-section-label]');

  /* ----------------------------------------------------------------- state */

  const KEY = 'mindroll.funnel.v1';

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  };

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(answers));
    } catch {
      /* Private window, or storage refused. The funnel still works forwards. */
    }
  };

  const answers = load();
  let index = 0;

  /* Mark the funnel taken over, which switches the stylesheet from the stacked
     no-script layout to one step at a time. */
  root.dataset.live = 'on';

  /* ------------------------------------------------------------ navigation */

  /**
   * Fill the bar for the section being answered, tick off the ones behind it.
   *
   * Progress is per-section rather than per-funnel, because that is the whole
   * point of splitting it: the reader is three questions into "Honestly", not
   * seven questions into eighteen.
   */
  function paintProgress(id) {
    const step = byId[id];

    /*
     * How many questions are behind this step, by position in the flow.
     *
     * Not "is this a question and what is its index" — that cannot tell the
     * opening screen from the plan, and treating both as "outside the
     * questions" once showed every section complete on the landing page.
     * Position in the order answers it for every kind of step.
     */
    const passed = order.slice(0, index).filter((sid) => byId[sid]?.counts).length;

    for (const section of boot.sections) {
      const el = root.querySelector(`[data-section="${section.id}"]`);
      if (!el) continue;

      const answeredHere = boot.questions
        .slice(0, passed)
        .filter((qid) => byId[qid]?.section === section.id).length;

      const ratio = section.count ? Math.min(1, answeredHere / section.count) : 0;
      el.querySelector('[data-section-fill]').style.width = `${Math.round(ratio * 100)}%`;
      el.toggleAttribute('data-done', ratio === 1);
      el.toggleAttribute('data-current', section.id === step.section);
    }

    if (labelEl) {
      const section = boot.sections.find((sec) => sec.id === step.section);
      labelEl.textContent = section ? section.label : '';
    }
    if (countEl) countEl.textContent = step.counts ? `${passed + 1} of ${boot.questions.length}` : '';
  }

  function render({ push = true } = {}) {
    const id = order[index];

    for (const [stepId, el] of stepEls) el.hidden = stepId !== id;

    paintProgress(id);
    if (backBtn) backBtn.hidden = index === 0;

    /*
     * `currentStep`, not `step`.
     *
     * Each section already carries `data-step="<id>"`. Putting the same
     * attribute on the root meant `[data-step="name"] [data-next]` matched the
     * root as well — and the root contains every step, so it answered with the
     * *first* Continue button in the funnel rather than the name step's own.
     * A selector that silently returns the wrong element is worse than one
     * that returns nothing.
     */
    root.dataset.currentStep = id;

    /*
     * The step goes in the URL.
     *
     * It makes the browser's own Back button do the obvious thing, it makes a
     * half-finished funnel a link somebody can be sent back to, and it is what
     * lets analytics say which question people leave on — which is the only
     * number that tells you what to fix.
     */
    /*
     * Wrapped, because not every host allows it.
     *
     * A sandboxed frame can refuse `pushState` outright, and an uncaught throw
     * here happens before the steps are shown — which turns "the URL did not
     * update" into a blank page. The address bar is a convenience; the funnel
     * working is not.
     */
    if (push) {
      try {
        const url = `${location.pathname}?q=${encodeURIComponent(id)}`;
        if (location.search !== `?q=${id}`) history.pushState({ step: id }, '', url);
      } catch {
        /* No history access here. The step still renders. */
      }
    }

    window.scrollTo(0, 0);

    const step = byId[id];

    /*
     * Never ask a signed-in reader to make an account.
     *
     * They may have signed in on the previous screen, or arrived with a session
     * from a past visit. Showing the form again reads as the sign-in not having
     * worked, and somebody who thinks it did not work does not then pay.
     */
    if (step.kind === 'account' && user) {
      persist();
      const at = order.indexOf('offer');
      if (at !== -1 && at !== index) {
        index = at;
        render({ push });
        return;
      }
    }

    if (step.kind === 'insight') fillInsight(id);
    if (step.kind === 'note') fillNote(id);
    if (step.kind === 'books') showShelf(id);
    if (step.kind === 'build') runBuild();
    if (step.kind === 'plan') fillPlan();
    if (step.kind === 'done') markDone();

    /* Move the focus to the new heading, or a keyboard user is left where the
       previous step was and a screen reader announces nothing. */
    const heading = stepEls.get(id).querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  const go = (delta) => {
    /* The slide follows the direction of travel: forward moves in from the
       right, Back from the left. A screen that always arrives the same way
       makes Back feel like another step forward. */
    root.toggleAttribute('data-back', delta < 0);
    index = Math.max(0, Math.min(order.length - 1, index + delta));
    render();
  };

  const next = () => go(1);

  if (backBtn) backBtn.addEventListener('click', () => go(-1));

  addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('q');
    const at = order.indexOf(id);
    if (at !== -1 && at !== index) {
      index = at;
      render({ push: false });
    }
  });

  /* ------------------------------------------------------------- questions */

  for (const [id, el] of stepEls) {
    const step = byId[id];
    if (!step) continue;

    if (['single', 'multi', 'grid', 'scale', 'books'].includes(step.kind)) {
      const buttons = [...el.querySelectorAll('[data-option]')];
      /* Each option carries its position, so the stylesheet can bring them in
         one after another instead of all at once. */
      buttons.forEach((button, i) => button.style.setProperty('--i', String(i)));
      const cta = el.querySelector('[data-next]');

      const paint = () => {
        const held = answers[step.answer];
        const chosen = Array.isArray(held) ? held : held == null ? [] : [held];
        for (const button of buttons) {
          const on = chosen.includes(button.dataset.option);
          button.setAttribute('aria-checked', String(on));
          button.toggleAttribute('data-chosen', on);
        }
        if (cta) cta.disabled = chosen.length === 0;
      };

      for (const button of buttons) {
        button.addEventListener('click', () => {
          const value = button.dataset.option;

          if (['multi', 'grid', 'books'].includes(step.kind)) {
            const held = Array.isArray(answers[step.answer]) ? answers[step.answer] : [];
            answers[step.answer] = held.includes(value) ? held.filter((v) => v !== value) : [...held, value];
          } else {
            /* `wrap` marks an answer the app stores as an array even though
               only one may be picked — the column is a text[] either way. */
            answers[step.answer] = step.wrap ? [value] : value;
          }

          save();
          paint();

          /* A single-answer step advances itself: a tap is the answer, and a
             Continue button underneath it is one more thing to find. */
          if (step.kind === 'single' || step.kind === 'scale') window.setTimeout(next, 180);
        });
      }

      paint();
      if (cta) cta.addEventListener('click', next);

      /*
       * "None of these" is a real answer, not an escape.
       *
       * Somebody who recognises none of the five is telling us something worth
       * knowing, and a Continue that stays disabled until they pick a book they
       * have not read is a screen that teaches people to lie.
       */
      const skipBooks = el.querySelector('[data-skip]');
      if (skipBooks) {
        skipBooks.addEventListener('click', () => {
          answers[step.answer] = [];
          save();
          next();
        });
      }
      if (step.kind === 'books' && cta) cta.disabled = false;
    }

    if (step.kind === 'text') {
      const cta = el.querySelector('[data-next]');
      const skip = el.querySelector('[data-skip]');

      const field = () => el.querySelector('[data-input]');
      if (answers[step.answer]) {
        const input = field();
        if (input) input.value = answers[step.answer];
      }

      /*
       * The field is read at the moment of the click, not captured when the
       * handler was attached.
       *
       * A captured reference is one DOM change away from being the wrong node
       * — and when it is wrong there is no error, just a value that silently
       * never saves. This step holds the reader's name, which the app greets
       * them by; losing it is invisible here and obvious on their first
       * morning.
       */
      const commit = () => {
        const value = (field()?.value || '').trim();
        if (value) answers[step.answer] = value;
        else delete answers[step.answer];
        save();
        next();
      };

      if (cta) cta.addEventListener('click', commit);
      el.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || !event.target.matches('[data-input]')) return;
        event.preventDefault();
        commit();
      });
      if (skip) {
        skip.addEventListener('click', () => {
          delete answers[step.answer];
          save();
          next();
        });
      }
    }

    if (['hook', 'insight', 'note', 'plan'].includes(step.kind)) {
      const cta = el.querySelector('[data-next]');
      if (cta) cta.addEventListener('click', next);
    }
  }

  /* --------------------------------------------------------- insight copy */

  /**
   * The two screens that answer the struggle just given.
   *
   * They are the reason the struggle question is asked before anything is sold:
   * a reader who has just named their own failure is handed a screen that says
   * it is not one. Generic copy here would waste the answer.
   */
  function fillInsight(id) {
    const chosen = answers.struggle;
    const copy = boot.struggles[chosen];
    if (!copy) return;

    const el = stepEls.get(id);
    const set = (name, text) => {
      const node = el.querySelector(`[data-fill="${name}"]`);
      if (node && text) node.textContent = text;
    };

    if (id === 'mirror') {
      set('title', copy.mirrorTitle);
      set('body', copy.mirrorBody);
      set('answer', copy.mirrorAnswer);
    } else if (id === 'potential') {
      set('title', copy.potentialTitle);
    }
  }

  /**
   * The between-question screens that quote an answer back.
   *
   * `{goalPhrase}` is the goal in our voice rather than theirs — the config
   * carries both, because "boost my productivity" reads wrongly when we say it.
   */
  function fillNote(id) {
    const template = boot.notes[id];
    if (!template) return;

    const goalId = Array.isArray(answers.goals) ? answers.goals[0] : answers.goals;
    const goal = boot.goals[goalId];

    const node = stepEls.get(id).querySelector('[data-fill="body"]');
    if (!node) return;

    node.textContent = template.replace('{goalPhrase}', goal ? goal.phrase : 'read more and keep it');
  }

  /**
   * Show the shelf that matches the goal, hide the rest.
   *
   * Every goal's five books are in the document; only one set is ever on
   * screen. A reader who goes back and changes their goal gets the new shelf,
   * because this runs on every render rather than once.
   */
  function showShelf(id) {
    const goalId = Array.isArray(answers.goals) ? answers.goals[0] : answers.goals;
    const el = stepEls.get(id);
    const shelves = [...el.querySelectorAll('[data-shelf]')];
    let shown = false;

    for (const shelf of shelves) {
      const match = shelf.dataset.shelf === goalId;
      shelf.hidden = !match;
      if (match) shown = true;
    }

    /* No goal answered — fall back to the first shelf rather than an empty
       screen with a Continue button and nothing above it. */
    if (!shown && shelves[0]) shelves[0].hidden = false;
  }

  /* ------------------------------------------------------------ the build */

  let built = false;

  function runBuild() {
    const el = stepEls.get('building');
    const lines = [...el.querySelectorAll('.fbuild__line')];
    const bar = el.querySelector('[data-build-bar]');

    if (built) {
      next();
      return;
    }
    built = true;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const per = reduced ? 120 : 520;

    lines.forEach((line, i) => {
      window.setTimeout(() => {
        line.setAttribute('data-done', 'true');
        if (bar) bar.style.width = `${Math.round(((i + 1) / lines.length) * 100)}%`;
      }, per * (i + 1));
    });

    window.setTimeout(next, per * (lines.length + 1));
  }

  /* -------------------------------------------------------------- the plan */

  const pad = (n) => String(n).padStart(2, '0');

  /** The plan, said back in the reader's own answers. */
  function planValues() {
    const goalId = Array.isArray(answers.goals) ? answers.goals[0] : answers.goals;
    const goal = boot.goals[goalId];
    const ideas = boot.commitment[answers.commitment] ?? 5;
    const hour = boot.energy[answers.energyWindow];

    return {
      goalLabel: goal ? goal.label : 'Read more, forget less',
      commitmentLine: `${ideas} ideas, about ${ideas} minutes`,
      reminderLine: hour == null ? 'Whenever suits you' : `${pad(hour)}:00, every day`,
      formatLabel: boot.formats[answers.format] || 'Reading',
      topicLine: goal ? goal.topics.join(', ') : '—',
      ladderLine: `${boot.ladder.join(', ')} days`,
    };
  }

  function fillPlan() {
    const values = planValues();
    for (const [key, value] of Object.entries(values)) {
      const node = root.querySelector(`[data-plan="${key}"]`);
      if (node) node.textContent = value;
    }
  }

  /* ---------------------------------------------------------------- account */

  let client = null;
  let user = null;

  if (boot.accounts && boot.supabase && window.supabase) {
    client = window.supabase.createClient(boot.supabase.url, boot.supabase.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    client.auth.getSession().then(({ data }) => {
      user = data.session?.user ?? null;
      if (user) showSignedIn();
    });

    /* A sign-in in another tab, or a token refresh, must not leave this page
       believing the reader is a stranger. */
    client.auth.onAuthStateChange((_event, session) => {
      user = session?.user ?? null;
      if (user) showSignedIn();
    });
  }

  const accountEl = stepEls.get('account');

  /*
   * Apple and Google, which is how the app signs people in.
   *
   * A provider takes the browser away from this page and brings it back, so
   * `redirectTo` has to name the step to return to. The answers are already in
   * localStorage, so the funnel resumes with everything intact — and because
   * the reader now has a session, `render()` steps straight past the account
   * screen to the offer rather than asking again.
   *
   * The redirect URL must be on Supabase's allow-list for the project or the
   * provider returns here with an error and no session. That is a dashboard
   * setting; `signInWithOAuth` cannot arrange it.
   */
  if (client && accountEl) {
    const status = accountEl.querySelector('[data-auth-status]');
    const tell = (message, kind = 'error') => {
      if (!status) return;
      status.textContent = message || '';
      status.dataset.kind = kind;
      status.hidden = !message;
    };

    for (const button of accountEl.querySelectorAll('[data-oauth]')) {
      button.addEventListener('click', async () => {
        const provider = button.dataset.oauth;
        const label = provider === 'apple' ? 'Apple' : 'Google';

        for (const control of accountEl.querySelectorAll('button, input')) control.disabled = true;
        tell(`Taking you to ${label}…`, 'busy');

        try {
          const { error } = await client.auth.signInWithOAuth({
            provider,
            options: { redirectTo: `${location.origin}${location.pathname}?q=account` },
          });
          if (error) throw error;
          /* On success the browser leaves; nothing after this runs. */
        } catch (error) {
          for (const control of accountEl.querySelectorAll('button, input')) control.disabled = false;
          tell(error?.message || `We could not reach ${label}. Try email instead.`);
        }
      });
    }

    /* A provider that refuses comes back with the reason in the fragment. */
    const failed = new URLSearchParams(location.hash.slice(1)).get('error_description');
    if (failed) {
      tell(decodeURIComponent(failed.replace(/\+/g, ' ')));
      try {
        history.replaceState(null, '', `${location.pathname}${location.search}`);
      } catch {
        /* No history access; the message is shown either way. */
      }
    }

    /* The email half, kept out of the way until it is asked for. */
    const emailToggle = accountEl.querySelector('[data-email-toggle]');
    const emailForm = accountEl.querySelector('.signin__emailform');
    if (emailToggle && emailForm) {
      emailToggle.addEventListener('click', () => {
        const open = emailForm.hidden;
        emailForm.hidden = !open;
        emailToggle.setAttribute('aria-expanded', String(open));
        emailToggle.textContent = open ? 'Use a provider instead' : 'Use email instead';
        if (open) emailForm.querySelector('input[name="email"]')?.focus();
      });
    }
  }

  if (client && accountEl) {
    const form = accountEl.querySelector('[data-auth-form]');
    const status = accountEl.querySelector('[data-auth-status]');
    const submit = accountEl.querySelector('[data-auth-submit]');
    const toggle = accountEl.querySelector('[data-auth-toggle]');
    let mode = 'sign-up';

    const say = (message, kind = 'error') => {
      if (!status) return;
      status.textContent = message || '';
      status.dataset.kind = kind;
      status.hidden = !message;
    };

    if (toggle) {
      toggle.addEventListener('click', () => {
        mode = mode === 'sign-up' ? 'sign-in' : 'sign-up';
        if (submit) submit.textContent = mode === 'sign-up' ? 'Create account' : 'Sign in';
        toggle.textContent = mode === 'sign-up' ? 'I already have an account' : 'Create an account instead';
        const password = form?.querySelector('input[name="password"]');
        if (password) password.autocomplete = mode === 'sign-up' ? 'new-password' : 'current-password';
        say('');
      });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.querySelector('input[name="email"]').value.trim();
      const password = form.querySelector('input[name="password"]').value;

      if (!email || !password) return say('Email and password, please.');
      if (mode === 'sign-up' && password.length < 8) return say('Use at least 8 characters.');

      for (const control of form.querySelectorAll('input, button')) control.disabled = true;
      say(mode === 'sign-up' ? 'Creating your account…' : 'Signing you in…', 'busy');

      try {
        const result =
          mode === 'sign-up'
            ? await client.auth.signUp({ email, password })
            : await client.auth.signInWithPassword({ email, password });

        if (result.error) throw result.error;

        user = result.data.user ?? result.data.session?.user ?? null;

        /*
         * No session means the project requires a confirmed email. The account
         * exists and the answers cannot be written yet, so say so plainly
         * rather than sending them to a checkout that has nobody to bill.
         */
        /*
         * No session means the project is set to confirm addresses by email.
         * The account exists but nothing can be written to it yet and there is
         * nobody to bill, so this has to be a real instruction rather than a
         * shrug — and the answers stay in this browser, so coming back and
         * signing in picks up exactly here.
         */
        if (!result.data.session) {
          say(
            `Almost there. We have sent a confirmation link to ${email} — open it, ` +
              `then come back to this page and sign in. Your answers are saved.`,
            'ok',
          );
          if (toggle) toggle.hidden = false;
          return;
        }

        await persist();
        say('');
        next();
      } catch (error) {
        say(error?.message || 'That did not work. Try again in a moment.');
      } finally {
        for (const control of form.querySelectorAll('input, button')) control.disabled = false;
      }
    });
  }

  /** Swap the form for a line saying who is signed in. */
  function showSignedIn() {
    if (!accountEl || !user) return;
    const form = accountEl.querySelector('[data-auth-form]');
    const toggle = accountEl.querySelector('[data-auth-toggle]');
    const status = accountEl.querySelector('[data-auth-status]');
    if (form) form.hidden = true;
    if (toggle) toggle.hidden = true;
    if (status) {
      status.textContent = `Signed in as ${user.email}. Your plan is saved to this account.`;
      status.dataset.kind = 'ok';
      status.hidden = false;
    }
  }

  /**
   * Write the answers to the account.
   *
   * Straight into the columns the app already reads — no separate web table to
   * reconcile later. A failure here must not block the funnel: the answers are
   * still in this browser, and an account without preferences is a reader the
   * app will ask once, not a reader who is lost.
   */
  async function persist() {
    if (!client || !user) return;

    const goals = Array.isArray(answers.goals) ? answers.goals : answers.goals ? [answers.goals] : [];
    const hour = boot.energy[answers.energyWindow];
    const ideas = boot.commitment[answers.commitment];

    const preferences = {
      user_id: user.id,
      onboarding_step: 'offer',
      onboarding_completed_at: new Date().toISOString(),
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    };

    if (goals.length) preferences.goals = goals;
    if (Array.isArray(answers.outcomes) && answers.outcomes.length) preferences.outcomes = answers.outcomes;
    if (answers.habitLevel) preferences.habit_level = answers.habitLevel;
    if (answers.format) preferences.format = answers.format;
    if (ideas) preferences.daily_goal_ideas = ideas;
    if (hour != null) preferences.reminder_hour = hour;

    try {
      await client.from('user_preferences').upsert(preferences, { onConflict: 'user_id' });
      if (answers.name) {
        await client.from('profiles').update({ display_name: answers.name }).eq('id', user.id);
      }
    } catch {
      /* Kept locally; the app asks once rather than never opening. */
    }
  }

  /* --------------------------------------------------------------- checkout */

  const offerEl = stepEls.get('offer');
  if (offerEl) {
    const planButtons = [...offerEl.querySelectorAll('[data-plan-id]')];
    let plan = boot.plans.find((p) => p.recommended)?.id || boot.plans[0]?.id || null;

    const smallprint = offerEl.querySelector('[data-plan-smallprint]');

    const paint = () => {
      for (const button of planButtons) {
        const on = button.dataset.planId === plan;
        button.setAttribute('aria-checked', String(on));
        button.toggleAttribute('data-chosen', on);
      }

      /*
       * State the charge for the plan actually selected.
       *
       * The cards lead with a per-week or per-day figure, which is the
       * convention and is fine — as long as the amount that leaves the
       * reader's account is written somewhere they cannot miss, for the plan
       * they have chosen rather than the one they have not.
       */
      if (!smallprint) return;
      const chosen = boot.plans.find((p) => p.id === plan);
      if (!chosen) return;

      const every = chosen.period === 'year' ? 'year' : 'week';
      smallprint.textContent = chosen.trialDays
        ? `${chosen.trialDays} days free, then ${chosen.amount} every ${every}. Cancel any time before it ends and you are not charged.`
        : `${chosen.amount} every ${every}, starting today.`;
    };

    for (const button of planButtons) {
      button.addEventListener('click', () => {
        plan = button.dataset.planId;
        paint();
      });
    }
    paint();

    const checkout = offerEl.querySelector('[data-checkout]');
    if (checkout && boot.checkout) {
      checkout.addEventListener('click', () => {
        if (!user) {
          index = order.indexOf('account');
          render();
          return;
        }

        /*
         * The App User ID is the Supabase user id, which is what ties a payment
         * taken in a browser to the account the app signs into. Sending
         * anything else here produces a subscription nobody can find.
         *
         * The path token is the purchase link's own, generated per link in the
         * RevenueCat dashboard — not the public API key. `package_id` is the
         * documented way to land on the chosen plan's checkout rather than the
         * picker, and `email` prefills the payment page. There is no documented
         * redirect parameter: where the checkout returns to is set against the
         * link in the dashboard.
         */
        const base = boot.checkout.url
          .replace('{token}', encodeURIComponent(boot.checkout.token))
          .replace('{user}', encodeURIComponent(user.id));

        const params = new URLSearchParams();
        const chosen = boot.plans.find((p) => p.id === plan);
        if (chosen?.packageId) params.set('package_id', chosen.packageId);
        if (user.email) params.set('email', user.email);

        const query = params.toString();
        window.location.href = query ? `${base}?${query}` : base;
      });
    }
  }

  /* ------------------------------------------------------------------- done */

  function markDone() {
    /* The funnel is finished: stop restoring it on the next visit. */
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* Nothing to clean up. */
    }
  }

  /* ------------------------------------------------------------------ start */

  /*
   * Come back to where they stopped.
   *
   * Only as far as the last question they answered — never into the account or
   * the offer, which would put a price in front of somebody who has not yet
   * been shown a plan.
   */
  const lastAnswered = boot.questions.filter((id) => {
    const step = byId[id];
    const held = answers[step?.answer];
    return Array.isArray(held) ? held.length > 0 : held != null;
  });

  if (lastAnswered.length) {
    const resumeAt = order.indexOf(lastAnswered[lastAnswered.length - 1]);
    if (resumeAt > 0) index = Math.min(resumeAt + 1, order.indexOf('building'));
  }

  render();
})();
