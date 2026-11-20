/*
 * Video templates: "Make a video".
 *
 * A template turns a reference video into a row of short clips. The creator
 * films one clip per piece, and this file joins the clips, lays each clip's
 * edits (words, pictures, screen recordings) over it at their set times, mixes
 * the music underneath, and hands back one finished vertical video to post.
 *
 * Everything is put together in the browser. The clips never leave the
 * creator's device; only the recipe (clips, edits, music) is on the server, in
 * creator_templates. build() is the one place that makes the video, so a
 * hosted renderer could replace it without touching the rest.
 */
(() => {
  'use strict';
  const cp = window.mindrollCreators;
  if (!cp) return;
  const { h, toast } = cp;

  const W = 720;
  const H = 1280;
  const FPS = 30;
  const MAX_SLOTS = 12;
  const MAX_LAYERS = 8;
  const POS = { top: 0.17, middle: 0.5, bottom: 0.76 };
  const POS_LABEL = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };
  const SIZE = { s: { w: 0.4, h: 0.25, font: 42 }, m: { w: 0.64, h: 0.36, font: 54 }, l: { w: 0.86, h: 0.5, font: 68 }, full: { w: 1, h: 1, font: 68 } };
  const SIZE_LABEL = { s: 'Small', m: 'Medium', l: 'Large', full: 'Full screen' };
  const KIND_LABEL = { text: 'Words', image: 'Picture', video: 'Screen recording' };
  const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif";

  /* A stored file's address. A path on the site itself (the sample template's recording) is used as it is. */
  const fileUrl = (path) => (/^\//.test(path || '') ? path : cp.briefVideoUrl(path));
  const secs = (n) => { const v = Math.round(Number(n) * 10) / 10; return `${Number.isInteger(v) ? v : v.toFixed(1)}s`; };
  const slotLen = (s) => Math.max(0, Number(s.end) - Number(s.start)) || 0;
  /* A clip may run a little over its slot; past this it is cut. */
  const capOf = (s) => { const len = slotLen(s); return len ? Math.max(len * 1.5, len + 1.5) : 15; };
  const AC = window.AudioContext || window.webkitAudioContext;
  const canBuild = !!(window.MediaRecorder && AC && HTMLCanvasElement.prototype.captureStream);
  const pickMime = () => ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';

  /* ------------------------------------------------- clips kept on the device */

  const memory = new Map();
  let dbOpen = null;
  const idb = () => (dbOpen ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open('mindroll-maker', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('clips');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
  const store = async (mode, run) => {
    const db = await idb();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('clips', mode);
        const req = run(tx.objectStore('clips'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = tx.onabort = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  };
  const clipKey = (id, i) => `${id}:${i}`;
  const saveClip = (id, i, blob) => { memory.set(clipKey(id, i), blob); return store('readwrite', (s) => s.put(blob, clipKey(id, i))); };
  const dropClip = (id, i) => { memory.delete(clipKey(id, i)); return store('readwrite', (s) => s.delete(clipKey(id, i))); };
  const readClip = async (id, i) => memory.get(clipKey(id, i)) || (await store('readonly', (s) => s.get(clipKey(id, i)))) || null;

  /* Words a creator adds to their own video: kept on their device, per format and clip. */
  const extrasKey = (id) => `mindroll.maker.words.${id}`;
  const readExtras = (id) => { try { const v = JSON.parse(localStorage.getItem(extrasKey(id)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const saveExtras = (id, all) => { try { localStorage.setItem(extrasKey(id), JSON.stringify(all)); } catch { /* private window: kept for this visit only */ } };

  /* --------------------------------------------------------------- templates */

  const words = (text, pos, from, to) => ({ kind: 'text', text, pos, size: 'm', from: from || 0, to: to ?? null });
  /* The sample formats shown on the preview pages: three the team might put up, each with its reference. */
  const DEMO = [{
    brief_id: 'f1',
    brief: { id: 'f1', title: 'The "I replaced doomscrolling" hook', url: 'https://www.tiktok.com/@mindroll/video/7520000000000000100', video_path: null, note: 'Say the swap in the first two seconds, show the app by second five.' },
    active: true,
    music_path: null,
    music_volume: 0.25,
    caption: 'I swapped doomscrolling for this. #Mindroll',
    slots: [
      { start: 0, end: 3, line: 'I deleted every app I doomscroll on. Here is what I open instead.', layers: [words('I replaced doomscrolling', 'top')] },
      { start: 3, end: 8, line: 'It is called Mindroll. You swipe through big ideas from books, a minute each.', layers: [words('Big ideas, one minute each', 'bottom'), { kind: 'video', path: '/app/assets/assets/onboarding/brain-wake.be22d1fe2e29e275298f016b4206060d.mp4', note: 'A short recording of the app', pos: 'middle', size: 'm', from: 1, to: 4.5 }] },
      { start: 8, end: 13, line: 'Ten minutes on the train and I have finished what used to take me a month to read.', layers: [words('10 minutes a day', 'bottom', 0, 2.5), words('= a book a week', 'bottom', 2.5, null)] },
      { start: 13, end: 17, line: 'Link is in my bio. Try it for a week and tell me I am wrong.', layers: [words('Link in bio', 'middle')] },
    ],
  }, {
    brief_id: 'f2',
    brief: { id: 'f2', title: '"3 things I learned this week"', url: 'https://www.tiktok.com/@mindroll/video/7520000000000000200', video_path: null, note: 'A quick list. One idea per clip, count them on screen.' },
    active: true,
    music_path: null,
    music_volume: 0.25,
    caption: '3 things I learned this week, in five minutes a day. #Mindroll',
    slots: [
      { start: 0, end: 3, line: 'Three things I learned this week without opening a single book.', layers: [words('3 things I learned this week', 'top')] },
      { start: 3, end: 8, line: 'One. Your brain keeps what it meets again, so the good ideas come back until they stick.', layers: [words('1. Ideas you revisit, you keep', 'bottom')] },
      { start: 8, end: 13, line: 'Two. The Stoics wrote their notes to themselves, not to an audience.', layers: [words('2. Write it for yourself', 'bottom')] },
      { start: 13, end: 18, line: 'Three. Five minutes a day beats an hour once a week.', layers: [words('3. Small and daily wins', 'bottom')] },
      { start: 18, end: 22, line: 'All of it came from Mindroll. Link is in my bio.', layers: [words('Link in bio', 'middle'), { kind: 'video', path: '/app/assets/assets/onboarding/brain-smart.25419c3ee8e998f275243c42933c6f52.mp4', note: 'A short recording of the app', pos: 'top', size: 's', from: 0.5, to: null }] },
    ],
  }, {
    brief_id: 'f3',
    brief: { id: 'f3', title: 'POV: your commute, but smarter', url: 'https://www.tiktok.com/@mindroll/video/7520000000000000300', video_path: null, note: 'Three shots, hardly any talking. Film it on the way somewhere.' },
    active: true,
    music_path: null,
    music_volume: 0.25,
    caption: 'POV: you stopped scrolling on the train. #Mindroll',
    slots: [
      { start: 0, end: 4, line: 'Film yourself getting on the train or the bus, phone in hand. No need to speak.', layers: [words('POV: you stopped scrolling on your commute', 'top')] },
      { start: 4, end: 10, line: 'Film over your shoulder, or just your face reading. Say: this is the only app I open now.', layers: [{ kind: 'video', path: '/app/assets/assets/onboarding/brain-wake.be22d1fe2e29e275298f016b4206060d.mp4', note: 'A short recording of the app', pos: 'middle', size: 'l', from: 0.5, to: 5 }, words('5 ideas before my stop', 'bottom')] },
      { start: 10, end: 14, line: 'Look up at the camera. Say: link is in my bio.', layers: [words('Link in bio', 'middle')] },
    ],
  }];

  const cleanLayer = (l) => {
    const kind = KIND_LABEL[l.kind] ? l.kind : 'text';
    const from = Math.max(0, Number(l.from) || 0);
    const to = l.to == null || l.to === '' || !(Number(l.to) > from) ? null : Number(l.to);
    return { kind, text: String(l.text || ''), path: kind === 'text' ? null : l.path || null, note: String(l.note || ''), pos: POS[l.pos] ? l.pos : kind === 'text' ? 'bottom' : 'middle', size: SIZE[l.size] ? l.size : 'm', from, to };
  };
  const cleanSlot = (s) => {
    let layers = Array.isArray(s.layers) ? s.layers : [];
    /* The first version kept one line of words and one picture per clip. */
    if (!Array.isArray(s.layers)) {
      if (s.text) layers.push({ kind: 'text', text: s.text, pos: s.text_pos });
      if (s.image_path) layers.push({ kind: 'image', path: s.image_path, pos: s.image_pos });
    }
    return { start: Number(s.start) || 0, end: Number(s.end) || 0, line: String(s.line || ''), layers: layers.slice(0, MAX_LAYERS).map(cleanLayer) };
  };
  const clean = (row) => ({
    brief_id: row.brief_id,
    active: !!row.active,
    music_path: row.music_path || null,
    music_volume: Number(row.music_volume ?? 0.25),
    caption: row.caption || '',
    slots: (Array.isArray(row.slots) ? row.slots : []).slice(0, MAX_SLOTS).map(cleanSlot),
  });
  const filesOf = (t) => [t.music_path, ...t.slots.flatMap((s) => s.layers.map((l) => l.path))].filter(Boolean);
  const showing = (l, t) => t >= l.from && (l.to == null || t < l.to);

  let loaded = null;
  let list = [];
  /* The templates this creator can use: switched on, and for a reference video they can see. */
  function load(briefs) {
    return (loaded ||= (async () => {
      let rows = [];
      if (cp.demo) rows = DEMO;
      else {
        try {
          const { data, error } = await cp.client.from('creator_templates').select('*').eq('active', true);
          if (!error && data) rows = data;
        } catch { /* no table yet, or offline: no templates */ }
      }
      /* The preview's sample formats carry their own reference; real ones are matched to the reference videos this creator can see. */
      const byId = new Map([...(briefs || []), ...(cp.demo ? DEMO.map((t) => t.brief) : [])].map((b) => [b.id, b]));
      list = rows.map(clean).filter((t) => byId.has(t.brief_id) && t.slots.length).map((t) => ({ ...t, brief: byId.get(t.brief_id) }));
      return list.length;
    })());
  }

  /* ----------------------------------------------------------------- drawing */

  const once = (el, ok, bad, ms) => new Promise((resolve, reject) => {
    const timer = ms ? setTimeout(() => reject(new Error('timeout')), ms) : null;
    const done = (fn, value) => { if (timer) clearTimeout(timer); fn(value); };
    el.addEventListener(ok, () => done(resolve, el), { once: true });
    (bad || []).forEach((name) => el.addEventListener(name, () => done(reject, new Error(name)), { once: true }));
  });

  function wrap(ctx, text, max) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > max) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
    }
    return lines.slice(0, 5);
  }

  /* Each edit pops in over its first fifth of a second. */
  const popIn = (ctx, t, cx, cy, draw) => {
    const k = Math.min(1, Math.max(0, t / 0.2));
    const ease = 1 - (1 - k) ** 3;
    ctx.save();
    ctx.globalAlpha = ease;
    ctx.translate(cx, cy);
    ctx.scale(0.86 + 0.14 * ease, 0.86 + 0.14 * ease);
    draw();
    ctx.restore();
  };

  function drawWords(ctx, layer, t) {
    if (!layer.text) return;
    const size = SIZE[layer.size].font;
    ctx.font = `800 ${size}px ${FONT}`;
    const lines = wrap(ctx, layer.text, W * 0.84);
    const lead = size * 1.22;
    popIn(ctx, t, W / 2, H * POS[layer.pos], () => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.round(size * 0.22);
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#fff';
      lines.forEach((line, i) => {
        const y = (i - (lines.length - 1) / 2) * lead;
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 3;
        ctx.strokeText(line, 0, y);
        ctx.shadowColor = 'transparent';
        ctx.fillText(line, 0, y);
      });
    });
  }

  const sizeOf = (el) => (el.videoWidth ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight]);
  const cover = (ctx, el, x, y, w, hh) => {
    const [ew, eh] = sizeOf(el);
    if (!ew || !eh) return;
    const k = Math.max(w / ew, hh / eh);
    ctx.drawImage(el, x + (w - ew * k) / 2, y + (hh - eh * k) / 2, ew * k, eh * k);
  };
  /* The box a picture or recording takes: its own shape, fitted inside its size. */
  const boxOf = (layer, el) => {
    const s = SIZE[layer.size];
    const [ew, eh] = el ? sizeOf(el) : [9, 16];
    const k = Math.min((W * s.w) / (ew || 9), (H * s.h) / (eh || 16));
    return [(ew || 9) * k, (eh || 16) * k];
  };

  function drawMedia(ctx, layer, el, t, ghost) {
    if (!el && !ghost) return;
    if (el && !sizeOf(el)[0]) return;
    if (layer.size === 'full' && el) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, t / 0.15);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      cover(ctx, el, 0, 0, W, H);
      ctx.restore();
      return;
    }
    const [w, hh] = layer.size === 'full' ? [W * 0.9, H * 0.9] : boxOf(layer, el);
    const cy = layer.size === 'full' ? H / 2 : H * POS[layer.pos];
    popIn(ctx, t, W / 2, cy, () => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-w / 2, -hh / 2, w, hh, 22); else ctx.rect(-w / 2, -hh / 2, w, hh);
      if (!el) {
        /* An empty placeholder, drawn only in the editor. */
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
        ctx.setLineDash([18, 12]);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `700 30px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        wrap(ctx, layer.note || `${KIND_LABEL[layer.kind]} goes here`, w - 40).slice(0, 4).forEach((line, i, all) => ctx.fillText(line, 0, (i - (all.length - 1) / 2) * 38));
        return;
      }
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.save();
      ctx.clip();
      cover(ctx, el, -w / 2, -hh / 2, w, hh);
      ctx.restore();
    });
  }

  /* One frame: the creator's clip, then every edit showing at this moment, in order. */
  function drawFrame(ctx, video, slot, media, t, ghost) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (video && sizeOf(video)[0]) cover(ctx, video, 0, 0, W, H);
    slot.layers.forEach((layer, j) => {
      if (!showing(layer, t)) return;
      /* In the editor an edit is shown settled, not part-way through popping in. */
      const lt = ghost ? 1 : t - layer.from;
      if (layer.kind === 'text') drawWords(ctx, layer, lt);
      else drawMedia(ctx, layer, media[j], lt, ghost);
    });
  }

  /* ------------------------------------------------------------- the builder */

  /*
   * Phones only let a page play sound that a tap started. start() runs inside
   * the Build tap and touches every element once, so the builder can play them
   * later by itself.
   */
  function start(template, blobs) {
    const ac = new AC();
    ac.resume().catch(() => {});
    /* Every clip and the music go into the recording, not the speakers, from the first moment. */
    const dest = ac.createMediaStreamDestination();
    const voice = ac.createGain();
    voice.connect(dest);
    const prime = (el) => { const p = el.play(); if (p) p.then(() => { if (!el.dataset.go) el.pause(); }).catch(() => {}); };
    const videos = blobs.map((blob) => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.src = URL.createObjectURL(blob);
      try { ac.createMediaElementSource(v).connect(voice); } catch { /* a clip without sound */ }
      prime(v);
      return v;
    });
    /* Screen recordings laid over a clip: silent, and looped if shorter than their time on screen. */
    const media = template.slots.map((s) => s.layers.map((l) => {
      const url = l.path && fileUrl(l.path);
      if (!url) return null;
      if (l.kind === 'image') { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; return img; }
      if (l.kind !== 'video') return null;
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.src = url;
      prime(v);
      return v;
    }));
    let music = null;
    let bed = null;
    if (template.music_path && fileUrl(template.music_path)) {
      music = new Audio();
      music.crossOrigin = 'anonymous';
      music.loop = true;
      music.preload = 'auto';
      music.src = fileUrl(template.music_path);
      try {
        bed = ac.createGain();
        bed.gain.value = template.music_volume;
        ac.createMediaElementSource(music).connect(bed);
        bed.connect(dest);
      } catch { bed = null; }
      prime(music);
    }
    return { ac, dest, videos, media, music, bed };
  }

  async function build(template, primed, onProgress) {
    const { ac, dest, videos, music } = primed;
    const slots = template.slots;
    const mime = pickMime();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const overlays = primed.media.flat().filter((m) => m && m.tagName === 'VIDEO');
    let recorder = null;
    let raf = 0;
    let failed = null;
    const onHide = () => { if (document.hidden) failed = new Error('The page went to the background, so the video stopped. Keep this page open and on screen while it builds.'); };
    document.addEventListener('visibilitychange', onHide);
    try {
      onProgress(0, 'Getting your clips ready…');
      await Promise.all(videos.map((v) => (v.readyState >= 2 ? v : once(v, 'loadeddata', ['error'], 20000))))
        .catch(() => { throw new Error('One of your clips could not be opened. Record or choose it again.'); });
      /* An edit that will not load is left out rather than stopping the build. */
      const media = await Promise.all(primed.media.map((row) => Promise.all(row.map((m) => {
        if (!m) return null;
        if (m.tagName === 'IMG') return m.complete && m.naturalWidth ? m : once(m, 'load', ['error'], 15000).catch(() => null);
        return m.readyState >= 2 ? m : once(m, 'loadeddata', ['error'], 20000).catch(() => null);
      }))));
      let bed = primed.bed;
      if (bed) {
        try { if (music.readyState < 2) await once(music, 'canplay', ['error'], 15000); } catch { bed = null; }
      }
      const plan = videos.map((v, i) => Math.min(capOf(slots[i]), Number.isFinite(v.duration) && v.duration > 0 ? v.duration : capOf(slots[i])));
      const total = plan.reduce((a, b) => a + b, 0);

      const stream = canvas.captureStream(FPS);
      dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      const chunks = [];
      recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { failed = new Error('This browser stopped recording the video.'); };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

      [...videos, ...overlays].forEach((v) => { v.dataset.go = '1'; v.pause(); v.currentTime = 0; });
      drawFrame(ctx, videos[0], slots[0], media[0], 0);
      recorder.start();
      if (bed) { music.dataset.go = '1'; music.currentTime = 0; music.play().catch(() => {}); }

      let done = 0;
      for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        const slot = slots[i];
        await v.play().catch(() => { throw new Error('Your browser would not play a clip. Tap Build again.'); });
        await new Promise((resolve, reject) => {
          const began = performance.now();
          const tick = () => {
            if (failed) return reject(failed);
            const t = v.currentTime;
            /* Start each screen recording as its moment arrives, and stop it when its moment passes. */
            slot.layers.forEach((layer, j) => {
              const m = media[i][j];
              if (!m || m.tagName !== 'VIDEO') return;
              if (showing(layer, t)) { if (m.paused) m.play().catch(() => {}); } else if (!m.paused) m.pause();
            });
            drawFrame(ctx, v, slot, media[i], t);
            onProgress(Math.min(0.99, (done + Math.min(t, plan[i])) / total), `Building clip ${i + 1} of ${videos.length}…`);
            /* Out of time, finished, or stuck for longer than the clip could run. */
            if (v.ended || t >= plan[i] - 0.02 || performance.now() - began > (plan[i] + 6) * 1000) return resolve();
            raf = requestAnimationFrame(tick);
          };
          tick();
        });
        v.pause();
        media[i].forEach((m) => { if (m && m.tagName === 'VIDEO') m.pause(); });
        done += plan[i];
      }
      if (bed) {
        bed.gain.setValueAtTime(bed.gain.value, ac.currentTime);
        bed.gain.linearRampToValueAtTime(0, ac.currentTime + 0.25);
      }
      await new Promise((r) => setTimeout(r, 280));
      recorder.stop();
      await stopped;
      if (failed) throw failed;
      const type = (recorder.mimeType || mime || 'video/mp4').split(';')[0];
      const blob = new Blob(chunks, { type });
      if (!blob.size) throw new Error('The video came out empty. Try again, or open this page in Safari or Chrome.');
      onProgress(1, 'Done');
      return { blob, type, seconds: total };
    } finally {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onHide);
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* already stopped */ } }
      if (music) music.pause();
      videos.forEach((v) => { v.pause(); URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); });
      overlays.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
      ac.close().catch(() => {});
    }
  }

  /* -------------------------------------------------------- the creator's page */

  const root = h('div', { class: 'mk' });
  const ui = { id: null, clips: {}, result: null, busy: false, data: null, extras: {} };
  const MAX_OWN = 3;
  const ownOf = (i) => (Array.isArray(ui.extras[i]) ? ui.extras[i] : []);
  /* The template with the creator's own words laid on top of the team's edits. */
  const withOwn = (t) => ({ ...t, slots: t.slots.map((s, i) => ({ ...s, layers: [...s.layers, ...ownOf(i).filter((w) => w.text && w.text.trim()).map((w) => cleanLayer({ kind: 'text', text: w.text.trim().slice(0, 120), pos: w.pos, size: 'm' }))] })) });

  const durationOf = (blob) => new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(blob);
    const end = (value) => { URL.revokeObjectURL(url); resolve(value); };
    v.preload = 'metadata';
    v.onloadedmetadata = () => end(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => end(undefined);
    setTimeout(() => end(null), 8000);
    v.src = url;
  });

  const setClip = (i, blob, duration) => {
    const old = ui.clips[i];
    if (old) URL.revokeObjectURL(old.url);
    if (blob) ui.clips[i] = { blob, url: URL.createObjectURL(blob), duration }; else delete ui.clips[i];
  };
  const clearResult = () => { if (ui.result) URL.revokeObjectURL(ui.result.url); ui.result = null; };

  async function openTemplate(id) {
    Object.keys(ui.clips).forEach((i) => setClip(i, null));
    clearResult();
    ui.id = id;
    ui.extras = readExtras(id);
    const t = list.find((x) => x.brief_id === id);
    if (t) {
      await Promise.all(t.slots.map(async (_, i) => {
        const blob = await readClip(id, i);
        if (blob) setClip(i, blob, await durationOf(blob));
      }));
    }
    draw();
  }

  async function pick(t, i, file) {
    if (!file) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name || '')) return toast('That file is not a video.', 'error');
    const duration = await durationOf(file);
    if (duration === undefined) return toast('This browser cannot open that video. Try recording it again.', 'error');
    setClip(i, file, duration);
    clearResult();
    saveClip(t.brief_id, i, file);
    draw();
  }

  /* The row of pieces: one per clip, as wide as the clip is long. */
  const piece = (slot, i, attrs, ...kids) => h('button', { class: 'mk-piece', type: 'button', style: `flex-grow:${Math.max(2, slotLen(slot) || 4)}`, ...attrs }, h('b', {}, String(i + 1)), h('span', { class: 'mk-piece__len' }, slotLen(slot) ? secs(slotLen(slot)) : ''), ...kids);

  function slotCard(t, i) {
    const slot = t.slots[i];
    const clip = ui.clips[i];
    const len = slotLen(slot);
    const ref = fileUrl(t.brief.video_path);
    const input = (capture) => {
      const el = h('input', { type: 'file', accept: 'video/*', capture: capture || null, hidden: true });
      el.addEventListener('change', () => pick(t, i, el.files && el.files[0]));
      return el;
    };
    const record = input('user');
    const choose = input(null);
    const over = clip && clip.duration && clip.duration > capOf(slot) + 0.3;
    const redo = h('button', { class: 'cp-link', type: 'button', onclick: () => { setClip(i, null); clearResult(); dropClip(t.brief_id, i); draw(); } }, 'Remove');
    const said = slot.layers.filter((l) => l.kind === 'text' && l.text).map((l) => l.text);
    const added = slot.layers.filter((l) => l.kind !== 'text' && l.path).length;
    /* The creator's own words on this clip: typed in place, so nothing is redrawn while they type. */
    const own = ownOf(i);
    const keep = () => { saveExtras(t.brief_id, ui.extras); if (ui.result && !ui.busy) { clearResult(); draw(); } };
    const ownRows = own.map((w, j) => {
      const text = h('input', { class: 'cp-input', value: w.text || '', maxlength: '120', placeholder: 'Your words on screen', 'aria-label': `Your words on clip ${i + 1}` });
      text.addEventListener('input', () => { w.text = text.value; saveExtras(t.brief_id, ui.extras); });
      text.addEventListener('change', keep);
      const pos = h('select', { class: 'cp-input', 'aria-label': 'Where your words go' }, Object.keys(POS).map((k) => h('option', { value: k, selected: k === (w.pos || 'middle') || null }, POS_LABEL[k])));
      pos.addEventListener('change', () => { w.pos = pos.value; keep(); });
      return h('div', { class: 'mk-own' }, text, pos, h('button', { class: 'cp-link', type: 'button', onclick: () => { own.splice(j, 1); ui.extras[i] = own; saveExtras(t.brief_id, ui.extras); clearResult(); draw(); } }, 'Remove'));
    });
    const addOwn = own.length < MAX_OWN && !ui.busy ? h('button', { class: 'cp-link', type: 'button', onclick: () => { ui.extras[i] = [...own, { text: '', pos: 'middle' }]; saveExtras(t.brief_id, ui.extras); draw(); root.querySelector(`#mk-clip-${i} .mk-own:last-of-type input`)?.focus(); } }, own.length ? '+ More words' : '+ Add your own words') : null;
    return h(
      'li',
      { class: 'mk-slot', id: `mk-clip-${i}`, 'data-done': clip ? true : null },
      h('div', { class: 'mk-slot__head' }, h('span', { class: 'mk-slot__n', 'aria-hidden': 'true' }, clip ? '✓' : String(i + 1)), h('b', {}, `Clip ${i + 1}`), len ? h('span', { class: 'cp-muted cp-small' }, `about ${secs(len)}`) : null),
      h('div', { class: 'mk-slot__body' },
        h('div', { class: 'mk-slot__say' },
          slot.line ? [h('span', { class: 'mk-label' }, 'Say'), h('p', { class: 'mk-line' }, slot.line)] : null,
          said.length ? h('p', { class: 'cp-muted cp-small' }, 'On screen: ', h('b', {}, said.join(' · '))) : null,
          added ? h('p', { class: 'cp-muted cp-small' }, added === 1 ? 'A picture or screen recording is added over this clip for you.' : `${added} pictures or screen recordings are added over this clip for you.`) : null,
          h('div', { class: 'cp-inline' },
            record, choose,
            h('button', { class: `btn btn--sm ${clip ? 'btn--ghost' : 'btn--primary'}`, type: 'button', disabled: ui.busy || null, onclick: () => record.click() }, clip ? 'Record again' : 'Record'),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: ui.busy || null, onclick: () => choose.click() }, 'Choose a video'),
            clip && !ui.busy ? redo : null,
          ),
          over ? h('p', { class: 'cp-small mk-warn' }, `Yours is ${secs(clip.duration)}. This clip is cut at ${secs(capOf(slot))}, so say the line and stop.`) : null,
          ownRows, addOwn,
        ),
        h('div', { class: 'mk-slot__media' },
          ref && len ? h('figure', {}, h('video', { src: `${ref}#t=${slot.start},${slot.end}`, controls: true, preload: 'metadata', playsinline: true, 'aria-label': `The reference, clip ${i + 1}` }), h('figcaption', { class: 'cp-small cp-muted' }, 'Reference')) : null,
          clip ? h('figure', {}, h('video', { src: clip.url, controls: true, preload: 'metadata', playsinline: true, 'aria-label': `Your clip ${i + 1}` }), h('figcaption', { class: 'cp-small cp-muted' }, 'Yours')) : null,
        ),
      ),
    );
  }

  function resultCard(t) {
    const r = ui.result;
    const ext = r.type === 'video/mp4' ? 'mp4' : 'webm';
    const name = `mindroll-${String(t.brief.title || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'video'}.${ext}`;
    const file = (() => { try { return new File([r.blob], name, { type: r.type }); } catch { return null; } })();
    const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    const share = h('button', { class: 'btn btn--primary', type: 'button', onclick: async () => { try { await navigator.share({ files: [file] }); } catch { /* they closed the sheet */ } } }, 'Share to TikTok or Instagram');
    const save = h('a', { class: `btn ${canShare ? 'btn--ghost' : 'btn--primary'}`, href: r.url, download: name }, 'Save the video');
    const tag = `#${String(ui.data?.settings?.hashtag || 'mindroll').replace(/^./, (c) => c.toUpperCase())}`;
    const caption = (t.caption || '').trim() || tag;
    const copy = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(caption); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1600); } catch { toast('Copy it by hand: select the text.', 'error'); }
    });
    return h(
      'section',
      { class: 'cp-card mk-result' },
      h('div', { class: 'cp-card__head' }, h('h2', {}, 'Your video is ready'), h('span', { class: 'cp-muted' }, secs(r.seconds))),
      h('div', { class: 'mk-result__in' },
        h('video', { src: r.url, controls: true, playsinline: true, 'aria-label': 'Your finished video' }),
        h('div', { class: 'mk-result__side' },
          r.type === 'video/mp4' ? null : h('p', { class: 'cp-small mk-warn' }, 'This browser saved it as a WebM file, which TikTok and Instagram may refuse. Open this page in Safari, or an up-to-date Chrome, and build it again to get an MP4.'),
          h('div', { class: 'cp-inline' }, canShare ? share : null, save),
          h('span', { class: 'mk-label' }, 'Caption'),
          h('div', { class: 'cp-copyrow' }, h('span', { class: 'mk-caption' }, caption), copy),
          h('p', { class: 'cp-muted cp-small' }, `Post it from the account you linked and keep ${tag} in the caption, so it shows up under Videos and counts for you.`),
          h('button', { class: 'cp-link', type: 'button', onclick: () => { clearResult(); draw(); } }, 'Change a clip and build again'),
        ),
      ),
    );
  }

  function draw() {
    const kids = [];
    const t = list.find((x) => x.brief_id === ui.id);
    if (!t) {
      kids.push(cp.section(
        'Winning formats',
        h('span', { class: 'cp-muted' }, `${list.length} picked by the Mindroll team`),
        h('p', { class: 'cp-muted' }, 'These are formats that are working right now. Choose the one you want to copy, film each short clip, and the captions and music are added for you. You get one finished video to post.'),
        h('ul', { class: 'mk-pick' }, list.map((x) => {
          const ref = fileUrl(x.brief.video_path);
          const total = x.slots.reduce((a, s) => a + slotLen(s), 0);
          return h('li', {},
            ref ? h('video', { src: ref, controls: true, preload: 'metadata', playsinline: true, 'aria-label': x.brief.title }) : null,
            h('div', {},
              h('span', { class: 'mk-label' }, 'Winning format'),
              h('b', {}, x.brief.title),
              x.brief.note ? h('p', { class: 'cp-muted cp-small' }, x.brief.note) : null,
              h('p', { class: 'cp-muted cp-small' }, `${x.slots.length} clips${total ? ` · about ${secs(total)}` : ''}`),
              h('div', { class: 'cp-inline' },
                h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => openTemplate(x.brief_id) }, 'Copy this one'),
                cp.safeUrl(x.brief.url) ? h('a', { class: 'btn btn--ghost btn--sm', href: cp.safeUrl(x.brief.url), target: '_blank', rel: 'noopener noreferrer' }, 'Watch the reference') : null,
              ),
            ),
          );
        })),
      ));
    } else {
      const filled = t.slots.filter((_, i) => ui.clips[i]).length;
      const ready = filled === t.slots.length;
      const bar = h('div', { class: 'mk-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, h('i', {}));
      const status = h('p', { class: 'cp-small cp-muted', 'aria-live': 'polite' }, ready ? 'All clips are in.' : `${filled} of ${t.slots.length} clips in. Your clips are saved on this device as you go.`);
      const go = h('button', { class: 'btn btn--primary', type: 'button', disabled: !ready || ui.busy || !canBuild || null }, ui.result ? 'Build it again' : 'Build my video');
      go.addEventListener('click', async () => {
        if (ui.busy) return;
        /* Everything up to the first await runs inside the tap, which is what lets a phone play the clips. */
        const mine = withOwn(t);
        const primed = start(mine, t.slots.map((_, i) => ui.clips[i].blob));
        ui.busy = true;
        clearResult();
        go.disabled = true;
        root.querySelectorAll('.mk-slot button').forEach((b) => { b.disabled = true; });
        bar.hidden = false;
        try {
          const out = await build(mine, primed, (p, label) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round(p * 100))); status.textContent = `${label} Keep this page open.`; });
          ui.result = { ...out, url: URL.createObjectURL(out.blob) };
        } catch (error) {
          toast(error.message || 'The video could not be built. Try again.', 'error');
        }
        ui.busy = false;
        draw();
        if (ui.result) root.querySelector('.mk-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      kids.push(
        h('button', { class: 'cp-link mk-back', type: 'button', disabled: ui.busy || null, onclick: () => { ui.id = null; clearResult(); draw(); } }, '← All winning formats'),
        ui.result ? resultCard(t) : null,
        cp.section(
          t.brief.title,
          cp.safeUrl(t.brief.url) ? h('a', { href: cp.safeUrl(t.brief.url), target: '_blank', rel: 'noopener noreferrer' }, 'Watch the reference') : h('span', { class: 'cp-muted' }, `${t.slots.length} clips`),
          h('p', { class: 'cp-muted' }, 'Film each clip the way the reference does it, saying the line shown. Hold your phone upright. The words on screen, pictures and music are added when you build it, and you can add words of your own to any clip.'),
          h('div', { class: 'mk-tl', role: 'list', 'aria-label': 'The clips in this video' }, t.slots.map((s, i) => piece(s, i, { role: 'listitem', 'data-done': ui.clips[i] ? true : null, 'aria-label': `Clip ${i + 1}${ui.clips[i] ? ', filmed' : ', not filmed yet'}`, onclick: () => root.querySelector(`#mk-clip-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, h('span', { class: 'mk-piece__text' }, ui.clips[i] ? 'Filmed' : 'To film'), h('span', { class: 'mk-piece__chips' }, [...s.layers.filter((l) => l.kind === 'text' || l.path), ...ownOf(i).map(() => ({ kind: 'text' }))].map((l) => h('i', { 'data-kind': l.kind })))))),
          h('ol', { class: 'mk-slots' }, t.slots.map((_, i) => slotCard(t, i))),
          canBuild ? null : h('p', { class: 'mk-warn' }, 'This browser cannot build the video. Open this page in Safari or Chrome (not inside TikTok, Instagram or Discord) and your clips can be added there.'),
          h('div', { class: 'mk-build' }, go, bar, status),
        ),
      );
    }
    root.replaceChildren(...kids.flat().filter(Boolean));
  }

  /** The "Make a video" pane. The same element every time, so a build survives the dashboard redrawing. */
  function view(data) {
    ui.data = data;
    if (ui.id && !ui.busy && !list.some((x) => x.brief_id === ui.id)) { ui.id = null; draw(); }
    if (!root.firstChild) draw();
    return root;
  }

  /* ------------------------------------------------------------ admin editor */

  const editors = new Map();
  let adminRows = null;

  /* Still frames from the reference, for the AI to read: about two a second, small. */
  async function framesOf(url, onProgress) {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    await once(v, 'loadeddata', ['error'], 30000).catch(() => { throw new Error('The reference video could not be opened to analyze.'); });
    const duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The reference video has no readable length.');
    if (duration > 120) throw new Error('Analyze works on reference videos up to two minutes long.');
    const count = Math.min(48, Math.max(4, Math.ceil(duration * 2)));
    const canvas = document.createElement('canvas');
    canvas.width = 288;
    canvas.height = Math.round((288 * (v.videoHeight || 16)) / (v.videoWidth || 9));
    const ctx = canvas.getContext('2d');
    const frames = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(duration - 0.05, (i + 0.5) * (duration / count));
      v.currentTime = t;
      await once(v, 'seeked', ['error'], 10000).catch(() => { throw new Error('The reference video could not be read through.'); });
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      frames.push({ t: Math.round(t * 10) / 10, data: canvas.toDataURL('image/jpeg', 0.6).split(',')[1] });
      onProgress(i + 1, count);
    }
    v.removeAttribute('src');
    v.load();
    return { duration: Math.round(duration * 10) / 10, frames };
  }

  /*
   * Who drafts a template. A helper running on the team's own Mac hands the
   * frames to the Claude Code signed in there; when it is not running, the
   * server function does it with an API key instead.
   */
  const HELPER = 'http://127.0.0.1:8796';
  const helperUp = async () => {
    try {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), 1500);
      const res = await fetch(`${HELPER}/health`, { signal: stop.signal });
      clearTimeout(timer);
      return res.ok;
    } catch { return false; }
  };
  async function draftWithAI(payload, say) {
    if (await helperUp()) {
      say('Claude on this Mac is working out the clips… a few minutes');
      const res = await fetch(`${HELPER}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => { throw new Error('The helper on the Mac stopped answering. Check it is still running.'); });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'The helper on the Mac could not draft it.');
      return out;
    }
    /* The Mac is off, asleep, or this is another computer: tell the team on Discord, then try the server. */
    const told = cp.demo ? false : await cp.rpc('creator_admin_draft_ping', { p_title: payload.title || null }).then(() => true, () => false);
    say('Working out the clips… about a minute');
    try { return await cp.fn('creator-analyze', payload); } catch (error) {
      if (/AI key has not been added|preview/.test(error.message)) throw new Error(`The Mac that drafts templates is not reachable from here.${told ? ' The team has been pinged on Discord to draft this one.' : ''} You can still set the clips up by hand.`);
      throw error;
    }
  }

  function editor(brief, db) {
    const el = h('details', { class: 'cp-fold mk-edit' }, h('summary', {}, brief.title, ' ', h('span', { class: 'mk-edit__state cp-small cp-muted' })));
    const stateEl = el.querySelector('.mk-edit__state');
    const body = h('div', { class: 'mk-edit__body' });
    el.append(body);
    let t = null;
    let saved = null;
    let sel = 0;
    let selLayer = -1;
    let at = 0;
    const mark = () => { stateEl.textContent = !saved ? 'No template yet' : saved.active ? `${saved.slots.length} clips · showing to creators` : `${saved.slots.length} clips · hidden`; };

    const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
    const upload = async (file, kinds, maxMb) => {
      if (!kinds.test(file.type)) throw new Error('That file type is not supported here.');
      if (file.size > maxMb * 1048576) throw new Error(`That file is ${Math.round(file.size / 1048576)} MB. The limit is ${maxMb} MB.`);
      if (cp.demo) throw new Error('This is a preview, so nothing was uploaded.');
      const path = `${crypto.randomUUID()}.${EXT[file.type] || 'bin'}`;
      const { error } = await db.storage.from('creator-briefs').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
      if (error) throw new Error(`The upload did not go through: ${error.message}`);
      return path;
    };

    /* The preview: the reference frame for this moment, with the clip's edits drawn the way the builder draws them. */
    const ref = fileUrl(brief.video_path);
    const canvas = h('canvas', { class: 'mk-edit__canvas', width: String(W / 2), height: String(H / 2), 'aria-label': 'Preview of this clip' });
    const pctx = canvas.getContext('2d');
    const refVideo = ref ? Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto', src: ref }) : null;
    const cache = new Map();
    const mediaFor = (layer) => {
      if (layer.kind === 'text' || !layer.path) return null;
      if (!cache.has(layer.path)) {
        const m = layer.kind === 'image' ? new Image() : Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' });
        m.addEventListener(layer.kind === 'image' ? 'load' : 'loadeddata', () => preview());
        if (layer.kind === 'video') m.addEventListener('seeked', () => preview());
        m.src = fileUrl(layer.path);
        cache.set(layer.path, m);
      }
      return cache.get(layer.path);
    };
    function preview() {
      if (!t || !t.slots[sel]) return;
      const slot = t.slots[sel];
      pctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
      const media = slot.layers.map(mediaFor);
      if (refVideo && refVideo.videoWidth) drawFrame(pctx, refVideo, slot, media, at, true);
      else {
        /* No reference file to show: a plain backdrop standing in for the creator. */
        const off = { layers: [] };
        drawFrame(pctx, null, off, [], at, true);
        const g = pctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#454b5a');
        g.addColorStop(1, '#1d2028');
        pctx.fillStyle = g;
        pctx.fillRect(0, 0, W, H);
        slot.layers.forEach((layer, j) => {
          if (!showing(layer, at)) return;
          if (layer.kind === 'text') drawWords(pctx, layer, 1); else drawMedia(pctx, layer, media[j], 1, true);
        });
      }
    }
    if (refVideo) { refVideo.addEventListener('seeked', preview); refVideo.addEventListener('loadeddata', () => seek()); }
    function seek() {
      if (!t || !t.slots[sel]) return;
      const slot = t.slots[sel];
      if (refVideo && refVideo.readyState >= 1) { try { refVideo.currentTime = slot.start + at; } catch { /* not loaded yet */ } }
      slot.layers.forEach((l) => { const m = mediaFor(l); if (m && m.tagName === 'VIDEO' && m.duration) { try { m.currentTime = Math.max(0, at - l.from) % m.duration; } catch { /* not loaded yet */ } } });
      preview();
    }

    /*
     * A box that has just been typed in reports its change as the next thing is
     * pressed. Redrawing right then would remove the button under the pointer
     * and lose the click, so a redraw asked for mid-press waits for the release.
     */
    let pressed = false;
    let waiting = false;
    body.addEventListener('pointerdown', () => { pressed = true; }, true);
    window.addEventListener('pointerup', () => { pressed = false; if (waiting) { waiting = false; setTimeout(() => { if (t) paint(); }, 0); } }, true);
    window.addEventListener('pointercancel', () => { pressed = false; }, true);
    const repaint = () => { if (pressed) waiting = true; else paint(); };

    const newLayer = (kind) => cleanLayer({ kind, pos: kind === 'text' ? 'bottom' : 'middle', size: 'm', from: Math.round(at * 10) / 10 });

    function paint() {
      if (sel >= t.slots.length) sel = Math.max(0, t.slots.length - 1);
      const slot = t.slots[sel];
      const len = slot ? slotLen(slot) || 5 : 5;
      if (slot && selLayer >= slot.layers.length) selLayer = -1;
      at = Math.min(at, len);
      const num = (value, set, label, opts) => { const i = h('input', { class: 'cp-input cp-input--num', type: 'number', min: '0', max: '600', step: '0.5', value: value == null ? '' : String(value), placeholder: opts?.placeholder || null, 'aria-label': label }); i.addEventListener('change', () => { set(i.value === '' ? null : Number(i.value) || 0); repaint(); }); return i; };
      const choice = (value, labels, set, label) => { const s = h('select', { class: 'cp-input', 'aria-label': label }, Object.keys(labels).map((k) => h('option', { value: k, selected: k === value || null }, labels[k]))); s.addEventListener('change', () => { set(s.value); preview(); }); return s; };

      /* The row of pieces. */
      const pieces = t.slots.map((s, i) => piece(s, i, { 'aria-current': i === sel ? 'true' : null, 'aria-label': `Clip ${i + 1}`, onclick: () => { sel = i; selLayer = -1; at = 0; paint(); } },
        h('span', { class: 'mk-piece__text' }, s.line || 'No line yet'),
        h('span', { class: 'mk-piece__chips' }, s.layers.map((l) => h('i', { 'data-kind': l.kind, 'data-empty': l.kind !== 'text' && !l.path ? true : null, title: KIND_LABEL[l.kind] })))));
      const addClip = h('button', { class: 'mk-piece mk-piece--add', type: 'button', disabled: t.slots.length >= MAX_SLOTS || null, 'aria-label': 'Add a clip', onclick: () => { const last = t.slots[t.slots.length - 1]; const from = last ? last.end : 0; t.slots.push(cleanSlot({ start: from, end: from + 5, layers: [] })); sel = t.slots.length - 1; selLayer = -1; at = 0; paint(); } }, h('b', {}, '+'), h('span', { class: 'mk-piece__text' }, 'Add a clip'));

      let panel = null;
      if (slot) {
        const move = (by) => { const j = sel + by; if (j < 0 || j >= t.slots.length) return; [t.slots[sel], t.slots[j]] = [t.slots[j], t.slots[sel]]; sel = j; paint(); };
        const line = h('textarea', { class: 'cp-input', rows: '2', maxlength: '400', placeholder: 'What the creator says in this clip', 'aria-label': 'What to say' }, slot.line);
        line.addEventListener('input', () => { slot.line = line.value; const label = body.querySelector('.mk-piece[aria-current] .mk-piece__text'); if (label) label.textContent = slot.line || 'No line yet'; });
        const scrub = h('input', { class: 'mk-edit__scrub', type: 'range', min: '0', max: String(len), step: '0.1', value: String(at), 'aria-label': 'Move through this clip' });
        const clock = h('span', { class: 'cp-small cp-muted' }, `${secs(at)} of ${secs(len)}`);
        const head = h('i', { class: 'mk-edit__head', style: `left:${(at / len) * 100}%` });
        scrub.addEventListener('input', () => { at = Number(scrub.value); clock.textContent = `${secs(at)} of ${secs(len)}`; head.style.left = `${(at / len) * 100}%`; seek(); });

        /* Each edit is a bar on the clip's own line: where it starts, how long it stays. */
        const bars = slot.layers.map((l, j) => {
          const from = Math.min(l.from, len);
          const to = Math.max(from, Math.min(l.to ?? len, len));
          return h('button', { class: 'mk-edit__bar', type: 'button', 'data-kind': l.kind, 'data-empty': l.kind !== 'text' && !l.path ? true : null, 'aria-current': j === selLayer ? 'true' : null, style: `margin-left:${(from / len) * 100}%;width:${Math.max(8, ((to - from) / len) * 100)}%`, onclick: () => { selLayer = j; at = Math.min(len, l.from + 0.3); paint(); } },
            l.kind === 'text' ? l.text || 'Words' : l.path ? KIND_LABEL[l.kind] : `${KIND_LABEL[l.kind]}: to add`);
        });
        const add = (kind) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: slot.layers.length >= MAX_LAYERS || null, onclick: () => { slot.layers.push(newLayer(kind)); selLayer = slot.layers.length - 1; paint(); } }, `+ ${KIND_LABEL[kind]}`);

        let form = null;
        const layer = slot.layers[selLayer];
        if (layer) {
          const media = layer.kind !== 'text';
          const file = h('input', { type: 'file', accept: layer.kind === 'image' ? 'image/png,image/jpeg,image/webp' : 'video/mp4,video/quicktime,video/webm', hidden: true });
          const pickFile = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => file.click() }, layer.path ? 'Replace the file' : layer.kind === 'image' ? 'Upload the picture' : 'Upload the recording');
          file.addEventListener('change', cp.act(pickFile, async () => { const f = file.files && file.files[0]; if (!f) return; layer.path = layer.kind === 'image' ? await upload(f, /^image\/(png|jpeg|webp)$/, 5) : await upload(f, /^video\/(mp4|quicktime|webm)$/, 30); paint(); }));
          const text = h('input', { class: 'cp-input', value: layer.kind === 'text' ? layer.text : layer.note, maxlength: layer.kind === 'text' ? '120' : '200', placeholder: layer.kind === 'text' ? 'Words on screen' : 'What it should show (a note for you)', 'aria-label': layer.kind === 'text' ? 'Words on screen' : 'Note' });
          text.addEventListener('input', () => { if (layer.kind === 'text') { layer.text = text.value; const bar = body.querySelector('.mk-edit__bar[aria-current]'); if (bar) bar.textContent = layer.text || 'Words'; } else layer.note = text.value; preview(); });
          form = h('div', { class: 'mk-edit__layer' },
            h('div', { class: 'cp-inline' }, h('b', {}, KIND_LABEL[layer.kind]), h('button', { class: 'cp-link', type: 'button', onclick: () => { slot.layers.splice(selLayer, 1); selLayer = -1; paint(); } }, 'Remove')),
            text,
            media ? h('div', { class: 'cp-inline' }, file, pickFile, layer.path ? h('span', { class: 'cp-small cp-muted' }, 'File added') : h('span', { class: 'cp-small mk-warn' }, 'Empty: left out of the video until a file is added')) : null,
            h('div', { class: 'cp-inline' },
              layer.size === 'full' && media ? null : choice(layer.pos, POS_LABEL, (v) => (layer.pos = v), 'Where it goes'),
              choice(layer.size === 'full' && !media ? 'l' : layer.size, media ? SIZE_LABEL : { s: 'Small', m: 'Medium', l: 'Large' }, (v) => { layer.size = v; paint(); }, 'How big'),
              h('label', { class: 'cp-inline cp-small' }, 'shows from', num(layer.from, (v) => (layer.from = v || 0), 'Shows from, seconds into the clip')),
              h('label', { class: 'cp-inline cp-small' }, 'to', num(layer.to, (v) => (layer.to = v), 'Until, seconds into the clip', { placeholder: 'end' })),
              h('span', { class: 'cp-small cp-muted' }, 'seconds into the clip'),
            ),
          );
        }

        panel = h('div', { class: 'mk-edit__panel' },
          h('div', { class: 'mk-edit__stage' }, canvas, scrub, clock),
          h('div', { class: 'mk-edit__clip' },
            h('div', { class: 'cp-inline' }, h('b', {}, `Clip ${sel + 1}`),
              h('label', { class: 'cp-inline cp-small' }, 'from', num(slot.start, (v) => (slot.start = v || 0), 'Starts at, seconds')),
              h('label', { class: 'cp-inline cp-small' }, 'to', num(slot.end, (v) => (slot.end = v || 0), 'Ends at, seconds')),
              h('span', { class: 'cp-small cp-muted' }, 'seconds of the reference'),
              h('button', { class: 'cp-link', type: 'button', disabled: sel === 0 || null, onclick: () => move(-1) }, '← Move'),
              h('button', { class: 'cp-link', type: 'button', disabled: sel === t.slots.length - 1 || null, onclick: () => move(1) }, 'Move →'),
              h('button', { class: 'cp-link', type: 'button', onclick: () => { t.slots.splice(sel, 1); selLayer = -1; paint(); } }, 'Remove clip')),
            line,
            h('span', { class: 'mk-label' }, 'Edits on this clip'),
            h('div', { class: 'mk-edit__track', 'data-empty': slot.layers.length ? null : true }, slot.layers.length ? bars : h('span', { class: 'cp-small cp-muted' }, 'Nothing added yet. Add words, a picture or a screen recording below.'), head),
            h('div', { class: 'cp-inline' }, add('text'), add('image'), add('video')),
            form,
          ),
        );
      }

      /* Analyze: read the reference and draft the clips and edits. */
      const analyze = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' });
      const hasWork = t.slots.some((s) => s.line || s.layers.length);
      let armed = false;
      const READ = ref ? 'Draft it from the reference with AI' : 'Draft it with AI from a video file';
      analyze.textContent = READ;
      const run = async (url) => {
        let out;
        try {
          const shots = await framesOf(url, (n, of) => { analyze.textContent = `Reading the video… ${n} of ${of}`; });
          out = await draftWithAI({ title: brief.title, ...shots }, (label) => { analyze.textContent = label; });
        } finally { analyze.textContent = READ; }
        if (!out.slots || !out.slots.length) throw new Error('The analysis came back empty. Try again.');
        t.slots = out.slots.slice(0, MAX_SLOTS).map(cleanSlot);
        sel = 0; selLayer = -1; at = 0;
        paint();
        toast(`Draft ready: ${t.slots.length} clips. Check each one, fill the empty spots, then save.`);
      };
      /* A file picked here is read on this computer only: its frames go to the AI, the file is not stored. */
      const local = h('input', { type: 'file', accept: 'video/*', hidden: true });
      local.addEventListener('change', cp.act(analyze, async () => {
        const f = local.files && local.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        try { await run(url); } finally { URL.revokeObjectURL(url); }
      }));
      analyze.addEventListener('click', (event) => {
        if (hasWork && !armed) { armed = true; analyze.textContent = 'This replaces the clips below. Press again to go ahead'; return; }
        if (ref) return cp.act(analyze, () => run(ref))(event);
        local.click();
      });

      const music = h('input', { type: 'file', accept: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,.mp3,.m4a,.wav', hidden: true });
      const addMusic = h('button', { class: 'cp-link', type: 'button', onclick: () => music.click() }, t.music_path ? 'Replace the music' : '+ Add music');
      music.addEventListener('change', cp.act(addMusic, async () => { const f = music.files && music.files[0]; if (!f) return; t.music_path = await upload(f, /^audio\//, 15); paint(); }));
      const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(t.music_volume), 'aria-label': 'Music volume' });
      vol.addEventListener('input', () => (t.music_volume = Number(vol.value)));
      const caption = h('textarea', { class: 'cp-input', rows: '2', maxlength: '600', placeholder: 'Caption for creators to copy (optional)', 'aria-label': 'Caption' }, t.caption);
      caption.addEventListener('input', () => { t.caption = caption.value; });
      const on = h('input', { type: 'checkbox', checked: t.active || null });
      on.addEventListener('change', () => (t.active = on.checked));
      const save = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Save template');
      save.addEventListener('click', cp.act(save, async () => {
        if (!t.slots.length) throw new Error('Add at least one clip.');
        t.slots.forEach((s, i) => {
          if (!s.line.trim() && !s.layers.some((l) => l.text.trim() || l.path)) throw new Error(`Clip ${i + 1} needs a line to say or something on screen.`);
          if (!(s.end > s.start)) throw new Error(`Clip ${i + 1} must end after it starts.`);
        });
        if (cp.demo) throw new Error('This is a preview, so nothing was saved.');
        const row = { brief_id: brief.id, slots: t.slots.map((s) => ({ ...s, line: s.line.trim(), layers: s.layers.map((l) => ({ ...l, text: l.text.trim(), note: l.note.trim() })) })), music_path: t.music_path, music_volume: t.music_volume, caption: t.caption.trim() || null, active: t.active, updated_at: new Date().toISOString() };
        const { error } = await db.from('creator_templates').upsert(row);
        if (error) throw new Error(/creator_templates/.test(error.message) && /find|exist|schema/.test(error.message) ? 'The templates table has not been added to the database yet.' : error.message);
        /* Files the saved template no longer points at. */
        const next = clean(row);
        const kept = new Set(filesOf(next));
        const gone = saved ? filesOf(saved).filter((p) => !kept.has(p)) : [];
        if (gone.length) db.storage.from('creator-briefs').remove(gone).catch(() => {});
        saved = next;
        mark();
        const empty = next.slots.reduce((n, s) => n + s.layers.filter((l) => l.kind !== 'text' && !l.path).length, 0);
        toast(`${row.active ? 'Saved. Creators can make this video now.' : 'Saved. It is hidden until you tick "Show to creators".'}${empty ? ` ${empty} empty ${empty === 1 ? 'spot is' : 'spots are'} left out of the video until you add a file.` : ''}`);
      }));

      body.replaceChildren(
        h('p', { class: 'cp-small cp-muted' }, 'Each piece is one clip the creator films. Pick a piece to set its line and add edits: words, pictures or screen recordings that appear over the clip at the moments you choose.'),
        h('div', { class: 'cp-inline' }, local, analyze, h('span', { class: 'cp-small cp-muted' }, ref ? 'Reads the frames and drafts the clips, on-screen words and where each picture or recording sits.' : 'Pick the reference as a video file from your computer. Its frames are read to draft the clips; the file itself is not uploaded or kept.')),
        ref ? null : h('p', { class: 'cp-small cp-muted' }, 'This reference is a link only, so the preview shows a plain backdrop and creators get a button to watch it.'),
        h('div', { class: 'mk-tl mk-tl--edit', role: 'list', 'aria-label': 'The clips, in order' }, pieces, addClip),
        panel,
        h('div', { class: 'cp-inline' }, music, h('b', { class: 'cp-small' }, 'Music'), t.music_path ? h('audio', { src: fileUrl(t.music_path), controls: true, preload: 'none' }) : h('span', { class: 'cp-small cp-muted' }, 'None'), addMusic,
          t.music_path ? [h('label', { class: 'cp-inline cp-small' }, 'Volume', vol), h('button', { class: 'cp-link', type: 'button', onclick: () => { t.music_path = null; paint(); } }, 'Remove')] : null),
        h('p', { class: 'cp-hint' }, 'Only upload music, pictures and recordings you have the right to use in ads. Music plays quietly under the creator\'s voice.'),
        caption,
        h('div', { class: 'cp-inline' }, h('label', { class: 'cp-inline' }, on, 'Show to creators'), save),
      );
      seek();
    }

    el.addEventListener('toggle', () => {
      if (!el.open || t) return;
      t = saved ? clean(saved) : clean({ brief_id: brief.id, slots: [{ start: 0, end: 5, layers: [] }] });
      paint();
    });
    return { el, set: (row) => { saved = row ? clean(row) : null; mark(); } };
  }

  /** Admin > Campaigns: one fold per reference video, to set up or edit its template. */
  function adminSection(briefs, db) {
    if (!(briefs || []).length) return null;
    const folds = briefs.map((b) => {
      if (!editors.has(b.id)) editors.set(b.id, editor(b, db));
      return editors.get(b.id);
    });
    if (!adminRows) {
      adminRows = cp.demo ? Promise.resolve(DEMO) : Promise.resolve(db.from('creator_templates').select('*')).then(({ data }) => data || [], () => []);
    }
    adminRows.then((rows) => folds.forEach((f, i) => { if (!f.seen) { f.seen = true; f.set(rows.find((r) => r.brief_id === briefs[i].id)); } }));
    return cp.section(
      'Video templates',
      h('span', { class: 'cp-muted' }, 'Creators film the clips; the edit is done for them'),
      h('p', { class: 'cp-muted cp-small' }, 'Turn a reference video into a fill-in template. Each one you switch on appears to creators as a winning format they can choose to copy, in "Make a video" under UGC Brief.'),
      folds.map((f) => f.el),
    );
  }

  cp.maker = { load, view, adminSection, canBuild, get count() { return list.length; }, _build: build, _start: start, _clean: clean, _frames: framesOf };
})();
