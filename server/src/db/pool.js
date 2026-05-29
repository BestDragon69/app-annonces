import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://annonces_user:changeme@localhost:5432/annonces",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function migrate() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await pool.query(sql);

  // Créer l'admin par défaut s'il n'existe pas
  const existing = await pool.query(
    "SELECT id FROM users WHERE email = 'admin@annonces.fr'",
  );
  if (existing.rows.length === 0) {
    // 1. Compte Admin
    const hash = await bcrypt.hash("Admin1234!", 12);
    await pool.query(
      `
      INSERT INTO users (email, password_hash, username, role)
      VALUES ('admin@annonces.fr', $1, 'admin', 'admin')
    `,
      [hash],
    );

    // 2. Compte Modérateur
    const hash2 = await bcrypt.hash("Modo1234!", 12);
    await pool.query(
      `
      INSERT INTO users (email, password_hash, username, role, city)
      VALUES ('modo@annonces.fr', $1, 'moderateur', 'moderator', 'Lyon')
    `,
      [hash2],
    );

    // 3. Compte Utilisateur
    const hash3 = await bcrypt.hash("User1234!", 12);
    await pool.query(
      `
      INSERT INTO users (email, password_hash, username, phone, city)
      VALUES ('user@annonces.fr', $1, 'utilisateur_test', '0601020304', 'Paris')
    `,
      [hash3],
    );

    console.log("✅ Comptes de test créés");
  }

  console.log("✅ Migration terminée");
}

export default pool;
