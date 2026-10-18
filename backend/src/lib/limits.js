import rateLimit from 'express-rate-limit';

// Senhas pegas por IP (com ou sem conta), para barrar quem tenta lotar a fila.
export const joinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many tickets, please try again later' },
});
