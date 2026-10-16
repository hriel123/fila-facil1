/* =========================================================
   FilaFácil — app.js
   Login, área do cliente (pegar e acompanhar senha) e
   painel do estabelecimento (chamar, fila, relatório, ajustes)
========================================================= */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const filaCode = (params.get("e") || "").trim().toUpperCase();

  const STATUS = {
    WAITING: "Aguardando",
    CALLED: "Chamada",
    DONE: "Atendida",
    NO_SHOW: "Não veio",
    CANCELED: "Desistiu",
    EXPIRED: "Expirou",
  };

  let user = null;
  let pollTimer = null;
  let pollFn = null;
  let offlineToastShown = false;

  /* ---------------------------------------------------------
     Utilidades
  --------------------------------------------------------- */
  function show(viewId) {
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== viewId; });
    window.scrollTo(0, 0);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  let toastTimer = null;
  function toast(message) {
    const box = $("toast");
    box.textContent = message;
    box.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("is-visible"), 3200);
  }

  function setError(box, err) {
    box.textContent = err ? err.friendly || String(err) : "";
    box.hidden = !err;
  }

  function firstName(name) {
    return (name || "").trim().split(/\s+/)[0];
  }

  function people(n) {
    return n === 1 ? "1 pessoa" : `${n} pessoas`;
  }

  function mins(value) {
    if (value === null || value === undefined) return "—";
    if (value < 1) return "< 1 min";
    return `${Math.round(value)} min`;
  }

  function waitText(m) {
    if (!m) return null;
    if (m < 60) return `~${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `~${h} h ${r} min` : `~${h} h`;
  }

  function hhmm(iso) {
    return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  }

  function ago(iso) {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "agora mesmo";
    if (m < 60) return `há ${m} min`;
    return `há ${Math.floor(m / 60)} h ${m % 60} min`;
  }

  function localDay(date = new Date()) {
    return date.toLocaleDateString("en-CA");
  }

  function startPolling(fn, ms) {
    stopPolling();
    pollFn = fn;
    pollTimer = setInterval(runPoll, ms);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
    pollFn = null;
  }

  async function runPoll() {
    if (!pollFn) return;
    try {
      await pollFn();
      offlineToastShown = false;
    } catch (err) {
      if (err.status === 401) {
        location.reload();
      } else if (err.code === "network" && !offlineToastShown) {
        offlineToastShown = true;
        toast("Sem conexão com o servidor. Tentando de novo…");
      }
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runPoll();
      if (avisosOn && watched && isActive(watched)) requestWakeLock();
    }
  });

  /* ---------------------------------------------------------
     Início
  --------------------------------------------------------- */
  async function boot() {
    show("vLoading");
    if (!FF.base) {
      showOffline("O sistema ainda não foi ligado ao servidor.", false);
      return;
    }

    const slow = setTimeout(() => { $("loadingHint").hidden = false; }, 4000);
    try {
      const fila = filaCode ? await loadFila(filaCode) : null;
      if (FF.getToken()) {
        try {
          user = (await FF.request("/auth/me")).user;
        } catch (err) {
          if (err.status !== 401 && err.status !== 404) throw err;
          FF.setToken(null);
          user = null;
        }
      }
      clearTimeout(slow);
      await route(fila);
    } catch (err) {
      clearTimeout(slow);
      showOffline(err.friendly || "O servidor do FilaFácil não respondeu.", true);
    }
  }

  function showOffline(message, canRetry) {
    stopPolling();
    $("offlineMsg").textContent = message;
    $("btnRetry").hidden = !canRetry;
    show("vOffline");
  }

  $("btnRetry").addEventListener("click", boot);

  async function loadFila(code) {
    try {
      return await FF.request(`/public/${encodeURIComponent(code)}`, { auth: false });
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function route(fila) {
    renderHeader();
    const ticketId = Number(params.get("t"));
    if (!user) return showAuth(fila);
    if (user.role === "OWNER") return showPanel();
    if (ticketId) return showTicket(ticketId);
    if (fila) return showJoin(fila);
    await showCustomer();
    if (filaCode) toast("Não encontramos uma fila com esse código.");
  }

  function renderHeader() {
    $("appUser").hidden = !user;
    if (user) $("userName").textContent = firstName(user.name);
  }

  $("btnSair").addEventListener("click", () => {
    FF.setToken(null);
    location.href = "app.html";
  });

  /* ---------------------------------------------------------
     Dados públicos da fila (cartões de "entrar na fila")
  --------------------------------------------------------- */
  function estimateFor(fila) {
    return (fila.waiting + (fila.current ? 1 : 0)) * fila.avgMinutes;
  }

  function fillFila(fila) {
    const estimate = estimateFor(fila);
    const values = {
      name: fila.name,
      waiting: `${people(fila.waiting)} aguardando`,
      estimate: estimate ? `espera de ${waitText(estimate)}` : "sem espera agora",
      waitingNum: String(fila.waiting),
      estimateNum: estimate ? waitText(estimate) : "sem espera",
      current: fila.current ? fila.current.code : "—",
    };
    document.querySelectorAll("[data-fila]").forEach((node) => {
      node.textContent = values[node.dataset.fila];
    });
  }

  /* ---------------------------------------------------------
     Entrar / criar conta
  --------------------------------------------------------- */
  let authFila = null;

  function showAuth(fila) {
    stopPolling();
    authFila = fila;
    $("authFila").hidden = !fila;
    if (fila) fillFila(fila);

    // Quem chega pelo QR code de uma fila é cliente: esconde a escolha de tipo.
    document.querySelector(".role-pick").hidden = !!fila;
    const ownerFirst = params.get("criar") === "negocio" && !fila;
    document.querySelector(`#formCriar input[name="role"][value="${ownerFirst ? "OWNER" : "CUSTOMER"}"]`).checked = true;
    syncRole();

    switchAuthTab(params.has("criar") || fila ? "criar" : "entrar");
    show("vAuth");
  }

  function switchAuthTab(tab) {
    document.querySelectorAll(".tabs [data-auth-tab]").forEach((b) => {
      const active = b.dataset.authTab === tab;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    $("formEntrar").hidden = tab !== "entrar";
    $("formCriar").hidden = tab !== "criar";
  }

  document.querySelectorAll("[data-auth-tab]").forEach((b) => {
    b.addEventListener("click", () => switchAuthTab(b.dataset.authTab));
  });

  function syncRole() {
    const owner = document.querySelector('#formCriar input[name="role"]:checked').value === "OWNER";
    document.querySelector("[data-owner-only]").hidden = !owner;
    document.querySelector('#formCriar input[name="businessName"]').required = owner;
  }

  document.querySelectorAll('#formCriar input[name="role"]').forEach((r) => r.addEventListener("change", syncRole));

  async function submitAuth(form, path, body) {
    const error = form.querySelector(".form__error");
    const button = form.querySelector('button[type="submit"]');
    setError(error, null);
    FF.unlockAudio();
    button.disabled = true;
    try {
      const data = await FF.request(path, { method: "POST", body, auth: false });
      FF.setToken(data.token);
      user = data.user;
      renderHeader();
      if (user.role === "OWNER") return showPanel();
      if (authFila) return takeTicket(authFila.code);
      return showCustomer();
    } catch (err) {
      setError(error, err);
    } finally {
      button.disabled = false;
    }
  }

  $("formEntrar").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    if (!email || !f.password.value) {
      setError(f.querySelector(".form__error"), { friendly: "Preencha e-mail e senha." });
      return;
    }
    submitAuth(f, "/auth/login", { email, password: f.password.value });
  });

  $("formCriar").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const role = f.role.value;
    const body = { name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value, role };
    if (role === "OWNER") body.businessName = f.businessName.value.trim();
    const error = f.querySelector(".form__error");
    if (!body.name || !body.email || !body.password) return setError(error, { friendly: "Preencha todos os campos." });
    if (role === "OWNER" && body.businessName.length < 2) return setError(error, { friendly: "Digite o nome do estabelecimento." });
    if (body.password.length < 6) return setError(error, { friendly: "A senha precisa ter pelo menos 6 caracteres." });
    submitAuth(f, "/auth/register", body);
  });

  /* ---------------------------------------------------------
     Cliente: pegar senha
  --------------------------------------------------------- */
  async function showJoin(fila) {
    const mine = await FF.request("/tickets");
    const existing = mine.active.find((t) => t.establishment.code === fila.code);
    if (existing) return showTicket(existing.id, existing);

    const render = (f) => {
      fillFila(f);
      $("btnPegar").hidden = !f.open;
      $("joinClosed").hidden = f.open;
    };
    render(fila);
    setError($("joinError"), null);
    show("vJoin");
    startPolling(async () => {
      const f = await loadFila(fila.code);
      if (f) render(f);
    }, 8000);
  }

  async function takeTicket(code) {
    try {
      const ticket = await FF.request("/tickets", { method: "POST", body: { code } });
      showTicket(ticket.id, ticket);
    } catch (err) {
      const fila = await loadFila(code).catch(() => null);
      try {
        if (fila) {
          await showJoin(fila);
          setError($("joinError"), err);
        } else {
          await showCustomer();
          toast(err.friendly);
        }
      } catch (inner) {
        toast(inner.friendly || err.friendly);
      }
    }
  }

  $("btnPegar").addEventListener("click", async (e) => {
    FF.unlockAudio();
    e.currentTarget.disabled = true;
    await takeTicket(filaCode);
    $("btnPegar").disabled = false;
  });

  /* ---------------------------------------------------------
     Cliente: acompanhar a senha
  --------------------------------------------------------- */
  let watched = null;
  let maxAhead = 0;
  let avisosOn = false;
  let wakeLock = null;

  function isActive(t) {
    return t.status === "WAITING" || t.status === "CALLED";
  }

  function showTicket(id, initial) {
    history.replaceState(null, "", `app.html?t=${id}`);
    watched = null;
    maxAhead = 0;
    show("vTicket");
    const refresh = async () => renderTicket(await FF.request(`/tickets/${id}`));
    if (initial) {
      renderTicket(initial);
    } else {
      refresh().catch((err) => {
        showCustomer();
        toast(err.friendly);
      });
    }
    startPolling(refresh, 5000);
    renderAvisos();
  }

  function renderTicket(t) {
    const prev = watched && watched.id === t.id ? watched : null;
    watched = t;
    const active = isActive(t);
    if (t.status === "WAITING") maxAhead = Math.max(maxAhead, t.ahead);

    const card = $("myTicket");
    card.dataset.status = t.status;
    $("mtPlace").textContent = t.establishment.name;
    $("mtCode").textContent = t.code;

    let headline = "";
    let detail = "";
    if (t.status === "WAITING") {
      headline = t.ahead === 0 ? "Você é o próximo!" : t.ahead === 1 ? "Falta 1 pessoa na sua frente" : `Faltam ${t.ahead} pessoas na sua frente`;
      if (t.ahead > 0) detail = "Acompanhe por aqui. Avisamos quando chegar a sua vez.";
      else detail = t.current ? "Assim que o atendimento atual terminar, você será chamado." : "Você será chamado em instantes.";
    } else if (t.status === "CALLED") {
      headline = "É a sua vez!";
      detail = t.callCount > 1 ? `Dirija-se ao atendimento. Você foi chamado ${t.callCount} vezes.` : "Dirija-se ao atendimento.";
    } else if (t.status === "DONE") {
      headline = "Atendimento concluído";
      detail = "Obrigado por usar o FilaFácil!";
    } else if (t.status === "NO_SHOW") {
      headline = "Sua senha foi chamada";
      detail = "Como você não apareceu, ela saiu da fila. Se ainda precisar, pegue uma nova senha.";
    } else if (t.status === "CANCELED") {
      headline = "Você saiu da fila";
      detail = "Se mudar de ideia, pegue uma nova senha.";
    } else {
      headline = "Senha expirada";
      detail = "As senhas valem só no dia em que foram emitidas.";
    }
    $("mtHeadline").textContent = headline;
    $("mtDetail").textContent = detail;

    $("mtMeta").hidden = t.status !== "WAITING";
    $("mtProgress").hidden = t.status !== "WAITING";
    if (t.status === "WAITING") {
      $("mtCurrent").textContent = t.current || "—";
      $("mtWait").textContent = waitText(t.waitMinutes) || "agora";
      const pct = maxAhead ? ((maxAhead - t.ahead + 1) / (maxAhead + 1)) * 100 : 100;
      $("mtProgress").firstElementChild.style.width = `${Math.max(8, pct)}%`;
    }

    $("btnDesistir").hidden = !active;
    $("btnMinhas").hidden = active;
    $("ticketTip").hidden = !active;
    renderAvisos();

    if (!active) {
      stopPolling();
      releaseWakeLock();
    }

    const newCall = t.status === "CALLED" && (!prev || prev.status !== "CALLED" || t.callCount > prev.callCount);
    if (newCall) alertCalled(t);
  }

  function renderAvisos() {
    const active = watched ? isActive(watched) : true;
    $("btnAvisos").hidden = !active || avisosOn;
    $("avisosOk").hidden = !active || !avisosOn;
  }

  async function registerWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await navigator.serviceWorker.register("sw.js");
    } catch {
      return null;
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch { /* o navegador recusou: segue sem manter a tela ligada */ }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  $("btnAvisos").addEventListener("click", async () => {
    FF.unlockAudio();
    FF.chime();
    if ("Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* sem permissão */ }
    }
    registerWorker();
    requestWakeLock();
    avisosOn = true;
    renderAvisos();
  });

  let titleTimer = null;
  function flashTitle(text) {
    const original = "FilaFácil";
    let on = false;
    let count = 0;
    clearInterval(titleTimer);
    titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? text : original;
      if (++count > 40 || (document.visibilityState === "visible" && count > 6)) {
        clearInterval(titleTimer);
        document.title = original;
      }
    }, 1000);
  }

  async function alertCalled(t) {
    FF.chime();
    setTimeout(FF.chime, 1700);
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 900]);
    flashTitle(`É a sua vez! ${t.code}`);
    if ("Notification" in window && Notification.permission === "granted") {
      const options = { body: `Senha ${t.code} · ${t.establishment.name}. Dirija-se ao atendimento.`, icon: "favicon.png", tag: `filafacil-${t.id}`, renotify: true };
      const reg = await registerWorker();
      try {
        if (reg) await reg.showNotification("É a sua vez!", options);
        else new Notification("É a sua vez!", options);
      } catch { /* notificação indisponível neste navegador */ }
    }
  }

  $("btnDesistir").addEventListener("click", async () => {
    if (!watched || !confirm(`Sair da fila e cancelar a senha ${watched.code}?`)) return;
    try {
      renderTicket(await FF.request(`/tickets/${watched.id}`, { method: "DELETE" }));
    } catch (err) {
      toast(err.friendly);
    }
  });

  /* ---------------------------------------------------------
     Cliente: início
  --------------------------------------------------------- */
  async function showCustomer() {
    history.replaceState(null, "", "app.html");
    $("custName").textContent = firstName(user.name);
    show("vCustomer");
    const refresh = async () => renderCustomer(await FF.request("/tickets"));
    try {
      await refresh();
    } catch (err) {
      toast(err.friendly);
    }
    startPolling(refresh, 10000);
  }

  function renderCustomer(data) {
    const activeBox = $("custActive");
    activeBox.replaceChildren();
    data.active.forEach((t) => {
      const card = el("button", "active-ticket");
      card.type = "button";
      card.dataset.status = t.status;
      card.append(el("span", "active-ticket__code", t.code));
      const info = el("span", "active-ticket__info");
      info.append(el("strong", null, t.establishment.name));
      const line = t.status === "CALLED"
        ? "É a sua vez! Dirija-se ao atendimento."
        : `${t.ahead === 0 ? "Você é o próximo" : `${people(t.ahead)} na sua frente`} · ${waitText(t.waitMinutes) || "agora"}`;
      info.append(el("span", null, line));
      card.append(info, el("span", "active-ticket__go", "Acompanhar ›"));
      card.addEventListener("click", () => showTicket(t.id, t));
      activeBox.append(card);
    });

    const list = $("custHistory");
    list.replaceChildren();
    if (!data.history.length) {
      list.append(el("li", "hist-empty", "Nenhuma senha ainda."));
    }
    data.history.forEach((t) => {
      const li = el("li", "hist-item");
      li.append(el("span", "mono", t.code), el("span", "hist-item__place", t.establishment.name));
      const [, m, d] = t.day.split("-");
      li.append(el("span", `status status--${t.status}`, STATUS[t.status]), el("span", "hist-item__day", `${d}/${m}`));
      list.append(li);
    });
  }

  $("formCodigo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim().toUpperCase();
    const error = e.target.parentElement.querySelector(".form__error");
    if (code.length < 5) return setError(error, { friendly: "O código da fila tem 5 caracteres." });
    const fila = await loadFila(code).catch((err) => { setError(error, err); return undefined; });
    if (fila === null) return setError(error, { friendly: "Não encontramos uma fila com esse código." });
    if (fila) location.href = `app.html?e=${encodeURIComponent(code)}`;
  });

  /* ---------------------------------------------------------
     Estabelecimento: painel
  --------------------------------------------------------- */
  let panel = null;
  let report = null;

  function showPanel() {
    history.replaceState(null, "", "app.html");
    show("vPanel");
    switchPtab("atendimento");
    refreshPanel().catch((err) => toast(err.friendly));
    startPolling(refreshPanel, 4000);
  }

  async function refreshPanel() {
    renderPanel(await FF.request("/panel"));
  }

  function switchPtab(tab) {
    document.querySelectorAll("[data-ptab]").forEach((b) => {
      const active = b.dataset.ptab === tab;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    $("tabAtendimento").hidden = tab !== "atendimento";
    $("tabRelatorio").hidden = tab !== "relatorio";
    $("tabAjustes").hidden = tab !== "ajustes";
    if (tab === "relatorio") {
      if (!$("rDay").value) $("rDay").value = localDay();
      $("rDay").max = localDay();
      loadReport();
    }
    if (tab === "ajustes" && panel) fillSettings(panel.establishment);
  }

  document.querySelectorAll("[data-ptab]").forEach((b) => b.addEventListener("click", () => switchPtab(b.dataset.ptab)));

  function ticketName(t) {
    if (t.name) return t.name;
    return t.walkIn ? "Senha avulsa" : "Cliente";
  }

  function renderPanel(p) {
    panel = p;
    const e = p.establishment;
    $("pName").textContent = e.name;
    $("pOpen").checked = e.open;
    $("pOpenLabel").textContent = e.open ? "Recebendo senhas" : "Fila fechada";
    $("pClosedNotice").hidden = e.open;
    $("btnTv").href = FF.link("tv.html", e.code);

    $("sWaiting").textContent = String(p.stats.waiting);
    $("sDone").textContent = String(p.stats.done);
    $("sWait").textContent = mins(p.stats.avgWait);
    $("sService").textContent = mins(p.stats.avgService);

    const cur = p.current;
    $("nowCard").dataset.state = cur ? "calling" : "idle";
    $("nowCode").textContent = cur ? cur.code : "—";
    $("nowName").textContent = cur ? ticketName(cur) : "Ninguém sendo atendido";
    $("nowSince").textContent = cur
      ? `Chamada ${ago(cur.calledAt)}${cur.callCount > 1 ? ` · chamada ${cur.callCount} vezes` : ""}`
      : p.waiting.length ? "Toque em chamar para atender a próxima senha." : "";
    const next = p.waiting[0];
    $("btnNext").textContent = next ? `Chamar próximo · ${next.code}` : "Ninguém aguardando";
    $("btnNext").disabled = !next;
    ["btnRecall", "btnFinish", "btnNoShow"].forEach((id) => { $(id).disabled = !cur; });

    $("qCount").textContent = String(p.waiting.length);
    $("qEmpty").hidden = p.waiting.length > 0;
    const list = $("qList");
    list.replaceChildren();
    p.waiting.forEach((t, i) => {
      const li = el("li", "q-item");
      li.append(el("span", "q-item__pos", String(i + 1)), el("span", "q-item__code", t.code));
      const info = el("span", "q-item__info");
      info.append(el("strong", null, ticketName(t)), el("span", null, `chegou ${ago(t.createdAt)}`));
      const remove = el("button", "q-item__remove", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Tirar a senha ${t.code} da fila`);
      remove.addEventListener("click", () => cancelTicket(t));
      li.append(info, remove);
      list.append(li);
    });

    $("recentBox").hidden = p.recent.length === 0;
    const recent = $("recentList");
    recent.replaceChildren();
    p.recent.forEach((t) => {
      const li = el("li", "recent__item");
      li.append(el("span", "mono", t.code), el("span", "recent__name", ticketName(t)), el("span", `status status--${t.status}`, STATUS[t.status]), el("span", "recent__time", hhmm(t.finishedAt)));
      recent.append(li);
    });

    $("aCode").textContent = e.code;
    $("aLink").value = FF.link("app.html", e.code);
  }

  async function panelAction(path, options = {}) {
    const buttons = document.querySelectorAll(".now-card .btn");
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const p = await FF.request(path, { method: "POST", ...options });
      renderPanel(p);
      return p;
    } catch (err) {
      toast(err.friendly);
      refreshPanel().catch(() => {});
      return null;
    } finally {
      if (panel) renderPanel(panel);
    }
  }

  $("btnNext").addEventListener("click", async () => {
    const p = await panelAction("/panel/next");
    if (p?.current) toast(`Chamando ${p.current.code}`);
  });
  $("btnRecall").addEventListener("click", async () => {
    const p = await panelAction("/panel/recall");
    if (p?.current) toast(`Chamando ${p.current.code} de novo`);
  });
  $("btnFinish").addEventListener("click", () => panelAction("/panel/finish"));
  $("btnNoShow").addEventListener("click", async () => {
    const code = panel?.current?.code;
    const p = await panelAction("/panel/no-show");
    if (p && code) toast(`${code} marcada como "não veio"`);
  });

  async function cancelTicket(t) {
    if (!confirm(`Tirar a senha ${t.code} (${ticketName(t)}) da fila?`)) return;
    try {
      renderPanel(await FF.request(`/panel/tickets/${t.id}`, { method: "DELETE" }));
    } catch (err) {
      toast(err.friendly);
    }
  }

  $("btnWalkIn").addEventListener("click", () => {
    $("formWalkIn").hidden = false;
    $("btnWalkIn").hidden = true;
    $("formWalkIn").name.focus();
  });

  function closeWalkIn() {
    $("formWalkIn").hidden = true;
    $("btnWalkIn").hidden = false;
    $("formWalkIn").reset();
  }

  $("btnWalkInCancel").addEventListener("click", closeWalkIn);

  $("formWalkIn").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    try {
      const p = await FF.request("/panel/tickets", { method: "POST", body: { name } });
      renderPanel(p);
      const created = p.waiting[p.waiting.length - 1];
      if (created) toast(`Senha ${created.code} gerada${name ? ` para ${name}` : ""}`);
      closeWalkIn();
    } catch (err) {
      toast(err.friendly);
    }
  });

  $("pOpen").addEventListener("change", async (e) => {
    const open = e.target.checked;
    try {
      renderPanel(await FF.request("/panel/settings", { method: "PATCH", body: { open } }));
      toast(open ? "Fila aberta: os clientes já podem pegar senha." : "Fila fechada para novas senhas.");
    } catch (err) {
      e.target.checked = !open;
      toast(err.friendly);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "n" && e.key !== "N") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ($("vPanel").hidden || $("tabAtendimento").hidden) return;
    if (e.target.closest("input, textarea, select")) return;
    if (!$("btnNext").disabled) $("btnNext").click();
  });

  /* ---------------------------------------------------------
     Estabelecimento: relatório do dia
  --------------------------------------------------------- */
  async function loadReport() {
    try {
      renderReport(await FF.request(`/panel/report?day=${encodeURIComponent($("rDay").value || localDay())}`));
    } catch (err) {
      toast(err.friendly);
    }
  }

  $("rDay").addEventListener("change", loadReport);

  function renderReport(r) {
    report = r;
    $("kIssued").textContent = String(r.issued);
    $("kDone").textContent = String(r.done);
    $("kNoShow").textContent = String(r.noShow);
    $("kCanceled").textContent = String(r.canceled);
    $("kWait").textContent = mins(r.avgWait);
    $("kMaxWait").textContent = mins(r.maxWait);
    $("kService").textContent = mins(r.avgService);

    const chart = $("rChart");
    chart.replaceChildren();
    const peak = Math.max(1, ...r.byHour.map((h) => h.issued));
    if (!r.byHour.length) chart.append(el("p", "q-empty", "Sem senhas neste dia."));
    r.byHour.forEach((h) => {
      const col = el("div", "bars__col");
      col.title = `${h.issued} senha(s) das ${h.hour}h às ${h.hour + 1}h`;
      const bar = el("div", "bars__bar");
      bar.style.height = `${(h.issued / peak) * 100}%`;
      if (h.issued === peak) bar.classList.add("is-peak");
      col.append(el("span", "bars__value", h.issued ? String(h.issued) : ""), bar, el("span", "bars__label", `${h.hour}h`));
      chart.append(col);
    });

    const rows = $("rRows");
    rows.replaceChildren();
    $("rEmpty").hidden = r.tickets.length > 0;
    r.tickets.forEach((t) => {
      const tr = document.createElement("tr");
      const cells = [t.code, ticketName(t), null, hhmm(t.createdAt), hhmm(t.calledAt), mins(t.waitMinutes), mins(t.serviceMinutes)];
      cells.forEach((value, i) => {
        const td = document.createElement("td");
        if (i === 2) td.append(el("span", `status status--${t.status}`, STATUS[t.status]));
        else td.textContent = value;
        if (i === 0) td.className = "mono";
        tr.append(td);
      });
      rows.append(tr);
    });
  }

  $("btnCsv").addEventListener("click", () => {
    if (!report) return;
    const num = (v) => (v === null ? "" : String(v).replace(".", ","));
    const lines = [["Senha", "Cliente", "Situação", "Chegou", "Chamada", "Finalizada", "Espera (min)", "Atendimento (min)"]];
    report.tickets.forEach((t) => {
      lines.push([t.code, ticketName(t), STATUS[t.status], hhmm(t.createdAt), hhmm(t.calledAt), hhmm(t.finishedAt), num(t.waitMinutes), num(t.serviceMinutes)]);
    });
    const csv = lines.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `filafacil-${report.day}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  /* ---------------------------------------------------------
     Estabelecimento: ajustes
  --------------------------------------------------------- */
  function fillSettings(e) {
    const f = $("formAjustes");
    f.elements.name.value = e.name;
    f.elements.prefix.value = e.prefix;
    f.elements.avgMinutes.value = e.avgMinutes;
  }

  $("formAjustes").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const error = f.querySelector(".form__error");
    const body = {
      name: f.elements.name.value.trim(),
      prefix: f.elements.prefix.value.trim(),
      avgMinutes: Number(f.elements.avgMinutes.value),
    };
    setError(error, null);
    try {
      renderPanel(await FF.request("/panel/settings", { method: "PATCH", body }));
      fillSettings(panel.establishment);
      toast("Ajustes salvos.");
    } catch (err) {
      setError(error, err);
    }
  });

  /* ---------------------------------------------------------
     QR code, cartaz e copiar link
  --------------------------------------------------------- */
  function openModal() {
    $("qrModal").hidden = false;
    $("qrModal").querySelector(".modal__close").focus();
  }

  function closeModal() {
    $("qrModal").hidden = true;
  }

  $("btnQr").addEventListener("click", () => {
    if (!panel) return;
    const link = FF.link("app.html", panel.establishment.code);
    const svg = FF.qrSvg(link);
    $("qrBox").innerHTML = svg || "";
    if (!svg) $("qrBox").append(el("p", "card__text", "Não foi possível gerar o QR code agora. Use o link abaixo."));
    $("qrLink").value = link;
    openModal();
  });

  document.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModal));
  $("qrModal").addEventListener("click", (e) => { if (e.target === $("qrModal")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("qrModal").hidden) closeModal(); });

  $("btnPrint").addEventListener("click", () => {
    const e = panel.establishment;
    $("posterName").textContent = e.name;
    $("posterCode").textContent = e.code;
    $("posterQr").innerHTML = FF.qrSvg(FF.link("app.html", e.code)) || "";
    window.print();
  });

  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      const input = $(b.dataset.copy);
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      toast("Link copiado.");
    });
  });

  boot();
})();
