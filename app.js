(() => {
  "use strict";

  const PER_TEST = 10;
  const AUTO_NEXT_MS = 1300;
  const LETTERS = ["A", "B", "C", "D"];

  const TOPICS = [
    { id: "web",    name: "Veb asoslari", short: "WEB",  color: "#38bdf8", desc: "HTTP, URL, server, DNS" },
    { id: "html",   name: "HTML5",        short: "HTML", color: "#fb7185", desc: "Teglar, formalar, semantika" },
    { id: "css",    name: "CSS3",         short: "CSS",  color: "#a78bfa", desc: "Selektorlar, Flex, Grid" },
    { id: "js",     name: "JavaScript",   short: "JS",   color: "#facc15", desc: "DOM, BOM, async, massivlar" },
    { id: "jquery", name: "jQuery",       short: "$()",  color: "#34d399", desc: "Selektorlar, hodisalar, Ajax" },
  ];
  const topicById = Object.fromEntries(TOPICS.map(t => [t.id, t]));
  const DATA = window.QUIZ_DATA || {};

  // ---------- storage (safe) ----------
  const STORE_KEY = "webquiz:v1";
  const store = (() => {
    let s = { best: {}, mistakes: [], answered: 0, correct: 0 };
    try { Object.assign(s, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch (e) {}
    return {
      get: () => s,
      save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} },
      reset() { s = { best: {}, mistakes: [], answered: 0, correct: 0 }; this.save(); },
    };
  })();

  // ---------- helpers ----------
  const $app = document.getElementById("app");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const qKey = q => q.topic + ":" + q.n;

  // highlight code-ish tokens inside question text
  function fmtQuestion(text) {
    const toks = text.split(/\s+/).filter(Boolean).map(part => {
      const m = part.match(/^(.*?)([?,]*)$/);
      return { core: m[1], tail: m[2], code: false };
    });
    const isCode = c => /[()<>{}\[\]$="#;]/.test(c) || /^[.:]{1,2}[a-z]/i.test(c) || /^[a-z]+\.[a-z]/i.test(c) || /^\\[a-z]$/i.test(c) || /^[*~>^|+%!&]{1,3}=?$/.test(c);
    let depth = 0;
    toks.forEach((t, i) => {
      const opens = (t.core.match(/[{(\[]/g) || []).length, closes = (t.core.match(/[})\]]/g) || []).length;
      t.code = isCode(t.core) || depth > 0;
      depth = Math.max(0, depth + opens - closes);
      // selector right before "{" belongs to the rule
      if (/^\{/.test(t.core) && i > 0 && /^[\w.#:\-*>~+\[\]="]+$/.test(toks[i - 1].core)) toks[i - 1].code = true;
    });
    let out = "", run = [];
    const flush = () => { if (run.length) { out += `<code>${esc(run.map(t => t.core).join(" "))}</code>`; const tl = run[run.length - 1].tail; out += esc(tl) + " "; run = []; } };
    toks.forEach(t => {
      if (t.code && !t.tail) run.push(t);
      else if (t.code) { run.push(t); flush(); }
      else { flush(); out += esc(t.core + t.tail) + " "; }
    });
    flush();
    return out.trim();
  }
  // whole option rendered as code if it looks like code
  function fmtOption(text) {
    const words = (text.match(/[A-Za-zʻ‘’'ʼЀ-ӿ]{4,}/g) || []).filter(w => !/^(function|document|window|alert|console|class|style|color|display|input|href|true|false|null|const|grid|flex)$/i.test(w));
    const special = /[()<>{}\[\]$=;#]|^[.#:@]|^[a-z-]+:\s/.test(text) || !/\s/.test(text);
    if (special && words.length < 4) return `<span class="code" style="background:none;padding:0">${esc(text)}</span>`;
    return esc(text);
  }

  function testsForTopic(id) {
    const qs = (DATA[id] || []).map(q => ({ ...q, topic: id }));
    const tests = [];
    for (let i = 0; i < qs.length; i += PER_TEST) {
      let chunk = qs.slice(i, i + PER_TEST);
      if (chunk.length < PER_TEST && qs.length >= PER_TEST) {
        const used = new Set(chunk.map(q => q.n));
        for (const q of qs) { if (chunk.length >= PER_TEST) break; if (!used.has(q.n)) chunk.push(q); }
      }
      tests.push(chunk);
    }
    return tests;
  }
  const allQuestions = () => TOPICS.flatMap(t => (DATA[t.id] || []).map(q => ({ ...q, topic: t.id })));

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function badge(best) {
    if (best == null) return `<span class="badge">Boshlanmagan</span>`;
    const cls = best >= 8 ? "good" : best >= 5 ? "mid" : "low";
    return `<span class="badge ${cls}">★ ${best}/${PER_TEST}</span>`;
  }

  // ---------- views ----------
  let timer = null;
  let keyHandler = null;
  function setView(html, onKey) {
    clearTimeout(timer);
    keyHandler = onKey || null;
    $app.innerHTML = `<div class="view">${html}</div>`;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }
  document.addEventListener("keydown", e => { if (keyHandler && !e.metaKey && !e.ctrlKey && !e.altKey) keyHandler(e); });

  function home() {
    const s = store.get();
    const total = allQuestions().length;
    const acc = s.answered ? Math.round(s.correct / s.answered * 100) : 0;
    const topicsHtml = TOPICS.map(t => {
      const tests = testsForTopic(t.id);
      const done = tests.filter((_, i) => s.best[t.id + ":" + i] != null).length;
      return `
        <button class="topic" style="--c:${t.color}" data-topic="${t.id}">
          <div class="topic-ico">${esc(t.short)}</div>
          <div class="topic-body">
            <h3>${esc(t.name)}</h3>
            <p>${tests.length} ta test · ${(DATA[t.id] || []).length} savol · ${esc(t.desc)}</p>
            <div class="bar"><i style="width:${tests.length ? done / tests.length * 100 : 0}%"></i></div>
          </div>
          <span class="chev">›</span>
        </button>`;
    }).join("");
    const mcount = s.mistakes.length;

    setView(`
      <header class="brand">
        <div class="logo">&lt;/&gt;</div>
        <div><h1>WebQuiz</h1><p>Veb dasturlash bo‘yicha 10 talik testlar</p></div>
      </header>
      <section class="hero">
        <div class="stat"><b>${total}</b><span>savol</span></div>
        <div class="stat"><b>${s.answered}</b><span>javob berildi</span></div>
        <div class="stat"><b>${acc}%</b><span>aniqlik</span></div>
      </section>
      <div class="section-title">Mavzular</div>
      <div class="topics">${topicsHtml}</div>
      <div class="quick">
        <button id="random"><b>🎲 Aralash test</b><span>Barcha mavzulardan 10 ta tasodifiy savol</span></button>
        <button id="mist" ${mcount ? "" : "disabled"}><b>🔁 Xatolarim</b><span>${mcount ? mcount + " ta xato savolni qayta ishlash" : "Hozircha xato yo‘q"}</span></button>
      </div>
      <p class="footer">Natijalar shu brauzerda saqlanadi · <button class="link-btn" id="reset">Natijalarni tozalash</button></p>
    `);

    $app.querySelectorAll("[data-topic]").forEach(b => b.onclick = () => topic(b.dataset.topic));
    $app.querySelector("#random").onclick = () => startQuiz({
      title: "Aralash test", topic: null, questions: shuffle(allQuestions()).slice(0, PER_TEST),
    });
    $app.querySelector("#mist").onclick = () => {
      const keys = new Set(store.get().mistakes);
      const qs = shuffle(allQuestions().filter(q => keys.has(qKey(q)))).slice(0, PER_TEST);
      if (qs.length) startQuiz({ title: "Xatolarim", topic: null, questions: qs, mistakesMode: true });
    };
    $app.querySelector("#reset").onclick = () => {
      if (store.get().answered === 0 && !Object.keys(store.get().best).length) return toast("Tozalash uchun natija yo‘q");
      store.reset(); toast("Natijalar tozalandi"); home();
    };
  }

  function topic(id) {
    const t = topicById[id];
    const s = store.get();
    const tests = testsForTopic(id);
    const cards = tests.map((qs, i) => {
      const first = qs[0].n, last = Math.min((DATA[id] || []).length, i * PER_TEST + PER_TEST);
      return `
        <button class="test" style="--c:${t.color}" data-i="${i}">
          <div class="num">Savollar ${i * PER_TEST + 1}–${last}${qs.length && i * PER_TEST + PER_TEST > (DATA[id] || []).length ? " +" : ""}</div>
          <h4>Test ${i + 1}</h4>
          ${badge(s.best[id + ":" + i])}
        </button>`;
    }).join("");
    setView(`
      <div class="topbar">
        <button class="icon-btn" id="back" aria-label="Orqaga">←</button>
        <div class="t"><h2>${esc(t.name)}</h2><p>${tests.length} ta test, har birida ${PER_TEST} ta savol</p></div>
      </div>
      <div class="tests">${cards}</div>
    `, e => { if (e.key === "Escape") home(); });
    $app.querySelector("#back").onclick = home;
    $app.querySelectorAll("[data-i]").forEach(b => b.onclick = () => {
      const i = +b.dataset.i;
      startQuiz({ title: `${t.name} · Test ${i + 1}`, topic: id, testIndex: i, questions: tests[i] });
    });
  }

  // ---------- quiz ----------
  function startQuiz(cfg) {
    const state = {
      ...cfg,
      idx: 0,
      results: [], // {q, chosen, correct}
      items: cfg.questions.map(q => {
        const order = shuffle([0, 1, 2, 3]);
        return { q, order, answer: order.indexOf(q.a) };
      }),
    };
    renderQuestion(state);
  }

  function renderQuestion(st) {
    const item = st.items[st.idx];
    const q = item.q;
    const t = topicById[q.topic];
    const dots = st.items.map((_, i) => {
      const r = st.results[i];
      return `<i class="${r ? (r.correct ? "ok" : "bad") : i === st.idx ? "cur" : ""}"></i>`;
    }).join("");
    const opts = item.order.map((orig, i) => `
      <button class="opt" data-i="${i}">
        <span class="key">${LETTERS[i]}</span>
        <span class="txt">${fmtOption(q.o[orig])}</span>
        <span class="mark"></span>
      </button>`).join("");

    setView(`
      <div class="topbar">
        <button class="icon-btn" id="quit" aria-label="Chiqish">✕</button>
        <div class="t"><h2>${esc(st.title)}</h2><p>${st.idx + 1}-savol / ${st.items.length}</p></div>
      </div>
      <div class="dots" style="grid-template-columns:repeat(${st.items.length},1fr)">${dots}</div>
      <article class="qcard" style="--c:${t.color}">
        <div class="qmeta"><span class="pill">${esc(t.name)}</span><span class="count">${st.idx + 1} / ${st.items.length}</span></div>
        <div class="qtext">${fmtQuestion(q.q)}</div>
      </article>
      <div class="opts">${opts}</div>
      <div id="fb"></div>
      <p class="hint"><kbd>1</kbd>–<kbd>4</kbd> yoki <kbd>A</kbd>–<kbd>D</kbd> bilan tanlang · <kbd>Enter</kbd> — keyingi</p>
    `, e => {
      const k = e.key.toUpperCase();
      if (st.results[st.idx]) { if (k === "ENTER" || k === " ") { e.preventDefault(); next(st); } return; }
      const n = "1234".indexOf(k) >= 0 ? "1234".indexOf(k) : LETTERS.indexOf(k);
      if (n >= 0) choose(st, n);
      if (k === "ESCAPE") quit(st);
    });

    $app.querySelector("#quit").onclick = () => quit(st);
    $app.querySelectorAll(".opt").forEach(b => b.onclick = () => choose(st, +b.dataset.i));
  }

  function quit(st) {
    if (st.results.length && st.results.length < st.items.length && !confirmQuit()) return;
    st.topic ? topic(st.topic) : home();
  }
  function confirmQuit() {
    // non-blocking confirm: second tap within 2s quits
    if (confirmQuit._armed) { confirmQuit._armed = false; return true; }
    confirmQuit._armed = true; toast("Chiqish uchun yana bir marta bosing");
    setTimeout(() => confirmQuit._armed = false, 2000);
    return false;
  }

  function choose(st, i) {
    if (st.results[st.idx]) return;
    const item = st.items[st.idx];
    const ok = i === item.answer;
    st.results[st.idx] = { q: item.q, chosen: item.order[i], correct: ok };

    const s = store.get();
    s.answered++; if (ok) s.correct++;
    const key = qKey(item.q);
    s.mistakes = s.mistakes.filter(k => k !== key);
    if (!ok) s.mistakes.push(key);
    store.save();

    const btns = $app.querySelectorAll(".opt");
    btns.forEach((b, j) => {
      b.disabled = true;
      if (j === item.answer) { b.classList.add("correct"); b.querySelector(".mark").textContent = "✓"; }
      else if (j === i) { b.classList.add("wrong"); b.querySelector(".mark").textContent = "✗"; }
      else b.classList.add("dim");
    });
    const dot = $app.querySelectorAll(".dots i")[st.idx];
    dot.className = ok ? "ok" : "bad";

    const last = st.idx === st.items.length - 1;
    const nextLabel = last ? "Natijani ko‘rish" : "Keyingi savol →";
    const correctText = item.q.o[item.q.a];
    const fb = $app.querySelector("#fb");
    fb.innerHTML = ok ? `
      <div class="feedback ok">
        <div class="fi">✓</div>
        <div style="flex:1"><b>To‘g‘ri! Barakalla 🎉</b><p>${last ? "Test yakunlandi." : "Keyingi savolga o‘tilmoqda…"}</p>
        <div class="auto-bar"><i style="animation-duration:${AUTO_NEXT_MS}ms"></i></div></div>
      </div>
      <div class="actions"><button class="btn green" id="next">${nextLabel}</button></div>`
      : `
      <div class="feedback bad">
        <div class="fi">✗</div>
        <div><b>Noto‘g‘ri!</b><p>To‘g‘ri javob: <strong>${LETTERS[item.answer]})</strong> ${esc(correctText)}</p></div>
      </div>
      <div class="actions"><button class="btn" id="next">${nextLabel}</button></div>`;
    const nb = fb.querySelector("#next");
    nb.onclick = () => next(st);
    if (ok) timer = setTimeout(() => next(st), AUTO_NEXT_MS);
    else { nb.focus({ preventScroll: true }); fb.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }

  function next(st) {
    clearTimeout(timer);
    if (st.idx < st.items.length - 1) { st.idx++; renderQuestion(st); }
    else result(st);
  }

  function result(st) {
    const total = st.items.length;
    const right = st.results.filter(r => r.correct).length;
    const pct = Math.round(right / total * 100);
    const s = store.get();
    let isBest = false;
    if (st.topic != null && st.testIndex != null) {
      const k = st.topic + ":" + st.testIndex;
      if (s.best[k] == null || right > s.best[k]) { isBest = s.best[k] != null; s.best[k] = right; }
      store.save();
    }
    const color = pct >= 80 ? "var(--ok)" : pct >= 50 ? "#facc15" : "var(--bad)";
    const title = pct === 100 ? "Mukammal! 🏆" : pct >= 80 ? "Ajoyib natija! 🎉" : pct >= 50 ? "Yaxshi, yana biroz! 💪" : "Qayta urinib ko‘ring 📚";
    const C = 2 * Math.PI * 78;
    const wrong = st.results.filter(r => !r.correct);
    const review = wrong.map(r => `
      <div class="rv">
        <div class="rq">${fmtQuestion(r.q.q)}</div>
        <div class="ra y">✗ <span>Sizning javobingiz: ${esc(r.q.o[r.chosen])}</span></div>
        <div class="ra c">✓ <span>To‘g‘ri javob: ${esc(r.q.o[r.q.a])}</span></div>
      </div>`).join("");

    let nextTest = null;
    if (st.topic && st.testIndex != null && st.testIndex + 1 < testsForTopic(st.topic).length) nextTest = st.testIndex + 1;

    setView(`
      <div class="topbar">
        <button class="icon-btn" id="back" aria-label="Orqaga">←</button>
        <div class="t"><h2>${esc(st.title)}</h2><p>Natija</p></div>
      </div>
      <section class="result">
        <div class="ring">
          <svg viewBox="0 0 180 180"><circle class="track" cx="90" cy="90" r="78"/>
          <circle class="prog" cx="90" cy="90" r="78" stroke="${color}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
          <div class="in"><b>${right}/${total}</b><span>${pct}%</span></div>
        </div>
        <h2>${title}</h2>
        <p>${isBest ? "Yangi rekord! " : ""}${right} ta to‘g‘ri, ${total - right} ta noto‘g‘ri</p>
        <div class="summary">
          <div class="g"><b>${right}</b><span>To‘g‘ri</span></div>
          <div class="r"><b>${total - right}</b><span>Noto‘g‘ri</span></div>
        </div>
        <div class="actions">
          <button class="btn ghost" id="retry">↻ Qayta ishlash</button>
          ${nextTest != null ? `<button class="btn" id="nextTest">Keyingi test →</button>` : `<button class="btn" id="homeBtn">Bosh sahifa</button>`}
        </div>
        ${wrong.length ? `<div class="section-title" style="margin-top:26px;text-align:left">Xatolar tahlili</div><div class="review">${review}</div>` : ""}
      </section>
    `, e => { if (e.key === "Escape") goBack(); });

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const p = $app.querySelector(".prog"); if (p) p.style.strokeDashoffset = C * (1 - right / total);
    }));
    if (pct >= 80) confetti();

    const goBack = () => st.topic ? topic(st.topic) : home();
    $app.querySelector("#back").onclick = goBack;
    $app.querySelector("#retry").onclick = () => {
      if (st.mistakesMode) {
        const keys = new Set(store.get().mistakes);
        const qs = shuffle(allQuestions().filter(q => keys.has(qKey(q)))).slice(0, PER_TEST);
        return qs.length ? startQuiz({ ...st, questions: qs }) : (toast("Barcha xatolar tuzatildi! 🎉"), home());
      }
      startQuiz({ ...st, questions: st.topic ? st.questions : shuffle(allQuestions()).slice(0, PER_TEST) });
    };
    const nt = $app.querySelector("#nextTest");
    if (nt) nt.onclick = () => {
      const t = topicById[st.topic];
      startQuiz({ title: `${t.name} · Test ${nextTest + 1}`, topic: st.topic, testIndex: nextTest, questions: testsForTopic(st.topic)[nextTest] });
    };
    const hb = $app.querySelector("#homeBtn");
    if (hb) hb.onclick = home;
  }

  function confetti() {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const wrap = document.createElement("div"); wrap.className = "confetti";
    const colors = ["#7c6cff", "#22d3ee", "#22c55e", "#facc15", "#fb7185"];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement("i");
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.8 + Math.random() * 1.8 + "s";
      c.style.animationDelay = Math.random() * .5 + "s";
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      wrap.appendChild(c);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 4500);
  }

  home();
})();
