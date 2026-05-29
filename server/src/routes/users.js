import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

const avatarStorage = multer.diskStorage({
  destination: join(__dirname, '../../uploads'),
  filename: (req, file, cb) => cb(null, `avatar-${uuidv4()}-${file.originalname}`),
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Image uniquement'));
  },
});

// GET /api/users/:id — profil public
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.avatar_url, u.bio, u.city, u.created_at,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'active') as active_ads_count,
        ROUND(AVG(r.rating), 1) as avg_rating,
        COUNT(DISTINCT r.id) as review_count
      FROM users u
      LEFT JOIN ads a ON a.user_id = u.id
      LEFT JOIN reviews r ON r.seller_id = u.id
      WHERE u.id = $1 AND u.is_banned = false
      GROUP BY u.id
    `, [req.params.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // Avis récents
    const { rows: reviews } = await pool.query(`
      SELECT r.*, u.username, u.avatar_url
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.seller_id = $1
      ORDER BY r.created_at DESC
      LIMIT 5
    `, [req.params.id]);

    res.json({ ...rows[0], reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id/ads — annonces publiques d'un utilisateur
router.get('/:id/ads', async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows } = await pool.query(`
      SELECT a.*,
        (SELECT json_agg(json_build_object('url', ap.url, 'position', ap.position) ORDER BY ap.position)
         FROM ad_photos ap WHERE ap.ad_id = a.id) as photos,
        (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug))
         FROM ad_categories ac JOIN categories c ON ac.category_id = c.id WHERE ac.ad_id = a.id) as categories
      FROM ads a
      WHERE a.user_id = $1 AND a.status = 'active' AND a.expires_at > NOW()
      ORDER BY a.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.params.id, parseInt(limit), offset]);

    res.json({ ads: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/me/ads — mes annonces (toutes)
router.get('/me/ads', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const params = [req.user.id];
    let statusFilter = '';
    if (status) {
      params.push(status);
      statusFilter = `AND a.status = $${params.length}`;
    }

    const { rows } = await pool.query(`
      SELECT a.*,
        (SELECT json_agg(json_build_object('url', ap.url, 'position', ap.position) ORDER BY ap.position)
         FROM ad_photos ap WHERE ap.ad_id = a.id) as photos,
        (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug))
         FROM ad_categories ac JOIN categories c ON ac.category_id = c.id WHERE ac.ad_id = a.id) as categories,
        (SELECT COUNT(*) FROM messages m JOIN conversations cv ON m.conversation_id = cv.id
         WHERE cv.ad_id = a.id AND m.is_read = false AND m.sender_id != $1) as unread_messages
      FROM ads a
      WHERE a.user_id = $1 ${statusFilter}
      ORDER BY a.created_at DESC
    `, params);

    res.json({ ads: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/me — modifier mon profil
router.put('/me', requireAuth, uploadAvatar.single('avatar'), [
  body('username').optional().trim().isLength({ min: 2, max: 50 }),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('phone').optional().trim(),
  body('city').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, bio, phone, city } = req.body;
  try {
    // Vérifier unicité du username
    if (username) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2', [username, req.user.id]
      );
      if (existing.rows.length) return res.status(409).json({ error: 'Pseudo déjà utilisé' });
    }

    const avatarUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    const { rows } = await pool.query(`
      UPDATE users SET
        username = COALESCE($1, username),
        bio = COALESCE($2, bio),
        phone = COALESCE($3, phone),
        city = COALESCE($4, city),
        avatar_url = COALESCE($5, avatar_url),
        updated_at = NOW()
      WHERE id = $6
      RETURNING id, email, username, avatar_url, bio, phone, city, role, created_at
    `, [username, bio, phone, city, avatarUrl, req.user.id]);

    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/me/password — changer mot de passe
router.put('/me/password', requireAuth, [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { current_password, new_password } = req.body;
  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/me — supprimer mon compte
router.delete('/me', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.clearCookie('token');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/reviews — laisser un avis
router.post('/:id/reviews', requireAuth, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().trim().isLength({ max: 1000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas vous noter vous-même' });
  }

  const { rating, comment, ad_id } = req.body;
  try {
    // Vérifier que l'utilisateur a eu une transaction avec ce vendeur
    const hadTransaction = await pool.query(`
      SELECT 1 FROM conversations c
      WHERE c.ad_id = $1 AND c.buyer_id = $2
      LIMIT 1
    `, [ad_id, req.user.id]);

    const { rows } = await pool.query(`
      INSERT INTO reviews (seller_id, reviewer_id, rating, comment, ad_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (seller_id, reviewer_id, ad_id) DO UPDATE
        SET rating = $3, comment = $4, updated_at = NOW()
      RETURNING *
    `, [req.params.id, req.user.id, rating, comment || null, ad_id || null]);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows } = await pool.query(`
      SELECT r.*, u.username, u.avatar_url
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.seller_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.params.id, parseInt(limit), offset]);

    const count = await pool.query(
      'SELECT COUNT(*), ROUND(AVG(rating),1) as avg FROM reviews WHERE seller_id=$1', [req.params.id]
    );

    res.json({
      reviews: rows,
      total: parseInt(count.rows[0].count),
      avg_rating: count.rows[0].avg,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/me/history — historique des annonces consultées (stocké côté serveur si connecté)
router.get('/me/history', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, u.username,
        (SELECT json_agg(json_build_object('url', ap.url, 'position', ap.position) ORDER BY ap.position)
         FROM ad_photos ap WHERE ap.ad_id = a.id) as photos,
        vh.viewed_at
      FROM view_history vh
      JOIN ads a ON vh.ad_id = a.id
      JOIN users u ON a.user_id = u.id
      WHERE vh.user_id = $1
      ORDER BY vh.viewed_at DESC
      LIMIT 50
    `, [req.user.id]);

    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/me/history/:adId — enregistrer une consultation
router.post('/me/history/:adId', requireAuth, async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO view_history (user_id, ad_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, ad_id) DO UPDATE SET viewed_at = NOW()
    `, [req.user.id, req.params.adId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: liste des utilisateurs
router.get('/', requireAuth, requireRole('admin', 'moderator'), async (req, res) => {
  try {
    const { page = 1, limit = 20, q, role, banned } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];

    if (q) { params.push(`%${q}%`); conditions.push(`(u.username ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    if (role) { params.push(role); conditions.push(`u.role = $${params.length}`); }
    if (banned !== undefined) { params.push(banned === 'true'); conditions.push(`u.is_banned = $${params.length}`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(parseInt(limit), offset);

    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.username, u.role, u.is_banned, u.city, u.created_at,
        COUNT(DISTINCT a.id) as ads_count
      FROM users u
      LEFT JOIN ads a ON a.user_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const total = await pool.query(`SELECT COUNT(*) FROM users u ${where}`, params.slice(0, -2));
    res.json({ users: rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
