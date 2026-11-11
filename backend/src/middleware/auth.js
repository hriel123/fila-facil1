import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'missing authorization token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { tokenVersion: true } });
  if (!user || user.tokenVersion !== (payload.tokenVersion ?? 0)) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }

  req.userId = payload.userId;
  req.role = payload.role;
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.role !== role) {
      return res.status(403).json({ error: 'forbidden for this account type' });
    }
    next();
  };
}
