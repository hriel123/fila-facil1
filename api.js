/* =========================================================
   FilaFácil — api.js
   Acesso à API, sessão e som de chamada (usado por app.js e tv.js)
========================================================= */

const FF = (() => {
  "use strict";

  const base = (document.querySelector('meta[name="filafacil-api"]')?.content || "").trim().replace(/\/+$/, "");
  const TOKEN_KEY = "filafacil:token";

  const MESSAGES = {
    "invalid credentials": "E-mail ou senha incorretos.",
    "email already registered": "Este e-mail já tem conta. Use a aba \"Entrar\".",
    "invalid email format": "Digite um e-mail válido.",
    "password must be at least 6 characters long": "A senha precisa ter pelo menos 6 caracteres.",
    "businessName is required": "Digite o nome do estabelecimento.",
    "name, email and password are required": "Preencha nome, e-mail e senha.",
    "too many attempts, please try again later": "Muitas tentativas. Espere alguns minutos e tente de novo.",
    "too many tickets, please try again later": "Muitas senhas em pouco tempo. Espere alguns minutos.",
    "too many requests": "Muitas atualizações seguidas. Espere um instante.",
    "queue closed": "Esta fila não está recebendo senhas agora.",
    "establishment not found": "Não encontramos uma fila com esse código.",
    "ticket not found": "Senha não encontrada.",
    "ticket is not active": "Esta senha não está mais na fila.",
    "waiting ticket not found": "Essa senha já saiu da fila.",
    "forbidden for this account type": "Esta conta não tem acesso a esta área.",
    "invalid name": "O nome precisa ter pelo menos 2 letras.",
    "avgMinutes must be 1 to 120": "O tempo médio deve ficar entre 1 e 120 minutos.",
    "prefix must be one letter": "A letra da senha deve ser uma única letra.",
    "name is required": "Digite o seu nome.",
    "counters must be 1 to 20": "O número de guichês deve ficar entre 1 e 20.",
    "counter busy": "Um dos guichês que você quer tirar ainda está atendendo alguém. Finalize esse atendimento antes.",
    "email not configured": "A recuperação de senha por e-mail ainda não foi ativada.",
    "invalid or expired reset link": "Este link expirou ou já foi usado. Peça um novo em \"Esqueci minha senha\".",
    "token and password are required": "Digite a nova senha.",
    network: "Sem conexão com o servidor. Verifique a internet e tente de novo.",
  };

  class ApiError extends Error {
    constructor(status, code) {
      super(code);
      this.status = status;
      this.code = code;
    }
    get friendly() {
      return MESSAGES[this.code] || "Algo deu errado. Tente de novo.";
    }
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* navegador sem armazenamento: a sessão dura só esta aba */ }
  }

  async function request(path, { method = "GET", body, auth = true, timeout = 75000, headers: extra = {} } = {}) {
    const headers = { ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, "network");
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try { data = await res.json(); } catch { /* resposta sem corpo */ }
    if (!res.ok) {
      if (res.status === 401 && auth) setToken(null);
      throw new ApiError(res.status, data?.error || "error");
    }
    return data;
  }

  /* Som de chamada: dois toques ("blim-blom"). O navegador só libera som
     depois de um toque na tela, por isso unlockAudio() roda num clique. */
  let audio = null;

  function unlockAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    audio = audio || new Ctx();
    if (audio.state === "suspended") audio.resume();
    return true;
  }

  function audioReady() {
    return !!audio && audio.state === "running";
  }

  function chime() {
    if (!audio) return;
    const now = audio.currentTime;
    [[880, 0], [659, 0.38]].forEach(([freq, at]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.45, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.1);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 1.2);
    });
  }

  function link(page, code) {
    return new URL(`${page}?e=${encodeURIComponent(code)}`, location.href).href;
  }

  function qrSvg(text) {
    if (typeof window.qrcode !== "function") return null;
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 8, margin: 0 });
  }

  return { base, request, getToken, setToken, ApiError, unlockAudio, audioReady, chime, link, qrSvg };
})();
