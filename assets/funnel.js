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

    if (['hook', 'insight', 'note', 'plan', 'pledge'].includes(step.kind)) {
      /* A pledge has two buttons and both go forward. */
      for (const cta of el.querySelectorAll('[data-next]')) {
        cta.addEventListener('click', next);
      }
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

    /*
     * A session that arrives after the account step is already on screen.
     *
     * This is the ordinary case coming back from a provider: the page opens at
     * `?q=account`, draws the sign-in screen, and the session resolves a moment
     * later. `render` is what moves a signed-in reader on to the offer, and
     * nothing was calling it again — so a *successful* sign-in left the reader
     * looking at the sign-in screen, which is indistinguishable from a failed
     * one. Re-rendering hands the step back to the skip that already exists.
     */
    const sessionArrived = (session) => {
      const wasSignedOut = !user;
      user = session?.user ?? null;
      if (!user) return;
      showSignedIn();
      if (wasSignedOut && byId[order[index]]?.kind === 'account') render({ push: false });
    };

    client.auth.getSession().then(({ data }) => sessionArrived(data.session));

    /* A sign-in in another tab, or a token refresh, must not leave this page
       believing the reader is a stranger. */
    client.auth.onAuthStateChange((_event, session) => sessionArrived(session));
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

    const oauth = window.mindrollOAuth;
    const returnTo = `${location.origin}${location.pathname}?q=account`;

    /*
     * A provider that cannot work is taken off the screen before it is clicked.
     *
     * `preflight` asks the auth server whether the provider would actually go
     * anywhere. A provider switched on without a client secret answers 400 with
     * a JSON body, and since `signInWithOAuth` navigates rather than fetches,
     * clicking it used to drop the reader onto a Supabase URL showing raw JSON.
     *
     * Runs unawaited: the buttons start usable, and only a definite refusal
     * takes one away. A slow or failed check leaves everything as it was.
     */
    const unusable = new Map();
    for (const button of accountEl.querySelectorAll('[data-oauth]')) {
      const provider = button.dataset.oauth;
      if (!oauth) break;
      oauth.preflight(boot.supabase.url, provider, returnTo).then((verdict) => {
        if (verdict.ok) return;
        unusable.set(provider, verdict.message);
        oauth.retire(button, accountEl);
      });
    }

    for (const button of accountEl.querySelectorAll('[data-oauth]')) {
      button.addEventListener('click', async () => {
        const provider = button.dataset.oauth;
        const label = oauth ? oauth.label(provider) : provider;

        /* Known bad from the check above, or from a previous click. */
        if (unusable.has(provider)) {
          tell(`${unusable.get(provider)} Use your email address instead.`);
          return;
        }

        const controls = accountEl.querySelectorAll('button, input');
        for (const control of controls) control.disabled = true;
        tell(`Taking you to ${label}…`, 'busy');

        const restore = () => {
          for (const control of controls) control.disabled = false;
        };

        try {
          /* The check may not have finished, or may not have run at all. One
             round trip here is cheaper than a dead end on somebody else's
             domain, and on the happy path it overlaps nothing the reader sees. */
          if (oauth) {
            const verdict = await oauth.preflight(boot.supabase.url, provider, returnTo);
            if (!verdict.ok) {
              unusable.set(provider, verdict.message);
              restore();
              oauth.retire(button, accountEl);
              tell(`${verdict.message} Use your email address instead.`);
              return;
            }
          }

          const { error } = await client.auth.signInWithOAuth({
            provider,
            options: { redirectTo: returnTo },
          });
          if (error) throw error;
          /* On success the browser leaves; nothing after this runs. */
        } catch (error) {
          restore();
          tell(error?.message || `We could not reach ${label}. Try email instead.`);
        }
      });
    }

    /*
     * A provider that refused sends the reader back here with the reason in the
     * URL — in the query string under PKCE, in the fragment under the older
     * implicit flow. Reading only the fragment, which this did, meant every
     * refusal looked like a button that simply did nothing.
     */
    const failure = oauth?.readFailure();
    if (failure) {
      tell(failure.message);
      oauth.clean();
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

        /*
         * Only if nothing has moved already.
         *
         * `onAuthStateChange` also reacts to this sign-in, and when it wins the
         * race it re-renders the account step — which is what carries a
         * signed-in reader on to the offer. Calling `next()` unconditionally
         * then advanced a second time, straight past the offer to the closing
         * screen: an account created, the answers saved, and the price never
         * shown. Whichever of the two fires first, the reader lands on the
         * offer exactly once.
         */
        if (byId[order[index]]?.kind === 'account') next();
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
    /*
     * The recommended plan, unless the reader has already picked one.
     *
     * The pricing on the marketing page links here with `?plan=`, so somebody
     * who clicked "Annual" over there arrives with Annual selected rather than
     * having to choose it a second time. An unknown value falls back rather
     * than selecting nothing, because a paywall with no plan chosen has a
     * button that cannot be pressed.
     */
    const asked = new URLSearchParams(location.search).get('plan');
    let plan =
      boot.plans.find((p) => p.id === asked)?.id ||
      boot.plans.find((p) => p.recommended)?.id ||
      boot.plans[0]?.id ||
      null;

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
      const chosen = boot.plans.find((p) => p.id === plan);
      if (!chosen) return;

      /*
       * The button promises what the *selected* plan actually gives.
       *
       * It was built once from the longest trial on offer, so choosing the
       * weekly plan — which has no trial — left a button reading "Start my 3
       * days free" above small print saying £19.99 would be taken today. That
       * is a misleading price claim, not a typo: it is the kind of thing the
       * CMA acts on, and the reader finds out at the card form.
       */
      const button = offerEl.querySelector('[data-checkout]');
      if (button) {
        button.textContent = chosen.trialDays
          ? `Start my ${chosen.trialDays} days free`
          : 'Subscribe';
      }

      if (!smallprint) return;
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
    const till = offerEl.querySelector('[data-till]');

    /*
     * The SDK, fetched the first time somebody actually means to buy.
     *
     * It is most of a megabyte, and thirty screens come before this one. Asked
     * for at the top of the funnel it would be a megabyte spent on the large
     * majority who never reach the offer; asked for here it downloads while
     * the reader is reading two prices. Cached after the first call, so a
     * second attempt after a declined card is instant.
     */
    let sdk = null;
    const loadSdk = () => {
      if (sdk) return sdk;
      sdk = new Promise((resolve, reject) => {
        if (window.Purchases?.Purchases) return resolve(window.Purchases.Purchases);
        const tag = document.createElement('script');
        tag.src = '/assets/vendor/purchases.js';
        tag.async = true;
        tag.onload = () =>
          window.Purchases?.Purchases
            ? resolve(window.Purchases.Purchases)
            : reject(new Error('The checkout loaded but did not start.'));
        tag.onerror = () => {
          /* Let a later attempt try again rather than caching the failure. */
          sdk = null;
          reject(new Error('We could not load the checkout. Check your connection.'));
        };
        document.head.appendChild(tag);
      });
      return sdk;
    };

    /*
     * One configured instance per reader.
     *
     * `appUserId` is the Supabase user id — the same value the app hands
     * RevenueCat at sign-in, which is the whole reason a subscription bought
     * in a browser is already there when the app opens. Anything else here
     * buys a subscription nobody can find.
     */
    let configured = null;
    const instance = async (Purchases) => {
      if (configured) return configured;
      configured = Purchases.configure({ apiKey: boot.checkout.key, appUserId: user.id });
      return configured;
    };

    /**
     * Give the checkout somewhere with a height to be drawn in.
     *
     * The SDK styles its own root as `height: 100%`, which means it inherits
     * whatever the target element is — and an empty `<div>` is nothing. The
     * form rendered at its full 559px and was then clipped to 26px by a parent
     * that had no reason to be any taller, so the reader saw a Stripe badge
     * and no card fields.
     *
     * Matched to the form rather than given a fixed height, because the form
     * is not one height: a wallet button, a declined card, a 3-D Secure step
     * and a billing address field each change it, and a checkout that clips
     * the Pay button at the moment a bank asks for confirmation is worse than
     * one that never opened.
     *
     * Returns the function that stops watching and puts the element back.
     */
    const fitTill = (node) => {
      if (!node) return () => {};

      const inner = () => node.querySelector('.rc-checkout-form-container') || node.firstElementChild;

      /* No ResizeObserver: one generous height, which is the old behaviour of
         every checkout that ever shipped in an iframe. */
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
        /* A one-pixel difference is rounding, not a resize; reacting to it
           would have the observer feeding itself for ever. */
        if (height > 0 && Math.abs(height - node.offsetHeight) > 2) {
          node.style.height = `${height}px`;
        }
      });

      /* The SDK mounts asynchronously, so watch the target until the form
         appears, then watch the form. */
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

    const say = (message, kind = 'error') => {
      const node = offerEl.querySelector('[data-checkout-status]');
      if (!node) return;
      node.textContent = message || '';
      node.dataset.kind = kind;
      node.hidden = !message;
    };

    if (checkout && boot.checkout) {
      checkout.addEventListener('click', async () => {
        /* No account, no identity to attach a subscription to. */
        if (!user) {
          index = order.indexOf('account');
          render();
          return;
        }

        const chosen = boot.plans.find((p) => p.id === plan);
        checkout.disabled = true;
        say('Opening the checkout…', 'busy');
        let unfit = null;

        try {
          const Purchases = await loadSdk();
          const purchases = await instance(Purchases);

          const offerings = await purchases.getOfferings();
          const current = offerings?.current;
          if (!current) throw new Error('No plans are available right now.');

          /*
           * Matched on RevenueCat's own package identifier rather than on
           * position. `$rc_annual` and `$rc_weekly` are what the dashboard
           * calls them, and the prices printed above came from the same two
           * ids — so if a package is renamed this fails loudly here instead of
           * quietly selling the wrong one.
           */
          const pkg =
            current.availablePackages.find((c) => c.identifier === chosen?.packageId) ||
            current.availablePackages.find((c) => c.webBillingProduct);
          if (!pkg) throw new Error('That plan is not available right now.');

          say('');
          if (till) till.hidden = false;
          unfit = fitTill(till);

          const result = await purchases.purchase({
            rcPackage: pkg,
            /* Drawn into the page. Without a target the SDK opens its own
               overlay, which is still ours but reads as a different place. */
            htmlTarget: till || undefined,
            customerEmail: user.email || undefined,
          });

          /*
           * A subscription exists. `result` carries the customer info, which
           * is worth reading only to be sure the purchase completed rather
           * than merely returned — an empty entitlement set here means
           * something went through that did not grant anything.
           */
          const active = Object.keys(result?.customerInfo?.entitlements?.active || {});
          if (!active.length) throw new Error('The payment went through but the plan did not open. We are on it — email us.');
          unfit();
          if (till) till.hidden = true;
          next();
        } catch (error) {
          unfit?.();
          if (till) till.hidden = true;
          checkout.disabled = false;

          /*
           * Backing out is not a failure and must not be dressed as one. The
           * SDK raises the same typed error for it as for a declined card, so
           * the code is what separates them.
           */
          const code = error?.errorCode ?? error?.code;
          const cancelled =
            code === window.Purchases?.ErrorCode?.UserCancelledError ||
            /cancel/i.test(String(error?.message || ''));
          if (cancelled) {
            say('');
            return;
          }

          /*
           * The SDK's messages are written for whoever wired it up, not for
           * whoever is trying to pay: "There was a credentials issue. Check
           * the underlying error for more details." is true and useless at a
           * till. A reader gets a sentence they can act on and the real text
           * goes to the console, where the person who can fix it will look.
           */
          console.error('[checkout]', error);
          const wording = /card|declin|insufficient|expired|cvc|postal|billing/i.test(
            String(error?.message || ''),
          )
            ? error.message
            : 'We could not open the checkout just now. Nothing has been charged — ' +
              'please try again, or email ' + boot.support + ' and we will sort it out.';
          say(wording);
        }
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

  /*
   * `?q=` on load, which is how a provider brings the reader back.
   *
   * Until now the step in the URL was read only on `popstate`, so it worked for
   * the browser's Back button and for nothing else. `signInWithOAuth` sends the
   * reader away and returns them to `?q=account` — and the funnel ignored it,
   * put them back at their last answered question, and left the sign-in result
   * (a confirmation, or the reason it failed) written into a step that was
   * never on screen. From the reader's side the button did nothing at all.
   *
   * An earlier step is always allowed: those are answers they have already
   * given. A *later* one is not, because `?q=offer` would otherwise be a link
   * that skips the funnel and shows a price to somebody with no plan. The
   * account step is the exception the redirect needs, and it costs nothing —
   * it asks for a sign-in, and `render` sends a reader who already has one
   * straight on to the offer.
   */
  const params = new URLSearchParams(location.search);
  const requested = order.indexOf(params.get('q') ?? '');

  /*
   * Two steps may be jumped forward to; everything else may only be gone back
   * to. `account` is where a provider returns a reader. `offer` is where the
   * pricing on the marketing page sends somebody who has already decided to
   * buy — they do not need to be walked through fifteen questions first, and
   * the offer stands on its own: it lists what Pro is and what it costs, and
   * asks for an account before it will take any money.
   */
  const jumpable = new Set(['account', 'offer']);
  if (requested !== -1 && (requested <= index || jumpable.has(order[requested]))) {
    index = requested;
  }

  render();
})();
