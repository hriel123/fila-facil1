import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ACTIVE, issueTicket, today } from '../lib/queue.js';
import { customerView } from '../lib/views.js';
import { joinLimiter } from '../lib/limits.js';

const router = Router();

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
