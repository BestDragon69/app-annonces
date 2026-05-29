import { Router } from 'express';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

const storage = multer.diskStorage({
  destination: join(__dirname, '../../uploads'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Fichier image uniquement'));
  },
});

// GET /api/ads — liste avec recherche & filtres
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, category, city, region, min_price, max_price, sort = 'recent', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let conditions = ["a.status = 'active'", "a.expires_at > NOW()"];
    const params = [];

    if (q) {
      params.push(q);
      conditions.push(`(a.search_vector @@ plainto_tsquery('french', unaccent($${params.length})) OR a.title ILIKE '%' || $${params.length} || '%')`);
    }
    if (city) { params.push(`%${city}%`); conditions.push(`a.city ILIKE $${params.length}`); }
    if (region) { params.push(`%${region}%`); conditions.push(`a.region ILIKE $${params.length}`); }
    if (min_price) { params.push(min_price); conditions.push(`a.price >= $${params.length}`); }
    if (max_price) { params.push(max_price); conditions.push(`a.price <= $${params.length}`); }
    if (category) {
      params.push(category);
      conditions.push(`EXISTS (SELECT 1 FROM ad_categories ac JOIN categories c ON ac.category_id=c.id WHERE ac.ad_id=a.id AND c.slug=$${params.length})`);
    }

    const orderBy = {
      recent: 'a.created_at DESC',
      price_asc: 'a.price ASC NULLS LAST',
      price_desc: 'a.price DESC NULLS LAST',
      views: 'a.views DESC',
    }[sort] || 'a.created_at DESC';

    const where = conditions.join(' AND ');

    const countRes = await pool.query(`SELECT COUNT(*) FROM ads a WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    params.push(parseInt(limit), offset);
    const { rows } = await pool.query(`
      SELECT a.*, u.username, u.avatar_url,
        (SELECT json_agg(json_build_object('url', ap.url, 'position', ap.position) ORDER BY ap.position)
         FROM ad_photos ap WHERE ap.ad_id = a.id) as photos,
        (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug))
         FROM ad_categories ac JOIN categories c ON ac.category_id=c.id WHERE ac.ad_id=a.id) as categories
        ${req.userId ? ', EXISTS(SELECT 1 FROM favorites f WHERE f.ad_id=a.id AND f.user_id=$' + (params.length - 1) + ') as is_favorite' : ''}
      FROM ads a JOIN users u ON a.user_id=u.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, req.userId ? [req.userId, ...params.slice(0, -2), ...params.slice(-2)] : params);

    res.json({ ads: rows, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ads/:id — fiche détaillée
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, u.username, u.avatar_url, u.phone, u.city as user_city,
        (SELECT json_agg(json_build_object('url', ap.url, 'position', ap.position) ORDER BY ap.position)
         FROM ad_photos ap WHERE ap.ad_id=a.id) as photos,
        (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug))
         FROM ad_categories ac JOIN categories c ON ac.category_id=c.id WHERE ac.ad_id=a.id) as categories
      FROM ads a JOIN users u ON a.user_id=u.id
      WHERE a.id=$1 AND (a.status='active' OR a.user_id=$2 OR $3=true)
    `, [req.params.id, req.userId || null, req.userRole === 'moderator' || req.userRole === 'admin']);

    if (!rows[0]) return res.status(404).json({ error: 'Annonce introuvable' });

    // Incrémenter les vues
    if (req.userId !== rows[0].user_id) {
      await pool.query('UPDATE ads SET views=views+1 WHERE id=$1', [req.params.id]);
    }

    // Favori ?
    let isFavorite = false;
    if (req.userId) {
      const fav = await pool.query('SELECT 1 FROM favorites WHERE user_id=$1 AND ad_id=$2', [req.userId, req.params.id]);
      isFavorite = fav.rows.length > 0;
    }

    res.json({ ...rows[0], is_favorite: isFavorite });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ads — créer une annonce
router.post('/', requireAuth, upload.array('photos', 6), [
  body('title').trim().isLength({ min: 3, max: 255 }),
  body('description').trim().isLength({ min: 10 }),
  body('price').optional().isFloat({ min: 0 }),
  body('city').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, description, price, city, region, categories } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO ads (user_id, title, description, price, city, region)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [req.user.id, title, description, price || null, city, region]);

    const adId = rows[0].id;

    // Catégories
    if (categories) {
      const cats = Array.isArray(categories) ? categories : [categories];
      for (const catId of cats) {
        await client.query('INSERT INTO ad_categories (ad_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [adId, catId]);
      }
    }

    // Photos
    if (req.files?.length) {
      for (let i = 0; i < req.files.length; i++) {
        await client.query('INSERT INTO ad_photos (ad_id, url, position) VALUES ($1,$2,$3)',
          [adId, `/uploads/${req.files[i].filename}`, i]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/ads/:id — modifier
router.put('/:id', requireAuth, upload.array('photos', 6), async (req, res) => {
  try {
    const ad = await pool.query('SELECT * FROM ads WHERE id=$1', [req.params.id]);
    if (!ad.rows[0]) return res.status(404).json({ error: 'Annonce introuvable' });
    if (ad.rows[0].user_id !== req.user.id && req.user.role === 'user') return res.status(403).json({ error: 'Accès refusé' });

    const { title, description, price, city, region, categories, remove_photos } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        UPDATE ads SET title=COALESCE($1,title), description=COALESCE($2,description),
          price=COALESCE($3,price), city=COALESCE($4,city), region=COALESCE($5,region), updated_at=NOW()
        WHERE id=$6
      `, [title, description, price, city, region, req.params.id]);

      if (categories) {
        await client.query('DELETE FROM ad_categories WHERE ad_id=$1', [req.params.id]);
        const cats = Array.isArray(categories) ? categories : [categories];
        for (const catId of cats) {
          await client.query('INSERT INTO ad_categories (ad_id, category_id) VALUES ($1,$2)', [req.params.id, catId]);
        }
      }

      if (remove_photos) {
        const toRemove = Array.isArray(remove_photos) ? remove_photos : [remove_photos];
        await client.query('DELETE FROM ad_photos WHERE ad_id=$1 AND url=ANY($2)', [req.params.id, toRemove]);
      }

      if (req.files?.length) {
        for (let i = 0; i < req.files.length; i++) {
          await client.query('INSERT INTO ad_photos (ad_id, url, position) VALUES ($1,$2,$3)',
            [req.params.id, `/uploads/${req.files[i].filename}`, i + 10]);
        }
      }

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ads/:id/status — changer le statut (masquer, activer, marquer vendu)
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'hidden', 'sold'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });

    const ad = await pool.query('SELECT user_id FROM ads WHERE id=$1', [req.params.id]);
    if (!ad.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    if (ad.rows[0].user_id !== req.user.id && req.user.role === 'user') return res.status(403).json({ error: 'Accès refusé' });

    await pool.query('UPDATE ads SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ads/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const ad = await pool.query('SELECT user_id FROM ads WHERE id=$1', [req.params.id]);
    if (!ad.rows[0]) return res.status(404).json({ error: 'Introuvable' });

    const canDelete = ad.rows[0].user_id === req.user.id || ['moderator', 'admin'].includes(req.user.role);
    if (!canDelete) return res.status(403).json({ error: 'Accès refusé' });

    await pool.query('DELETE FROM ads WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
