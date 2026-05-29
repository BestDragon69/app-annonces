import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Toutes les routes nécessitent au moins le rôle modérateur
router.use(requireAuth, requireRole('moderator', 'admin'));

// GET /api/moderation/stats — statistiques globales
router.get('/stats', async (req, res) => {
  try {
    const [users, ads, reports, messages] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_banned) as banned, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL \'7 days\') as new_this_week FROM users'),
      pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='active') as active, COUNT(*) FILTER (WHERE status='hidden') as hidden, COUNT(*) FILTER (WHERE status='sold') as sold FROM ads"),
      pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='pending') as pending, COUNT(*) FILTER (WHERE status='reviewed') as reviewed FROM reports"),
      pool.query('SELECT COUNT(*) as total FROM messages'),
    ]);

    res.json({
      users: users.rows[0],
      ads: ads.rows[0],
      reports: reports.rows[0],
      messages: messages.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/moderation/ads — toutes les annonces (y compris masquées)
router.get('/ads', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, q } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];

    if (status) { params.push(status); conditions.push(`a.status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); conditions.push(`(a.title ILIKE $${params.length} OR u.username ILIKE $${params.length})`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(parseInt(limit), offset);

    const { rows } = await pool.query(`
      SELECT a.*, u.username, u.email,
        (SELECT COUNT(*) FROM reports r WHERE r.ad_id = a.id AND r.status = 'pending') as pending_reports
      FROM ads a
      JOIN users u ON a.user_id = u.id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM ads a JOIN users u ON a.user_id=u.id ${where}`, params.slice(0,-2));
    res.json({ ads: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/moderation/ads/:id/status — forcer le statut d'une annonce
router.patch('/ads/:id/status', [
  body('status').isIn(['active', 'hidden', 'sold', 'expired']),
  body('reason').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, reason } = req.body;
  try {
    await pool.query(
      'UPDATE ads SET status=$1, updated_at=NOW() WHERE id=$2',
      [status, req.params.id]
    );

    // Log de modération
    await pool.query(`
      INSERT INTO moderation_logs (moderator_id, action, target_type, target_id, reason)
      VALUES ($1, $2, 'ad', $3, $4)
    `, [req.user.id, `set_status_${status}`, req.params.id, reason || null]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/moderation/ads/:id — supprimer une annonce
router.delete('/ads/:id', async (req, res) => {
  try {
    const { reason } = req.body;
    await pool.query('DELETE FROM ads WHERE id=$1', [req.params.id]);
    await pool.query(`
      INSERT INTO moderation_logs (moderator_id, action, target_type, target_id, reason)
      VALUES ($1, 'delete_ad', 'ad', $2, $3)
    `, [req.user.id, req.params.id, reason || null]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/moderation/users/:id/ban — bannir/débannir
router.patch('/users/:id/ban', requireRole('moderator', 'admin'), [
  body('banned').isBoolean(),
  body('reason').optional().trim(),
], async (req, res) => {
  const { banned, reason } = req.body;
  try {
    // Un modérateur ne peut pas bannir un admin
    const target = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
    if (!target.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (target.rows[0].role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Impossible de bannir un administrateur' });
    }

    await pool.query('UPDATE users SET is_banned=$1 WHERE id=$2', [banned, req.params.id]);
    await pool.query(`
      INSERT INTO moderation_logs (moderator_id, action, target_type, target_id, reason)
      VALUES ($1, $2, 'user', $3, $4)
    `, [req.user.id, banned ? 'ban_user' : 'unban_user', req.params.id, reason || null]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/moderation/users/:id/role — changer le rôle (admin uniquement)
router.patch('/users/:id/role', requireRole('admin'), [
  body('role').isIn(['user', 'moderator', 'admin']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { role } = req.body;
  try {
    await pool.query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
    await pool.query(`
      INSERT INTO moderation_logs (moderator_id, action, target_type, target_id, reason)
      VALUES ($1, $2, 'user', $3, $4)
    `, [req.user.id, `set_role_${role}`, req.params.id, null]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/moderation/logs — journal de modération
router.get('/logs', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows } = await pool.query(`
      SELECT ml.*, u.username as moderator_username
      FROM moderation_logs ml
      JOIN users u ON ml.moderator_id = u.id
      ORDER BY ml.created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]);

    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
