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

  /*
   * When the answers were last touched.
   *
   * Resuming is for somebody who closed the tab and came back — not for
   * somebody returning a fortnight later, who is a new visit and should see
   * the opening screen rather than question fourteen with no idea how they
   * got there. The stamp lives beside the answers, under its own key, so an
   * older saved funnel simply has no stamp and is treated as stale.
   */
  const STAMP_KEY = `${KEY}.at`;
  const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(answers));
      localStorage.setItem(STAMP_KEY, String(Date.now()));
    } catch {
      /* Private window, or storage refused. The funnel still works forwards. */
    }
  };

  /** Fresh enough to pick up where they left off. */
  const resumable = () => {
    try {
      const at = Number(localStorage.getItem(STAMP_KEY) || 0);
      return at > 0 && Date.now() - at < RESUME_WINDOW_MS;
    } catch {
      return false;
    }
  };

  /*
   * `?restart=1` throws the saved answers away and opens at the top.
   *
   * The funnel is otherwise impossible to see from the beginning once you
   * have walked it, which makes it impossible to check.
   */
  const restarting = new URLSearchParams(location.search).has('restart');
  if (restarting) {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(STAMP_KEY);
    } catch {
      /* Nothing to clear. */
    }
  }

  const answers = restarting ? {} : load();
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
      /* Signed in already, so the configure and the offerings can be done now
         rather than on the press. */
      warmAhead?.();
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
    if (step.kind === 'single' && stepEls.get(id).querySelector('[data-art]')) matchPortraits(id);
    if (step.kind === 'build') runBuild();
    /* Last chance: a reader who signed up by email reaches the offer without
       passing through the branch above, so the warm-up is asked for here too.
       It caches, so asking three times costs nothing. */
    if (step.kind === 'offer') warmAhead?.();
    if (step.kind === 'plan') {
      fillPlan();
      /*
       * Start the checkout now, two screens early.
       *
       * The reader is about to spend a minute reading their plan and making
       * an account. That minute is the only free time this funnel has, and
       * the alternative is spending it after they press Subscribe, watching
       * a disabled button.
       */
      warmAhead?.();
    }
    if (step.kind === 'done') markDone();

    /* Move the focus to the new heading, or a keyboard user is left where the
       previous step was and a screen reader announces nothing. */
    const heading = stepEls.get(id).querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      /*
       * Focused so a screen reader announces the new step rather than leaving
       * the reader where the last one was. Safari paints `:focus-visible` on a
       * programmatic focus where Chrome does not, which drew a clay box around
       * every title — the stylesheet turns the ring off for these two headings
       * only. They are not controls; every real control keeps its own.
       */
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

          /*
           * A single-answer step advances itself: a tap is the answer, and a
           * Continue button underneath it is one more thing to find.
           *
           * The pause before it moves is the whole of whether the tap felt
           * answered. Too short and the chosen state never renders — the
           * reader presses and the screen is simply gone, which reads as the
           * page jumping rather than as an answer being taken. A variant may
           * set its own in `data-confirm`; 180ms is funnel 1's.
           *
           * Unless the step has a Continue of its own. The age cards do: four
           * photographs do not read as controls, so that screen asks for a
           * deliberate press and must not move under one.
           */
          const confirm = Number(root.dataset.confirm) || 180;
          const waits = Boolean(cta);
          if (!waits && (step.kind === 'single' || step.kind === 'scale')) {
            /*
             * Saying yes to a book is worth watching.
             *
             * On the taste screens the cover lifts away as the answer is
             * taken — filed, rather than dismissed — and the screen waits for
             * it. `data-taste` carries the answer so the stylesheet can send
             * a yes and a no different ways, and it is cleared on the way out
             * so coming back by Back does not replay it.
             */
            let hold = confirm;
            if (el.querySelector('.ftaste')) {
              el.dataset.taste = value;
              hold = value === 'yes' ? 620 : 320;
            }
            window.setTimeout(() => {
              el.removeAttribute('data-taste');
              next();
            }, hold);
          }
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

    /*
     * Every step whose only job is to be read and moved on from.
     *
     * This list is the one thing standing between a step and a dead end: a
     * kind missing from it still renders its `[data-next]` button, styled
     * exactly like every other Continue, and clicking it does nothing at all.
     * `showcase` was missing, so `app-set` and `app-recall` — the two screens
     * between the plan and the account — stopped the funnel dead, two steps
     * short of the offer. Anything added here must be added there too.
     */
    if (['hook', 'insight', 'note', 'plan', 'pledge', 'showcase'].includes(step.kind)) {
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

  /**
   * What to call the reader, or nothing.
   *
   * The name they typed, else the local part of an email we already have —
   * either one they entered, or the one on a session they are already signed
   * into. Returns null rather than a guess, because every caller has a
   * complete sentence to fall back on and "Hi , it's time to…" is worse than
   * no name at all.
   *
   * An email is a weak source and is treated as one: `ana.k+books@x.com`
   * gives "Ana", and anything that is not a plausible name — digits, a single
   * letter, `info`, `hello` — gives nothing. A funnel that greets somebody as
   * "Admin23" has not personalised anything.
   */
  const NOT_NAMES = new Set(['info', 'hello', 'hi', 'admin', 'contact', 'me', 'mail', 'email', 'test', 'support', 'no-reply', 'noreply']);

  function readerName() {
    const typed = String(answers.name || '').trim();
    if (typed) return typed.split(/\s+/)[0];

    const email = String(answers.email || user?.email || '').trim();
    const local = email.split('@')[0] || '';
    /* `+tag` and anything after the first separator are not the name. */
    const head = local.split(/[+._-]/)[0].toLowerCase();
    if (head.length < 2 || /\d/.test(head) || NOT_NAMES.has(head)) return null;
    return head[0].toUpperCase() + head.slice(1);
  }

  /**
   * The build screen: their name on it, a figure counting up, work ticking off.
   *
   * The percentage is derived from the same line index that marks the work
   * done, so the figure and the ticks can never disagree — it is one state
   * read two ways rather than two timers that drift.
   */
  /**
   * The build screen: a bar that counts, and stops to ask.
   *
   * It used to be four lines on a timer, which meant the reader watched a
   * progress bar they had no part in. The gates change that. Each `[data-ask]`
   * carries the percentage it interrupts at; the count runs up to that mark
   * and holds there — bar, number and all — until the question on screen is
   * answered. The pause is the point: the bar is visibly waiting on the
   * reader, so answering reads as finishing the job rather than as more form.
   *
   * The answers are saved like any other, so a reader who comes back inside
   * the resume window is not asked again. `built` still guards the whole
   * screen, because running this twice would hand the reader a second set of
   * questions they have already answered.
   */
  function runBuild() {
    const el = stepEls.get('building');
    const lines = [...el.querySelectorAll('.fbuild__line')];
    const bar = el.querySelector('[data-build-bar]');
    const ring = el.querySelector('[data-build-ring]');
    const pct = el.querySelector('[data-build-pct]');
    /*
     * The ring's own circumference, measured rather than assumed.
     *
     * `stroke-dasharray` is in user units, and the circle is drawn at r=54 in
     * a 120 viewBox that the stylesheet then scales. Reading the length off
     * the element means the dash maths survives somebody changing the radius
     * in the markup, which is exactly the kind of change that otherwise
     * leaves a ring that never quite closes.
     */
    const circumference = ring ? ring.getTotalLength?.() || 2 * Math.PI * 54 : 0;
    if (ring) {
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference);
    }
    const title = el.querySelector('[data-fill="title"]');
    const step = byId['building'];
    const name = readerName();
    if (title && name && step?.greeting) {
      title.textContent = `${name}, ${step.greeting}`;
    }
    if (built) {
      next();
      return;
    }
    built = true;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const span = reduced ? 900 : 7000;

    const gates = [...el.querySelectorAll('[data-ask]')]
      .map((node) => ({ node, at: Number(node.dataset.at) || 0, done: false }))
      .sort((a, b) => a.at - b.at);

    /*
     * Three states per line, not two.
     *
     * A list where every line is already legible and ticks off one by one is
     * a checklist being read to you. Marking the line the bar is *on* as well
     * as the ones behind it turns it into work being done: the one in hand is
     * lit and the ones not started yet are quiet, so the eye has somewhere to
     * be for the seven seconds this screen lasts.
     */
    const paintLines = (value) => {
      lines.forEach((line, i) => {
        const from = (i / lines.length) * 100;
        const to = ((i + 1) / lines.length) * 100;
        const done = value >= to - 0.5;
        line.toggleAttribute('data-done', done);
        line.toggleAttribute('data-now', !done && value >= from);
      });
    };

    let shown = 0;
    let held = false;
    let holdAt = 0;
    let started = null;
    let offset = 0;

    const paint = (value) => {
      const whole = Math.min(100, Math.round(value));
      if (pct) pct.textContent = String(whole);
      if (bar) bar.style.width = `${whole}%`;
      if (ring) ring.style.strokeDashoffset = String(circumference * (1 - whole / 100));
      paintLines(whole);
    };

    const ask = (gate) => {
      held = true;
      holdAt = gate.at;
      gate.node.hidden = false;
      el.setAttribute('data-asking', 'true');
      const answer = (value) => {
        if (gate.done) return;
        gate.done = true;
        answers[`build_${gate.node.dataset.ask}`] = value;
        save();
        gate.node.hidden = true;
        if (!gates.some((g) => !g.done && g.at <= holdAt)) {
          el.removeAttribute('data-asking');
          held = false;
          offset = holdAt;
          started = null;
          window.requestAnimationFrame(tick);
        }
      };
      for (const button of gate.node.querySelectorAll('[data-ask-answer]')) {
        button.addEventListener('click', () => answer(button.dataset.askAnswer), { once: true });
      }
    };

    const tick = (now) => {
      if (held) return;
      if (started === null) started = now;
      const value = Math.min(100, offset + ((now - started) / span) * 100);
      paint(value);

      const gate = gates.find((g) => !g.done && value >= g.at);
      if (gate) {
        paint(gate.at);
        ask(gate);
        return;
      }

      if (value >= 100) {
        shown = 100;
        window.setTimeout(next, reduced ? 120 : 650);
        return;
      }
      window.requestAnimationFrame(tick);
    };

    paint(0);
    window.requestAnimationFrame(tick);
    void shown;
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
    /* Funnel 2 draws a different object out of different answers. */
    if (root.querySelector('[data-plan2]')) {
      fillPlan2();
      return;
    }
    const values = planValues();
    for (const [key, value] of Object.entries(values)) {
      const node = root.querySelector(`[data-plan="${key}"]`);
      if (node) node.textContent = value;
    }
  }

  /**
   * The age cards show somebody the reader might be.
   *
   * Two sets of portraits, `m_` and `f_`, one per age band. The page ships the
   * mixed set — two men and two women — and this swaps it for the matching one
   * once the gender question has an answer, which is the screen immediately
   * before. Answering "rather not say", or going back and clearing it, leaves
   * the mixed set alone rather than picking for them.
   *
   * A missing file would be a hole where a face was, so the swap is done by
   * loading the new picture first and only then putting it on screen. The
   * worst case is the mixed set staying, which is a complete screen.
   */
  function matchPortraits(id) {
    const held = answers.gender;
    const gender = Array.isArray(held) ? held[0] : held;
    const set = gender === 'male' ? 'm' : gender === 'female' ? 'f' : null;
    if (!set) return;

    for (const img of stepEls.get(id).querySelectorAll('[data-art]')) {
      const wanted = `/assets/img/funnel2/cards/${set}_${img.dataset.art}.webp`;
      if (img.getAttribute('src') === wanted) continue;
      const probe = new Image();
      probe.onload = () => {
        img.src = wanted;
      };
      probe.src = wanted;
    }
  }

  /* ------------------------------------------------- the plan, said back */

  /** Every label a step offered, so an answer id can be read as English. */
  const labelsFor = (stepId) => boot.labels?.[stepId] || {};

  /** One step's answer as a list of ids, however it was stored. */
  const chosenIds = (stepId) => {
    const key = boot.answerKeys?.[stepId] || stepId;
    const held = answers[key];
    if (held == null) return [];
    return Array.isArray(held) ? held : [held];
  };

  /** One step's answer as a list of labels, in the order it was asked. */
  const chosenLabels = (stepId) => {
    const map = labelsFor(stepId);
    return chosenIds(stepId)
      .map((id) => map[id])
      .filter(Boolean);
  };

  /** A list as a sentence: "a, b and c". */
  const andList = (items) =>
    items.length <= 1
      ? items.join('')
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

  /**
   * The plan screen, filled from twenty answers.
   *
   * This is the screen the funnel is for. Everything on it comes from
   * something the reader actually pressed: the card states the four decisions
   * they made, the quotes are the statements they agreed with in the words
   * that were on the buttons, the week is built out of the books they said
   * yes to, and the arithmetic is the number of minutes they chose multiplied
   * out. Nothing is invented to fill a space — a section with no answer
   * behind it hides itself, because a shorter plan is honest and a padded one
   * is the thing that makes a reader stop believing the rest of it.
   */
  function fillPlan2() {
    const el = stepEls.get('plan');
    if (!el) return;
    const name = readerName();
    const step = byId['plan'];

    const head = el.querySelector('[data-fill="title"]');
    if (head && name && step?.greeting) head.textContent = `${name}, ${step.greeting}`;

    const set = (key, value) => {
      const node = el.querySelector(`[data-plan2="${key}"]`);
      if (node) node.textContent = value;
    };

    /*
     * Whose plan it is, and when it was made.
     *
     * The card carries a name because that is most of what makes it theirs
     * rather than a summary of a questionnaire. Without one it says "Your
     * plan", which is still true — the name step is skippable on purpose and
     * a card that reads "undefined's plan" would undo the whole point of it.
     * The date is the day they answered, written out, so the card reads as a
     * thing that was issued to them.
     */
    set('owner', name ? `${name}\u2019s plan` : 'Your plan');
    set(
      'made',
      `Built from your answers \u00b7 ${new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
      })}`,
    );

    /* ---- the four decisions */

    const commitment = chosenIds('commitment')[0];
    const ideas = boot.commitment?.[commitment] ?? 5;
    const minutes = boot.minutes?.[commitment] ?? 5;

    /*
     * The promise, assembled from what they chose.
     *
     * Three pieces, each of them theirs: how long they said they had, what
     * they said they wanted to get better at, and when they said they would
     * do it. Said as one sentence about them rather than as four settings in
     * a table, which is the difference between a plan and a preferences page.
     * Every clause drops out cleanly if its answer is missing, so somebody
     * who skipped everything still gets a true sentence rather than a gap.
     */
    /*
     * The time of day, as a phrase rather than as its own label.
     *
     * The labels are written to sit on a button — "Morning coffee", "Lunch
     * break" — and lowercasing one into a sentence gave "over lunch break",
     * which nobody says. Each one gets the preposition it actually takes.
     */
    const WHEN_PHRASE = {
      morning: 'over your morning coffee',
      commute: 'on the commute',
      lunch: 'on your lunch break',
      night: 'before bed',
    };
    const topicsNow = chosenLabels('topics').map((t) => t.toLowerCase());
    const whenNow = WHEN_PHRASE[chosenIds('when')[0]];
    const focus =
      topicsNow.length === 0
        ? 'the ideas worth keeping'
        : andList(topicsNow.slice(0, 3));
    set(
      'vow',
      `${minutes} minutes a day on ${focus}` +
        (whenNow ? `, ${whenNow}` : '') +
        ' — and the ones that matter come back until they stick.',
    );

    set('daily', `${ideas} ideas · about ${minutes} minutes`);
    set('when', chosenLabels('when')[0] || 'Whenever suits you');

    /*
     * How they learn, in one phrase.
     *
     * They may have ticked four. Naming all four is a list, not a decision,
     * and the card has one line for it — so two, then "and more", which is
     * true and reads as a setting rather than as a dump of the answer.
     */
    /*
     * One style, plus a count.
     *
     * The card has a cell, not a paragraph. Four ticked styles spelled out
     * ran to four lines and pushed the cell beside it off its own baseline —
     * so the first one is named and the rest are counted, which fits and is
     * still exactly what they chose.
     */
    const styles = chosenLabels('styles');
    set(
      'style',
      styles.length === 0
        ? 'A bit of everything'
        : styles.length === 1
          ? styles[0]
          : `${styles[0]} +${styles.length - 1}`,
    );
    set('ladder', `${(boot.ladder || []).join(', ')} days`);

    /* ---- what it draws from */

    const topics = chosenLabels('topics');
    const topicBox = el.querySelector('[data-plan2-topics]');
    const topicList = el.querySelector('[data-plan2-topiclist]');
    if (topicBox && topicList) {
      topicList.replaceChildren(
        ...topics.map((label) => {
          const li = document.createElement('li');
          li.textContent = label;
          return li;
        }),
      );
      topicBox.hidden = topics.length === 0;
    }

    /* ---- their own answers, quoted */

    /*
     * Only what they actually leaned into.
     *
     * The agreement rows run 1–5. Quoting back a 1 ("you said this is not
     * you") is telling somebody what they are not, which is neither useful
     * nor what they came for; quoting a 3 is quoting a shrug. Four and five
     * are the ones where they told us something, and those are the ones the
     * plan answers.
     */
    /*
     * One line per agreement row, written for the reader who said yes to it.
     *
     * Keyed by the step's own id rather than by matching on its text, so a
     * reworded question keeps its promise and a new one simply has none until
     * somebody writes it — which is the right failure: a plan that invents a
     * promise is worse than a plan with one fewer line on it.
     */
    const ANSWERED = {
      'q-left-out': 'You stop sitting out of the conversation',
      'q-motivation': 'Short enough that losing steam stops being the problem',
      'q-know-want': 'Built around what you already know you are after',
      'q-doubt': 'Something steady to read on the days you got it wrong',
      'q-decisions': 'Ways of deciding that do not take all evening',
      'q-understand': 'Chosen to show you something about yourself',
    };

    const heard = [];
    for (const [id, scale] of Object.entries(boot.scales || {})) {
      const value = chosenIds(id)[0];
      if (value !== '4' && value !== '5') continue;
      const word = (scale.words?.[value] || '').toLowerCase();
      /*
       * Their own sentence, turned round to face them.
       *
       * Agreeing that you feel left out of conversations is a complaint, and
       * reading it back unchanged is a receipt. Said as the thing that stops
       * being true, it is the plan making a promise — which is what this
       * screen is for, and the same move the struggles above make.
       */
      if (ANSWERED[id]) heard.push({ line: ANSWERED[id] });
      void word;
      void scale;
    }

    /*
     * Their answers turned round to face them.
     *
     * A struggle is the most useful thing a reader hands over, and reading it
     * back to them unchanged — "in the way: forgetting what I read" — is a
     * receipt. Said as what stops being true, it is the plan making a
     * promise, which is what this screen is for. The map is small and
     * explicit rather than clever: a struggle with no line written for it is
     * simply not claimed about.
     */
    const RELIEF = {
      overload: 'The noise gets filtered before it reaches you',
      notifications: 'Five minutes that out-pull the notifications',
      no_time: 'Short enough to finish, every single day',
      forgetting: 'What you read comes back before you lose it',
      unclear: 'You stop deciding what to learn — we decide',
      books_long: 'The whole idea, without the whole book',
    };
    /*
     * The same again for what is driving it.
     *
     * These labels are button copy too — "Getting a promotion", "Starting
     * something of my own" — and dropping three of them into the middle of a
     * sentence gave "Getting a promotion, Starting something of my own and A
     * relationship". Each is written once more as the thing it points at.
     */
    const TOWARD = {
      promotion: 'a promotion',
      business: 'something of your own',
      relationship: 'a relationship',
      parenthood: 'becoming a parent',
      transition: 'a change that is coming',
      financial: 'a number you want to hit',
      later_life: 'the part of life after this one',
      loss: 'finding your feet again',
    };
    const extras = [];
    for (const id of chosenIds('struggles')) {
      if (RELIEF[id]) extras.push({ line: RELIEF[id] });
    }
    const toward = chosenIds('reason').map((id) => TOWARD[id]).filter(Boolean);
    if (toward.length) {
      extras.push({ line: `All of it pointed at ${andList(toward.slice(0, 3))}` });
    }

    const heardBox = el.querySelector('[data-plan2-heard]');
    const heardList = el.querySelector('[data-plan2-heardlist]');
    if (heardBox && heardList) {
      /* Four at most. A plan that recites twenty answers is a receipt. */
      const rows = [...extras, ...heard].slice(0, 4);
      heardList.replaceChildren(
        ...rows.map((row) => {
          const li = document.createElement('li');
          const text = document.createElement('span');
          text.textContent = row.line;
          li.append(text);
          return li;
        }),
      );
      heardBox.hidden = rows.length === 0;
    }

    /* ---- the first week */

    /*
     * Built from the books they said yes to, then from their topics.
     *
     * A week of seven identical "a lesson from your topics" rows is a
     * placeholder with a calendar drawn around it. The books are real titles
     * the reader has just chosen in front of us, so those go first and the
     * topics carry the rest — and if they said no to everything and picked no
     * topics, the week hides rather than inventing one.
     */
    const yes = Object.entries(boot.tasteBooks || {})
      .filter(([id]) => chosenIds(id)[0] === 'yes')
      .map(([, book]) => book);

    const days = [];
    for (const book of yes) {
      if (days.length >= 7) break;
      days.push({ title: book.title, note: book.author || 'From your shelf' });
    }
    for (const topic of topics) {
      if (days.length >= 7) break;
      days.push({ title: topic, note: 'Chosen for you' });
    }

    const weekBox = el.querySelector('[data-plan2-week]');
    const weekList = el.querySelector('[data-plan2-weeklist]');
    if (weekBox && weekList) {
      weekList.replaceChildren(
        ...days.map((day, i) => {
          const li = document.createElement('li');
          li.className = 'fweek__day';
          if (i === 0) li.setAttribute('data-first', '');
          const n = document.createElement('span');
          n.className = 'fweek__n';
          n.textContent = `Day ${i + 1}`;
          const text = document.createElement('span');
          text.className = 'fweek__text';
          const title = document.createElement('b');
          title.textContent = day.title;
          const note = document.createElement('small');
          note.textContent = day.note;
          text.append(title, note);
          li.append(n, text);
          return li;
        }),
      );
      weekBox.hidden = days.length === 0;
    }

    /* ---- the arithmetic */

    const count = (n) => n.toLocaleString();
    set('m30', count(ideas * 30));
    set('m365', count(ideas * 365));
    set('mhours', count(Math.round((minutes * 365) / 60)));
    set(
      'mathsnote',
      `At ${minutes} minutes a day — the amount you chose — and only if you keep showing up. ` +
        'That part is yours.',
    );
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
    /*
     * Who sent this reader.
     *
     * A creator's link is this funnel with `?c=<code>` on it. The code is put
     * somewhere that survives the trip to Apple or Google and back, because
     * the moment that matters — the account being made — happens after that
     * round trip, and a code held only in the URL would be long gone.
     *
     * The row is written once and never updated. A reader who arrives again
     * through somebody else's link stays with whoever sent them first, which
     * is the only version of this that two creators can both be told.
     */
    const CREATOR_KEY = 'mindroll.creator.code';
    const CLICK_KEY = 'mindroll.creator.counted';

    const creatorCode = (() => {
      const fromUrl = new URLSearchParams(location.search).get('c');
      const clean = String(fromUrl || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 32);
      try {
        if (clean) localStorage.setItem(CREATOR_KEY, clean);
        return clean || localStorage.getItem(CREATOR_KEY) || null;
      } catch {
        /* Private browsing, or storage refused. Attribution is worth less
           than the funnel working, so carry on without it. */
        return clean || null;
      }
    })();

    /* One click per arrival, not per step. */
    if (creatorCode) {
      let counted = false;
      try {
        counted = sessionStorage.getItem(CLICK_KEY) === creatorCode;
        if (!counted) sessionStorage.setItem(CLICK_KEY, creatorCode);
      } catch {
        counted = false;
      }
      if (!counted) {
        client
          .from('creator_clicks')
          .insert({ code: creatorCode, referrer: document.referrer || null })
          .then(() => {}, () => {});
      }
    }

    const claimed = new Set();
    const claimCreator = (person) => {
      if (!creatorCode || !person || claimed.has(person.id)) return;
      claimed.add(person.id);
      client
        .from('creator_attribution')
        .insert({ user_id: person.id, code: creatorCode, landed_at: new Date().toISOString() })
        /* A duplicate means they already belong to somebody. That is the
           rule working, not a failure, so nothing is said either way. */
        .then(() => {}, () => {});
    };

    const sessionArrived = (session) => {
      const wasSignedOut = !user;
      user = session?.user ?? null;
      if (!user) return;
      claimCreator(user);
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

  /*
   * Set by the offer's own wiring, called from the plan screen.
   *
   * The two live in different scopes — the checkout is set up inside the
   * `offerEl` block and the plan is rendered from `render()` — and the
   * warm-up has to be reachable from the one that happens first. A function
   * handed outward is the smallest way to do that; before the offer's block
   * runs it is simply absent, and the plan screen's call is a no-op.
   */
  let warmAhead = null;

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
      /* Both buy buttons — the one under the plans and the one at the foot of
         the page — say the same thing, because they do the same thing. */
      for (const button of offerEl.querySelectorAll('[data-checkout]')) {
        /*
         * The no-trial wording belongs to the step, not to this line.
         *
         * It was hard-coded to "Subscribe", which quietly overwrote whatever
         * the offer was configured to say the moment this ran — so the
         * markup shipped one label and the reader saw another, and changing
         * the copy in the funnel data appeared to do nothing at all.
         */
        button.textContent = chosen.trialDays
          ? `Start my ${chosen.trialDays} days free`
          : byId['offer']?.cta || 'Subscribe';
      }

      const echo = offerEl.querySelector('[data-plan-echo]');
      if (echo) {
        const everyEcho = chosen.period === 'year' ? 'year' : 'week';
        echo.textContent = `${chosen.name} · ${chosen.amount} every ${everyEcho}`;
      }

      if (!smallprint) return;
      const every = chosen.period === 'year' ? 'year' : 'week';
      /*
       * The price, then the reassurance, on one line.
       *
       * The long consent paragraph that used to sit under the button is gone;
       * what a reader actually wants to know at this moment is that they are
       * not locked in, and it belongs beside the figure rather than three
       * paragraphs below it.
       */
      smallprint.textContent = chosen.trialDays
        ? `${chosen.trialDays} days free, then ${chosen.amount} every ${every}. Cancel any time before it ends and you are not charged.`
        : `${chosen.amount} every ${every} · Cancel anytime, no commitment.`;
    };

    /*
     * Picking a plan while the checkout is open.
     *
     * The cards stay live behind the form on purpose — changing your mind at
     * the till is the most ordinary thing in the world. Repainting them was
     * not enough: the form already mounted was the old plan's, so the reader
     * saw weekly selected above an annual payment sheet, and whatever they
     * typed would have bought the year. `reopen` is set after the handlers
     * exist, because the checkout is wired further down this same function.
     */
    let reopen = null;
    for (const button of planButtons) {
      button.addEventListener('click', () => {
        const was = plan;
        plan = button.dataset.planId;
        paint();
        if (was !== plan && reopen) reopen();
      });
    }
    paint();

    /*
     * The headline and the plan line, as the app writes them.
     *
     * `personalTitle` in src/features/paywall/config.ts puts the reader's name
     * in front of the headline and lowercases what follows; `planSubtitle`
     * names the goals they picked. This is the same moment on the web, so it
     * says the same thing rather than inventing a second voice for it.
     */
    (() => {
      const head = offerEl.querySelector('[data-fill="title"]');
      const step = byId['offer'];
      const name = readerName();
      if (head && name && step?.greeting) head.textContent = `${name}, ${step.greeting}`;

      const sub = offerEl.querySelector('[data-plan-subtitle]');
      if (!sub) return;
      const held = answers.goals;
      const picked = Array.isArray(held) ? held : held == null ? [] : [held];
      const phrases = picked
        .map((id) => boot.goals?.[id]?.phrase)
        .filter(Boolean)
        .slice(0, 2);
      if (!phrases.length) return;
      sub.textContent = `Your plan to ${phrases.join(' and ')} is ready.`;
      sub.hidden = false;
    })();

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
    /*
     * …except that by the time somebody means to buy, they have already told
     * us they mean to.
     *
     * Asking for the script on the Subscribe press put the whole of it — most
     * of a megabyte, then a round trip for the offerings, then the sheet's own
     * mount — between the press and anything visible happening. On a phone on
     * mobile data that is several seconds of a button that looks broken, at
     * the one moment in the funnel where hesitation costs the sale.
     *
     * `warmCheckout` below starts all of it the moment the reader reaches the
     * plan, which is two screens and about a minute earlier. Nothing is
     * charged and nothing is shown; the work simply happens while they read.
     * By the press, `loadSdk` and `instance` are resolved promises and the
     * offerings are in hand, so the sheet is the next thing that paints.
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

    /*
     * Everything the press needs, fetched before the press.
     *
     * Each piece caches its own promise, so calling this twice is free and
     * calling it before there is a signed-in reader still gets the script —
     * which is the expensive part — while the two steps that need an identity
     * wait for one. A failure here is swallowed on purpose: this is a warm-up
     * nobody asked for, and the real attempt reports its own errors properly.
     */
    let offerings = null;
    const warmCheckout = () => {
      loadSdk()
        .then((Purchases) => {
          if (!user) return null;
          return instance(Purchases).then((purchases) => {
            if (!offerings) offerings = purchases.getOfferings();
            return offerings;
          });
        })
        .catch(() => {
          /* Nothing is on screen that depends on this. The press will try
             again properly and say so if it fails then. */
          offerings = null;
        });
    };
    /*
     * Handed outward, not called here.
     *
     * Calling it at setup would start the megabyte on page load for every
     * visitor, and most visitors never reach this screen — which is the thing
     * the note above is at pains to avoid. The plan step calls it, two
     * screens and about a minute before the press.
     */
    warmAhead = warmCheckout;

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

      const measure = () => {
        const box = inner();
        if (!box) return;
        const height = Math.ceil(box.getBoundingClientRect().height);
        /* A one-pixel difference is rounding, not a resize; reacting to it
           would have the observer feeding itself for ever. */
        if (height > 0 && Math.abs(height - node.offsetHeight) > 2) {
          node.style.height = `${height}px`;
        }
      };

      const observer = new ResizeObserver(measure);
      observer.observe(node);

      /*
       * The SDK mounts asynchronously, and it re-renders its root as the form
       * moves between steps — so the element found first can be thrown away and
       * replaced by one the observer has never been told about. Observing only
       * the first one left the till at 26px with a 477px form inside it, and
       * the reader saw a Stripe badge and no card fields.
       *
       * Every change under the target re-finds the form and watches the current
       * one. The slow tick is a backstop for a change nothing else reports.
       */
      let watched = null;
      const rewatch = () => {
        const box = inner();
        if (box && box !== watched) {
          watched = box;
          observer.observe(box);
        }
        measure();
      };
      const mutations = new MutationObserver(rewatch);
      mutations.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      const tick = window.setInterval(rewatch, 500);
      rewatch();

      return () => {
        window.clearInterval(tick);
        mutations.disconnect();
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

    /*
     * Which checkout is the live one.
     *
     * The till can be reopened before the last one finished — somebody opens
     * the annual form, then changes their mind and taps weekly. Each open
     * takes a ticket; anything that comes back holding an old ticket is a
     * form the reader has already walked away from, and acting on it would
     * mean charging the plan they just rejected or sending them through to
     * the closing screen off a purchase that is no longer theirs.
     */
    let session = 0;
    const tillOpen = () => Boolean(till) && !till.hidden;

    if (checkout && boot.checkout) {
      const openCheckout = async () => {
        /* No account, no identity to attach a subscription to. */
        if (!user) {
          index = order.indexOf('account');
          render();
          return;
        }

        const mine = ++session;
        const chosen = boot.plans.find((p) => p.id === plan);
        for (const n of offerEl.querySelectorAll('[data-checkout]')) n.disabled = true;
        say('Opening the checkout…', 'busy');
        let unfit = null;

        /*
         * Empty the till before filling it.
         *
         * The SDK mounts its form into this element and has no close of its
         * own, so a second open would otherwise stack a second form under the
         * first — the reader would see the plan they rejected sitting above
         * the one they chose.
         */
        if (till) till.replaceChildren();

        try {
          const Purchases = await loadSdk();
          const purchases = await instance(Purchases);

          /* Warmed on the plan screen. Re-asked only if that failed or never
             ran, so the ordinary path has nothing left to wait for. */
          if (!offerings) offerings = purchases.getOfferings();
          let current;
          try {
            current = (await offerings)?.current;
          } catch (error) {
            /* A warm-up that failed must not poison the real attempt. */
            offerings = purchases.getOfferings();
            current = (await offerings)?.current;
          }
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
          if (till) {
            till.hidden = false;
            /*
             * Put the form where the reader is looking.
             *
             * Unhiding it is not the same as showing it: on a phone the
             * paywall is taller than the screen, so the till can open
             * perfectly well somewhere the reader cannot see, and pressing
             * Subscribe appears to do nothing. Scrolling to it makes the
             * response to the press the thing they asked for.
             */
            try {
              till.scrollIntoView({ block: 'start', behavior: 'smooth' });
            } catch {
              till.scrollIntoView();
            }
          }
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
          /* A newer checkout has opened since; this one is a ghost. */
          if (mine !== session) return;

          const active = Object.keys(result?.customerInfo?.entitlements?.active || {});
          if (!active.length) throw new Error('The payment went through but the plan did not open. We are on it — email us.');
          unfit();
          if (till) till.hidden = true;
          next();
        } catch (error) {
          unfit?.();
          /* Superseded: the newer checkout owns the till now, so leave it be. */
          if (mine !== session) return;
          if (till) till.hidden = true;
          for (const n of offerEl.querySelectorAll('[data-checkout]')) n.disabled = false;

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
      };

      for (const node of offerEl.querySelectorAll('[data-checkout]')) {
        node.addEventListener('click', openCheckout);
      }
      /* Now that it exists, a plan change can reopen the till on the new one. */
      reopen = () => {
        if (tillOpen()) openCheckout();
      };
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

  if (lastAnswered.length && !restarting && resumable()) {
    const resumeAt = order.indexOf(lastAnswered[lastAnswered.length - 1]);
    /*
     * `indexOf` is -1 when this flow has no such step, and `Math.min` then
     * happily returned -1 — `order[-1]` is undefined and the first paint threw,
     * leaving a blank page for anyone with answers saved from a previous visit.
     * A missing cap means "do not cap", and the result is clamped either way.
     */
    const cap = order.indexOf('building');
    if (resumeAt > 0) {
      const want = cap === -1 ? resumeAt + 1 : Math.min(resumeAt + 1, cap);
      index = Math.max(0, Math.min(order.length - 1, want));
    }
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
