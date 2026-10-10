require('dotenv').config();

const express = require('express');
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
    const [contributions, loans, payments, notifications] = await Promise.all([
      pool.query('SELECT id, amount, status, paid_at, created_at FROM contributions WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
      pool.query('SELECT id, amount, interest_rate, total_amount, due_date, status, created_at FROM loans WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
      pool.query('SELECT p.id, p.amount, p.method, p.reference, p.status, p.created_at, s.title AS session_title FROM payments p LEFT JOIN sessions s ON s.id = p.session_id WHERE p.user_id = $1 ORDER BY p.created_at DESC', [req.user.id]),
      pool.query('SELECT id, title, message, type, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id]),
    ]);

    res.json({
      user: req.user,
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

  if (!name || amount === undefined || amount === null || amount === '') {
    return res.status(400).json({
      error: 'Le nom et le montant sont requis.',
    });
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO tontines (name, amount, frequency)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [name, amount, frequency || 'monthly']
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
      SELECT *
      FROM tontines
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur SQL (GET /api/tontines) :', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les tontines.' });
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
  const { id } = req.params;
  const { amount } = req.body;

  if (amount === undefined || amount <= 0) {
    return res.status(400).json({ error: 'Un montant positif est requis.' });
  }

  try {
    const loanResult = await pool.query('SELECT * FROM loans WHERE id = $1', [id]);
    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prêt non trouvé.' });
    }

    const loan = loanResult.rows[0];
    const repaymentResult = await pool.query(`
      INSERT INTO loan_repayments (loan_id, amount)
      VALUES ($1, $2)
      RETURNING *
    `, [id, amount]);

    const paidAmountResult = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) AS paid_amount
      FROM loan_repayments
      WHERE loan_id = $1
    `, [id]);
    const paidAmount = Number(paidAmountResult.rows[0].paid_amount);
    const remaining = Number(loan.total_amount) - paidAmount;
    const status = remaining <= 0 ? 'paid' : 'active';

    await pool.query(`
      UPDATE loans
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [status, id]);

    res.status(201).json({
      ...repaymentResult.rows[0],
      remaining: Number(remaining.toFixed(2)),
      status
    });
  } catch (error) {
    console.error('Erreur SQL (POST /api/loans/:id/repayments) :', error.message);
    res.status(500).json({ error: 'Impossible d’enregistrer le remboursement.' });
  }
});

// -------------------------------------------------------------------------
// 7. Paiements et notifications
// -------------------------------------------------------------------------
async function createNotification({ user_id, title, message, type = 'info' }) {
  if (!user_id || !title || !message) return null;

  const result = await pool.query(`
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

  if (!user_id || amount === undefined || amount === null || amount <= 0) {
    return res.status(400).json({
      error: 'Le membre et un montant positif sont requis.',
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO payments (user_id, session_id, amount, method, reference, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [user_id, session_id || null, amount, method || 'mobile_money', reference || '', status || 'pending']);

    await createNotification({
      user_id,
      title: 'Paiement enregistré',
      message: `Un paiement de ${Number(amount).toFixed(2)} FCFA a été enregistré pour la session ${session_id || 'générale'}.`,
      type: 'payment'
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur SQL (POST /api/payments) :', error.message);
    res.status(500).json({ error: 'Impossible d’enregistrer le paiement.' });
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