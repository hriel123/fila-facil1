import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Used in place of a real password hash when no user is found, so login takes
// the same time whether or not the email is registered (avoids leaking
// account existence via response timing).
const DUMMY_HASH = bcrypt.hashSync('filafacil-timing-defense', 10);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Código curto do estabelecimento (vai no link e no QR code). Sem 0/O e 1/I
// para não confundir quem digita.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, please try again later' },
});

function newCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

function signToken(user) {
  return jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  const establishment = user.establishment
    ? {
        code: user.establishment.code,
        name: user.establishment.name,
        prefix: user.establishment.prefix,
        avgMinutes: user.establishment.avgMinutes,
        open: user.establishment.open,
      }
    : null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, establishment };
}

router.post('/register', authLimiter, async (req, res) => {
  const { name, email, password, role, businessName } = req.body ?? {};

  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !name.trim() || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }

  if (role !== 'OWNER' && role !== 'CUSTOMER') {
    return res.status(400).json({ error: 'role must be OWNER or CUSTOMER' });
  }

  if (role === 'OWNER' && (typeof businessName !== 'string' || businessName.trim().length < 2)) {
    return res.status(400).json({ error: 'businessName is required' });
  }

  if (!EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ error: 'invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters long' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(409).json({ error: 'email already registered' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const userData = { name: name.trim().slice(0, 80), email: normalizedEmail, password: hashedPassword, role };

  let user;
  if (role === 'OWNER') {
    for (let attempt = 0; attempt < 5 && !user; attempt++) {
      const code = newCode();
      if (await prisma.establishment.findUnique({ where: { code } })) continue;
      user = await prisma.user.create({
        data: { ...userData, establishment: { create: { code, name: businessName.trim().slice(0, 60) } } },
        include: { establishment: true },
      });
    }
    if (!user) throw new Error('could not generate a unique establishment code');
  } else {
    user = await prisma.user.create({ data: userData, include: { establishment: true } });
  }

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { establishment: true },
  });
  const validPassword = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !validPassword) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { establishment: true } });
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }

  res.json({ user: publicUser(user) });
});

export default router;
