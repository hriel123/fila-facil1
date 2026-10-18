import { ACTIVE, activeTickets, byLastCall, estimateMinutes, serviceMinutes, today } from './queue.js';

// Senha do cliente (com ou sem conta) com a posição na fila, o guichê e a
// estimativa de espera.
export async function customerView(ticket) {
  const day = today();
  const base = {
    id: ticket.id,
    code: ticket.code,
    status: ticket.day !== day && ACTIVE.includes(ticket.status) ? 'EXPIRED' : ticket.status,
    day: ticket.day,
    establishment: { code: ticket.establishment.code, name: ticket.establishment.name },
    counters: ticket.establishment.counters,
    counter: ticket.counter,
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
  const called = byLastCall(active.filter((t) => t.status === 'CALLED'));
  base.current = called[0]?.code ?? null;
  if (base.status === 'WAITING') {
    const avg = await serviceMinutes(ticket.establishment, day);
    base.ahead = active.filter((t) => t.status === 'WAITING' && t.number < ticket.number).length;
    base.waitMinutes = estimateMinutes(base.ahead, called.length, ticket.establishment.counters, avg);
  }
  return base;
}
