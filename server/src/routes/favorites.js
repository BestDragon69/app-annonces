import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/favorites — mes favoris
router.get('/', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows } = await pool.query(`
      SELECT a.*, u.username, u.avatar_url, f.created_at as favorited_at,
        (SELECT json_agg(json_build_object('url', ap.url, 'position', ap.position) ORDER BY ap.position)
         FROM ad_photos ap WHERE ap.ad_id = a.id) as photos,
        (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug))
         FROM ad_categories ac JOIN categories c ON ac.category_id = c.id WHERE ac.ad_id = a.id) as categories
      FROM favorites f
      JOIN ads a ON f.ad_id = a.id
      JOIN users u ON a.user_id = u.id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, parseInt(limit), offset]);

    const count = await pool.query('SELECT COUNT(*) FROM favorites WHERE user_id=$1', [req.user.id]);
    res.json({ favorites: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/favorites/:adId — ajouter aux favoris
router.post('/:adId', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO favorites (user_id, ad_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.user.id, req.params.adId]
    );
    res.json({ ok: true, is_favorite: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/favorites/:adId — retirer des favoris
router.delete('/:adId', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM favorites WHERE user_id=$1 AND ad_id=$2',
      [req.user.id, req.params.adId]
    );
    res.json({ ok: true, is_favorite: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
