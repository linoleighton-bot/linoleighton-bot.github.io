/*
 * The home page's scroll motion, with no library behind it.
 *
 * Everything here is an addition to a page that already works without it. The
 * markup renders complete and `home.css` styles it complete; this file only
 * turns on the tall, sticky versions of two sections and drives them. A reader
 * who asked for less motion gets the still page.
 *
 * Effects, top to bottom:
 *   - the phone rises, then plays the loop on one book as the page scrolls
 *   - the three counts count up once, and their card drifts as it passes
 *   - the question gives way to the answer over a growing glow
 *   - on a wide screen, the feature cards and the shelf are pinned and move
 *     sideways with the scroll; a feature card turns over when pressed
 *   - the mascot rises from behind the closing panel
 *
 * Scrolling itself is the browser's own. Each scene reads how far through its
 * section the reader is, eases toward it a little every frame (the softness a
 * smoothing library would add, without taking over the wheel), and writes
 * only `transform` and `opacity`. Which phone screen shows is an attribute;
 * the change itself is a CSS transition, so a reader who stops mid-way sees
 * one whole screen, never two half ones.
 */
(() => {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- rails */

  // The arrow buttons move the row by one card. The row is an ordinary
  // scroller, so a trackpad or a finger moves it the same way. When the row
  // is pinned, the page's scrolling is what moves it, so the buttons scroll
  // the page by however much moves the row one card.
  for (const nav of document.querySelectorAll('[data-rail-nav]')) {
    const rail = document.querySelector(`[data-rail="${nav.dataset.railNav}"]`);
    if (!rail) continue;
    const step = (dir) => {
      const card = rail.firstElementChild;
      const gap = Number.parseFloat(getComputedStyle(rail).columnGap) || 0;
      const by = dir * ((card?.offsetWidth || 300) + gap);
      const behavior = reduced ? 'auto' : 'smooth';
      const ratio = rail.closest('.is-pinned') ? Number(rail.dataset.pinRatio) : 0;
      if (ratio) window.scrollBy({ top: by * ratio, behavior });
      else rail.scrollBy({ left: by, behavior });
    };
    nav.querySelector('[data-rail-prev]')?.addEventListener('click', () => step(-1));
    nav.querySelector('[data-rail-next]')?.addEventListener('click', () => step(1));
  }

  /* ---------------------------------------------------------- card turns */

  // A feature card turns over when pressed, and back when pressed again.
  for (const button of document.querySelectorAll('[data-flip]')) {
    button.addEventListener('click', () => {
      const card = button.closest('.fcard');
      const on = card.classList.toggle('is-turned');
      button.setAttribute('aria-pressed', String(on));
    });
  }

  /* --------------------------------------------------------------- counts */

  const counts = [...document.querySelectorAll('[data-count]')];
  if (!reduced && counts.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const el = entry.target;
          const target = Number.parseInt(el.textContent.replace(/[^\d]/g, ''), 10);
          if (!Number.isFinite(target)) continue;
          const start = performance.now();
          const tick = (now) => {
            const t = Math.min(1, (now - start) / 1400);
            el.textContent = Math.round(target * (1 - (1 - t) ** 3)).toLocaleString('en-GB');
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 },
    );
    counts.forEach((el) => observer.observe(el));
  }

  /* ----------------------------------------------------------------- hero */

  /*
   * The first screen. Its entrance is CSS and has already started by the time
   * this runs; this block adds what CSS cannot do alone.
   *
   * For everyone: a cover turns over when pressed, and slides fully on screen
   * when pointed at or focused. For a reader who has not asked for less
   * motion, also: the covers drift with the mouse, the notices take turns,
   * and as the page scrolls the copy eases away while the covers rise past it.
   *
   * The scroll and the mouse each drive a spring, stepped by real time, so
   * the motion trails the input softly instead of jumping with it. Each frame
   * writes only `transform` and `opacity`, to boxes that do nothing else. The
   * loop stops once every spring has settled, and does not run at all while
   * the hero is off screen.
   */
  const hero = document.querySelector('[data-hero]');
  if (hero) {
    const books = [...hero.querySelectorAll('[data-book]')];
    const between = (v) => Math.min(1, Math.max(0, v));

    /*
     * How far a cover must slide, once it has straightened and grown, to sit
     * wholly on screen and clear of the header. Measured when it is pointed
     * at, focused or pressed: never inside the animation loop.
     */
    const reveal = (btn) => {
      const box = btn.getBoundingClientRect();
      const bar = document.querySelector('.site-header .wrap')?.getBoundingClientRect();
      const grow = 1.08;
      const w = box.width * grow;
      const h = box.height * grow;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2 - 12;
      const edge = 16;
      const right = document.documentElement.clientWidth - edge;
      const top = Math.max(edge, (bar?.bottom || 0) + 8);
      const bottom = window.innerHeight - edge;
      let dx = 0;
      let dy = 0;
      if (cx - w / 2 < edge) dx = edge - (cx - w / 2);
      else if (cx + w / 2 > right) dx = right - (cx + w / 2);
      if (cy - h / 2 < top || h > bottom - top) dy = top - (cy - h / 2);
      else if (cy + h / 2 > bottom) dy = bottom - (cy + h / 2);
      btn.style.setProperty('--hx', `${Math.round(dx)}px`);
      btn.style.setProperty('--hy', `${Math.round(dy)}px`);
    };

    for (const book of books) {
      const btn = book.querySelector('button');
      btn.addEventListener('pointerenter', () => reveal(btn));
      btn.addEventListener('focus', () => reveal(btn));
      btn.addEventListener('click', () => {
        reveal(btn);
        btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      });
      // A look, not a setting: the cover turns back once the mouse or the
      // focus moves on, rather than leaving a blank card at the screen's edge.
      // A finger has no hover, so on a touch screen a second tap does it.
      btn.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse') btn.setAttribute('aria-pressed', 'false');
      });
      btn.addEventListener('blur', () => btn.setAttribute('aria-pressed', 'false'));
    }

    if (!reduced) {
      hero.setAttribute('data-live', '');
      const copy = hero.querySelector('[data-hero-copy]');
      const cue = hero.querySelector('[data-hero-scroll]');
      const floats = books.map((book) => ({
        depth: Number(book.dataset.depth) || 1,
        drift: book.querySelector('[data-drift]'),
        par: book.querySelector('[data-par]'),
      }));

      /* Deepstash's own numbers: a firm spring for the scroll, a floatier one
         for the mouse, which settles in about a second. */
      const spring = (stiffness, damping) => ({ stiffness, damping, x: 0, v: 0, to: 0 });
      const scroll = spring(80, 40);
      const mouseX = spring(40, 30);
      const mouseY = spring(40, 30);
      const step = (s, dt) => {
        s.v += (-s.stiffness * (s.x - s.to) - s.damping * s.v) * dt;
        s.x += s.v * dt;
      };
      const rest = (s, near) => {
        if (Math.abs(s.to - s.x) > near || Math.abs(s.v) > near) return false;
        s.x = s.to;
        s.v = 0;
        return true;
      };

      // The hero is not pinned: it is gone once its own height has scrolled by.
      let top = 0;
      let height = 1;
      const progress = () => between((window.scrollY - top) / height);
      const measure = () => {
        const box = hero.getBoundingClientRect();
        top = box.top + window.scrollY;
        height = Math.max(1, box.height);
        scroll.to = progress();
      };

      const shown = { p: -1, x: 0, y: 0, faded: false };
      const apply = () => {
        const p = scroll.x;
        if (p !== shown.p) {
          shown.p = p;
          const fade = between(p / 0.5);
          copy.style.opacity = String(1 - fade);
          copy.style.transform = `translate3d(0, ${(150 * p).toFixed(1)}px, 0) scale(${(1 - 0.1 * fade).toFixed(4)})`;
          if (cue) cue.style.opacity = String(1 - between((p * height) / 150));
          for (const f of floats) {
            f.drift.style.transform = `translate3d(0, ${(-300 * f.depth * p).toFixed(1)}px, 0) rotate(${(5 * p).toFixed(2)}deg)`;
          }
          // Faded copy must not take clicks meant for what is now behind it.
          if ((fade > 0.9) !== shown.faded) {
            shown.faded = fade > 0.9;
            hero.toggleAttribute('data-faded', shown.faded);
          }
        }
        if (mouseX.x !== shown.x || mouseY.x !== shown.y) {
          shown.x = mouseX.x;
          shown.y = mouseY.x;
          for (const f of floats) {
            f.par.style.transform = `translate3d(${(-20 * f.depth * mouseX.x).toFixed(1)}px, ${(-20 * f.depth * mouseY.x).toFixed(1)}px, 0)`;
          }
        }
      };

      let visible = true;
      let frame = 0;
      let then = 0;
      const tick = (now) => {
        frame = 0;
        const dt = then ? Math.min(0.05, (now - then) / 1000) : 1 / 60;
        then = now;
        // Short steps keep the firmer spring steady through a slow frame.
        const steps = Math.ceil(dt / 0.008);
        for (let i = 0; i < steps; i++) {
          step(scroll, dt / steps);
          step(mouseX, dt / steps);
          step(mouseY, dt / steps);
        }
        // Settled means under a fifth of a pixel from rest, even for the nearest cover.
        const settled = [rest(scroll, 0.0002), rest(mouseX, 0.003), rest(mouseY, 0.003)].every(Boolean);
        apply();
        if (!settled && visible) frame = requestAnimationFrame(tick);
        else then = 0;
      };
      const wake = () => {
        if (!frame && visible) frame = requestAnimationFrame(tick);
      };

      measure();
      scroll.x = scroll.to;
      apply();

      window.addEventListener(
        'scroll',
        () => {
          scroll.to = progress();
          wake();
        },
        { passive: true },
      );

      const parallax = window.matchMedia('(pointer: fine) and (min-width: 48rem)');
      window.addEventListener(
        'pointermove',
        (event) => {
          if (!visible || event.pointerType !== 'mouse' || !parallax.matches) return;
          mouseX.to = (event.clientX / window.innerWidth) * 2 - 1;
          mouseY.to = (event.clientY / window.innerHeight) * 2 - 1;
          wake();
        },
        { passive: true },
      );
      parallax.addEventListener('change', () => {
        mouseX.to = 0;
        mouseY.to = 0;
        wake();
      });

      const remeasure = () => {
        measure();
        wake();
      };
      window.addEventListener('resize', remeasure);
      document.fonts?.ready.then(remeasure);
      window.addEventListener('load', remeasure);

      /*
       * The notices take turns every four seconds: the front one fades away,
       * the one behind comes forward, and the next slides in behind it. They
       * hold still while pointed at, while the tab is hidden and while the
       * hero is off screen. Only the front one is read aloud.
       */
      const toasts = [...hero.querySelectorAll('[data-toast]')];
      let lead = 0;
      let timer = 0;
      let held = false;
      const deal = () => {
        lead = (lead + 1) % toasts.length;
        toasts.forEach((toast, i) => {
          const at = (i - lead + toasts.length) % toasts.length;
          toast.dataset.pos = at === 0 ? 'front' : at === 1 ? 'back' : 'out';
          if (at === 0) toast.removeAttribute('aria-hidden');
          else toast.setAttribute('aria-hidden', 'true');
        });
      };
      const cycle = () => {
        clearInterval(timer);
        timer = 0;
        if (toasts.length > 1 && visible && !held && !document.hidden) timer = setInterval(deal, 4000);
      };
      const stack = hero.querySelector('[data-toasts]');
      stack?.addEventListener('pointerenter', () => {
        held = true;
        cycle();
      });
      stack?.addEventListener('pointerleave', () => {
        held = false;
        cycle();
      });
      document.addEventListener('visibilitychange', cycle);

      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        hero.toggleAttribute('data-off', !visible);
        if (visible) {
          wake();
        } else {
          // Leave everything exactly where the reader left it.
          for (const s of [scroll, mouseX, mouseY]) {
            if (s === scroll) s.to = progress();
            s.x = s.to;
            s.v = 0;
          }
          apply();
        }
        cycle();
      }).observe(hero);
    }
  }

  if (reduced) return;
  root.classList.add('has-motion');

  const clamp = (v) => Math.min(1, Math.max(0, v));
  const range = (p, from, to) => clamp((p - from) / (to - from));
  const out = (t) => 1 - (1 - t) ** 3;
  const px = (n) => `${n.toFixed(1)}px`;

  /*
   * A scene is a tall section with a sticky stage. Its progress is 0 when the
   * section's top reaches the top of the screen and 1 when its bottom reaches
   * the bottom. `apply` gets the eased progress; `measure` runs on resize.
   *
   * Options: `ease` is how much of the gap closes each frame (smaller is
   * floatier), and `pass` measures an ordinary section instead, from its top
   * entering at the bottom of the screen to its bottom leaving at the top.
   * While a scene is on screen its section carries `data-live`, which is what
   * lets CSS loops inside it pause the rest of the time.
   */
  const scenes = [];
  const scene = (section, apply, measure = () => {}, { ease = 0.25, pass = false } = {}) => {
    if (!section) return;
    scenes.push({ section, apply, measure, ease, pass, current: null, live: false });
  };

  /* ---------------------------------------------------------- phone story */

  /*
   * The progress map. `p` is 0 when the section's top reaches the top of the
   * screen and 1 when its bottom reaches the bottom. The section is 1050svh
   * tall from the md breakpoint and 750svh below it, so 0.01 of `p` is 9.5svh
   * of scrolling on a desktop and 6.5svh on a phone.
   *
   * It alternates holds and moves. Every screen there is something to read
   * on holds completely still for at least 0.085 (81svh on a desktop, 55svh
   * on a phone). A change of screen is a CSS transition on `data-stage`, so
   * it takes no scroll at all.
   *
   *   p            beat                                          kind
   *   0    - .04   a line of covers under "Keep scrolling"        hold
   *   .04  - .17   the row slides six covers and glides to land   move
   *   .04  - .12   the hint shrinks toward the row                move
   *   .12  - .17   ...and fades as the phone comes up             move
   *   .14  - .20   the phone rises over the cover that landed     move
   *   .20  - .29   scanning: the laser sweeps, the island talks   hold
   *   .29  - .375  detected: green frame, the cover, found        hold
   *   .375 - .405  the row fades and blurs away                   move
   *   .405 - .49   the book screen                                hold
   *   .49  - .58   the book screen scrolls itself, slowly         move
   *   .58  - .625  the end of its idea list                       hold
   *   .625 - .645  the button is pressed                          hold
   *   .645 - .73   slide 1: one of the book's ideas               hold
   *   .73  - .815  slide 2                                        hold
   *   .815 - .90   slide 3                                        hold
   *   .90  - 1     done: one idea kept, and this is Mindroll      hold
   *   .21 on       the mascot peeks over the phone (md and up)
   */
  const STORY = {
    travel: [0.04, 0.17],
    steps: 6, // covers the row slides before it lands
    hint: [0.04, 0.12],
    hintOut: [0.12, 0.17],
    rise: [0.14, 0.2],
    rowOut: [0.375, 0.405],
    scroll: [0.49, 0.58],
    mascot: 0.21,
    stages: [
      [0, 'scan'],
      [0.29, 'found'],
      [0.405, 'book'],
      [0.625, 'press'],
      [0.645, 'slide-1'],
      [0.73, 'slide-2'],
      [0.815, 'slide-3'],
      [0.9, 'done'],
    ],
  };

  const story = document.querySelector('[data-story]');
  if (story) {
    const stage = story.querySelector('[data-story-stage]');
    const phone = story.querySelector('[data-story-phone]');
    const screen = story.querySelector('[data-story-screen]');
    const hint = story.querySelector('[data-story-hint]');
    const row = story.querySelector('[data-story-row]');
    const scroller = story.querySelector('[data-story-scroll]');
    const smooth = (t) => t * t * (3 - 2 * t);
    // Starts gently, then a long slowing glide onto the book.
    const land = (t) => 1 - (1 - smooth(t)) ** 2;
    let stepX = 0;
    let travel = 0;
    let drop = 0;
    let shown = '';
    let pal = '';
    let blur = '';
    let last = 0;
    let onScreen = false;

    const stageAt = (p) =>
      STORY.stages.reduce((name, [from, one]) => (p >= from ? one : name), 'scan');

    // The loops in the phone (laser, pulse, burst) run only while the phone
    // is up and the section is on screen.
    const sync = () => {
      const live = onScreen && last >= STORY.rise[0];
      if (live !== story.hasAttribute('data-live')) story.toggleAttribute('data-live', live);
    };
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    }).observe(story);

    scene(
      story,
      (p) => {
        last = p;

        // The hint shrinks toward the row, then fades as the phone comes up.
        const h = smooth(range(p, ...STORY.hint));
        const shrink = (1 - h * 0.35).toFixed(3);
        hint.style.transform = `translate3d(0, ${px(h * drop)}, 0) scale(${shrink})`;
        hint.style.opacity = String(1 - range(p, ...STORY.hintOut));

        // The row slides in from the right and slows onto the story's book.
        const slide = (1 - land(range(p, ...STORY.travel))) * stepX * STORY.steps;
        row.style.transform = `translate3d(${px(slide)}, 0, 0)`;
        const gone = range(p, ...STORY.rowOut);
        row.style.opacity = String(1 - gone);
        const rowBlur = gone ? `blur(${(gone * 10).toFixed(1)}px)` : '';
        if (rowBlur !== blur) {
          blur = rowBlur;
          row.style.filter = rowBlur;
        }

        // The phone rises from below the fold and settles over that cover.
        const below = (1 - out(range(p, ...STORY.rise))) * window.innerHeight * 1.2;
        phone.style.transform = `translate3d(0, ${px(below)}, 0)`;

        // The book screen scrolls itself, slowly enough to read.
        const read = smooth(range(p, ...STORY.scroll)) * travel;
        scroller.style.transform = `translate3d(0, ${px(-read)}, 0)`;

        const now = stageAt(p);
        if (now !== shown) {
          shown = now;
          screen.dataset.stage = now;
        }
        const mascot = p < STORY.mascot ? '' : now === 'done' ? 'cheer' : 'wave';
        if (mascot !== pal) {
          pal = mascot;
          if (mascot) stage.dataset.mascot = mascot;
          else delete stage.dataset.mascot;
        }
        sync();
        root.classList.toggle('story-on', p > 0.005 && p < 0.995);
      },
      () => {
        const book = row.firstElementChild;
        const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
        stepX = (book?.offsetWidth || 0) + gap;
        travel = Math.max(0, scroller.offsetHeight - scroller.parentElement.clientHeight);
        drop = Math.max(0, row.offsetTop - (hint.offsetTop + hint.offsetHeight)) * 0.8;
      },
    );
  }

  /* -------------------------------------------------------- the manifesto */

  const manifesto = document.querySelector('[data-manifesto]');
  if (manifesto) {
    const ring = manifesto.querySelector('[data-m-ring]');
    const blob = manifesto.querySelector('[data-m-blob]');
    const quiet = manifesto.querySelector('[data-m-quiet]');
    const loud = manifesto.querySelector('[data-m-loud]');

    const stage = manifesto.querySelector('.manifesto__stage');
    const kicker = manifesto.querySelector('[data-m-kicker]');
    const body = manifesto.querySelector('[data-m-body]');

    /*
     * The section is 300svh, so `p` covers two screens of scrolling. The
     * question holds for the first 6%, the target opens out past the edges
     * while the question lifts away, the glow grows, and the answer comes in
     * line by line: the headline, then the small line, then the paragraph.
     * From 0.66 nothing moves until the stage fades at the very end, which is
     * about half a screen of scrolling to read it in.
     */
    scene(
      manifesto,
      (p) => {
        const r = out(range(p, 0.06, 0.36));
        ring.style.transform = `scale(${(1 + r * 3).toFixed(3)})`;
        ring.style.opacity = String(1 - range(p, 0.18, 0.34));

        quiet.style.transform = `translate3d(0, ${px(-out(range(p, 0.12, 0.4)) * 150)}, 0)`;
        quiet.style.opacity = String(1 - range(p, 0.18, 0.34));

        blob.style.transform = `scale(${(0.5 + out(range(p, 0.28, 0.8)) * 3).toFixed(3)})`;
        blob.style.opacity = String(range(p, 0.28, 0.44));

        const l = out(range(p, 0.38, 0.54));
        loud.style.transform = `translate3d(0, ${px((1 - l) * 50)}, 0) scale(${(0.9 + l * 0.1).toFixed(3)})`;
        loud.style.opacity = String(range(p, 0.4, 0.52));

        const k = out(range(p, 0.5, 0.6));
        kicker.style.transform = `translate3d(0, ${px((1 - k) * 18)}, 0)`;
        kicker.style.opacity = String(k);

        const b = out(range(p, 0.56, 0.66));
        body.style.transform = `translate3d(0, ${px((1 - b) * 18)}, 0)`;
        body.style.opacity = String(b);

        const end = range(p, 0.95, 1);
        stage.style.opacity = String(1 - end);
        stage.style.transform = end ? `scale(${(1 - end * 0.02).toFixed(4)})` : '';
      },
      undefined,
      { ease: 0.14 },
    );
  }

  /* ----------------------------------------------------------- the stats */

  // The card drifts against the scroll by a few pixels as it passes.
  const statCard = document.querySelector('.statbar__card');
  if (statCard) {
    scene(
      statCard.closest('section'),
      (p) => {
        statCard.style.translate = `0 ${px(24 - p * 48)}`;
      },
      undefined,
      { pass: true, ease: 0.18 },
    );
  }

  /* ----------------------------------------------------------- the closer */

  // The mascot rises from behind the panel every time it comes into view,
  // and sinks back when it leaves.
  const closer = document.querySelector('[data-closer]');
  if (closer) {
    new IntersectionObserver(
      ([entry]) => closer.classList.toggle('is-up', entry.isIntersecting),
      { threshold: 0.1 },
    ).observe(closer);
  }

  /* -------------------------------------------------------- pinned rails */

  /*
   * On a wide, tall enough screen a row of cards is pinned: its section grows
   * by the row's length, the stage sticks, and scrolling down moves the row
   * left. One pixel scrolled is one pixel moved, unless the row is longer
   * than `data-pin-screens` screens, in which case it moves faster so the
   * page does not hold for ever. The first and last 8% of the pin hold still,
   * so the heading is read before anything moves and the last card is seen
   * before the page moves on.
   *
   * A sideways swipe on a trackpad scrolls the page instead, so it still
   * moves the row, and a card reached by Tab is brought on screen.
   */
  const pinQuery = window.matchMedia('(min-width: 64rem) and (min-height: 40rem)');
  const HOLD = 0.08;
  for (const section of document.querySelectorAll('[data-pin]')) {
    const rail = section.querySelector('.rail');
    if (!rail) continue;
    const screens = Number(section.dataset.pinScreens) || Infinity;
    let pinned = false;
    let travel = 0;
    let length = 0;

    // The page position at which the row has moved `x` pixels.
    const scrollFor = (x) => {
      const p = HOLD + (Math.min(travel, Math.max(0, x)) / Math.max(1, travel)) * (1 - 2 * HOLD);
      return section.getBoundingClientRect().top + window.scrollY + p * (section.offsetHeight - window.innerHeight);
    };

    scene(
      section,
      (p) => {
        if (pinned) rail.style.transform = `translate3d(${px(-range(p, HOLD, 1 - HOLD) * travel)}, 0, 0)`;
      },
      () => {
        pinned = pinQuery.matches;
        section.classList.toggle('is-pinned', pinned);
        rail.style.transform = '';
        section.style.height = '';
        if (!pinned) return;
        const last = rail.lastElementChild;
        const edge = Number.parseFloat(getComputedStyle(rail).paddingRight) || 0;
        travel = Math.max(0, last.offsetLeft + last.offsetWidth + edge - rail.clientWidth);
        length = Math.min(travel, screens * window.innerHeight);
        rail.dataset.pinRatio = String(length / Math.max(1, travel));
        section.style.height = `${Math.round(length / (1 - 2 * HOLD) + window.innerHeight)}px`;
      },
      { ease: 0.16 },
    );

    section.addEventListener(
      'wheel',
      (event) => {
        if (!pinned || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        window.scrollBy(0, event.deltaX * (length / Math.max(1, travel)));
      },
      { passive: false },
    );

    rail.addEventListener('focusin', (event) => {
      if (!pinned) return;
      const card = event.target.closest('.rail > li');
      if (!card) return;
      const x = card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2;
      window.scrollTo({ top: scrollFor(x), behavior: 'auto' });
    });
  }

  /* ---------------------------------------------------------------- engine */

  const progressOf = (s) => {
    const box = s.section.getBoundingClientRect();
    if (s.pass) return clamp((window.innerHeight - box.top) / (window.innerHeight + box.height));
    return clamp(-box.top / Math.max(1, box.height - window.innerHeight));
  };

  let frame = 0;
  const tick = () => {
    frame = 0;
    let moving = false;
    for (const s of scenes) {
      if (!s.live) continue;
      const target = progressOf(s);
      // Close part of the gap each frame: a quarter by default, which is
      // soft and settled in about a third of a second.
      s.current = s.current === null ? target : s.current + (target - s.current) * s.ease;
      if (Math.abs(target - s.current) < 0.0005) s.current = target;
      else moving = true;
      s.apply(s.current);
    }
    if (moving) frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  // Scenes only run while their section is on screen.
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const s = scenes.find((one) => one.section === entry.target);
      if (!s) continue;
      s.live = entry.isIntersecting;
      s.section.toggleAttribute('data-live', s.live);
      if (!s.live) {
        // Leave it exactly at whichever end the reader left by.
        s.current = progressOf(s);
        s.apply(s.current);
      }
    }
    wake();
  });

  const measure = () => {
    scenes.forEach((s) => {
      s.measure();
      s.current = progressOf(s);
      s.apply(s.current);
    });
  };

  scenes.forEach((s) => watcher.observe(s.section));
  measure();
  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', measure);
  // Lexend changes the length of the source screen when it arrives.
  document.fonts?.ready.then(measure);
  window.addEventListener('load', measure);
})();
