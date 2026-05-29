import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Non authentifié' });

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
    const { rows } = await pool.query(
      'SELECT id, email, username, role, is_banned FROM users WHERE id = $1',
      [payload.userId]
    );

    if (!rows[0]) return res.status(401).json({ error: 'Utilisateur introuvable' });
    if (rows[0].is_banned) return res.status(403).json({ error: 'Compte banni' });

    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

export function optionalAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
    req.userId = payload.userId;
    req.userRole = payload.role;
  } catch {}
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  };
}
