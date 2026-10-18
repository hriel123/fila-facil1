/* =========================================================
   FilaFácil — tv.js
   Tela de chamada para TV ou monitor da sala de espera
========================================================= */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const code = (new URLSearchParams(location.search).get("e") || "").trim().toUpperCase();

  let lastCallId;      // undefined até a primeira leitura (não toca ao abrir a tela)
  let qrDone = false;
  let flashTimer = null;

  function tick() {
    $("tvClock").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  tick();
  setInterval(tick, 5000);

  function speak(ticketCode, counter) {
    if (!("speechSynthesis" in window)) return;
    const match = ticketCode.match(/^([A-Z])(\d+)$/);
    let text = match ? `Senha ${match[1]}, ${Number(match[2])}` : `Senha ${ticketCode}`;
    if (counter) text += `, guichê ${counter}`;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "pt-BR";
    const voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith("pt"));
    if (voice) utter.voice = voice;
    utter.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }

  function announce(ticketCode, counter) {
    const now = $("tvNow");
    now.classList.remove("is-calling");
    void now.offsetWidth;
    now.classList.add("is-calling");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => now.classList.remove("is-calling"), 6000);
    FF.chime();
    setTimeout(() => speak(ticketCode, counter), 1300);
  }

  function render(f) {
    $("tvName").textContent = f.name;
    document.title = `${f.name} · FilaFácil`;
    const counterOf = (c) => (f.counters > 1 && c ? c : null);
    const counter = f.current ? counterOf(f.current.counter) : null;
    $("tvCode").textContent = f.current ? f.current.code : "—";
    $("tvCounter").hidden = !counter;
    $("tvCounter").textContent = counter ? `Guichê ${counter}` : "";
    $("tvHint").textContent = f.current ? "Dirija-se ao atendimento" : "Aguardando a próxima chamada";
    $("tvWaiting").textContent = String(f.waiting);

    const list = $("tvRecent");
    list.replaceChildren();
    if (!f.recent.length) {
      const li = document.createElement("li");
      li.className = "is-empty";
      li.textContent = "Nenhuma ainda hoje";
      list.append(li);
    }
    f.recent.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r.code;
      const c = counterOf(r.counter);
      if (c) {
        const small = document.createElement("small");
        small.textContent = `Guichê ${c}`;
        li.append(small);
      }
      list.append(li);
    });

    $("tvQr").hidden = !f.open;
    $("tvJoinTitle").textContent = f.open ? "Pegue sua senha pelo celular" : "Fila fechada para novas senhas";
    $("tvJoinText").hidden = !f.open;
    if (f.open && !qrDone) {
      const svg = FF.qrSvg(FF.link("app.html", f.code));
      if (svg) {
        $("tvQr").innerHTML = svg;
        qrDone = true;
      } else {
        $("tvQr").hidden = true;
      }
    }

    const callId = f.current ? f.current.callId : null;
    if (lastCallId !== undefined && callId && callId !== lastCallId) announce(f.current.code, counter);
    lastCallId = callId;
  }

  async function refresh() {
    try {
      render(await FF.request(`/public/${encodeURIComponent(code)}`, { auth: false, timeout: 20000 }));
      $("tvStatus").hidden = true;
    } catch (err) {
      if (err.status === 404) {
        $("tvName").textContent = "Fila não encontrada";
        $("tvHint").textContent = "Abra esta tela pelo botão \"Tela da TV\" no painel.";
        return;
      }
      $("tvStatus").hidden = false;
    }
  }

  $("btnStart").addEventListener("click", () => {
    FF.unlockAudio();
    if ("speechSynthesis" in window) speechSynthesis.getVoices();
    const root = document.documentElement;
    if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    $("tvStart").hidden = true;
  });

  if (!code || !FF.base) {
    $("tvName").textContent = "Tela de chamada";
    $("tvHint").textContent = "Abra esta tela pelo botão \"Tela da TV\" no painel do estabelecimento.";
    $("tvStart").hidden = true;
    return;
  }

  refresh();
  setInterval(refresh, 3000);
})();
