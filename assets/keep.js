/*
 * The cancellation flow.
 *
 * Four questions between "manage subscription" and a cancelled plan. Every one
 * of them is a real question with a real answer behind it, which is the only
 * version of this that works twice: a flow built out of invented urgency saves
 * somebody once and costs the chargeback the second time.
 *
 * What it actually leans on:
 *
 *   1. A reason, chosen first. It is a small commitment, it makes the next
 *      three screens feel earned rather than imposed, and — the part that
 *      matters commercially — it is what lets the offer be the right one.
 *      A single "here's 50% off" shown to everybody converts the people who
 *      were leaving over money and insults everybody else.
 *
 *   2. Their own numbers. Loss aversion is the strongest lever in this whole
 *      file and it only works with specifics: "your 213 saved ideas" moves
 *      people, "your content" does not. Every figure on that screen is read
 *      from their account at the moment it is shown. None are estimated and
 *      none are rounded up.
 *
 *   3. The forgetting curve, which is this product's own argument turned on
 *      its owner. Somebody with reviews scheduled is mid-ladder, and the app
 *      exists because stopping there is when the material goes. That is both
 *      the most persuasive thing we can say and simply true.
 *
 *   4. A pause before a cancel. The single highest-yield lever in subscription
 *      retention, because most people reaching for cancel want to stop paying
 *      this month rather than stop entirely — and the ones who cancel outright
 *      come back later at full price, having lost everything in between.
 *
 * **Cancelling stays one click away on every screen.** That is not timidity.
 * A flow you cannot leave is a chargeback, a one-star review and — for a UK
 * trader selling to UK consumers — a straightforward breach of the rules on
 * subscription exits. The asymmetry here is in emphasis, which is allowed and
 * is what every subscription business does; it is not in availability.
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
   * with a Content-Range and nothing else. Run together, because this is
   * loading behind the first screen and must be finished by the time the
   * second one is shown.
   *
   * Every one of them is allowed to fail. A missing table or a denied policy
   * is a stat that is left out, never a flow that stops working: somebody
   * trying to cancel and meeting an error page is the worst outcome available.
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
      /* Mid-ladder only. An idea that has already survived the whole interval
         ladder carries `learned_at`, and claiming those are at risk would be
         the one dishonest number on the screen. */
      count('idea_reviews', (q) => q.is('learned_at', null).lte('due_at', horizon)),
      readStreak(client, user),
    ]);

    return { saved, learned, topics, dueSoon, streak: streakDays };
  }

  /**
   * The current streak, computed from the days themselves.
   *
   * `streak_events` is one row per day that counted, so the run is the number
   * of consecutive day keys back from today. Counted from yesterday as well as
   * today, because somebody who has not opened the app yet this morning still
   * has their streak — it has simply not been extended.
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

  /* ----------------------------------------------------------- the reasons */

  /*
   * Five reasons, which is as many as anybody reads.
   *
   * Worded as the person would word it to a friend rather than as a support
   * category — "it costs more than I'm getting back" rather than "price". The
   * phrasing is doing work: a reason somebody recognises is a reason they
   * click, and an unanswered first screen is a flow that saves nobody.
   */
  const REASONS = [
    { id: 'price', label: 'It costs more than I’m getting back' },
    { id: 'unused', label: 'I’m not opening it enough' },
    { id: 'missing', label: 'Something I need isn’t there' },
    { id: 'alternative', label: 'I’m using something else' },
    { id: 'break', label: 'I just need a break' },
  ];

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
         switch offer below is only honest if we know they are on the dearer
         of the two, so an unrecognised product means no switch is offered. */
      let plans = [];
      try {
        plans = JSON.parse(root.dataset.plans || '[]');
      } catch {
        plans = [];
      }
      const product = String(row?.product_id || '');
      const onWeekly = /week/i.test(product);
      const annual = plans.find((p) => p.id === 'annual') || null;

      const endsOn = prettyDate(row?.expires_at);

      /* Loaded behind the first screen; the second one waits on it. */
      const statsPromise = readStats(client, user);

      const state = { reason: null, detail: '', surveyId: null, step: 0 };

      /* ------------------------------------------------- survey recording */

      /*
       * Best-effort, always. The table may not exist on a project that has not
       * run the migration yet, and a failed write must never be the reason
       * somebody cannot leave. Recorded on the way *in* rather than on the way
       * out, so the saves are counted too — a flow measured only by completed
       * cancellations cannot tell you whether it is working.
       */
      const recordReason = async () => {
        try {
          const { data } = await client
            .from('cancellation_surveys')
            .insert({ user_id: user.id, reason: state.reason, detail: state.detail, store })
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
            .update({ outcome, detail: state.detail, updated_at: new Date().toISOString() })
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

      panel.append(
        h('div', { class: 'keep__bar' }, [fill]),
        h('button', {
          class: 'keep__close',
          type: 'button',
          'aria-label': 'Close',
          onclick: () => close(state.reason ? 'kept' : null),
        }, ['×']),
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
        const focusable = body.querySelector('button, [href], textarea, input');
        /*
         * Moved without the ring. Safari paints `:focus-visible` on a
         * programmatic focus where Chrome does not, and the orange box it drew
         * around the funnel headings is the same bug — a screen reader still
         * announces the heading, so nothing is lost by suppressing it.
         */
        if (focusable) focusable.focus({ preventScroll: true });
      };

      /* The way out, on every single screen. */
      const exitLink = (label = 'Cancel my subscription') =>
        h('button', { class: 'keep__exit', type: 'button', onclick: () => stepConfirm() }, [label]);

      /* ------------------------------------------------ 1. what happened */

      function stepReason() {
        let chosen = state.reason;
        const detail = h('textarea', {
          class: 'keep__detail',
          rows: '2',
          maxlength: '600',
          placeholder: 'Anything else? (optional)',
          oninput: (e) => {
            state.detail = e.target.value.slice(0, 600);
          },
        });
        detail.value = state.detail;

        const next = h('button', {
          class: 'btn btn--primary keep__go',
          type: 'button',
          disabled: !chosen,
          onclick: async () => {
            state.reason = chosen;
            await recordReason();
            stepLoss();
          },
        }, ['Continue']);

        const options = REASONS.map((reason) =>
          h('button', {
            class: `keep__option${chosen === reason.id ? ' is-on' : ''}`,
            type: 'button',
            'data-reason': reason.id,
            onclick: (event) => {
              chosen = reason.id;
              for (const node of body.querySelectorAll('.keep__option')) node.classList.remove('is-on');
              event.currentTarget.classList.add('is-on');
              next.disabled = false;
            },
          }, [reason.label]),
        );

        paint(1, [
          h('p', { class: 'keep__step', text: 'Question 1 of 4' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: 'Before you go — what happened?' }),
          h('p', {
            class: 'keep__lead',
            text: 'One question, and it changes what we can actually do about it.',
          }),
          h('div', { class: 'keep__options' }, options),
          detail,
          next,
          exitLink('Skip this and cancel'),
        ]);
      }

      /* ------------------------------------------- 2. what it costs them */

      async function stepLoss() {
        paint(2, [
          h('p', { class: 'keep__step', text: 'Question 2 of 4' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: 'One moment…' }),
          h('p', { class: 'keep__lead', text: 'Reading your account.' }),
        ]);

        const stats = await statsPromise;
        if (state.step !== 2) return;

        const tiles = [
          stats.saved ? { n: stats.saved, label: stats.saved === 1 ? 'idea saved' : 'ideas saved' } : null,
          stats.streak ? { n: stats.streak, label: stats.streak === 1 ? 'day streak' : 'day streak' } : null,
          stats.learned ? { n: stats.learned, label: stats.learned === 1 ? 'idea learned' : 'ideas learned' } : null,
          stats.topics ? { n: stats.topics, label: stats.topics === 1 ? 'topic followed' : 'topics followed' } : null,
        ].filter(Boolean);

        const greeting = ctx.name ? `${ctx.name}, look` : 'Look';

        /*
         * The forgetting curve, pointed at the person leaving.
         *
         * Only shown when there is actually something scheduled. Said to
         * somebody with nothing due it would be a scare with no substance
         * behind it, and that is the version of this screen that gets a
         * business a reputation.
         */
        const curve =
          stats.dueSoon > 0
            ? h('div', { class: 'keep__curve' }, [
                h('p', {
                  class: 'keep__curvehead',
                  html: `<strong>${plural(stats.dueSoon, 'idea is', 'ideas are')}</strong> scheduled for review in the next 30 days.`,
                }),
                h('p', {
                  class: 'keep__curvebody',
                  text:
                    'Cancelling stops those reviews. That matters more here than it would anywhere else — ' +
                    'the whole app exists because of what happens when you stop: most of what you have ' +
                    'learned but not yet locked in goes within a week.',
                }),
              ])
            : null;

        const streakLine =
          stats.streak >= 3
            ? h('p', {
                class: 'keep__loseline',
                html: `Your library stays either way. <strong>The streak is the part you cannot get back</strong> — day ${stats.streak} took you ${plural(stats.streak, 'day', 'days')} to reach, and it restarts at one.`,
              })
            : h('p', {
                class: 'keep__loseline',
                text: 'Your saves and collections stay on your account either way. What stops is everything that was still being built on top of them.',
              });

        paint(2, [
          h('p', { class: 'keep__step', text: 'Question 2 of 4' }),
          h('h2', {
            class: 'keep__title',
            id: 'keep-title',
            text: tiles.length ? `${greeting} at what you have built.` : 'Here is what cancelling stops.',
          }),
          tiles.length
            ? h(
                'div',
                { class: 'keep__stats' },
                tiles.map((tile) =>
                  h('div', { class: 'keep__stat' }, [
                    h('span', { class: 'keep__statn', text: tile.n.toLocaleString() }),
                    h('span', { class: 'keep__statl', text: tile.label }),
                  ]),
                ),
              )
            : null,
          curve,
          streakLine,
          h('button', {
            class: 'btn btn--primary keep__go',
            type: 'button',
            onclick: () => stepOffer(stats),
          }, ['See what we can do']),
          exitLink('No, cancel my subscription'),
        ]);
      }

      /* ------------------------------------------------- 3. the real offer */

      /*
       * One offer, chosen by the reason given on screen one.
       *
       * Each is something that can actually be delivered. The switch is a real
       * checkout against a real cheaper plan; the hold is a real request that
       * a real person answers. Nothing here promises a discount that does not
       * exist, which is the trap this kind of screen usually falls into — an
       * offer the business cannot honour converts once and refunds twice.
       */
      function stepOffer(stats) {
        const holdButton = (label) =>
          h('button', {
            class: 'btn btn--primary keep__go',
            type: 'button',
            /* Pressed a second time after it has gone through, "Done" is a
               close button — leaving it live would let somebody file the same
               request four times and wonder why nothing happened. */
            onclick: (event) =>
              event.currentTarget.dataset.done
                ? close('paused')
                : void requestHold(event.currentTarget),
          }, [label]);

        let title = 'Here is what we can do.';
        let lead = null;
        let extra = null;
        let action = holdButton('Pause my plan for a month');

        if (state.reason === 'price' && onWeekly && annual) {
          /*
           * The only offer on this screen that is a straight saving, and it is
           * a large one: the weekly plan annualises to many times the annual
           * price. Somebody leaving over money who is on the wrong plan is the
           * easiest save there is, and it is also simply the right advice.
           */
          title = 'You are on the expensive one.';
          lead =
            `You are paying by the week, which is the dearest way to buy this. The annual plan is ` +
            `${annual.leadAmount} a ${annual.leadUnit} — ${annual.amount} once, for the same everything.`;
          action = h('button', {
            class: 'btn btn--primary keep__go',
            type: 'button',
            onclick: () => {
              void recordOutcome('switched');
              /* The funnel's offer step is where the embedded checkout lives,
                 and it takes the plan to open on in the query string. */
              window.location.href = '/start?q=offer&plan=annual';
            },
          }, [`Switch to annual — ${annual.amount}`]);
        } else if (state.reason === 'price') {
          title = 'Annual is already the cheapest we do.';
          lead =
            'So we will not pretend there is a secret lower price. What we can do is stop charging you ' +
            'for a month you are not using — the plan holds, the streak freezes where it is, and nothing ' +
            'you have built goes anywhere.';
        } else if (state.reason === 'unused' || state.reason === 'break') {
          title = 'Then do not cancel. Pause.';
          lead =
            'Cancelling and coming back means starting from nothing — a streak of one, no review ' +
            'schedule, and whatever the price is by then. Pausing means billing stops and everything ' +
            'else waits exactly where you left it.';
          extra = stats.dueSoon
            ? `Your ${plural(stats.dueSoon, 'review', 'reviews')} due this month will be waiting too, not expired.`
            : null;
        } else if (state.reason === 'missing') {
          title = 'Tell us what is missing.';
          lead =
            'A real person reads these and answers them. And we will hold your plan while we look at ' +
            'it, so you are not paying to wait for something that is not there yet.';
          const box = h('textarea', {
            class: 'keep__detail',
            rows: '3',
            maxlength: '600',
            placeholder: 'What were you expecting to find?',
            oninput: (e) => {
              state.detail = e.target.value.slice(0, 600);
            },
          });
          box.value = state.detail;
          extra = box;
          action = holdButton('Send it and pause my plan');
        } else if (state.reason === 'alternative') {
          title = 'Fair enough. One thing first.';
          const mine = [
            stats.saved ? plural(stats.saved, 'saved idea', 'saved ideas') : null,
            stats.streak >= 3 ? `${stats.streak}-day streak` : null,
            stats.dueSoon ? plural(stats.dueSoon, 'scheduled review', 'scheduled reviews') : null,
          ].filter(Boolean);
          lead = mine.length
            ? `Whatever you have moved to does not have your ${mine.join(', your ')}. If it does not work out — and most switches do not — you would be starting here from zero.`
            : 'If it does not work out, you would be starting here from zero rather than picking up where you left off.';
          extra = 'Pause instead and you will not be.';
        }

        paint(3, [
          h('p', { class: 'keep__step', text: 'Question 3 of 4' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: title }),
          lead ? h('p', { class: 'keep__lead', text: lead }) : null,
          typeof extra === 'string' ? h('p', { class: 'keep__lead keep__lead--tight', text: extra }) : extra,
          h('p', { class: 'keep__status', 'data-keep-status': true, hidden: true }),
          action,
          h('button', {
            class: 'keep__secondary',
            type: 'button',
            onclick: () => close('kept'),
          }, ['Actually, I’m staying']),
          exitLink('No, cancel my subscription'),
        ]);
      }

      /**
       * A pause, asked for properly.
       *
       * Written to `support_tickets`, which already exists, is already read, and
       * is already the place a request from a customer lands. The copy promises
       * a reply within one working day and that promise has to be kept by a
       * person — which is said plainly on screen rather than dressed up as an
       * automatic pause that does not happen.
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
            `Reason: ${state.reason}\n` +
            `Store: ${store || 'unknown'}\n` +
            `Plan ends: ${endsOn || 'unknown'}\n\n` +
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
            ? 'Got it. We will confirm by email within one working day — your plan stays exactly as it is until then.'
            : `We could not send that. Email <a href="mailto:${root.dataset.support}?subject=Pause%20my%20plan">${root.dataset.support}</a> and we will sort it.`;
        }
        button.disabled = false;
        button.textContent = sent ? 'Done' : 'Try again';
        if (sent) button.dataset.done = '1';
      }

      /* ------------------------------------------------------ 4. confirm */

      /*
       * The honest screen.
       *
       * Everything above argues. This one does not: it says what ends, when it
       * ends, what survives, and then gives them the way out. A last screen
       * that argues again is where a retention flow stops being persuasion and
       * starts being the thing regulators write rules about.
       */
      function stepConfirm() {
        const where = isApple
          ? root.dataset.manageIos
          : isPlay
            ? root.dataset.managePlay
            : null;

        const handoff = !isWeb
          ? h('a', {
              class: 'keep__exitbtn',
              href: where,
              target: '_blank',
              rel: 'noopener',
              onclick: () => void recordOutcome('cancelled'),
            }, [isApple ? 'Cancel in your Apple account' : 'Cancel in Google Play'])
          : h('button', {
              class: 'keep__exitbtn',
              type: 'button',
              onclick: (event) => void openPortal(event.currentTarget),
            }, ['Take me to cancel']);

        paint(4, [
          h('p', { class: 'keep__step', text: 'Question 4 of 4' }),
          h('h2', { class: 'keep__title', id: 'keep-title', text: 'Last thing, and then we will stop.' }),
          h('ul', { class: 'keep__facts' }, [
            h('li', {
              html: endsOn
                ? `Pro runs until <strong>${endsOn}</strong>. Nothing changes before then, and you are not charged again.`
                : 'Pro runs to the end of the period you have already paid for. You are not charged again.',
            }),
            h('li', {
              text: 'After that: audio, downloads and unlimited saves stop. Your review schedule stops with them.',
            }),
            h('li', {
              text: 'Your saves, collections and notes stay on your account. Nothing is deleted.',
            }),
            h('li', {
              text: 'You can turn Pro back on whenever you like — at whatever it costs then.',
            }),
          ]),
          isApple
            ? h('p', {
                class: 'keep__lead keep__lead--tight',
                text:
                  'Apple took the payment, so Apple is the only place it can be cancelled. We cannot do ' +
                  'it from here, and anyone who tells you otherwise is guessing.',
              })
            : null,
          h('p', { class: 'keep__status', 'data-keep-status': true, hidden: true }),
          h('button', {
            class: 'btn btn--primary keep__go',
            type: 'button',
            onclick: () => close('kept'),
          }, ['Keep my plan']),
          handoff,
        ]);
      }

      /**
       * The web subscriber's way out.
       *
       * RevenueCat hands every Web Billing customer a management URL — the
       * portal where the card and the cancellation actually live. It comes off
       * the subscriber object, which the public SDK key is allowed to read;
       * this is the same call the SDK makes.
       *
       * This replaces a `mailto:` link. A subscription you can only leave by
       * writing an email to a human is not a subscription anybody should be
       * selling in the UK, and it is also the fastest route to a chargeback.
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
            `and we will cancel it for you — within one working day, and we will confirm in writing.`;
        }
        button.disabled = false;
      }

      stepReason();
    },
  };

  window.mindrollKeep = api;
})();
