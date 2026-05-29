import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /api/categories
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, COUNT(DISTINCT ac.ad_id) FILTER (
        WHERE EXISTS (SELECT 1 FROM ads a WHERE a.id = ac.ad_id AND a.status = 'active' AND a.expires_at > NOW())
      ) as active_ads_count
      FROM categories c
      LEFT JOIN ad_categories ac ON ac.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json({ categories: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/categories/:slug
router.get('/:slug', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories WHERE slug = $1', [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/categories — admin only
router.post('/', requireAuth, requireRole('admin'), [
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('slug').trim().isLength({ min: 2, max: 100 }),
  body('icon').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, slug, icon } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories (name, slug, icon) VALUES ($1,$2,$3) RETURNING *',
      [name, slug, icon || 'tag']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Catégorie déjà existante' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/categories/:id — admin only
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, slug, icon } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE categories SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        icon = COALESCE($3, icon)
      WHERE id = $4 RETURNING *
    `, [name, slug, icon, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/categories/:id — admin only
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
