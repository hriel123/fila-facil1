/* =========================================================
   FilaFácil — demo.js
   Modo visitante: responde às rotas do painel e da TV com uma
   barbearia de exemplo guardada só neste navegador.
========================================================= */

const FFDemo = (() => {
  "use strict";

  const TOKEN = "demo";
  const CODE = "DEMO1";
  const KEY = "filafacil:demo";
  const NAMES = ["Rita Gomes", "João Pedro", "Camila Rocha", "Diego Santos", "Larissa Melo", "Paulo Sérgio", "Beatriz Nunes", "Felipe Araújo", "Sandra Reis", "Vinícius Lima"];
  const MIN = 60000;

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function lsSet(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* sem armazenamento: a demonstração vale só nesta aba */ }
  }

  function active() {
    return lsGet("filafacil:token") === TOKEN;
  }

  function dayOf(date) {
    return new Date(date).toLocaleDateString("en-CA");
  }

  function code(prefix, number) {
    return prefix + String(number).padStart(3, "0");
  }

  function iso(ms) {
    return ms === null ? null : new Date(ms).toISOString();
  }

  // Um dia de barbearia: atendidas, uma que não veio, uma desistência,
  // dois guichês chamando e quatro pessoas aguardando.
  function seed() {
    const now = Date.now();
    const rows = [
      ["Carlos Mendes", false, "DONE", 1, -150, -148, -132],
      ["Fernanda Lima", false, "DONE", 2, -145, -140, -122],
      [null, true, "DONE", 1, -138, -131, -115],
      ["Rafael Costa", false, "NO_SHOW", 2, -130, -121, -118],
      ["Bruna Alves", false, "DONE", 2, -125, -117, -100],
      ["Luana Prado", false, "CANCELED", null, -110, null, -90],
      ["Thiago Lopes", false, "DONE", 1, -104, -96, -79],
      ["Lucas Freitas", false, "CALLED", 2, -70, -6, null],
      ["Ana Clara", false, "CALLED", 1, -58, -9, null],
      ["Pedro Henrique", false, "WAITING", null, -38, null, null],
      ["Seu Antônio", false, "WAITING", null, -24, null, null],
      ["Juliana Reis", true, "WAITING", null, -15, null, null],
      ["Mariana Souza", false, "WAITING", null, -4, null, null],
    ];
    const tickets = rows.map(([name, walkIn, status, counter, created, called, finished], i) => ({
      id: i + 1,
      number: i + 1,
      code: code("A", i + 1),
      name,
      walkIn,
      status,
      counter,
      createdAt: now + created * MIN,
      calledAt: called === null ? null : now + called * MIN,
      lastCallAt: called === null ? null : now + called * MIN,
      finishedAt: finished === null ? null : now + finished * MIN,
      callCount: called === null ? 0 : 1,
    }));
    return {
      est: { code: CODE, name: "Barbearia do Zé", prefix: "A", avgMinutes: 15, counters: 2, open: true },
      day: dayOf(now),
      tickets,
      nextId: tickets.length + 1,
      nextNumber: tickets.length + 1,
      lastArrival: now,
      nameIndex: 0,
    };
  }

  function load() {
    try {
      const data = JSON.parse(lsGet(KEY));
      if (data && data.est && Array.isArray(data.tickets)) return data;
    } catch { /* dados corrompidos: recomeça do exemplo */ }
    return null;
  }

  function save(data) {
    lsSet(KEY, JSON.stringify(data));
  }

  function start() {
    save(seed());
    lsSet("filafacil:token", TOKEN);
  }

  function clear() {
    lsSet(KEY, null);
  }

  function handles(path) {
    const route = path.split("?")[0];
    if (route === `/public/${CODE}`) return !!load();
    return active() && (route === "/auth/me" || route === "/panel" || route.startsWith("/panel/"));
  }

  function fail(status, codeText) {
    const err = new Error(codeText);
    err.status = status;
    err.code = codeText;
    throw err;
  }

  function round1(value) {
    return value === null ? null : Math.round(value * 10) / 10;
  }

  function average(values) {
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  }

  function minutes(a, b) {
    return (b - a) / MIN;
  }

  // Numeração e senhas recomeçam todo dia, como no servidor.
  function rollDay(data, now) {
    const today = dayOf(now);
    if (data.day === today) return;
    const fresh = seed();
    Object.assign(data, { day: today, tickets: fresh.tickets, nextId: fresh.nextId, nextNumber: fresh.nextNumber, lastArrival: now });
  }

  // Um cliente novo chega de vez em quando, para a fila não esvaziar.
  function arrivals(data, now) {
    const waiting = data.tickets.filter((t) => t.status === "WAITING").length;
    if (!data.est.open || waiting >= 5 || now - data.lastArrival < 50000) return;
    issue(data, NAMES[data.nameIndex % NAMES.length], false, now);
    data.nameIndex += 1;
    data.lastArrival = now;
  }

  function issue(data, name, walkIn, now) {
    const number = data.nextNumber++;
    data.tickets.push({
      id: data.nextId++, number, code: code(data.est.prefix, number), name, walkIn, status: "WAITING", counter: null,
      createdAt: now, calledAt: null, lastCallAt: null, finishedAt: null, callCount: 0,
    });
  }

  function serviceAvg(data) {
    const done = data.tickets.filter((t) => t.status === "DONE" && t.calledAt && t.finishedAt);
    const avg = average(done.map((t) => minutes(t.calledAt, t.finishedAt)));
    if (done.length < 3 || avg === null) return data.est.avgMinutes;
    return Math.max(1, Math.round(avg));
  }

  function byLastCall(list) {
    const when = (t) => t.lastCallAt ?? t.calledAt ?? t.createdAt;
    return [...list].sort((a, b) => when(b) - when(a));
  }

  function panelTicket(t) {
    return {
      id: t.id, code: t.code, name: t.name, walkIn: t.walkIn, counter: t.counter, status: t.status,
      createdAt: iso(t.createdAt), calledAt: iso(t.calledAt), finishedAt: iso(t.finishedAt), callCount: t.callCount,
    };
  }

  function counterOf(data, body, query) {
    const value = Number(body?.counter ?? query.get("counter"));
    return Number.isInteger(value) ? Math.min(Math.max(value, 1), data.est.counters) : 1;
  }

  function panelState(data, counter) {
    const byNumber = (a, b) => a.number - b.number;
    const activeList = data.tickets.filter((t) => t.status === "WAITING" || t.status === "CALLED").sort(byNumber);
    const finished = data.tickets.filter((t) => t.status === "DONE" || t.status === "NO_SHOW").sort((a, b) => b.finishedAt - a.finishedAt);
    const calling = activeList.filter((t) => t.status === "CALLED");
    const current = calling.find((t) => (t.counter ?? 1) === counter) ?? null;
    const waiting = activeList.filter((t) => t.status === "WAITING");
    const called = [...finished, ...calling].filter((t) => t.calledAt);
    const services = finished.filter((t) => t.status === "DONE" && t.calledAt && t.finishedAt);
    return {
      establishment: { ...data.est },
      counter,
      current: current ? panelTicket(current) : null,
      others: byLastCall(calling.filter((t) => t !== current)).map(panelTicket),
      waiting: waiting.map(panelTicket),
      recent: finished.slice(0, 5).map(panelTicket),
      stats: {
        waiting: waiting.length,
        done: finished.filter((t) => t.status === "DONE").length,
        noShow: finished.filter((t) => t.status === "NO_SHOW").length,
        avgWait: round1(average(called.map((t) => minutes(t.createdAt, t.calledAt)))),
        avgService: round1(average(services.map((t) => minutes(t.calledAt, t.finishedAt)))),
        estimateMinutes: serviceAvg(data),
      },
    };
  }

  function publicState(data) {
    const activeList = data.tickets.filter((t) => t.status === "WAITING" || t.status === "CALLED");
    const finishedCalls = data.tickets
      .filter((t) => (t.status === "DONE" || t.status === "NO_SHOW") && t.calledAt)
      .sort((a, b) => b.calledAt - a.calledAt)
      .slice(0, 5);
    const called = byLastCall(activeList.filter((t) => t.status === "CALLED"));
    const current = called[0] ?? null;
    const recent = byLastCall([...called.slice(1), ...finishedCalls]).slice(0, 4);
    return {
      code: data.est.code,
      name: data.est.name,
      open: data.est.open,
      counters: data.est.counters,
      waiting: activeList.filter((t) => t.status === "WAITING").length,
      avgMinutes: serviceAvg(data),
      current: current ? { code: current.code, counter: current.counter, callId: `${current.id}-${current.callCount}` } : null,
      calling: [...called].sort((a, b) => (a.counter ?? 1) - (b.counter ?? 1)).map((t) => ({ code: t.code, counter: t.counter })),
      recent: recent.map((t) => ({ code: t.code, counter: t.counter })),
    };
  }

  // Dias anteriores: um movimento parecido, sempre igual para a mesma data.
  function pastDay(day) {
    let seedValue = [...day].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 233280, 7);
    const rnd = () => { seedValue = (seedValue * 9301 + 49297) % 233280; return seedValue / 233280; };
    const tickets = [];
    const start = new Date(`${day}T08:00:00`).getTime();
    const total = 12 + Math.floor(rnd() * 10);
    let clock = start;
    const free = [start, start];
    for (let i = 0; i < total; i++) {
      clock += (20 + rnd() * 25) * MIN;
      const counter = free[0] <= free[1] ? 1 : 2;
      const calledAt = Math.max(clock, free[counter - 1]) + rnd() * 6 * MIN;
      const roll = rnd();
      const status = roll < 0.08 ? "NO_SHOW" : roll < 0.14 ? "CANCELED" : "DONE";
      const finishedAt = status === "DONE" ? calledAt + (10 + rnd() * 12) * MIN : status === "NO_SHOW" ? calledAt + 3 * MIN : clock + 20 * MIN;
      if (status !== "CANCELED") free[counter - 1] = finishedAt;
      tickets.push({
        id: 10000 + i, number: i + 1, code: code("A", i + 1), name: NAMES[i % NAMES.length], walkIn: rnd() < 0.15,
        status, counter: status === "CANCELED" ? null : counter, createdAt: clock,
        calledAt: status === "CANCELED" ? null : calledAt, lastCallAt: null, finishedAt, callCount: status === "CANCELED" ? 0 : 1,
      });
    }
    return tickets;
  }

  function report(data, day) {
    const today = dayOf(Date.now());
    const oldest = dayOf(Date.now() - 60 * 24 * 60 * MIN);
    const tickets = day === today ? [...data.tickets].sort((a, b) => a.number - b.number) : day < today && day >= oldest ? pastDay(day) : [];
    const isToday = day === today;
    const rows = tickets.map((t) => ({
      ...panelTicket(t),
      status: !isToday && (t.status === "WAITING" || t.status === "CALLED") ? "EXPIRED" : t.status,
      waitMinutes: t.calledAt ? round1(minutes(t.createdAt, t.calledAt)) : null,
      serviceMinutes: t.status === "DONE" && t.calledAt && t.finishedAt ? round1(minutes(t.calledAt, t.finishedAt)) : null,
    }));
    const waits = rows.filter((r) => r.waitMinutes !== null).map((r) => r.waitMinutes);
    const services = rows.filter((r) => r.serviceMinutes !== null).map((r) => r.serviceMinutes);
    const counts = new Map();
    for (const t of tickets) {
      const hour = new Date(t.createdAt).getHours();
      counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }
    const hours = [...counts.keys()];
    const byHour = [];
    if (hours.length) {
      for (let h = Math.min(...hours); h <= Math.max(...hours); h++) byHour.push({ hour: h, issued: counts.get(h) ?? 0 });
    }
    return {
      day,
      issued: rows.length,
      done: rows.filter((r) => r.status === "DONE").length,
      noShow: rows.filter((r) => r.status === "NO_SHOW").length,
      canceled: rows.filter((r) => r.status === "CANCELED").length,
      avgWait: round1(average(waits)),
      maxWait: waits.length ? Math.max(...waits) : null,
      avgService: round1(average(services)),
      byHour,
      tickets: rows,
    };
  }

  function closeCurrent(data, counter, status, now) {
    data.tickets.forEach((t) => {
      if (t.status === "CALLED" && t.counter === counter) {
        t.status = status;
        t.finishedAt = now;
      }
    });
  }

  function settings(data, body) {
    const { name, avgMinutes, open, prefix, counters } = body ?? {};
    const next = { ...data.est };
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) fail(400, "invalid name");
      next.name = name.trim().slice(0, 60);
    }
    if (avgMinutes !== undefined) {
      if (!Number.isInteger(avgMinutes) || avgMinutes < 1 || avgMinutes > 120) fail(400, "avgMinutes must be 1 to 120");
      next.avgMinutes = avgMinutes;
    }
    if (open !== undefined) next.open = !!open;
    if (prefix !== undefined) {
      if (typeof prefix !== "string" || !/^[A-Za-z]$/.test(prefix)) fail(400, "prefix must be one letter");
      next.prefix = prefix.toUpperCase();
    }
    if (counters !== undefined) {
      if (!Number.isInteger(counters) || counters < 1 || counters > 20) fail(400, "counters must be 1 to 20");
      if (data.tickets.some((t) => t.status === "CALLED" && t.counter > counters)) fail(409, "counter busy");
      next.counters = counters;
    }
    data.est = next;
  }

  function request(path, { method = "GET", body } = {}) {
    const data = load();
    if (!data) fail(404, "establishment not found");
    const now = Date.now();
    const [route, search = ""] = path.split("?");
    const query = new URLSearchParams(search);
    rollDay(data, now);
    arrivals(data, now);

    let result;
    if (route === `/public/${CODE}`) {
      result = publicState(data);
    } else if (route === "/auth/me") {
      const e = data.est;
      result = { user: { id: 0, name: "Visitante", email: "visitante@filafacil.app", role: "OWNER", establishment: { code: e.code, name: e.name, prefix: e.prefix, avgMinutes: e.avgMinutes, open: e.open } } };
    } else if (route === "/panel/report") {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(query.get("day") || "") ? query.get("day") : dayOf(now);
      result = report(data, day);
    } else {
      let counter = counterOf(data, body, query);
      if (route === "/panel/next") {
        closeCurrent(data, counter, "DONE", now);
        const next = data.tickets.filter((t) => t.status === "WAITING").sort((a, b) => a.number - b.number)[0];
        if (next) Object.assign(next, { status: "CALLED", counter, calledAt: now, lastCallAt: now, callCount: 1 });
      } else if (route === "/panel/recall") {
        data.tickets.forEach((t) => {
          if (t.status === "CALLED" && t.counter === counter) {
            t.callCount += 1;
            t.lastCallAt = now;
          }
        });
      } else if (route === "/panel/finish") {
        closeCurrent(data, counter, "DONE", now);
      } else if (route === "/panel/no-show") {
        closeCurrent(data, counter, "NO_SHOW", now);
      } else if (route === "/panel/tickets" && method === "POST") {
        const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
        issue(data, name || null, true, now);
      } else if (route.startsWith("/panel/tickets/") && method === "DELETE") {
        const t = data.tickets.find((x) => x.id === Number(route.split("/").pop()) && x.status === "WAITING");
        if (!t) fail(404, "waiting ticket not found");
        t.status = "CANCELED";
        t.finishedAt = now;
      } else if (route === "/panel/settings") {
        settings(data, body);
        counter = Math.min(counter, data.est.counters);
      } else if (route !== "/panel") {
        fail(404, "not found");
      }
      result = panelState(data, counter);
    }

    save(data);
    return JSON.parse(JSON.stringify(result));
  }

  return { CODE, active, start, clear, handles, request };
})();
