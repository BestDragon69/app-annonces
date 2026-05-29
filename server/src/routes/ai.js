import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../db/pool.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Appel Claude simple, retourne le texte brut */
async function askClaude(system, userContent, maxTokens = 600) {
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userContent }],
  });
  return msg.content[0]?.text ?? '';
}

// ─── POST /api/ai/write-ad ─────────────────────────────────────────────────
// Aide à la rédaction : génère un titre + description soignés
router.post(
  '/write-ad',
  requireAuth,
  [
    body('keywords').trim().isLength({ min: 5, max: 500 }),
    body('category').optional().trim(),
    body('price').optional().isFloat({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { keywords, category, price } = req.body;
    try {
      const prompt = `
Voici les informations brutes fournies par le vendeur :
- Mots-clés / description brute : ${keywords}
${category ? `- Catégorie : ${category}` : ''}
${price ? `- Prix souhaité : ${price} €` : ''}

Génère une annonce attractive pour un site de petites annonces français.
Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks) contenant :
{
  "title": "titre accrocheur, 60 caractères max",
  "description": "description claire et vendeuse, 150-300 mots, avec puces si pertinent"
}`;

      const raw = await askClaude(
        "Tu es un expert en rédaction d'annonces pour un site de petites annonces français. Tu réponds uniquement en JSON valide, sans markdown.",
        prompt,
        800
      );

      const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
      res.json(json);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/ai/price-suggestion ────────────────────────────────────────
// Suggestion de prix basée sur le descriptif
router.post(
  '/price-suggestion',
  requireAuth,
  [body('description').trim().isLength({ min: 10, max: 1000 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { description, category } = req.body;
    try {
      const prompt = `
Un vendeur souhaite estimer le prix de vente de son article sur un site de petites annonces français (type Leboncoin).
Description de l'article : ${description}
${category ? `Catégorie : ${category}` : ''}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown) :
{
  "min": <prix minimum en entier>,
  "max": <prix maximum en entier>,
  "suggested": <prix conseillé en entier>,
  "reasoning": "explication courte en 1-2 phrases"
}`;

      const raw = await askClaude(
        "Tu es un expert en estimation de prix pour les petites annonces en France. Tu réponds uniquement en JSON valide.",
        prompt,
        400
      );

      const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
      res.json(json);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/ai/fraud-check ──────────────────────────────────────────────
// Détection d'arnaques potentielles dans une annonce
router.post(
  '/fraud-check',
  optionalAuth,
  [
    body('title').trim().isLength({ min: 3, max: 255 }),
    body('description').trim().isLength({ min: 10 }),
    body('price').optional().isFloat({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { title, description, price } = req.body;
    try {
      const prompt = `
Analyse cette annonce de petites annonces et détecte les éventuels signaux d'arnaque.

Titre : ${title}
Description : ${description}
${price !== undefined ? `Prix : ${price} €` : 'Prix : non renseigné'}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown) :
{
  "risk_level": "low" | "medium" | "high",
  "score": <entier de 0 à 100, 100 = arnaque certaine>,
  "flags": ["signal 1", "signal 2"],
  "summary": "résumé en 1-2 phrases pour l'utilisateur"
}`;

      const raw = await askClaude(
        "Tu es un système expert en détection de fraudes sur les sites de petites annonces français. Tu réponds uniquement en JSON valide.",
        prompt,
        500
      );

      const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
      res.json(json);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/ai/recommendations ──────────────────────────────────────────
// Recommandations personnalisées basées sur l'historique et les favoris
router.get('/recommendations', requireAuth, async (req, res) => {
  try {
    // Récupérer les 10 dernières annonces consultées + favoris
    const [history, favorites] = await Promise.all([
      pool.query(`
        SELECT a.title, a.description, a.price,
          array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as categories
        FROM view_history vh
        JOIN ads a ON vh.ad_id = a.id
        LEFT JOIN ad_categories ac ON ac.ad_id = a.id
        LEFT JOIN categories c ON c.id = ac.category_id
        WHERE vh.user_id = $1 AND a.status = 'active'
        GROUP BY a.id
        ORDER BY vh.viewed_at DESC
        LIMIT 10
      `, [req.user.id]),
      pool.query(`
        SELECT a.title, a.price,
          array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as categories
        FROM favorites f
        JOIN ads a ON f.ad_id = a.id
        LEFT JOIN ad_categories ac ON ac.ad_id = a.id
        LEFT JOIN categories c ON c.id = ac.category_id
        WHERE f.user_id = $1 AND a.status = 'active'
        GROUP BY a.id
        ORDER BY f.created_at DESC
        LIMIT 10
      `, [req.user.id]),
    ]);

    if (history.rows.length === 0 && favorites.rows.length === 0) {
      return res.json({ categories: [], keywords: [], message: 'Pas encore assez de données pour des recommandations.' });
    }

    const historyText = history.rows.map(r =>
      `- "${r.title}" (${r.categories?.join(', ') || 'sans catégorie'}${r.price ? `, ${r.price}€` : ''})`
    ).join('\n');
    const favText = favorites.rows.map(r =>
      `- "${r.title}" (${r.categories?.join(', ') || 'sans catégorie'}${r.price ? `, ${r.price}€` : ''})`
    ).join('\n');

    const prompt = `
Un utilisateur d'un site de petites annonces a consulté et/ou mis en favori les annonces suivantes.

Annonces consultées récemment :
${historyText || '(aucune)'}

Annonces en favoris :
${favText || '(aucune)'}

Déduis ses centres d'intérêt et génère des recommandations de recherche.
Réponds UNIQUEMENT avec un objet JSON valide (sans markdown) :
{
  "categories": ["catégorie 1", "catégorie 2"],
  "keywords": ["mot-clé 1", "mot-clé 2", "mot-clé 3"],
  "price_range": { "min": <entier ou null>, "max": <entier ou null> },
  "summary": "phrase décrivant le profil de l'utilisateur"
}`;

    const raw = await askClaude(
      "Tu es un moteur de recommandation pour un site de petites annonces. Tu réponds uniquement en JSON valide.",
      prompt,
      400
    );

    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Chercher des annonces correspondantes
    if (json.keywords?.length) {
      const kw = json.keywords[0];
      const { rows: suggested } = await pool.query(`
        SELECT a.id, a.title, a.price, a.city,
          (SELECT url FROM ad_photos WHERE ad_id = a.id ORDER BY position LIMIT 1) as photo
        FROM ads a
        WHERE a.status = 'active' AND a.expires_at > NOW()
          AND (a.search_vector @@ plainto_tsquery('french', unaccent($1)) OR a.title ILIKE '%' || $1 || '%')
          AND a.user_id != $2
        ORDER BY a.created_at DESC
        LIMIT 6
      `, [kw, req.user.id]);

      json.suggested_ads = suggested;
    }

    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/ai/chat ─────────────────────────────────────────────────────
// Chatbot d'aide aux utilisateurs (multi-tour)
router.post(
  '/chat',
  optionalAuth,
  [
    body('messages').isArray({ min: 1, max: 20 }),
    body('messages.*.role').isIn(['user', 'assistant']),
    body('messages.*.content').isString().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 600,
        system: `Tu es un assistant virtuel pour un site de petites annonces français appelé "AnnoncesApp".
Tu aides les utilisateurs à :
- Naviguer et utiliser l'application
- Rédiger de meilleures annonces
- Comprendre les règles et politiques du site
- Trouver ce qu'ils cherchent
- Contacter les vendeurs

Règles du site : les annonces expirent après 90 jours, les photos sont limitées à 6 par annonce (5 Mo max chacune), on peut signaler une annonce via le bouton "Signaler".
Sois concis, aimable et utile. Réponds toujours en français.`,
        messages: req.body.messages,
      });

      res.json({ reply: msg.content[0]?.text ?? '' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/ai/natural-search ──────────────────────────────────────────
// Traduit une requête en langage naturel en filtres structurés
router.post(
  '/natural-search',
  optionalAuth,
  [body('query').trim().isLength({ min: 3, max: 500 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { query } = req.body;
    try {
      const prompt = `
Un utilisateur recherche sur un site de petites annonces avec cette phrase :
"${query}"

Extrais les critères de recherche structurés.
Réponds UNIQUEMENT avec un objet JSON valide (sans markdown) :
{
  "q": "mots-clés pertinents ou null",
  "category": "slug de catégorie parmi : vehicules, immobilier, electronique, mode, maison-jardin, sports-loisirs, enfants-bebes, livres-medias, animaux, services, informatique, autres — ou null",
  "city": "ville ou null",
  "region": "région ou null",
  "min_price": <entier ou null>,
  "max_price": <entier ou null>,
  "sort": "recent" | "price_asc" | "price_desc" | "views"
}`;

      const raw = await askClaude(
        "Tu es un moteur de recherche sémantique pour petites annonces. Tu extrais des filtres structurés depuis du langage naturel. Tu réponds uniquement en JSON valide.",
        prompt,
        300
      );

      const filters = JSON.parse(raw.replace(/```json|```/g, '').trim());

      // Optionnel : exécuter directement la recherche avec ces filtres
      const conditions = ["a.status = 'active'", "a.expires_at > NOW()"];
      const params = [];

      if (filters.q) { params.push(filters.q); conditions.push(`(a.search_vector @@ plainto_tsquery('french', unaccent($${params.length})) OR a.title ILIKE '%' || $${params.length} || '%')`); }
      if (filters.city) { params.push(`%${filters.city}%`); conditions.push(`a.city ILIKE $${params.length}`); }
      if (filters.region) { params.push(`%${filters.region}%`); conditions.push(`a.region ILIKE $${params.length}`); }
      if (filters.min_price) { params.push(filters.min_price); conditions.push(`a.price >= $${params.length}`); }
      if (filters.max_price) { params.push(filters.max_price); conditions.push(`a.price <= $${params.length}`); }
      if (filters.category) {
        params.push(filters.category);
        conditions.push(`EXISTS (SELECT 1 FROM ad_categories ac JOIN categories c ON ac.category_id=c.id WHERE ac.ad_id=a.id AND c.slug=$${params.length})`);
      }

      const orderBy = { recent: 'a.created_at DESC', price_asc: 'a.price ASC NULLS LAST', price_desc: 'a.price DESC NULLS LAST', views: 'a.views DESC' }[filters.sort] || 'a.created_at DESC';

      params.push(12, 0); // limit, offset
      const { rows: ads } = await pool.query(`
        SELECT a.id, a.title, a.price, a.city, a.created_at,
          (SELECT url FROM ad_photos WHERE ad_id = a.id ORDER BY position LIMIT 1) as photo,
          u.username
        FROM ads a
        JOIN users u ON a.user_id = u.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);

      res.json({ filters, ads });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
