import { prisma } from './prisma.js';

export const TIME_ZONES = ['America/Noronha', 'America/Sao_Paulo', 'America/Fortaleza', 'America/Manaus', 'America/Rio_Branco'];

const formats = new Map();

function formatIn(timeZone, kind) {
  const key = `${kind}:${timeZone}`;
  if (!formats.has(key)) {
    formats.set(key, kind === 'day'
      ? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      : new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }));
  }
  return formats.get(key);
}

export const ACTIVE = ['WAITING', 'CALLED'];

export function today(timeZone, date = new Date()) {
  return formatIn(timeZone, 'day').format(date);
}

export function hourOf(timeZone, date) {
  return Number(formatIn(timeZone, 'hour').format(date));
}

export function formatCode(prefix, number) {
  return prefix + String(number).padStart(3, '0');
}

export function minutesBetween(start, end) {
  return (end.getTime() - start.getTime()) / 60000;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Tempo médio de atendimento do dia (da chamada ao fim). Com menos de 3
// atendimentos no dia, usa o tempo médio configurado pelo estabelecimento.
export async function serviceMinutes(establishment, day = today(establishment.timeZone)) {
  const done = await prisma.ticket.findMany({
    where: { establishmentId: establishment.id, day, status: 'DONE', calledAt: { not: null }, finishedAt: { not: null } },
    select: { calledAt: true, finishedAt: true },
  });
  const avg = average(done.map((t) => minutesBetween(t.calledAt, t.finishedAt)));
  if (done.length < 3 || avg === null) return establishment.avgMinutes;
  return Math.max(1, Math.round(avg));
}

// Senhas ativas do dia (aguardando ou em chamada), em ordem de chegada.
export function activeTickets(establishmentId, day) {
  return prisma.ticket.findMany({
    where: { establishmentId, day, status: { in: ['WAITING', 'CALLED'] } },
    orderBy: { number: 'asc' },
    include: { user: { select: { name: true } } },
  });
}

// Trava a linha do estabelecimento até o fim da transação, para que duas
// ações ao mesmo tempo (duas senhas emitidas, dois cliques em "chamar")
// não se atropelem.
export async function lockEstablishment(tx, id) {
  await tx.$queryRaw`SELECT id FROM "Establishment" WHERE id = ${id} FOR UPDATE`;
  return tx.establishment.findUnique({ where: { id } });
}

export function cancelWaiting(ticket) {
  return prisma.$transaction(async (tx) => {
    await lockEstablishment(tx, ticket.establishmentId);
    const { count } = await tx.ticket.updateMany({
      where: { id: ticket.id, status: 'WAITING' },
      data: { status: 'CANCELED', finishedAt: new Date() },
    });
    if (count) return null;
    const current = await tx.ticket.findUnique({ where: { id: ticket.id }, select: { status: true } });
    return current.status === 'CALLED' ? 'ticket already called' : 'ticket is not active';
  });
}

export async function issueTicket(tx, establishmentId, data) {
  const establishment = await lockEstablishment(tx, establishmentId);
  const day = today(establishment.timeZone);
  const number = establishment.numberingDay === day ? establishment.nextNumber : 1;
  await tx.establishment.update({ where: { id: establishmentId }, data: { nextNumber: number + 1, numberingDay: day } });
  return tx.ticket.create({
    data: { ...data, establishmentId, number, day, code: formatCode(establishment.prefix, number) },
  });
}

// Espera estimada: as pessoas na frente mais os atendimentos em andamento,
// divididos pelos guichês que atendem ao mesmo tempo.
export function estimateMinutes(ahead, busy, counters, avg) {
  return Math.round(((ahead + busy) / Math.max(1, counters)) * avg);
}

// Senhas em chamada, da chamada mais recente para a mais antiga.
export function byLastCall(tickets) {
  const when = (t) => (t.lastCallAt ?? t.calledAt ?? t.createdAt).getTime();
  return [...tickets].sort((a, b) => when(b) - when(a));
}
