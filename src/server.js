require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { rateLimit } = require('express-rate-limit');

// -------------------------------------------------------------------------
// 1. Configuration du serveur
// -------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://tontine_user:secretpassword@postgres:5432/tontine_db',
});
const PgSessionStore = connectPgSimple(session);
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET doit contenir au moins 32 caractères.');
}

// -------------------------------------------------------------------------
// 2. Middleware global
// -------------------------------------------------------------------------
// Le serveur accepte les données JSON envoyées par le frontend.
app.use(express.json());
app.use(session({
  store: new PgSessionStore({ pool, tableName: 'user_sessions' }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// Les fichiers publics sont servis après la configuration des sessions.
app.use(express.static(path.join(__dirname, '../public')));

// Évite une requête inutile vers le favicon.
app.get('/favicon.ico', (req, res) => res.status(204).end());

// -------------------------------------------------------------------------
// 3. Routes de santé et de membres
// -------------------------------------------------------------------------
// Vérification de la connexion du serveur et de PostgreSQL.
app.get('/api/health', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW() AS now');

    res.json({
      status: 'OK',
      message: 'Serveur et base de données opérationnels !',
      dbTime: dbResult.rows[0].now,
    });
  } catch (error) {
    console.error('Erreur de santé :', error.message);
    res.status(500).json({
      status: 'ERROR',
      error: 'Le serveur ou PostgreSQL n’est pas disponible.',
    });
  }
});

async function requireAuthentication(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const result = await pool.query(`
      SELECT id, full_name, phone_number, role
      FROM users
      WHERE id = $1 AND password_hash IS NOT NULL
    `, [req.session.user.id]);
    if (result.rows.length === 0) {
      return req.session.destroy(() => res.status(401).json({ error: 'Votre compte n’est plus actif.' }));
    }

    req.user = result.rows[0];
    req.session.user = req.user;
    next();
  } catch (error) {
    console.error('Erreur de vérification de session :', error.message);
    res.status(500).json({ error: 'Impossible de vérifier votre session.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Cette action est réservée aux administrateurs.' });
  }

  next();
}

app.post('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
}), async (req, res) => {
  const phoneNumber = String(req.body.phone_number || '').trim();
  const password = String(req.body.password || '');

  if (!phoneNumber || !password) {
    return res.status(400).json({ error: 'Le téléphone et le mot de passe sont requis.' });
  }

  try {
    const result = await pool.query(`
      SELECT id, full_name, phone_number, role, password_hash
      FROM users
      WHERE phone_number = $1 AND password_hash IS NOT NULL
      ORDER BY id
      LIMIT 1
    `, [phoneNumber]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Téléphone ou mot de passe incorrect.' });
    }

    req.session.regenerate(error => {
      if (error) {
        console.error('Erreur de création de session :', error.message);
        return res.status(500).json({ error: 'Impossible d’ouvrir la session.' });
      }

      req.session.user = {
        id: user.id,
        full_name: user.full_name,
        phone_number: user.phone_number,
        role: user.role,
      };
      req.session.save(saveError => {
        if (saveError) {
          console.error('Erreur de sauvegarde de session :', saveError.message);
          return res.status(500).json({ error: 'Impossible d’ouvrir la session.' });
        }

        res.json({ user: req.session.user });
      });
    });
  } catch (error) {
    console.error('Erreur SQL (POST /api/auth/login) :', error.message);
    res.status(500).json({ error: 'Impossible de vérifier les identifiants.' });
  }
});

app.get('/api/auth/me', requireAuthentication, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', requireAuthentication, (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('connect.sid', { sameSite: 'strict' });
    res.json({ message: 'Déconnexion réussie.' });
  });
});

app.use('/api', requireAuthentication);

app.get('/api/me/overview', async (req, res) => {
  try {
    const [tontines, upcomingSessions, contributions, loans, payments, notifications] = await Promise.all([
      pool.query(`
        SELECT t.id, t.name, t.amount, t.frequency, tm.joined_at
        FROM tontine_members tm
        JOIN tontines t ON t.id = tm.tontine_id
        WHERE tm.user_id = $1
        ORDER BY t.name
      `, [req.user.id]),
      pool.query(`
        SELECT s.id, s.title, s.date, s.agenda, s.status, t.name AS tontine_name
        FROM sessions s
        JOIN tontines t ON t.id = s.tontine_id
        JOIN tontine_members tm ON tm.tontine_id = t.id
        WHERE tm.user_id = $1
          AND s.date >= CURRENT_TIMESTAMP
          AND s.status IN ('scheduled', 'ongoing')
        ORDER BY s.date
        LIMIT 10
      `, [req.user.id]),
      pool.query('SELECT id, amount, status, paid_at, created_at FROM contributions WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
      pool.query('SELECT id, amount, interest_rate, total_amount, due_date, status, created_at FROM loans WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
      pool.query('SELECT p.id, p.amount, p.method, p.reference, p.status, p.created_at, s.title AS session_title FROM payments p LEFT JOIN sessions s ON s.id = p.session_id WHERE p.user_id = $1 ORDER BY p.created_at DESC', [req.user.id]),
      pool.query('SELECT id, title, message, type, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id]),
    ]);

    res.json({
      user: req.user,
      tontines: tontines.rows,
      upcomingSessions: upcomingSessions.rows,
      contributions: contributions.rows,
      loans: loans.rows,
      payments: payments.rows,
      notifications: notifications.rows,
    });
  } catch (error) {
    console.error('Erreur SQL (GET /api/me/overview) :', error.message);
    res.status(500).json({ error: 'Impossible de charger votre espace personnel.' });
  }
});

async function initializeAuthentication() {
  const schema = fs.readFileSync(path.join(__dirname, '../init.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_authenticated_phone_unique
    ON users (phone_number) WHERE password_hash IS NOT NULL
  `);

  const { ADMIN_NAME, ADMIN_PHONE, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_PHONE || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
    throw new Error('Définissez ADMIN_NAME, ADMIN_PHONE et ADMIN_PASSWORD (8 caractères minimum).');
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const existingAdmin = await pool.query(
    'SELECT id FROM users WHERE phone_number = $1 ORDER BY id DESC LIMIT 1',
    [ADMIN_PHONE]
  );
  if (existingAdmin.rows[0]) {
    await pool.query(`
      UPDATE users
      SET full_name = $1, role = 'admin', password_hash = $2
      WHERE id = $3
    `, [ADMIN_NAME, passwordHash, existingAdmin.rows[0].id]);
  } else {
    await pool.query(`
      INSERT INTO users (full_name, phone_number, role, password_hash)
      VALUES ($1, $2, 'admin', $3)
    `, [ADMIN_NAME, ADMIN_PHONE, passwordHash]);
  }
  console.log(`Compte administrateur prêt pour ${ADMIN_PHONE}.`);
}

// Récupération des membres enregistrés, du plus récent au plus ancien.
app.get('/api/members', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      const result = await pool.query(`
        SELECT id, full_name, phone_number, role, created_at
        FROM users
        WHERE id = $1
      `, [req.user.id]);
      return res.json(result.rows);
    }

    const result = await pool.query(`
      SELECT id, full_name, phone_number, role, created_at
      FROM users
      ORDER BY created_at DESC, id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/members) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les membres.' });
  }
});

app.use('/api', requireAdmin);

app.get('/api/admin/overview', async (req, res) => {
  try {
    const [members, sessions, contributions, payments, loans, activity] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'member'"),
      pool.query("SELECT COUNT(*)::int AS total FROM sessions WHERE status = 'scheduled' AND date >= CURRENT_TIMESTAMP"),
      pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM contributions WHERE status = 'paid'"),
      pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid'"),
      pool.query(`
        SELECT COALESCE(SUM(GREATEST(l.total_amount - COALESCE(repayments.paid_amount, 0), 0)), 0) AS total
        FROM loans l
        LEFT JOIN (
          SELECT loan_id, SUM(amount) AS paid_amount
          FROM loan_repayments
          GROUP BY loan_id
        ) repayments ON repayments.loan_id = l.id
        WHERE l.status <> 'paid'
      `),
      pool.query(`
        SELECT * FROM (
          SELECT c.created_at AS occurred_at, 'Cotisation' AS category,
                 u.full_name || ' · ' || c.status AS description, c.amount, c.status
          FROM contributions c JOIN users u ON u.id = c.user_id
          UNION ALL
          SELECT p.created_at AS occurred_at, 'Paiement' AS category,
                 u.full_name || ' · ' || p.method AS description, p.amount, p.status
          FROM payments p JOIN users u ON u.id = p.user_id
          UNION ALL
          SELECT l.created_at AS occurred_at, 'Prêt' AS category,
                 u.full_name || ' · échéance ' || l.due_date::text AS description,
                 l.amount, l.status
          FROM loans l JOIN users u ON u.id = l.user_id
        ) recent_activity
        ORDER BY occurred_at DESC
        LIMIT 8
      `),
    ]);

    res.json({
      members: members.rows[0].total,
      upcomingSessions: sessions.rows[0].total,
      paidContributions: contributions.rows[0].total,
      confirmedPayments: payments.rows[0].total,
      outstandingLoans: loans.rows[0].total,
      recentActivity: activity.rows,
    });
  } catch (error) {
    console.error('Erreur SQL (GET /api/admin/overview) :', error.message);
    res.status(500).json({ error: 'Impossible de charger les indicateurs du tableau de bord.' });
  }
});

app.get('/api/admin/reports', async (req, res) => {
  const { start_date: startDate, end_date: endDate, type = 'all' } = req.query;
  const allowedTypes = ['all', 'contribution', 'payment', 'loan'];
  const isValidDate = value => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };

  if (!allowedTypes.includes(type) || !isValidDate(startDate) || !isValidDate(endDate)) {
    return res.status(400).json({ error: 'Choisissez un type et des dates valides.' });
  }
  if (startDate && endDate && startDate > endDate) {
    return res.status(400).json({ error: 'La date de début doit précéder la date de fin.' });
  }

  try {
    const result = await pool.query(`
      SELECT * FROM (
        SELECT 'contribution' AS type, c.created_at, u.full_name AS member_name,
               c.amount, c.status, s.title AS details
        FROM contributions c
        JOIN users u ON u.id = c.user_id
        JOIN sessions s ON s.id = c.session_id
        UNION ALL
        SELECT 'payment' AS type, p.created_at, u.full_name AS member_name,
               p.amount, p.status, COALESCE(s.title, p.method) AS details
        FROM payments p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN sessions s ON s.id = p.session_id
        UNION ALL
        SELECT 'loan' AS type, l.created_at, u.full_name AS member_name,
               l.amount, l.status, 'Échéance ' || l.due_date::text AS details
        FROM loans l
        JOIN users u ON u.id = l.user_id
      ) report_rows
      WHERE ($1 = 'all' OR type = $1)
        AND ($2::date IS NULL OR created_at >= $2::date)
        AND ($3::date IS NULL OR created_at < $3::date + INTERVAL '1 day')
      ORDER BY created_at DESC
    `, [type, startDate || null, endDate || null]);

    res.json({ rows: result.rows });
  } catch (error) {
    console.error('Erreur SQL (GET /api/admin/reports) :', error.message);
    res.status(500).json({ error: 'Impossible de générer le rapport.' });
  }
});

// Création d'un membre après validation des champs obligatoires.
app.post('/api/members', async (req, res) => {
  const { full_name, phone_number, password, role } = req.body;

  if (!full_name || !phone_number || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({
      error: 'Le nom, le téléphone et un mot de passe d’au moins 8 caractères sont requis.',
    });
  }

  try {
    const existingMember = await pool.query(`
      SELECT id, password_hash
      FROM users
      WHERE phone_number = $1
      ORDER BY id DESC
      LIMIT 1
    `, [phone_number]);
    if (existingMember.rows[0]?.password_hash) {
      return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const memberRole = role === 'admin' ? 'admin' : 'member';
    const result = existingMember.rows[0]
      ? await pool.query(`
          UPDATE users
          SET full_name = $1, role = $2, password_hash = $3
          WHERE id = $4
          RETURNING id, full_name, phone_number, role, created_at
        `, [full_name, memberRole, passwordHash, existingMember.rows[0].id])
      : await pool.query(`
          INSERT INTO users (full_name, phone_number, role, password_hash)
          VALUES ($1, $2, $3, $4)
          RETURNING id, full_name, phone_number, role, created_at
        `, [full_name, phone_number, memberRole, passwordHash]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/members) :', error.message);
    res.status(500).json({ error: 'Impossible d’ajouter le membre.' });
  }
});

// -------------------------------------------------------------------------
// 4. Routes de tontines
// -------------------------------------------------------------------------
// Création d'une tontine avec validation du nom et du montant.
app.post('/api/tontines', async (req, res) => {
  const { name, amount, frequency } = req.body;
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const numericAmount = Number(amount);
  const allowedFrequencies = ['weekly', 'monthly', 'quarterly', 'yearly'];
  const normalizedFrequency = frequency || 'monthly';

  if (!normalizedName || !Number.isFinite(numericAmount) || numericAmount <= 0 || !allowedFrequencies.includes(normalizedFrequency)) {
    return res.status(400).json({
      error: 'Indiquez un nom, un montant positif et une fréquence valide.',
    });
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO tontines (name, amount, frequency)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [normalizedName, numericAmount, normalizedFrequency]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/tontines) :', error.message);
    res.status(500).json({ error: 'Impossible de créer la tontine.' });
  }
});

// Récupération de toutes les tontines, du plus récente au plus ancienne.
app.get('/api/tontines', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, COUNT(tm.user_id)::int AS member_count
      FROM tontines t
      LEFT JOIN tontine_members tm ON tm.tontine_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC, t.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/tontines) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les tontines.' });
  }
});

app.post('/api/tontines/:id/members', async (req, res) => {
  const tontineId = Number(req.params.id);
  const memberId = Number(req.body.member_id);

  if (!Number.isInteger(tontineId) || tontineId <= 0 || !Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ error: 'La tontine et le membre sélectionnés sont invalides.' });
  }

  try {
    const entities = await pool.query(`
      SELECT EXISTS (SELECT 1 FROM tontines WHERE id = $1) AS tontine_exists,
             EXISTS (SELECT 1 FROM users WHERE id = $2 AND role = 'member') AS member_exists
    `, [tontineId, memberId]);
    if (!entities.rows[0].tontine_exists || !entities.rows[0].member_exists) {
      return res.status(404).json({ error: 'Tontine ou membre introuvable.' });
    }

    const result = await pool.query(`
      INSERT INTO tontine_members (tontine_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (tontine_id, user_id) DO NOTHING
      RETURNING id, tontine_id, user_id, joined_at
    `, [tontineId, memberId]);

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Ce membre appartient déjà à cette tontine.' });
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/tontines/:id/members) :', error.message);
    res.status(500).json({ error: 'Impossible d’ajouter le membre à cette tontine.' });
  }
});

// -------------------------------------------------------------------------
// 5. Routes de sessions et cotisations
// -------------------------------------------------------------------------
// Une session représente une réunion ou un tour de tontine.
app.get('/api/sessions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, t.name AS tontine_name
      FROM sessions s
      JOIN tontines t ON t.id = s.tontine_id
      ORDER BY s.date DESC, s.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/sessions) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les sessions.' });
  }
});

// Création d'une session après validation des champs principaux.
app.post('/api/sessions', async (req, res) => {
  const { tontine_id, title, date, agenda, status } = req.body;

  if (!tontine_id || !title || !date) {
    return res.status(400).json({
      error: 'La tontine, le titre et la date sont requis.',
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO sessions (tontine_id, title, date, agenda, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      tontine_id,
      title,
      date,
      agenda || '',
      status || 'scheduled',
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/sessions) :', error.message);
    res.status(500).json({ error: 'Impossible de créer la session.' });
  }
});

// Modification du statut d'une session.
app.patch('/api/sessions/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ['scheduled', 'ongoing', 'completed', 'cancelled'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Le statut doit être scheduled, ongoing, completed ou cancelled.',
    });
  }

  try {
    const result = await pool.query(`
      UPDATE sessions
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session non trouvée.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (PATCH /api/sessions/:id/status) :', error.message);
    res.status(500).json({ error: 'Impossible de modifier le statut de la session.' });
  }
});

// Récupération des cotisations d'une session.
app.get('/api/contributions', async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: 'Le paramètre session_id est requis.' });
  }

  try {
    const result = await pool.query(`
      SELECT c.*, u.full_name, u.phone_number
      FROM contributions c
      JOIN users u ON u.id = c.user_id
      WHERE c.session_id = $1
      ORDER BY c.created_at DESC
    `, [session_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/contributions) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les cotisations.' });
  }
});

// Enregistrement d'une cotisation pour un membre et une session.
app.post('/api/contributions', async (req, res) => {
  const { session_id, user_id, amount, status } = req.body;

  if (!session_id || !user_id || amount === undefined || amount === null || amount <= 0) {
    return res.status(400).json({
      error: 'La session, le membre et un montant positif sont requis.',
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO contributions (session_id, user_id, amount, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [session_id, user_id, amount, status || 'pending']);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/contributions) :', error.message);
    res.status(500).json({ error: 'Impossible d’enregistrer la cotisation.' });
  }
});

// -------------------------------------------------------------------------
// 6. Prêts, intérêt et remboursements
// -------------------------------------------------------------------------
app.get('/api/loans', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, u.full_name, u.phone_number,
             COALESCE(SUM(r.amount), 0) AS paid_amount
      FROM loans l
      JOIN users u ON u.id = l.user_id
      LEFT JOIN loan_repayments r ON r.loan_id = l.id
      GROUP BY l.id, u.full_name, u.phone_number
      ORDER BY l.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/loans) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les prêts.' });
  }
});

app.post('/api/loans', async (req, res) => {
  const { user_id, amount, interest_rate, due_date } = req.body;

  if (!user_id || amount === undefined || amount <= 0 || interest_rate === undefined || due_date === undefined) {
    return res.status(400).json({
      error: 'Le membre, le montant, le taux d’intérêt et l’échéance sont requis.',
    });
  }

  try {
    const interest = Number((Number(amount) * Number(interest_rate) / 100).toFixed(2));
    const totalAmount = Number((Number(amount) + interest).toFixed(2));
    const result = await pool.query(`
      INSERT INTO loans (user_id, amount, interest_rate, due_date, interest, total_amount)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [user_id, amount, interest_rate, due_date, interest, totalAmount]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/loans) :', error.message);
    res.status(500).json({ error: 'Impossible de créer le prêt.' });
  }
});

app.post('/api/loans/:id/repayments', async (req, res) => {
  const loanId = Number(req.params.id);
  const amount = Number(req.body.amount);

  if (!Number.isInteger(loanId) || loanId <= 0 || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Un montant positif est requis.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const loanResult = await client.query('SELECT * FROM loans WHERE id = $1 FOR UPDATE', [loanId]);
    if (loanResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Prêt non trouvé.' });
    }

    const loan = loanResult.rows[0];
    const paidAmountResult = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS paid_amount
      FROM loan_repayments
      WHERE loan_id = $1
    `, [loanId]);
    const paidAmount = Number(paidAmountResult.rows[0].paid_amount);
    const remaining = Number((Number(loan.total_amount) - paidAmount).toFixed(2));
    const repaymentAmount = Number(amount.toFixed(2));

    if (repaymentAmount <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Le remboursement doit être d’au moins 0,01 FCFA.' });
    }

    if (remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce prêt est déjà entièrement remboursé.' });
    }
    if (repaymentAmount > remaining) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Le remboursement dépasse le solde restant de ${remaining.toFixed(2)} FCFA.`,
      });
    }

    const repaymentResult = await client.query(`
      INSERT INTO loan_repayments (loan_id, amount)
      VALUES ($1, $2)
      RETURNING *
    `, [loanId, repaymentAmount]);
    const newRemaining = Number((remaining - repaymentAmount).toFixed(2));
    const status = newRemaining === 0 ? 'paid' : 'active';

    await client.query(`
      UPDATE loans
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [status, loanId]);
    await client.query('COMMIT');

    res.status(201).json({
      ...repaymentResult.rows[0],
      remaining: newRemaining,
      status
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur SQL (POST /api/loans/:id/repayments) :', error.message);
    res.status(500).json({ error: 'Impossible d’enregistrer le remboursement.' });
  } finally {
    client?.release();
  }
});

// -------------------------------------------------------------------------
// 7. Paiements et notifications
// -------------------------------------------------------------------------
async function createNotification({ user_id, title, message, type = 'info' }, database = pool) {
  if (!user_id || !title || !message) return null;

  const result = await database.query(`
    INSERT INTO notifications (user_id, title, message, type)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [user_id, title, message, type]);

  return result.rows[0];
}

app.get('/api/payments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.full_name, s.title AS session_title
      FROM payments p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN sessions s ON s.id = p.session_id
      ORDER BY p.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/payments) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les paiements.' });
  }
});

app.post('/api/payments', async (req, res) => {
  const { user_id, session_id, amount, method, reference, status } = req.body;
  const memberId = Number(user_id);
  const numericAmount = Number(amount);
  const paymentMethod = method || 'mobile_money';
  const paymentStatus = status || 'pending';
  const allowedMethods = ['mobile_money', 'bank_transfer', 'cash'];
  const allowedStatuses = ['pending', 'paid', 'failed'];

  if (!Number.isInteger(memberId) || memberId <= 0 || !Number.isFinite(numericAmount) || numericAmount <= 0 ||
      !allowedMethods.includes(paymentMethod) || !allowedStatuses.includes(paymentStatus)) {
    return res.status(400).json({
      error: 'Vérifiez le membre, le montant, la méthode et le statut du paiement.',
    });
  }

  const sessionId = session_id ? Number(session_id) : null;
  if (sessionId !== null && (!Number.isInteger(sessionId) || sessionId <= 0)) {
    return res.status(400).json({ error: 'La session sélectionnée est invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO payments (user_id, session_id, amount, method, reference, status, paid_at)
      VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END)
      RETURNING *
    `, [memberId, sessionId, numericAmount, paymentMethod, reference || '', paymentStatus]);

    await createNotification({
      user_id: memberId,
      title: 'Paiement enregistré',
      message: `Un paiement de ${numericAmount.toFixed(2)} FCFA a été enregistré pour la session ${sessionId || 'générale'}.`,
      type: 'payment'
    }, client);
    await client.query('COMMIT');

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur SQL (POST /api/payments) :', error.message);
    res.status(500).json({ error: 'Impossible d’enregistrer le paiement.' });
  } finally {
    client?.release();
  }
});

app.get('/api/notifications', async (req, res) => {
  const { user_id } = req.query;

  try {
    let query = `
      SELECT n.*, u.full_name
      FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC
    `;
    const params = [];

    if (user_id) {
      query = `
        SELECT n.*, u.full_name
        FROM notifications n
        LEFT JOIN users u ON u.id = n.user_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC
      `;
      params.push(user_id);
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/notifications) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les notifications.' });
  }
});

app.post('/api/notifications', async (req, res) => {
  const { user_id, title, message, type } = req.body;

  if (!user_id || !title || !message) {
    return res.status(400).json({ error: 'Le membre, le titre et le message sont requis.' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [user_id, title, message, type || 'info']);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/notifications) :', error.message);
    res.status(500).json({ error: 'Impossible d’envoyer la notification.' });
  }
});

// -------------------------------------------------------------------------
// 8. Démarrage du serveur
// -------------------------------------------------------------------------
(async () => {
  try {
    await initializeAuthentication();
    app.listen(PORT, () => {
      console.log(`Serveur démarré sur http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Impossible d’initialiser l’authentification :', error.message);
    process.exit(1);
  }
})();