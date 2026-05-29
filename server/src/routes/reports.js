import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/reports — signaler une annonce
router.post('/', requireAuth, [
  body('ad_id').notEmpty(),
  body('reason').trim().isLength({ min: 5, max: 1000 }),
  body('type').isIn(['spam', 'fraud', 'prohibited', 'duplicate', 'wrong_category', 'other']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { ad_id, reason, type } = req.body;
  try {
    // Vérifier que l'annonce existe
    const ad = await pool.query('SELECT id FROM ads WHERE id=$1', [ad_id]);
    if (!ad.rows[0]) return res.status(404).json({ error: 'Annonce introuvable' });

    // Un utilisateur ne peut signaler qu'une fois par annonce
    const existing = await pool.query(
      'SELECT id FROM reports WHERE reporter_id=$1 AND ad_id=$2', [req.user.id, ad_id]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Vous avez déjà signalé cette annonce' });
    }

    const { rows } = await pool.query(`
      INSERT INTO reports (reporter_id, ad_id, reason, type)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [req.user.id, ad_id, reason, type]);

    res.status(201).json({ ok: true, report: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports — liste des signalements (modérateurs/admin)
router.get('/', requireAuth, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows } = await pool.query(`
      SELECT r.*, 
        u.username as reporter_username,
        a.title as ad_title, a.status as ad_status, a.user_id as ad_owner_id,
        ou.username as ad_owner_username
      FROM reports r
      JOIN users u ON r.reporter_id = u.id
      JOIN ads a ON r.ad_id = a.id
      JOIN users ou ON a.user_id = ou.id
      WHERE r.status = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `, [status, parseInt(limit), offset]);

    const count = await pool.query('SELECT COUNT(*) FROM reports WHERE status=$1', [status]);
    res.json({ reports: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reports/:id — mettre à jour le statut d'un signalement
router.patch('/:id', requireAuth, requireRole('moderator', 'admin'), [
  body('status').isIn(['reviewed', 'dismissed']),
  body('moderator_note').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, moderator_note } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE reports
      SET status=$1, moderator_note=$2, reviewed_by=$3, reviewed_at=NOW()
      WHERE id=$4 RETURNING *
    `, [status, moderator_note || null, req.user.id, req.params.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Signalement introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
