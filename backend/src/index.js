import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import ticketRoutes from './routes/tickets.js';
import panelRoutes from './routes/panel.js';
import { authMiddleware, requireRole } from './middleware/auth.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET environment variable is not set.');
  process.exit(1);
}

const allowedOrigins = (process.env.CORS_ORIGIN || 'https://hriel123.github.io')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// As telas atualizam sozinhas a cada poucos segundos, e vários clientes podem
// estar no mesmo Wi-Fi (mesmo IP); o limite fica folgado e barra só abuso.
const pollLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '20kb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/auth', authRoutes);
app.use('/public', pollLimiter, publicRoutes);
app.use('/tickets', pollLimiter, authMiddleware, requireRole('CUSTOMER'), ticketRoutes);
app.use('/panel', pollLimiter, authMiddleware, requireRole('OWNER'), panelRoutes);

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload too large' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid json' });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'resource already exists' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'resource not found' });
    }
  }

  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
