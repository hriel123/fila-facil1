import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { activeTickets, serviceMinutes, today } from '../lib/queue.js';

const router = Router();

// Dados públicos de uma fila (página de entrar na fila e tela da TV).
// Só mostra códigos de senha e contagens, nunca nomes de clientes.
router.get('/:code', async (req, res) => {
  const establishment = await prisma.establishment.findUnique({ where: { code: String(req.params.code).toUpperCase() } });
  if (!establishment) {
    return res.status(404).json({ error: 'establishment not found' });
  }

  const day = today();
  const [active, recent, avg] = await Promise.all([
    activeTickets(establishment.id, day),
    prisma.ticket.findMany({
      where: { establishmentId: establishment.id, day, status: { in: ['DONE', 'NO_SHOW'] }, calledAt: { not: null } },
      orderBy: { calledAt: 'desc' },
      take: 4,
      select: { code: true },
    }),
    serviceMinutes(establishment, day),
  ]);
  const current = active.find((t) => t.status === 'CALLED') ?? null;
  const waiting = active.filter((t) => t.status === 'WAITING').length;

  res.json({
    code: establishment.code,
    name: establishment.name,
    open: establishment.open,
    waiting,
    avgMinutes: avg,
    current: current ? { code: current.code, callId: `${current.id}-${current.callCount}` } : null,
    recent: recent.map((t) => t.code),
  });
});

export default router;
