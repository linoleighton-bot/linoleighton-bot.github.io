/*
 * The cancellation flow.
 *
 * Three questions and a decision. Each question is a question — something the
 * person answers, not a slide they press past — because an answer is a small
 * commitment, and because what they tell us is what lets the offer be the
 * right one. A single "here is a discount" shown to everybody converts the
 * people leaving over money and insults everybody else.
 *
 *   1. Why are you cancelling?          — the cause
 *   2. What would have made you stay?   — the condition
 *   3. Can we do that instead?          — the offer, answerable yes or no
 *   then: what stops, and the decision.
 *
 * The third screen is the point of the first two. Somebody who has just named
 * the thing that would have kept them, and is then offered exactly that thing,
 * is in a different position from somebody shown a generic retention banner:
 * they set the condition themselves, and we are meeting it.
 *
 * The last screen carries their own numbers. Loss aversion is the strongest
 * lever available and it only works with specifics — "your 213 saved ideas"
 * moves people, "your content" does not. Every figure is read from the account
 * at the moment it is shown; none are estimated and none are rounded up. It
 * sits last rather than earlier because last is where the decision is made.
 *
 * The forgetting curve is this product's own argument pointed at its owner.
 * Somebody with reviews scheduled is mid-ladder, and stopping there is the
 * thing the app exists to prevent. Shown only when something really is
 * scheduled — said to somebody with nothing due it would be a scare with
 * nothing behind it, which is how a business earns the reputation this flow
 * is trying to avoid.
 *
 * **Cancelling stays available on every screen.** It is small, plain,
 * underlined text, and it works on the first press. That asymmetry — emphasis
 * on staying, no obstacle to leaving — is what every subscription business
 * does and is allowed. An exit that is hidden, disabled, delayed or routed
 * through a human is a chargeback, a one-star review, and for a UK trader
 * selling direct, against the rules.
 */
(() => {
  'use strict';

  /* --------------------------------------------------------------- utility */

  const h = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') node.className = value;
      else if (name === 'html') node.innerHTML = value;
      else if (name === 'text') node.textContent = value;
      else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  };

  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  const prettyDate = (iso) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  /* ------------------------------------------------------------ their data */

  /**
   * What they have actually built, counted rather than claimed.
   *
   * Five `head: true` counts, which fetch no rows at all — the server answers
   * with a Content-Range and nothing else. Started as the flow opens, so the
   * figures are long ready by the screen that shows them.
   *
   * Every one is allowed to fail. A missing table or a denied policy is a
   * figure left out, never a flow that stops working: somebody trying to
   * cancel and meeting an error is the worst outcome available here.
   */
  async function readStats(client, user) {
    const count = async (table, build) => {
      try {
        let query = client.from(table).select('*', { count: 'exact', head: true }).eq('user_id', user.id);
        if (build) query = build(query);
        const { count: n, error } = await query;
        return error ? null : (n ?? null);
      } catch {
        return null;
      }
    };

    const horizon = new Date(Date.now() + 30 * 86400000).toISOString();

    const [saved, learned, topics, dueSoon, streakDays] = await Promise.all([
      count('saved_items'),
      count('progress_events'),
      count('topic_follows'),
      /* Mid-ladder only. An idea that has survived the whole interval ladder
         carries `learned_at`, and claiming those are at risk would be the one
         dishonest number on the screen. */
      count('idea_reviews', (q) => q.is('learned_at', null).lte('due_at', horizon)),
      readStreak(client, user),
    ]);

    return { saved, learned, topics, dueSoon, streak: streakDays };
  }

  /**
   * The current streak, computed from the days themselves.
   *
   * `streak_events` is one row per day that counted, so the run is the number
   * of consecutive day keys back from today. Counted from yesterday as well,
   * because somebody who has not opened the app yet this morning still has
   * their streak — it has simply not been extended.
   */
  async function readStreak(client, user) {
    try {
      const { data, error } = await client
        .from('streak_events')
        .select('day_key')
        .eq('user_id', user.id)
        .order('day_key', { ascending: false })
        .limit(400);
      if (error || !data?.length) return null;

      const days = new Set(data.map((row) => row.day_key));
      const key = (date) => date.toISOString().slice(0, 10);

      const cursor = new Date();
      if (!days.has(key(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
        if (!days.has(key(cursor))) return 0;
      }

      let run = 0;
      while (days.has(key(cursor))) {
        run += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return run;
    } catch {
      return null;
    }
  }

  /* --------------------------------------------------------- the questions */

  /*
   * Worded the way somebody would say it to a friend rather than as a support
   * category. The phrasing is doing work: a reason people recognise is a
   * reason they press, and an unanswered first question is a flow that saves
   * nobody.
   */
  const REASONS = [
    { id: 'price', label: 'It costs too much for what I use' },
    { id: 'unused', label: 'I’m not opening it enough' },
    { id: 'missing', label: 'Something I need isn’t there' },
    { id: 'alternative', label: 'I’m using something else' },
    { id: 'break', label: 'I just need a break' },
  ];

  /*
   * The second question is the valuable one.
   *
   * It asks them to name their condition, and the next screen meets it. The
   * order matters: an offer that answers something the person said themselves
   * reads as a response, where the same offer shown unprompted reads as a
   * wall. "Honestly, nothing" is on the list on purpose — taking it off would
   * only produce false answers and poison the only churn data this has.
   */
  const STAYS = [
    { id: 'cheaper', label: 'A lower price' },
    { id: 'time', label: 'More time — I fell behind' },
    { id: 'feature', label: 'Something that isn’t in the app yet' },
    { id: 'smaller', label: 'A smaller daily goal I could actually keep' },
    { id: 'nothing', label: 'Honestly, nothing' },
  ];

  const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.id, r.label]));
  const STAY_LABEL = Object.fromEntries(STAYS.map((s) => [s.id, s.label]));

  /* ------------------------------------------------------------------ flow */

  const api = {
    /**
     * @param {object} ctx
     * @param {object} ctx.client    Supabase client, already holding the session.
     * @param {object} ctx.user      The signed-in user.
     * @param {object|null} ctx.row  Their `subscription_entitlements` row.
     * @param {HTMLElement} ctx.root The account panel, carrying the data attributes.
     * @param {string|null} ctx.name Their display name, if we know it.
     */
    open(ctx) {
      const mount = document.querySelector('[data-keep]');
      if (!mount) return;

      const { client, user, row, root } = ctx;
      const store = row?.store || '';
      const isApple = store === 'app_store';
      const isPlay = store === 'play_store';
      const isWeb = !isApple && !isPlay;

      /* Which plan they are on, matched against what the site sells. The
         switch offer is only honest if they are on the dearer of the two, so
         an unrecognised product means no switch is offered. */
      let plans = [];
      try {
        plans = JSON.parse(root.dataset.plans || '[]');
      } catch {
        plans = [];
      }
      const onWeekly = /week/i.test(String(row?.product_id || ''));
      const annual = plans.find((p) => p.id === 'annual') || null;

      const endsOn = prettyDate(row?.expires_at);
      const statsPromise = readStats(client, user);

      const state = { reason: null, stay: null, detail: '', surveyId: null, step: 0 };

      /* ------------------------------------------------- survey recording */

      /*
       * Best-effort, always. The table may not exist on a project that has not
       * run the migration, and a failed write must never be why somebody
       * cannot leave. Written on the way *in* rather than on the way out, so
       * the saves are counted too — a flow measured only by completed
       * cancellations cannot tell you whether it is working.
       */
      const noteText = () =>
        [state.stay ? `Would have stayed for: ${STAY_LABEL[state.stay]}` : null, state.detail || null]
          .filter(Boolean)
          .join('\n');

      const recordReason = async () => {
        try {
          const { data } = await client
            .from('cancellation_surveys')
            .insert({ user_id: user.id, reason: state.reason, detail: noteText(), store })
            .select('id')
            .maybeSingle();
          state.surveyId = data?.id ?? null;
        } catch {
          /* no-op */
        }
      };

      const recordOutcome = async (outcome) => {
        if (!state.surveyId) return;
        try {
          await client
            .from('cancellation_surveys')
            .update({ outcome, detail: noteText(), updated_at: new Date().toISOString() })
            .eq('id', state.surveyId);
        } catch {
          /* no-op */
        }
      };

      /* ------------------------------------------------------- the shell */

      const panel = h('div', {
        class: 'keep__panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'keep-title',
        tabindex: '-1',
      });
      const fill = h('span', { class: 'keep__fill' });
      const body = h('div', { class: 'keep__body' });

      const close = (outcome) => {
        if (outcome) void recordOutcome(outcome);
        mount.hidden = true;
        mount.replaceChildren();
        document.body.classList.remove('is-keeping');
        document.removeEventListener('keydown', onKey);
      };

      const onKey = (event) => {
        if (event.key === 'Escape') close(state.reason ? 'kept' : null);
      };

      /*
       * What is on the line, in view the whole way through.
       *
       * The loss used to arrive only on the last screen, which meant the first
       * three were answered by somebody with nothing at stake in front of
       * them. One quiet line under the progress bar fixes that: they are
       * reading their own streak and their own review count while they pick
       * an answer, and every screen after it is read in that light.
       *
       * Filled in when the counts land rather than rendered empty — a bar
       * that says nothing is worse than no bar.
       */
      const stakes = h('p', { class: 'keep__stakes', hidden: true });

      void statsPromise.then((s) => {
        const bits = [
          s.streak >= 2 ? `day ${s.streak} of your streak` : null,
          s.dueSoon > 0 ? `${plural(s.dueSoon, 'review', 'reviews')} due this month` : null,
          !s.streak && !s.dueSoon && s.saved ? plural(s.saved, 'saved idea', 'saved ideas') : null,
        ].filter(Boolean);
        if (!bits.length) return;
        stakes.textContent = `On the line: ${bits.join(' · ')}`;
        stakes.hidden = false;
      });

      panel.append(
        h('div', { class: 'keep__bar' }, [fill]),
        h('button', {
          class: 'keep__close',
          type: 'button',
          'aria-label': 'Close',
          onclick: () => close(state.reason ? 'kept' : null),
        }, ['×']),
        stakes,
        body,
      );

      mount.replaceChildren(
        h('div', { class: 'keep__scrim', onclick: () => close(state.reason ? 'kept' : null) }),
        panel,
      );
      mount.hidden = false;
      document.body.classList.add('is-keeping');
      document.addEventListener('keydown', onKey);

      const paint = (step, nodes) => {
        state.step = step;
        fill.style.width = `${(step / 4) * 100}%`;
        body.replaceChildren(...nodes.filter(Boolean));
        panel.scrollTop = 0;
        /*
         * Focus moves to the dialog, not to the first option.
         *
         * Focusing a control paints a ring on it — an orange box around the
         * first answer, which looks like it is already chosen and is the same
         * complaint the funnel headings earned. The panel itself takes focus
         * instead: a screen reader announces the dialog and its title, the
         * keyboard lands in the right place, and nothing is highlighted that
         * the reader has not picked.
         */
        panel.focus({ preventScroll: true });
      };

      /* The way out, on every screen: small, plain, underlined text. */
      const exitLink = (label = 'Take me to cancel') =>
        h('button', { class: 'keep__exit', type: 'button', onclick: () => stepDecide() }, [label]);

      /** One question's worth of options, with a Continue that waits for one. */
      const askList = (options, selected, onAnswer) => {
        const next = h('button', {
          class: 'btn btn--primary keep__go',
          type: 'button',
          disabled: !selected.value,
          onclick: () => onAnswer(selected.value),
        }, ['Continue']);

        const list = h(
          'div',
          { class: 'keep__options' },
          options.map((option) =>
            h('button', {
              class: `keep__option${selected.value === option.id ? ' is-on' : ''}`,
              type: 'button',
              'data-option': option.id,
              onclick: (event) => {
                selected.value = option.id;
                for (const node of list.querySelectorAll('.keep__option')) node.classList.remove('is-on');
                event.currentTarget.classList.add('is-on');
                next.disabled = false;
              },
            }, [option.label]),
          ),
        );

        return { list, next };
      };

      /* ------------------------------------------ 1. why are you cancelling */

      function stepWhy() {
        const selected = { value: state.reason };
        const { list, next } = askList(REASONS, selected, (value) => {
          state.reason = value;
          stepStay();
        });

        paint(1, [
          h('p', { class: 'keep__step', text: 'Question 1 of 3' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: 'Why are you cancelling?' }),
          h('p', { class: 'keep__lead', text: 'Pick the closest one. It changes what we can do about it.' }),
          list,
          next,
          exitLink(),
        ]);
      }

      /* ------------------------- 2. what would have made you stay */

      function stepStay() {
        const selected = { value: state.stay };
        const { list, next } = askList(STAYS, selected, (value) => {
          state.stay = value;
          void recordReason();
          stepFix();
        });

        paint(2, [
          h('p', { class: 'keep__step', text: 'Question 2 of 3' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: 'What would have made you stay?' }),
          h('p', {
            class: 'keep__lead',
            text: 'Be honest. If we can do it, the next screen offers it.',
          }),
          list,
          next,
          exitLink(),
        ]);
      }

      /* ----------------------------------- 3. can we do that instead? */

      /*
       * The offer, answerable yes or no, chosen by what they just asked for.
       * Everything here can actually be delivered: the switch is a real
       * checkout against a real cheaper plan, the pause is a real request a
       * real person answers. Nothing promises a discount that does not exist —
       * an offer the business cannot honour converts once and refunds twice.
       */
      function stepFix() {
        const holdButton = (label) =>
          h('button', {
            class: 'btn btn--primary keep__go',
            type: 'button',
            /* Pressed again once it has gone through, "Done" closes. Leaving
               it live would let somebody file the same request four times and
               wonder why nothing happened. */
            onclick: (event) =>
              event.currentTarget.dataset.done
                ? close('paused')
                : void requestHold(event.currentTarget),
          }, [label]);

        const want = state.stay;
        const wantsCheaper = want === 'cheaper' || (want === 'nothing' && state.reason === 'price');

        let title = 'Can we hold your subscription instead?';
        let lead =
          'Cancelling and coming back means starting over — a streak of one, no review schedule, ' +
          'and whatever the price is by then. Pausing stops the billing and leaves everything ' +
          'else exactly where it is.';
        let extra = null;
        let action = holdButton('Yes — pause my subscription');

        if (wantsCheaper && onWeekly && annual) {
          /*
           * The only straight saving on this screen, and a large one: the
           * weekly plan annualises to many times the annual price. Somebody
           * leaving over money who is on the wrong plan is the easiest save
           * there is, and moving them is also simply the right advice.
           */
          title = 'Yes — and you are on the expensive one.';
          lead =
            `You are paying by the week, which is the dearest way to buy this. Annual works out at ` +
            `${annual.leadAmount} a ${annual.leadUnit} — ${annual.amount} once, for exactly the same thing.`;
          action = h('button', {
            class: 'btn btn--primary keep__go',
            type: 'button',
            onclick: () => {
              void recordOutcome('switched');
              /* The website's own paywall, which opens the till on the plan
                 named in the query string. Not `/start` — that is thirty-three
                 questions built for somebody who has not decided, and this
                 reader has just been offered a specific plan and said yes. */
              window.location.href = '/pro?plan=annual';
            },
          }, [`Yes — move me to annual, ${annual.amount}`]);
        } else if (wantsCheaper) {
          title = 'Annual is already the cheapest we do.';
          lead =
            'So we will not pretend there is a secret lower price. What we can do is stop charging ' +
            'you for a month you are not using — the subscription holds, the streak freezes where ' +
            'it is, and nothing you have built goes anywhere.';
        } else if (want === 'feature') {
          title = 'Tell us what, and we will hold your subscription while we look.';
          lead =
            'A person reads these and answers them. Pausing meanwhile means you are not paying to ' +
            'wait for something that is not there yet.';
          const box = h('textarea', {
            class: 'keep__detail',
            rows: '3',
            maxlength: '600',
            placeholder: 'What were you expecting to find?',
            oninput: (event) => {
              state.detail = event.target.value.slice(0, 600);
            },
          });
          box.value = state.detail;
          extra = box;
          action = holdButton('Send it and pause my subscription');
        } else if (want === 'smaller') {
          title = 'Then we will make it smaller.';
          lead =
            'Three ideas a day is about two minutes, and it keeps the review schedule running — ' +
            'which is the part doing the actual work. We will drop your goal to that and pause the ' +
            'billing for a month while you find the level.';
          action = holdButton('Yes — smaller goal, pause the billing');
        } else if (want === 'nothing') {
          title = 'Then one last thing, and we will stop asking.';
          lead =
            'A pause costs you nothing and keeps the door open. Cancelling outright means that if ' +
            'you do come back — and most people who leave over a quiet month do — you start from ' +
            'zero rather than from where you left off.';
        }

        paint(3, [
          h('p', { class: 'keep__step', text: 'Question 3 of 3' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: title }),
          h('p', { class: 'keep__lead', text: lead }),
          extra,
          h('p', { class: 'keep__status', 'data-keep-status': true, hidden: true }),
          action,
          h('button', {
            class: 'keep__secondary',
            type: 'button',
            onclick: () => close('kept'),
          }, ['No — but I’m staying anyway']),
          exitLink(),
        ]);
      }

      /**
       * A pause, asked for properly.
       *
       * Written to `support_tickets`, which already exists, is already read,
       * and is already where a request from a customer lands. The copy
       * promises a reply within one working day, and that promise is kept by a
       * person — said plainly on screen rather than dressed up as an automatic
       * pause that does not happen.
       */
      async function requestHold(button) {
        const status = body.querySelector('[data-keep-status]');
        button.disabled = true;
        if (status) {
          status.hidden = false;
          status.dataset.kind = 'busy';
          status.textContent = 'Sending…';
        }

        let sent = false;
        try {
          const message =
            `PAUSE REQUEST — ${user.email || user.id}\n` +
            `Cancelling because: ${REASON_LABEL[state.reason] || state.reason}\n` +
            `Would have stayed for: ${STAY_LABEL[state.stay] || '—'}\n` +
            `Store: ${store || 'unknown'}\n` +
            `Subscription ends: ${endsOn || 'unknown'}\n\n` +
            `${state.detail || '(no detail given)'}`;
          const { error } = await client
            .from('support_tickets')
            .insert({ user_id: user.id, message, app_version: 'web' });
          sent = !error;
        } catch {
          sent = false;
        }

        await recordOutcome('paused');

        if (status) {
          status.dataset.kind = sent ? 'ok' : 'error';
          status.innerHTML = sent
            ? 'Done. We will confirm by email within one working day, and your subscription stays exactly as it is until then.'
            : `We could not send that. Email <a href="mailto:${root.dataset.support}?subject=Pause%20my%20subscription">${root.dataset.support}</a> and we will sort it.`;
        }
        button.disabled = false;
        button.textContent = sent ? 'Done' : 'Try again';
        if (sent) button.dataset.done = '1';
      }

      /* ----------------------------------------------------- the decision */

      /*
       * Where it is actually decided, so this is where their own numbers go.
       *
       * After them the screen stops arguing: what ends, when it ends, what
       * survives, and then both doors. Staying is the loud one. Leaving is a
       * line of text that works on the first press.
       */
      /**
       * The next month, drawn as days.
       *
       * One dot per day: the solid ones behind them, the faint ones the month
       * they are about to not have. It is the app's own streak calendar, which
       * is deliberate — this is the picture they already recognise, and seeing
       * the run they have built sitting next to the run they are giving up
       * does more in one glance than any sentence on this screen.
       *
       * Capped at thirty each side. A four-hundred-day streak would otherwise
       * fill the dialog, and the point is the shape rather than the census.
       */
      function streakDots(streak) {
        const past = Math.min(streak, 30);
        const dots = [];
        for (let i = 0; i < past; i += 1) dots.push(h('span', { class: 'keep__dot is-done' }));
        for (let i = 0; i < 30; i += 1) {
          dots.push(h('span', { class: 'keep__dot is-ghost', style: `--d:${i * 14}ms` }));
        }
        return h('div', { class: 'keep__dots' }, dots);
      }

      /**
       * Staying against leaving, over the same thirty days.
       *
       * This used to be Today against After, which compared them with their
       * own past. Comparing them with their own near future is the stronger
       * frame and the more useful one: nobody cancels because of what they
       * have already done, they cancel because they cannot see what it is
       * building towards.
       *
       * Each row is arithmetic or a real setting, never a projection dressed
       * up as a promise. Day 53 is day 23 plus thirty. The reviews are already
       * scheduled in `idea_reviews` and dated. The limits are the free tier's
       * actual numbers: fifty saves, three collections, no audio, no
       * downloads, sponsored cards on.
       */
      function swapTable(stats) {
        const rows = [
          stats.streak >= 2
            ? { now: `Day ${stats.streak + 30}`, after: 'Day 0', lead: 'Your streak' }
            : null,
          stats.dueSoon > 0
            ? {
                now: plural(stats.dueSoon, 'review lands', 'reviews land'),
                after: 'None of them',
                lead: 'Scheduled reviews',
              }
            : null,
          stats.saved > 50
            ? {
                lead: 'Saving',
                now: 'Anything you like',
                after: `Capped at 50 — you are at ${stats.saved.toLocaleString()}`,
              }
            : { lead: 'Saving', now: 'Unlimited', after: '50 saves, 3 collections' },
          { lead: 'Audio and downloads', now: 'Included', after: 'Reading only' },
          { lead: 'Sponsored cards', now: 'None', after: 'Back on' },
        ].filter(Boolean);

        return h('div', { class: 'keep__swap' }, [
          h('div', { class: 'keep__swaphead' }, [
            h('span', { class: 'keep__swaphead--lead' }),
            h('span', { class: 'is-stay', text: 'If you stay' }),
            h('span', { class: 'is-go', text: 'If you cancel' }),
          ]),
          ...rows.map((row) =>
            h('div', { class: 'keep__swaprow' }, [
              h('span', { class: 'keep__lead2', text: row.lead }),
              h('span', { class: 'keep__from', text: row.now }),
              h('span', { class: 'keep__to', text: row.after }),
            ]),
          ),
        ]);
      }

      async function stepDecide() {
        paint(4, [
          h('h2', { class: 'keep__title', id: 'keep-title', text: 'One moment…' }),
          h('p', { class: 'keep__lead', text: 'Reading your account.' }),
        ]);

        const stats = await statsPromise;
        if (state.step !== 4) return;

        const where = isApple ? root.dataset.manageIos : isPlay ? root.dataset.managePlay : null;

        /*
         * Leaving: plain text, under the button that keeps them. Smaller and
         * quieter than everything above it, and still a labelled control that
         * works on the first press. Understated is a design choice; the line
         * past which it stops being one is an exit people cannot use.
         */
        const leaving = isWeb
          ? h('button', {
              class: 'keep__leave',
              type: 'button',
              onclick: (event) => void openPortal(event.currentTarget),
            }, ['Cancel Subscription'])
          : h('a', {
              class: 'keep__leave',
              href: where,
              target: '_blank',
              rel: 'noopener',
              onclick: () => void recordOutcome('cancelled'),
            }, ['Cancel Subscription']);

        /*
         * The headline is the arithmetic, because the arithmetic is the whole
         * argument: thirty more days is day fifty-three, and cancelling is day
         * zero. Nothing in that sentence is a claim — it is addition, and it
         * is the number they are actually choosing between.
         */
        const headline =
          stats.streak >= 2
            ? `Thirty days from now you are on day ${stats.streak + 30}. Or day zero.`
            : 'Thirty days from now, this is either a habit or it is nothing.';

        paint(4, [
          h('p', { class: 'keep__step', text: 'Before you go' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: headline }),

          stats.streak >= 2
            ? h('div', { class: 'keep__run' }, [
                streakDots(stats.streak),
                h('p', {
                  class: 'keep__runcap',
                  html: `Each dot is a day. <strong>The solid ones you have already done.</strong> The faint ones are the month you are about to give up.`,
                }),
              ])
            : null,

          stats.dueSoon > 0
            ? h('p', {
                class: 'keep__punch',
                html:
                  `<strong>${plural(stats.dueSoon, 'idea is', 'ideas are')} mid-ladder right now.</strong> ` +
                  `Without the reviews, most of what you have half-learned is gone inside a week — ` +
                  `which is the entire reason this app exists.`,
              })
            : null,

          swapTable(stats),

          /*
           * One line of reassurance, and it is not softness.
           *
           * Somebody who believes cancelling wipes their library reaches the
           * same conclusion either way and stops reading — "it is all going
           * anyway" is a reason to press on, not a reason to stay. Saying
           * plainly that nothing is deleted is what makes everything above it
           * land as a loss they can still avoid.
           */
          h('p', {
            class: 'keep__reassure',
            html:
              (stats.saved > 1
                ? `Nothing is deleted. All ${stats.saved.toLocaleString()} of your saved ideas stay on your account — they just stop going anywhere.`
                : 'Nothing is deleted. Your library stays on your account — it just stops going anywhere.') +
              (endsOn ? ` Pro runs to <strong>${endsOn}</strong> either way.` : ''),
          }),
          isApple
            ? h('p', {
                class: 'keep__reassure',
                text: 'Apple took the payment, so Apple is the only place it can be cancelled.',
              })
            : null,
          h('p', { class: 'keep__status', 'data-keep-status': true, hidden: true }),
          h('button', {
            class: 'keep__stay',
            type: 'button',
            onclick: () => close('kept'),
          }, ['Keep My Subscription']),
          leaving,
        ]);
      }

      /**
       * The web subscriber's way out.
       *
       * RevenueCat hands every Web Billing customer a management URL — the
       * portal where the card and the cancellation actually live. It comes off
       * the subscriber object, which the public SDK key may read; this is the
       * same call the SDK makes.
       *
       * It replaces a `mailto:`. A subscription you can only leave by writing
       * to a human is not one anybody should be selling in the UK, and it is
       * the fastest route to a chargeback.
       */
      async function openPortal(button) {
        const status = body.querySelector('[data-keep-status]');
        const key = root.dataset.checkoutKey;
        button.disabled = true;
        if (status) {
          status.hidden = false;
          status.dataset.kind = 'busy';
          status.textContent = 'Opening your billing page…';
        }

        let url = null;
        try {
          const response = await fetch(
            `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`,
            { headers: { Authorization: `Bearer ${key}`, 'X-Platform': 'web' } },
          );
          if (response.ok) {
            const payload = await response.json();
            url = payload?.subscriber?.management_url || null;
          }
        } catch {
          url = null;
        }

        await recordOutcome('cancelled');

        if (url) {
          if (status) {
            status.dataset.kind = 'ok';
            status.textContent = 'Opening…';
          }
          window.open(url, '_blank', 'noopener');
          button.disabled = false;
          return;
        }

        if (status) {
          status.dataset.kind = 'error';
          status.innerHTML =
            `We could not open the billing page. Email ` +
            `<a href="mailto:${root.dataset.support}?subject=Cancel%20my%20subscription">${root.dataset.support}</a> ` +
            `and we will cancel it for you, within one working day and confirmed in writing.`;
        }
        button.disabled = false;
      }

      stepWhy();
    },
  };

  window.mindrollKeep = api;
})();
