import { prisma } from './prisma.js';

const TIME_ZONE = 'America/Fortaleza';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });

export const ACTIVE = ['WAITING', 'CALLED'];

export function today(date = new Date()) {
  return dayFormat.format(date);
}

export function hourOf(date) {
  return Number(hourFormat.format(date));
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
export async function serviceMinutes(establishment, day = today()) {
  const done = await prisma.ticket.findMany({
    where: { establishmentId: establishment.id, day, status: 'DONE', calledAt: { not: null }, finishedAt: { not: null } },
    select: { calledAt: true, finishedAt: true },
  });
  const avg = average(done.map((t) => minutesBetween(t.calledAt, t.finishedAt)));
  if (done.length < 3 || avg === null) return establishment.avgMinutes;
  return Math.max(1, Math.round(avg));
}

// Senhas ativas do dia (aguardando ou em chamada), em ordem de chegada.
export function activeTickets(establishmentId, day = today()) {
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

export async function issueTicket(tx, establishmentId, data) {
  const establishment = await lockEstablishment(tx, establishmentId);
  const day = today();
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
