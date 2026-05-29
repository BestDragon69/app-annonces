import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/messages/conversations — mes conversations
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.created_at, c.ad_id,
        a.title as ad_title, a.status as ad_status,
        (SELECT json_agg(json_build_object('url', ap.url) ORDER BY ap.position) FROM ad_photos ap WHERE ap.ad_id = a.id LIMIT 1) as ad_photo,
        a.price as ad_price,
        CASE WHEN c.buyer_id = $1 THEN c.seller_id ELSE c.buyer_id END as other_user_id,
        CASE WHEN c.buyer_id = $1 THEN su.username ELSE bu.username END as other_username,
        CASE WHEN c.buyer_id = $1 THEN su.avatar_url ELSE bu.avatar_url END as other_avatar,
        c.buyer_id = $1 as is_buyer,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND is_read = false AND sender_id != $1) as unread_count
      FROM conversations c
      JOIN ads a ON c.ad_id = a.id
      JOIN users bu ON c.buyer_id = bu.id
      JOIN users su ON c.seller_id = su.id
      WHERE c.buyer_id = $1 OR c.seller_id = $1
      ORDER BY last_message_at DESC NULLS LAST
    `, [req.user.id]);

    res.json({ conversations: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/conversations/:id — messages d'une conversation
router.get('/conversations/:id', requireAuth, async (req, res) => {
  try {
    // Vérifier que l'utilisateur fait partie de la conversation
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
      [req.params.id, req.user.id]
    );
    if (!conv.rows[0]) return res.status(403).json({ error: 'Accès refusé' });

    const { rows: messages } = await pool.query(`
      SELECT m.*, u.username, u.avatar_url
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
    `, [req.params.id]);

    // Marquer comme lus
    await pool.query(
      'UPDATE messages SET is_read=true WHERE conversation_id=$1 AND sender_id!=$2 AND is_read=false',
      [req.params.id, req.user.id]
    );

    // Info sur l'annonce et l'interlocuteur
    const other_id = conv.rows[0].buyer_id === req.user.id
      ? conv.rows[0].seller_id
      : conv.rows[0].buyer_id;

    const { rows: [other] } = await pool.query(
      'SELECT id, username, avatar_url, phone FROM users WHERE id=$1', [other_id]
    );
    const { rows: [ad] } = await pool.query(`
      SELECT a.id, a.title, a.price, a.status,
        (SELECT url FROM ad_photos WHERE ad_id=a.id ORDER BY position LIMIT 1) as photo
      FROM ads a WHERE a.id=$1
    `, [conv.rows[0].ad_id]);

    res.json({ messages, conversation: conv.rows[0], other_user: other, ad });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/conversations — créer ou récupérer une conversation, envoyer 1er message
router.post('/conversations', requireAuth, [
  body('ad_id').notEmpty(),
  body('message').trim().isLength({ min: 1, max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { ad_id, message } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Récupérer l'annonce
    const ad = await client.query('SELECT user_id FROM ads WHERE id=$1', [ad_id]);
    if (!ad.rows[0]) return res.status(404).json({ error: 'Annonce introuvable' });

    const seller_id = ad.rows[0].user_id;
    if (seller_id === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer un message' });
    }

    // Conversation existante ?
    let conv = await client.query(
      'SELECT * FROM conversations WHERE ad_id=$1 AND buyer_id=$2',
      [ad_id, req.user.id]
    );

    let conv_id;
    if (conv.rows.length) {
      conv_id = conv.rows[0].id;
    } else {
      const newConv = await client.query(
        'INSERT INTO conversations (ad_id, buyer_id, seller_id) VALUES ($1,$2,$3) RETURNING *',
        [ad_id, req.user.id, seller_id]
      );
      conv_id = newConv.rows[0].id;
    }

    const { rows: [msg] } = await client.query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *',
      [conv_id, req.user.id, message]
    );

    await client.query('COMMIT');
    res.status(201).json({ conversation_id: conv_id, message: msg });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/messages/conversations/:id — envoyer un message dans une conv existante
router.post('/conversations/:id', requireAuth, [
  body('content').trim().isLength({ min: 1, max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
      [req.params.id, req.user.id]
    );
    if (!conv.rows[0]) return res.status(403).json({ error: 'Accès refusé' });

    const { rows: [msg] } = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, req.body.content]
    );

    res.status(201).json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/unread-count
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE (c.buyer_id = $1 OR c.seller_id = $1)
        AND m.sender_id != $1
        AND m.is_read = false
    `, [req.user.id]);
    res.json({ count: parseInt(rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
