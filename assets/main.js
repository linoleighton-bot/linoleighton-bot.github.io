/*
 * Progressive enhancement, and nothing else.
 *
 * Every page works with this file blocked: the navigation is anchors, the FAQ
 * is `<details>`, and the notify control is a real form with a real action.
 * What follows only makes those things nicer, which is why none of it is
 * wrapped in error handling — if it throws, the page it was decorating is still
 * the page.
 */
(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* A hairline under the header once the page has moved. */
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => {
      header.setAttribute('data-scrolled', window.scrollY > 8 ? 'true' : 'false');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /*
   * Reveal on entry.
   *
   * The class that hides things is scoped to `[data-reveal="on"]`, which is set
   * here — so if this script never runs, nothing is ever hidden. Anything still
   * unrevealed after a few seconds is shown regardless, because an observer
   * that misfires must not be able to cost someone the content.
   */
  const targets = [...document.querySelectorAll('.reveal')];
  if (targets.length && !reduced && 'IntersectionObserver' in window) {
    document.documentElement.setAttribute('data-reveal', 'on');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );

    for (const el of targets) observer.observe(el);

    window.setTimeout(() => {
      for (const el of targets) el.classList.add('is-in');
    }, 3000);
  }

  /*
   * The notify form.
   *
   * With no endpoint configured the form is a `mailto:` and the browser hands
   * it to a mail client, which is why that case is left alone rather than
   * scripted. When an endpoint *is* configured it is posted in the background,
   * so the reader is not thrown onto a third party's thank-you page and back.
   */
  const form = document.querySelector('[data-notify="endpoint"]');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const status = form.querySelector('[data-notify-status]');
      const button = form.querySelector('button');
      const say = (message) => {
        if (status) status.textContent = message;
      };

      if (button) button.disabled = true;
      say('Sending…');

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new FormData(form),
        });
        if (!response.ok) throw new Error(String(response.status));
        form.reset();
        say('Thank you — we’ll email you when it’s out.');
      } catch {
        say(`That didn’t send. Email ${form.dataset.fallback} and we’ll add you by hand.`);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  /*
   * The menu, on a phone.
   *
   * The button ships `hidden` and is unhidden here, so a browser with this
   * script blocked never shows a control that cannot work — it gets the panel
   * as a plain list instead. Everything below is the contract that makes the
   * button a real one: it reports its state, Escape closes it and returns the
   * focus that opened it, a link closes it on the way out, and widening the
   * window past the breakpoint closes it so the page cannot be left scrolled
   * shut with no visible way back.
   */
  const toggle = document.querySelector('[data-nav-toggle]');
  const panel = document.querySelector('[data-nav-panel]');
  if (toggle && panel) {
    toggle.hidden = false;

    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      document.documentElement.classList.toggle('is-menu-open', open);
    };

    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

    toggle.addEventListener('click', () => setOpen(!isOpen()));

    for (const link of panel.querySelectorAll('[data-nav-link]')) {
      link.addEventListener('click', () => setOpen(false));
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      setOpen(false);
      toggle.focus();
    });

    const wide = window.matchMedia('(min-width: 56rem)');
    wide.addEventListener('change', (event) => {
      if (event.matches) setOpen(false);
    });
  }

  /*
   * The card deck.
   *
   * Five real cards ship visible; this turns them into one card with controls.
   * The state lives on the grid rather than the deck so the arrows and the save
   * control — which are siblings, not children — can be laid out from the same
   * attribute.
   *
   * Saving is a demonstration of the real thing: the ladder it reveals is the
   * scheduler's own interval array, written into the page at build time. It
   * resets when you change card, because a save belongs to one idea.
   */
  const deck = document.querySelector('[data-deck]');
  const grid = deck && deck.closest('.anatomy__grid');
  const cards = deck ? [...deck.querySelectorAll('[data-card]')] : [];

  if (grid && cards.length > 1) {
    const count = grid.querySelector('[data-count]');
    const saveButton = grid.querySelector('[data-save]');
    const saveLabel = grid.querySelector('[data-save-label]');
    let index = 0;

    grid.setAttribute('data-deck-ready', 'true');

    const setSaved = (saved) => {
      grid.toggleAttribute('data-saved', saved);
      if (saveButton) saveButton.setAttribute('aria-pressed', String(saved));
      if (saveLabel) saveLabel.textContent = saved ? saveLabel.dataset.saved : saveLabel.dataset.action;
    };

    const show = (next) => {
      index = (next + cards.length) % cards.length;
      cards.forEach((el, i) => el.toggleAttribute('data-current', i === index));
      if (count) count.textContent = `${index + 1} / ${cards.length}`;
      setSaved(false);
    };

    const prev = grid.querySelector('[data-prev]');
    const next = grid.querySelector('[data-next]');
    if (prev) prev.addEventListener('click', () => show(index - 1));
    if (next) next.addEventListener('click', () => show(index + 1));
    if (saveButton) {
      saveButton.addEventListener('click', () =>
        setSaved(saveButton.getAttribute('aria-pressed') !== 'true'),
      );
    }

    /* Arrows work while the focus is anywhere in the deck. */
    grid.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      else if (event.key === 'ArrowRight') show(index + 1);
      else return;
      event.preventDefault();
    });

    show(0);
  }

  /*
   * Mark the section being read, in the header.
   *
   * Only the anchors that point at a section on this page, so the policy pages
   * — whose header links all leave — are left alone.
   */
  /*
   * A section maps to *every* link that points at it, not one.
   *
   * The same four anchors exist twice — once in the wide bar, once in the phone
   * panel — so keying a Map by section would let the second overwrite the
   * first, and the bar would never light up. Each section keeps a list.
   */
  const navLinks = new Map();
  for (const a of document.querySelectorAll('.site-nav a[href^="#"], .site-menu__nav a[href^="#"]')) {
    const section = document.getElementById(a.getAttribute('href').slice(1));
    if (!section) continue;
    navLinks.set(section, [...(navLinks.get(section) || []), a]);
  }

  if (navLinks.size && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const links = navLinks.get(entry.target);
          if (!links || !entry.isIntersecting) continue;
          for (const group of navLinks.values()) {
            for (const other of group) other.removeAttribute('aria-current');
          }
          for (const link of links) link.setAttribute('aria-current', 'true');
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );

    for (const section of navLinks.keys()) spy.observe(section);
  }

  /* Back to the top, once there is enough page behind you to want it. */
  const toTop = document.querySelector('[data-top]');
  if (toTop) {
    toTop.hidden = false;
    const onScroll = () => toTop.classList.toggle('is-in', window.scrollY > window.innerHeight);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    toTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      const skip = document.querySelector('.skip');
      if (skip) skip.focus({ preventScroll: true });
    });
  }

  /*
   * Table of contents: mark the section being read.
   *
   * Only on the policy pages, and only as a convenience — the links work
   * without it.
   */
  const toc = document.querySelector('.doc__toc');
  if (toc && 'IntersectionObserver' in window) {
    const links = new Map(
      [...toc.querySelectorAll('a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]),
    );

    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const link = links.get(entry.target.id);
          if (!link || !entry.isIntersecting) continue;
          for (const other of links.values()) other.removeAttribute('aria-current');
          link.setAttribute('aria-current', 'true');
        }
      },
      { rootMargin: '-10% 0px -75% 0px' },
    );

    for (const heading of document.querySelectorAll('.doc h2[id]')) spy.observe(heading);
  }
})();
