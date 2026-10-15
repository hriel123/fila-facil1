import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { activeTickets, issueTicket, serviceMinutes, today } from '../lib/queue.js';

const router = Router();

const joinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many tickets, please try again later' },
});

const ACTIVE = ['WAITING', 'CALLED'];

// Senha do cliente com a posição na fila e a estimativa de espera.
async function customerView(ticket) {
  const day = today();
  const base = {
    id: ticket.id,
    code: ticket.code,
    status: ticket.day !== day && ACTIVE.includes(ticket.status) ? 'EXPIRED' : ticket.status,
    day: ticket.day,
    establishment: { code: ticket.establishment.code, name: ticket.establishment.name },
    callCount: ticket.callCount,
    createdAt: ticket.createdAt,
    calledAt: ticket.calledAt,
    finishedAt: ticket.finishedAt,
    ahead: null,
    waitMinutes: null,
    current: null,
  };
  if (base.status !== 'WAITING' && base.status !== 'CALLED') return base;

  const active = await activeTickets(ticket.establishmentId, day);
  const current = active.find((t) => t.status === 'CALLED') ?? null;
  base.current = current?.code ?? null;
  if (base.status === 'WAITING') {
    const avg = await serviceMinutes(ticket.establishment, day);
    base.ahead = active.filter((t) => t.status === 'WAITING' && t.number < ticket.number).length;
    base.waitMinutes = (base.ahead + (current ? 1 : 0)) * avg;
  }
  return base;
}

async function findOwnTicket(req, res) {
  const id = Number(req.params.id);
  const ticket = Number.isInteger(id)
    ? await prisma.ticket.findUnique({ where: { id }, include: { establishment: true } })
    : null;
  if (!ticket || ticket.userId !== req.userId) {
    res.status(404).json({ error: 'ticket not found' });
    return null;
  }
  return ticket;
}

router.get('/', async (req, res) => {
  const tickets = await prisma.ticket.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { establishment: true },
  });
  const views = await Promise.all(tickets.map(customerView));
  res.json({
    active: views.filter((t) => ACTIVE.includes(t.status)),
    history: views.filter((t) => !ACTIVE.includes(t.status)).slice(0, 10),
  });
});

router.get('/:id', async (req, res) => {
  const ticket = await findOwnTicket(req, res);
  if (ticket) res.json(await customerView(ticket));
});

router.post('/', joinLimiter, async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const establishment = code ? await prisma.establishment.findUnique({ where: { code } }) : null;
  if (!establishment) {
    return res.status(404).json({ error: 'establishment not found' });
  }
  if (!establishment.open) {
    return res.status(409).json({ error: 'queue closed' });
  }

  const ticket = await prisma.$transaction(async (tx) => {
    // Uma senha ativa por cliente em cada fila: se já tem, devolve a mesma.
    const existing = await tx.ticket.findFirst({
      where: { userId: req.userId, establishmentId: establishment.id, day: today(), status: { in: ACTIVE } },
    });
    if (existing) return existing;
    return issueTicket(tx, establishment.id, { userId: req.userId });
  });

  const full = await prisma.ticket.findUnique({ where: { id: ticket.id }, include: { establishment: true } });
  res.status(201).json(await customerView(full));
});

router.delete('/:id', async (req, res) => {
  const ticket = await findOwnTicket(req, res);
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

export default router;
