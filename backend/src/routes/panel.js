import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { activeTickets, hourOf, issueTicket, lockEstablishment, minutesBetween, serviceMinutes, today } from '../lib/queue.js';

const router = Router();

const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

router.use(async (req, res, next) => {
  const establishment = await prisma.establishment.findUnique({ where: { ownerId: req.userId } });
  if (!establishment) {
    return res.status(404).json({ error: 'establishment not found' });
  }
  req.establishment = establishment;
  next();
});

function round1(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function panelTicket(ticket) {
  return {
    id: ticket.id,
    code: ticket.code,
    name: ticket.user?.name ?? ticket.guestName ?? null,
    walkIn: ticket.userId === null,
    status: ticket.status,
    createdAt: ticket.createdAt,
    calledAt: ticket.calledAt,
    finishedAt: ticket.finishedAt,
    callCount: ticket.callCount,
  };
}

async function panelState(establishment) {
  const day = today();
  const [active, finished, avg] = await Promise.all([
    activeTickets(establishment.id, day),
    prisma.ticket.findMany({
      where: { establishmentId: establishment.id, day, status: { in: ['DONE', 'NO_SHOW'] } },
      orderBy: { finishedAt: 'desc' },
      include: { user: { select: { name: true } } },
    }),
    serviceMinutes(establishment, day),
  ]);
  const current = active.find((t) => t.status === 'CALLED') ?? null;
  const waiting = active.filter((t) => t.status === 'WAITING');
  const called = [...finished, ...(current ? [current] : [])].filter((t) => t.calledAt);
  const services = finished.filter((t) => t.status === 'DONE' && t.calledAt && t.finishedAt);

  return {
    establishment: {
      code: establishment.code,
      name: establishment.name,
      prefix: establishment.prefix,
      avgMinutes: establishment.avgMinutes,
      open: establishment.open,
    },
    current: current ? panelTicket(current) : null,
    waiting: waiting.map(panelTicket),
    recent: finished.slice(0, 5).map(panelTicket),
    stats: {
      waiting: waiting.length,
      done: finished.filter((t) => t.status === 'DONE').length,
      noShow: finished.filter((t) => t.status === 'NO_SHOW').length,
      avgWait: round1(average(called.map((t) => minutesBetween(t.createdAt, t.calledAt)))),
      avgService: round1(average(services.map((t) => minutesBetween(t.calledAt, t.finishedAt)))),
      estimateMinutes: avg,
    },
  };
}

// Executa uma ação com a fila travada e devolve o painel atualizado.
async function act(req, res, action) {
  await prisma.$transaction(async (tx) => {
    await lockEstablishment(tx, req.establishment.id);
    await action(tx, today(), new Date());
  });
  const establishment = await prisma.establishment.findUnique({ where: { id: req.establishment.id } });
  res.json(await panelState(establishment));
}

function closeCurrent(tx, establishmentId, day, now, status) {
  return tx.ticket.updateMany({
    where: { establishmentId, day, status: 'CALLED' },
    data: { status, finishedAt: now },
  });
}

router.get('/', async (req, res) => {
  res.json(await panelState(req.establishment));
});

// Finaliza quem está sendo atendido (se houver) e chama a próxima senha.
router.post('/next', (req, res) =>
  act(req, res, async (tx, day, now) => {
    const id = req.establishment.id;
    await closeCurrent(tx, id, day, now, 'DONE');
    const next = await tx.ticket.findFirst({ where: { establishmentId: id, day, status: 'WAITING' }, orderBy: { number: 'asc' } });
    if (next) {
      await tx.ticket.update({ where: { id: next.id }, data: { status: 'CALLED', calledAt: now, callCount: 1 } });
    }
  }));

router.post('/recall', (req, res) =>
  act(req, res, (tx, day) =>
    tx.ticket.updateMany({
      where: { establishmentId: req.establishment.id, day, status: 'CALLED' },
      data: { callCount: { increment: 1 } },
    })));

router.post('/finish', (req, res) =>
  act(req, res, (tx, day, now) => closeCurrent(tx, req.establishment.id, day, now, 'DONE')));

router.post('/no-show', (req, res) =>
  act(req, res, (tx, day, now) => closeCurrent(tx, req.establishment.id, day, now, 'NO_SHOW')));

// Senha avulsa, para quem chega sem celular ou sem conta.
router.post('/tickets', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  await prisma.$transaction((tx) => issueTicket(tx, req.establishment.id, { guestName: name || null }));
  res.status(201).json(await panelState(req.establishment));
});

router.delete('/tickets/:id', async (req, res) => {
  const id = Number(req.params.id);
  const result = Number.isInteger(id)
    ? await prisma.ticket.updateMany({
        where: { id, establishmentId: req.establishment.id, status: 'WAITING' },
        data: { status: 'CANCELED', finishedAt: new Date() },
      })
    : { count: 0 };
  if (result.count === 0) {
    return res.status(404).json({ error: 'waiting ticket not found' });
  }
  res.json(await panelState(req.establishment));
});

router.patch('/settings', async (req, res) => {
  const { name, avgMinutes, open, prefix } = req.body ?? {};
  const data = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) return res.status(400).json({ error: 'invalid name' });
    data.name = name.trim().slice(0, 60);
  }
  if (avgMinutes !== undefined) {
    if (!Number.isInteger(avgMinutes) || avgMinutes < 1 || avgMinutes > 120) return res.status(400).json({ error: 'avgMinutes must be 1 to 120' });
    data.avgMinutes = avgMinutes;
  }
  if (open !== undefined) {
    if (typeof open !== 'boolean') return res.status(400).json({ error: 'open must be boolean' });
    data.open = open;
  }
  if (prefix !== undefined) {
    if (typeof prefix !== 'string' || !/^[A-Za-z]$/.test(prefix)) return res.status(400).json({ error: 'prefix must be one letter' });
    data.prefix = prefix.toUpperCase();
  }

  const establishment = await prisma.establishment.update({ where: { id: req.establishment.id }, data });
  res.json(await panelState(establishment));
});

router.get('/report', async (req, res) => {
  const day = DAY_REGEX.test(String(req.query.day ?? '')) ? String(req.query.day) : today();
  const isToday = day === today();
  const tickets = await prisma.ticket.findMany({
    where: { establishmentId: req.establishment.id, day },
    orderBy: { number: 'asc' },
    include: { user: { select: { name: true } } },
  });

  const rows = tickets.map((t) => ({
    ...panelTicket(t),
    status: !isToday && (t.status === 'WAITING' || t.status === 'CALLED') ? 'EXPIRED' : t.status,
    waitMinutes: t.calledAt ? round1(minutesBetween(t.createdAt, t.calledAt)) : null,
    serviceMinutes: t.status === 'DONE' && t.calledAt && t.finishedAt ? round1(minutesBetween(t.calledAt, t.finishedAt)) : null,
  }));
  const waits = rows.filter((r) => r.waitMinutes !== null).map((r) => r.waitMinutes);
  const services = rows.filter((r) => r.serviceMinutes !== null).map((r) => r.serviceMinutes);

  const counts = new Map();
  for (const t of tickets) {
    const hour = hourOf(t.createdAt);
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  const hours = [...counts.keys()];
  const byHour = [];
  if (hours.length) {
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) byHour.push({ hour: h, issued: counts.get(h) ?? 0 });
  }

  res.json({
    day,
    issued: rows.length,
    done: rows.filter((r) => r.status === 'DONE').length,
    noShow: rows.filter((r) => r.status === 'NO_SHOW').length,
    canceled: rows.filter((r) => r.status === 'CANCELED').length,
    avgWait: round1(average(waits)),
    maxWait: waits.length ? Math.max(...waits) : null,
    avgService: round1(average(services)),
    byHour,
    tickets: rows,
  });
});

export default router;
