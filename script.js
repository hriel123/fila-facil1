/* =========================================================
   FilaFácil — script.js
   Sistema funcional de fila com persistência em localStorage
========================================================= */

(() => {
  "use strict";

  const STORAGE_KEY = "filafacil_state_v1";
  const MAX_TICKET = 999;
  const SERVED_BASE = 128; // número inicial de vitrine, somado ao uso real

  /* ---------------------------------------------------------
     Estado
  --------------------------------------------------------- */
  const defaultState = {
    queue: [],          // array de números de senha aguardando (int)
    current: null,      // número da senha em atendimento (int | null)
    nextNumber: 24,      // próxima senha a ser gerada (A024 em diante, para casar com o mock do hero)
    history: [],         // { ticket, finishedAt }
    avgTime: 5            // minutos por atendimento
  };

  let state = loadState();

  function formatTicket(n) {
    return "A" + String(n).padStart(3, "0");
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneSafe(defaultState);
      const parsed = JSON.parse(raw);
      return { ...structuredCloneSafe(defaultState), ...parsed };
    } catch (e) {
      console.warn("FilaFácil: não foi possível ler o localStorage, usando estado padrão.", e);
      return structuredCloneSafe(defaultState);
    }
  }

  function structuredCloneSafe(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("FilaFácil: não foi possível salvar no localStorage.", e);
    }
  }

  /* ---------------------------------------------------------
     Referências DOM
  --------------------------------------------------------- */
  const el = {
    currentTicket: document.getElementById("currentTicket"),
    currentStatus: document.getElementById("currentStatus"),
    waitingBadge: document.getElementById("waitingBadge"),
    waitingCount: document.getElementById("waitingCount"),
    estimatedTime: document.getElementById("estimatedTime"),
    queueItems: document.getElementById("queueItems"),
    queueEmpty: document.getElementById("queueEmpty"),
    historyList: document.getElementById("historyList"),
    historyEmpty: document.getElementById("historyEmpty"),
    avgTimeInput: document.getElementById("avgTime"),

    btnAdd: document.getElementById("btnAdd"),
    btnCall: document.getElementById("btnCall"),
    btnFinish: document.getElementById("btnFinish"),
    btnClear: document.getElementById("btnClear"),
    btnClearHistory: document.getElementById("btnClearHistory"),

    statServed: document.getElementById("statServed"),
    statWaiting: document.getElementById("statWaiting"),
    statAvg: document.getElementById("statAvg"),
  };

  /* ---------------------------------------------------------
     Renderização
  --------------------------------------------------------- */
  function render() {
    // Senha atual
    if (state.current !== null) {
      el.currentTicket.textContent = formatTicket(state.current);
      el.currentStatus.textContent = "Atendendo agora";
    } else {
      el.currentTicket.textContent = "—";
      el.currentStatus.textContent = "Nenhum atendimento em andamento";
    }

    // Contadores
    const waiting = state.queue.length;
    el.waitingBadge.textContent = `${waiting} aguardando`;
    el.waitingCount.textContent = String(waiting);

    const estimated = waiting * state.avgTime;
    el.estimatedTime.textContent = estimated > 0 ? `${estimated} min` : "0 min";

    // Botões
    el.btnCall.disabled = waiting === 0;
    el.btnFinish.disabled = state.current === null;
    el.btnClearHistory.disabled = state.history.length === 0;

    // Fila de espera
    el.queueItems.innerHTML = "";
    if (waiting === 0) {
      el.queueItems.appendChild(el.queueEmpty);
    } else {
      state.queue.forEach((ticket) => {
        const li = document.createElement("li");
        li.className = "queue-chip";
        li.innerHTML = `<span>${formatTicket(ticket)}</span>`;
        const removeBtn = document.createElement("button");
        removeBtn.className = "queue-chip__remove";
        removeBtn.setAttribute("aria-label", `Remover senha ${formatTicket(ticket)}`);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => removeFromQueue(ticket));
        li.appendChild(removeBtn);
        el.queueItems.appendChild(li);
      });
    }

    // Histórico (mais recente primeiro, máximo 8 visíveis)
    el.historyList.innerHTML = "";
    if (state.history.length === 0) {
      el.historyList.appendChild(el.historyEmpty);
    } else {
      state.history
        .slice()
        .reverse()
        .slice(0, 8)
        .forEach((item) => {
          const li = document.createElement("li");
          li.className = "history-item";
          li.innerHTML = `<span>${formatTicket(item.ticket)}</span><span>${item.finishedAt}</span>`;
          el.historyList.appendChild(li);
        });
    }

    // Estatísticas
    el.statServed.textContent = String(SERVED_BASE + state.history.length);
    el.statWaiting.textContent = String(waiting);
    el.statAvg.textContent = `${state.avgTime} min`;

    // Input de configuração (evita sobrescrever enquanto o usuário digita)
    if (document.activeElement !== el.avgTimeInput) {
      el.avgTimeInput.value = state.avgTime;
    }
  }

  function animateNumberChange() {
    el.currentTicket.classList.add("is-updating");
    window.requestAnimationFrame(() => {
      setTimeout(() => el.currentTicket.classList.remove("is-updating"), 20);
    });
  }

  /* ---------------------------------------------------------
     Ações
  --------------------------------------------------------- */
  function addClient() {
    const ticket = state.nextNumber;
    state.queue.push(ticket);
    state.nextNumber = ticket >= MAX_TICKET ? 1 : ticket + 1;
    saveState();
    render();
  }

  function callNext() {
    if (state.queue.length === 0) return;

    // Se já havia alguém em atendimento, considera finalizado ao chamar o próximo
    if (state.current !== null) {
      pushToHistory(state.current);
    }

    state.current = state.queue.shift();
    saveState();
    animateNumberChange();
    render();
  }

  function finishCurrent() {
    if (state.current === null) return;
    pushToHistory(state.current);
    state.current = null;
    saveState();
    animateNumberChange();
    render();
  }

  function removeFromQueue(ticket) {
    state.queue = state.queue.filter((t) => t !== ticket);
    saveState();
    render();
  }

  function clearQueue() {
    if (state.queue.length === 0) return;
    const confirmed = window.confirm("Limpar todas as senhas aguardando na fila?");
    if (!confirmed) return;
    state.queue = [];
    saveState();
    render();
  }

  function clearHistory() {
    if (state.history.length === 0) return;
    const confirmed = window.confirm("Limpar todo o histórico de atendimentos? Essa ação não pode ser desfeita.");
    if (!confirmed) return;
    state.history = [];
    saveState();
    render();
  }

  function pushToHistory(ticket) {
    const now = new Date();
    const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    state.history.push({ ticket, finishedAt: time });
  }

  function updateAvgTime(value) {
    const parsed = parseInt(value, 10);
    state.avgTime = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 60) : defaultState.avgTime;
    saveState();
    render();
  }

  /* ---------------------------------------------------------
     Listeners da demonstração
  --------------------------------------------------------- */
  el.btnAdd.addEventListener("click", addClient);
  el.btnCall.addEventListener("click", callNext);
  el.btnFinish.addEventListener("click", finishCurrent);
  el.btnClear.addEventListener("click", clearQueue);
  el.btnClearHistory.addEventListener("click", clearHistory);
  el.avgTimeInput.addEventListener("change", (e) => updateAvgTime(e.target.value));

  /* ---------------------------------------------------------
     Controles personalizados de incremento/decremento
     (substituem as setas nativas do input[type=number])
  --------------------------------------------------------- */
  document.querySelectorAll(".number-stepper").forEach((wrapper) => {
    const input = wrapper.querySelector("input[type='number']");
    if (!input) return;

    const step = () => parseFloat(input.step) || 1;
    const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
    const max = input.max !== "" ? parseFloat(input.max) : Infinity;

    const applyDelta = (delta) => {
      const current = parseFloat(input.value);
      const base = Number.isFinite(current) ? current : 0;
      const next = Math.min(max, Math.max(min, base + delta));
      input.value = next;
      // dispara 'change' para reaproveitar a lógica já existente (ex: updateAvgTime)
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    wrapper.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyDelta(btn.dataset.step === "up" ? step() : -step());
      });
    });
  });

  render();

  /* ---------------------------------------------------------
     Header: menu mobile
  --------------------------------------------------------- */
  const menuToggle = document.getElementById("menuToggle");
  const mobileNav = document.getElementById("mobileNav");

  menuToggle.addEventListener("click", () => {
    const isOpen = mobileNav.classList.toggle("is-open");
    menuToggle.classList.toggle("is-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  mobileNav.querySelectorAll("a, .btn").forEach((link) => {
    link.addEventListener("click", () => {
      mobileNav.classList.remove("is-open");
      menuToggle.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });

  /* ---------------------------------------------------------
     Header: sombra/estado ao rolar
  --------------------------------------------------------- */
  const header = document.getElementById("header");
  let lastScrollY = window.scrollY;

  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      header.style.boxShadow = y > 12 ? "0 8px 24px rgba(0,0,0,0.35)" : "none";
      lastScrollY = y;
    },
    { passive: true }
  );

  /* ---------------------------------------------------------
     Animação de revelação ao rolar (scroll reveal)
  --------------------------------------------------------- */
  const revealEls = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach((elToObserve) => observer.observe(elToObserve));
  } else {
    // Fallback: mostra tudo imediatamente
    revealEls.forEach((elToObserve) => elToObserve.classList.add("is-visible"));
  }

  /* ---------------------------------------------------------
     Semeadura inicial (apenas na primeira visita, sem dados salvos)
  --------------------------------------------------------- */
  (function seedInitialDemo() {
    const hasSavedState = localStorage.getItem(STORAGE_KEY);
    if (hasSavedState) return;

    // Estado inicial amigável, alinhado ao mock do Hero (A023 em atendimento, 3 aguardando)
    state.current = 23;
    state.queue = [24, 25, 26];
    state.nextNumber = 27;
    saveState();
    render();
  })();
})();
