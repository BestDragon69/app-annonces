-- ─── Patch schema : tables manquantes ────────────────────────────────────────
-- À ajouter à la fin de schema.sql (ou à exécuter séparément)

-- Colonnes manquantes dans reports
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS moderator_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Avis sur les vendeurs
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ad_id UUID REFERENCES ads(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (seller_id, reviewer_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_seller ON reviews(seller_id);

-- Historique de consultation
CREATE TABLE IF NOT EXISTS view_history (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_view_history_user ON view_history(user_id, viewed_at DESC);

-- Journal de modération
CREATE TABLE IF NOT EXISTS moderation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,  -- 'ad' | 'user'
  target_id UUID NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_logs_created ON moderation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_logs_moderator ON moderation_logs(moderator_id);
