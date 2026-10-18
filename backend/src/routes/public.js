import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { ACTIVE, activeTickets, byLastCall, issueTicket, serviceMinutes, today } from '../lib/queue.js';
import { customerView } from '../lib/views.js';
import { joinLimiter } from '../lib/limits.js';

const router = Router();

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Senha pega sem conta: quem tem a chave (guardada só no celular que pegou
// a senha) pode acompanhar e sair da fila. No banco fica só o hash da chave.
async function findGuestTicket(req, res) {
  const id = Number(req.params.id);
  const key = req.get('X-Ticket-Key') || '';
  const ticket = Number.isInteger(id) && key
    ? await prisma.ticket.findUnique({ where: { id }, include: { establishment: true } })
    : null;
  const valid = ticket?.guestKeyHash
    && crypto.timingSafeEqual(Buffer.from(ticket.guestKeyHash), Buffer.from(hashKey(key)));
  if (!valid) {
    res.status(404).json({ error: 'ticket not found' });
    return null;
  }
  return ticket;
}

router.get('/tickets/:id', async (req, res) => {
  const ticket = await findGuestTicket(req, res);
  if (ticket) res.json(await customerView(ticket));
});

router.delete('/tickets/:id', async (req, res) => {
  const ticket = await findGuestTicket(req, res);
  if (!ticket) return;
  if (!ACTIVE.includes(ticket.status)) {
    return res.status(409).json({ error: 'ticket is not active' });
  }
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'CANCELED', finishedAt: new Date() },
    include: { establishment: true },
  });
  res.json(await customerView(updated));
});

// Dados públicos de uma fila (página de entrar na fila e tela da TV).
// Só mostra códigos de senha, guichês e contagens, nunca nomes de clientes.
router.get('/:code', async (req, res) => {
  const establishment = await prisma.establishment.findUnique({ where: { code: String(req.params.code).toUpperCase() } });
  if (!establishment) {
    return res.status(404).json({ error: 'establishment not found' });
  }

  const day = today();
  const [active, finishedCalls, avg] = await Promise.all([
    activeTickets(establishment.id, day),
    prisma.ticket.findMany({
      where: { establishmentId: establishment.id, day, status: { in: ['DONE', 'NO_SHOW'] }, calledAt: { not: null } },
      orderBy: { calledAt: 'desc' },
      take: 5,
    }),
    serviceMinutes(establishment, day),
  ]);
  const called = byLastCall(active.filter((t) => t.status === 'CALLED'));
  const current = called[0] ?? null;
  const recent = byLastCall([...called.slice(1), ...finishedCalls]).slice(0, 4);

  res.json({
    code: establishment.code,
    name: establishment.name,
    open: establishment.open,
    counters: establishment.counters,
    waiting: active.filter((t) => t.status === 'WAITING').length,
    avgMinutes: avg,
    current: current ? { code: current.code, counter: current.counter, callId: `${current.id}-${current.callCount}` } : null,
    calling: [...called].sort((a, b) => (a.counter ?? 1) - (b.counter ?? 1)).map((t) => ({ code: t.code, counter: t.counter })),
    recent: recent.map((t) => ({ code: t.code, counter: t.counter })),
  });
});

router.post('/:code/tickets', joinLimiter, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  if (name.length < 2) {
    return res.status(400).json({ error: 'name is required' });
  }
  const establishment = await prisma.establishment.findUnique({ where: { code: String(req.params.code).toUpperCase() } });
  if (!establishment) {
    return res.status(404).json({ error: 'establishment not found' });
  }
  if (!establishment.open) {
    return res.status(409).json({ error: 'queue closed' });
  }

  const key = crypto.randomBytes(24).toString('base64url');
  const ticket = await prisma.$transaction((tx) => issueTicket(tx, establishment.id, { guestName: name, guestKeyHash: hashKey(key) }));
  const full = await prisma.ticket.findUnique({ where: { id: ticket.id }, include: { establishment: true } });
  res.status(201).json({ key, ticket: await customerView(full) });
});

export default router;
