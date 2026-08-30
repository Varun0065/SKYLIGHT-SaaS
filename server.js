require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const OAUTH_REDIRECT_URI =
  process.env.NODE_ENV === 'production'
    ? 'https://skylight-saas-8.onrender.com/auth/google/callback'
    : 'http://localhost:3000/auth/google/callback';

const SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? null
    : 'skylight-development-only-secret-change-me');

if (
  process.env.NODE_ENV === 'production' &&
  (!SECRET || SECRET.length < 32)
) {
  throw new Error(
    'JWT_SECRET must be set to a strong 32+ character secret in production'
  );
}

const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PAYMENT_LINK = 'https://razorpay.me/@imperialaura6959';

const usePostgres = !!process.env.DATABASE_URL;
const jsonFile = path.join(__dirname, 'data', 'db.json');

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Referrer-Policy',
    'strict-origin-when-cross-origin'
  );
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';

  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');

    if (i > 0) {
      const key = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();

      try {
        out[key] = decodeURIComponent(value);
      } catch (_) {
        out[key] = value;
      }
    }
  });

  return out;
}

function appendCookie(res, value) {
  res.append('Set-Cookie', value);
}

function setAuthCookie(res, token) {
  appendCookie(
    res,
    `skylight_token=${encodeURIComponent(token)}; Max-Age=${Math.floor(
      COOKIE_MAX_AGE / 1000
    )}; Path=/; HttpOnly; SameSite=Lax${
      COOKIE_SECURE ? '; Secure' : ''
    }`
  );
}

function clearCookie(res, name) {
  appendCookie(
    res,
    `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
      COOKIE_SECURE ? '; Secure' : ''
    }`
  );
}

/*
 * OAuth state
 *
 * Stateless signed state means Render does not need to remember
 * the state in server memory between the Google/Microsoft request
 * and the OAuth callback.
 */
function createOAuthState() {
  return jwt.sign(
    {
      purpose: 'oauth_state',
      nonce: crypto.randomBytes(32).toString('hex')
    },
    SECRET,
    {
      expiresIn: '10m'
    }
  );
}

function consumeOAuthState(state) {
  try {
    const payload = jwt.verify(state, SECRET);

    return !!payload && payload.purpose === 'oauth_state';
  } catch (_) {
    return false;
  }
}

const rateBuckets = new Map();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + '|' + req.path;
    const now = Date.now();

    let bucket = rateBuckets.get(key);

    if (!bucket || now - bucket.start >= windowMs) {
      bucket = {
        start: now,
        count: 0
      };
    }

    bucket.count++;
    rateBuckets.set(key, bucket);

    if (bucket.count > max) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.'
      });
    }

    next();
  };
}

const authRateLimit = rateLimit(10, 15 * 60 * 1000);
const oauthRateLimit = rateLimit(20, 15 * 60 * 1000);

let pool;

if (usePostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    max: 10,
    idleTimeoutMillis: 30000
  });
}

const id = (prefix) =>
  prefix +
  '_' +
  Date.now().toString(36) +
  Math.random().toString(36).slice(2, 8);

const safe = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  plan: u.plan,
  createdAt: u.created_at || u.createdAt
});

const plans = {
  Starter: 599,
  Growth: 999,
  Pro: 1299,
  Business: 1599,
  Scale: 1799,
  Agency: 1899,
  Enterprise: 1999,
  Premium: 2000,
  Ultimate: 2000,
  Elite: 2000
};

function auth(req, res, next) {
  try {
    const cookies = parseCookies(req);

    const token =
      (req.headers.authorization || '').replace(
        /^Bearer\s+/i,
        ''
      ) || cookies.skylight_token;

    if (!token) {
      throw new Error('missing token');
    }

    req.user = jwt.verify(token, SECRET);
    next();
  } catch (_) {
    res.status(401).json({
      error: 'Login required'
    });
  }
}

async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      plan TEXT NOT NULL DEFAULT 'Starter',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      company TEXT DEFAULT '',
      value NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      client TEXT DEFAULT 'Internal',
      budget NUMERIC NOT NULL DEFAULT 0,
      progress NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number TEXT NOT NULL,
      client TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      due TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      type TEXT DEFAULT 'activity',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'Pending',
      payment_link TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'local';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS provider_id TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider
      ON users(provider, provider_id)
      WHERE provider_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_clients_user
      ON clients(user_id);

    CREATE INDEX IF NOT EXISTS idx_projects_user
      ON projects(user_id);

    CREATE INDEX IF NOT EXISTS idx_invoices_user
      ON invoices(user_id);

    CREATE INDEX IF NOT EXISTS idx_activities_user
      ON activities(user_id);

    CREATE INDEX IF NOT EXISTS idx_payments_user
      ON payment_requests(user_id);
  `);
}

/*
 * Local fallback for development.
 */
function ensureJson() {
  fs.mkdirSync(path.dirname(jsonFile), {
    recursive: true
  });

  if (!fs.existsSync(jsonFile)) {
    fs.writeFileSync(
      jsonFile,
      JSON.stringify(
        {
          users: [],
          clients: [],
          projects: [],
          invoices: [],
          activities: [],
          paymentRequests: []
        },
        null,
        2
      )
    );
  }
}

function readJson() {
  ensureJson();

  return JSON.parse(
    fs.readFileSync(jsonFile, 'utf8')
  );
}

function writeJson(data) {
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(data, null, 2)
  );
}

async function getUser(userId) {
  if (usePostgres) {
    return (
      await pool.query(
        'SELECT * FROM users WHERE id=$1',
        [userId]
      )
    ).rows[0];
  }

  return readJson().users.find(
    (u) => u.id === userId
  );
}

async function dashboardData(userId) {
  if (usePostgres) {
    const [c, p, i, a] = await Promise.all([
      pool.query(
        `
        SELECT
          id,
          name,
          email,
          company,
          value,
          status,
          created_at AS "createdAt"
        FROM clients
        WHERE user_id=$1
        ORDER BY created_at DESC
        `,
        [userId]
      ),

      pool.query(
        `
        SELECT
          id,
          name,
          client,
          budget,
          progress,
          status,
          created_at AS "createdAt"
        FROM projects
        WHERE user_id=$1
        ORDER BY created_at DESC
        `,
        [userId]
      ),

      pool.query(
        `
        SELECT
          id,
          number,
          client,
          amount,
          due,
          status,
          created_at AS "createdAt"
        FROM invoices
        WHERE user_id=$1
        ORDER BY created_at DESC
        `,
        [userId]
      ),

      pool.query(
        `
        SELECT
          id,
          text,
          type,
          created_at AS "createdAt"
        FROM activities
        WHERE user_id=$1
        ORDER BY created_at DESC
        LIMIT 10
        `,
        [userId]
      )
    ]);

    const clients = c.rows;
    const projects = p.rows;
    const invoices = i.rows;

    return {
      stats: {
        revenue: invoices
          .filter((x) => x.status === 'Paid')
          .reduce(
            (n, x) => n + Number(x.amount),
            0
          ),

        pending: invoices
          .filter((x) => x.status === 'Pending')
          .reduce(
            (n, x) => n + Number(x.amount),
            0
          ),

        clients: clients.length,
        projects: projects.length
      },

      clients,
      projects,
      invoices,
      activities: a.rows
    };
  }

  const data = readJson();

  const clients = data.clients.filter(
    (x) => x.userId === userId
  );

  const projects = data.projects.filter(
    (x) => x.userId === userId
  );

  const invoices = data.invoices.filter(
    (x) => x.userId === userId
  );

  return {
    stats: {
      revenue: invoices
        .filter((x) => x.status === 'Paid')
        .reduce(
          (n, x) => n + Number(x.amount),
          0
        ),

      pending: invoices
        .filter((x) => x.status === 'Pending')
        .reduce(
          (n, x) => n + Number(x.amount),
          0
        ),

      clients: clients.length,
      projects: projects.length
    },

    clients,
    projects,
    invoices,

    activities: data.activities
      .filter((x) => x.userId === userId)
      .slice(-10)
      .reverse()
  };
}

app.post('/api/auth/logout', (req, res) => {
  clearCookie(res, 'skylight_token');
  clearCookie(res, 'skylight_oauth_state');

  res.json({
    ok: true
  });
});

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    app: 'SKYLIGHT SaaS v4',
    database: usePostgres
      ? 'postgresql'
      : 'local-json'
  });
});

/*
 * Normal registration
 */
app.post(
  '/api/auth/register',
  authRateLimit,
  async (req, res) => {
    try {
      let {
        name,
        email,
        password
      } = req.body || {};

      if (
        !name ||
        !email ||
        !password ||
        password.length < 6
      ) {
        return res.status(400).json({
          error:
            'Name, email and 6+ character password required'
        });
      }

      email = email
        .toLowerCase()
        .trim();

      const hash = await bcrypt.hash(
        password,
        10
      );

      const userId = id('usr');

      if (usePostgres) {
        const exists = await pool.query(
          'SELECT id FROM users WHERE email=$1',
          [email]
        );

        if (exists.rowCount) {
          return res.status(409).json({
            error: 'Email already registered'
          });
        }

        const result = await pool.query(
          `
          INSERT INTO users(
            id,
            name,
            email,
            password,
            plan
          )
          VALUES($1,$2,$3,$4,$5)
          RETURNING *
          `,
          [
            userId,
            name.trim(),
            email,
            hash,
            'Starter'
          ]
        );

        const user = result.rows[0];

        const token = jwt.sign(
          {
            id: user.id,
            email: user.email
          },
          SECRET,
          {
            expiresIn: '30d'
          }
        );

        setAuthCookie(res, token);

        return res.json({
          user: safe(user)
        });
      }

      const data = readJson();

      if (
        data.users.some(
          (u) => u.email === email
        )
      ) {
        return res.status(409).json({
          error: 'Email already registered'
        });
      }

      const user = {
        id: userId,
        name: name.trim(),
        email,
        password: hash,
        plan: 'Starter',
        createdAt:
          new Date().toISOString()
      };

      data.users.push(user);

      writeJson(data);

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email
        },
        SECRET,
        {
          expiresIn: '7d'
        }
      );

      setAuthCookie(res, token);

      res.json({
        user: safe(user)
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'Registration failed'
      });
    }
  }
);

/*
 * Normal login
 */
app.post(
  '/api/auth/login',
  authRateLimit,
  async (req, res) => {
    try {
      const email = String(
        req.body.email || ''
      )
        .toLowerCase()
        .trim();

      const user = usePostgres
        ? (
            await pool.query(
              'SELECT * FROM users WHERE email=$1',
              [email]
            )
          ).rows[0]
        : readJson().users.find(
            (x) => x.email === email
          );

      if (
        !user ||
        !(await bcrypt.compare(
          req.body.password || '',
          user.password
        ))
      ) {
        return res.status(401).json({
          error: 'Invalid email or password'
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email
        },
        SECRET,
        {
          expiresIn: '7d'
        }
      );

      setAuthCookie(res, token);

      res.json({
        user: safe(user)
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'Login failed'
      });
    }
  }
);

/*
 * Google OAuth start
 */
app.get(
  '/api/auth/google',
  oauthRateLimit,
  (req, res) => {
    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET
    ) {
      return res.status(503).json({
        error:
          'Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Render Environment.'
      });
    }

    const state = createOAuthState();

    const params = new URLSearchParams({
      client_id:
        process.env.GOOGLE_CLIENT_ID,

      redirect_uri:
        OAUTH_REDIRECT_URI,

      response_type: 'code',

      scope:
        'openid email profile',

      access_type: 'offline',

      prompt: 'select_account',

      state
    });

    res.json({
      url:
        'https://accounts.google.com/o/oauth2/v2/auth?' +
        params.toString()
    });
  }
);

/*
 * Microsoft OAuth start
 */
app.get(
  '/api/auth/microsoft',
  oauthRateLimit,
  (req, res) => {
    if (
      !process.env.MICROSOFT_CLIENT_ID ||
      !process.env.MICROSOFT_CLIENT_SECRET ||
      !process.env.MICROSOFT_REDIRECT_URI
    ) {
      return res.status(503).json({
        error:
          'Microsoft sign-in is not configured. Add MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_REDIRECT_URI.'
      });
    }

    const state = createOAuthState();

    const params = new URLSearchParams({
      client_id:
        process.env.MICROSOFT_CLIENT_ID,

      response_type: 'code',

      redirect_uri:
        process.env.MICROSOFT_REDIRECT_URI,

      response_mode: 'query',

      scope:
        'openid profile email User.Read',

      state
    });

    res.json({
      url:
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' +
        params.toString()
    });
  }
);

/*
 * Find existing OAuth user or create a new one.
 */
async function oauthLoginOrCreate({
  provider,
  providerId,
  email,
  name
}) {
  email = String(email || '')
    .trim()
    .toLowerCase();

  name = String(
    name ||
      email.split('@')[0] ||
      'User'
  ).trim();

  if (!email) {
    throw new Error(
      'OAuth provider did not return an email address'
    );
  }

  let user = usePostgres
    ? (
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE provider=$1
            AND provider_id=$2
          `,
          [provider, providerId]
        )
      ).rows[0]
    : readJson().users.find(
        (x) =>
          x.provider === provider &&
          x.providerId === providerId
      );

  if (!user) {
    user = usePostgres
      ? (
          await pool.query(
            'SELECT * FROM users WHERE email=$1',
            [email]
          )
        ).rows[0]
      : readJson().users.find(
          (x) => x.email === email
        );

    if (user) {
      if (usePostgres) {
        user = (
          await pool.query(
            `
            UPDATE users
            SET
              provider=$1,
              provider_id=$2,
              name=COALESCE(
                NULLIF($3,''),
                name
              )
            WHERE id=$4
            RETURNING *
            `,
            [
              provider,
              providerId,
              name,
              user.id
            ]
          )
        ).rows[0];
      } else {
        const data = readJson();

        user.provider = provider;
        user.providerId = providerId;

        if (name) {
          user.name = name;
        }

        writeJson(data);
      }
    } else {
      const userId = id('usr');

      if (usePostgres) {
        user = (
          await pool.query(
            `
            INSERT INTO users(
              id,
              name,
              email,
              password,
              provider,
              provider_id,
              plan
            )
            VALUES(
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7
            )
            RETURNING *
            `,
            [
              userId,
              name,
              email,
              '',
              provider,
              providerId,
              'Starter'
            ]
          )
        ).rows[0];
      } else {
        const data = readJson();

        user = {
          id: userId,
          name,
          email,
          password: '',
          provider,
          providerId,
          plan: 'Starter',
          createdAt:
            new Date().toISOString()
        };

        data.users.push(user);

        writeJson(data);
      }
    }
  }

  return {
    token: jwt.sign(
      {
        id: user.id,
        email: user.email
      },
      SECRET,
      {
        expiresIn: '30d'
      }
    ),

    user: safe(user)
  };
}

/*
 * Google OAuth callback
 */
app.get(
  '/auth/google/callback',
  async (req, res) => {
    try {
      if (req.query.error) {
        return res
          .status(400)
          .send(
            'Google sign-in cancelled or denied.'
          );
      }

      const state = String(
        req.query.state || ''
      );

      if (!consumeOAuthState(state)) {
        return res
          .status(400)
          .send(
            'Invalid or expired OAuth state. Please try again.'
          );
      }

      const code = String(
        req.query.code || ''
      );

      if (!code) {
        return res
          .status(400)
          .send(
            'Missing Google authorization code.'
          );
      }

      if (
        !process.env.GOOGLE_CLIENT_ID ||
        !process.env.GOOGLE_CLIENT_SECRET
      ) {
        return res
          .status(503)
          .send(
            'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
          );
      }

      const tokenResponse = await fetch(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },

          body: new URLSearchParams({
            code,

            client_id:
              process.env.GOOGLE_CLIENT_ID,

            client_secret:
              process.env.GOOGLE_CLIENT_SECRET,

            redirect_uri:
              OAUTH_REDIRECT_URI,

            grant_type:
              'authorization_code'
          })
        }
      );

      const tokens =
        await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokens.access_token
      ) {
        throw new Error(
          tokens.error_description ||
            tokens.error ||
            'Google token exchange failed'
        );
      }

      const profileResponse =
        await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: {
              Authorization:
                'Bearer ' +
                tokens.access_token
            }
          }
        );

      const profile =
        await profileResponse.json();

      if (!profileResponse.ok) {
        throw new Error(
          profile.error_description ||
            'Could not read Google profile'
        );
      }

      const result =
        await oauthLoginOrCreate({
          provider: 'google',
          providerId: profile.sub,
          email: profile.email,
          name:
            profile.name ||
            profile.email
        });

      setAuthCookie(
        res,
        result.token
      );

      res.redirect('/');
    } catch (e) {
      console.error(
        'Google OAuth error:',
        e
      );

      res
        .status(500)
        .send(
          'Google sign-in failed: ' +
            e.message
        );
    }
  }
);

/*
 * Microsoft OAuth callback
 */
app.get(
  '/auth/microsoft/callback',
  async (req, res) => {
    try {
      if (req.query.error) {
        return res
          .status(400)
          .send(
            'Microsoft sign-in cancelled or denied.'
          );
      }

      const state = String(
        req.query.state || ''
      );

      if (!consumeOAuthState(state)) {
        return res
          .status(400)
          .send(
            'Invalid or expired OAuth state. Please try again.'
          );
      }

      const code = String(
        req.query.code || ''
      );

      if (!code) {
        return res
          .status(400)
          .send(
            'Missing Microsoft authorization code.'
          );
      }

      if (
        !process.env.MICROSOFT_CLIENT_ID ||
        !process.env.MICROSOFT_CLIENT_SECRET ||
        !process.env.MICROSOFT_REDIRECT_URI
      ) {
        return res
          .status(503)
          .send(
            'Microsoft OAuth is not configured. Add MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_REDIRECT_URI.'
          );
      }

      const tokenResponse = await fetch(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },

          body: new URLSearchParams({
            client_id:
              process.env.MICROSOFT_CLIENT_ID,

            client_secret:
              process.env.MICROSOFT_CLIENT_SECRET,

            code,

            redirect_uri:
              process.env.MICROSOFT_REDIRECT_URI,

            grant_type:
              'authorization_code',

            scope:
              'openid profile email User.Read'
          })
        }
      );

      const tokens =
        await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokens.access_token
      ) {
        throw new Error(
          tokens.error_description ||
            tokens.error ||
            'Microsoft token exchange failed'
        );
      }

      const profileResponse =
        await fetch(
          'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',
          {
            headers: {
              Authorization:
                'Bearer ' +
                tokens.access_token
            }
          }
        );

      const profile =
        await profileResponse.json();

      if (!profileResponse.ok) {
        throw new Error(
          profile.error?.message ||
            'Could not read Microsoft profile'
        );
      }

      const result =
        await oauthLoginOrCreate({
          provider: 'microsoft',
          providerId: profile.id,
          email:
            profile.mail ||
            profile.userPrincipalName,
          name:
            profile.displayName ||
            profile.mail ||
            profile.userPrincipalName
        });

      setAuthCookie(
        res,
        result.token
      );

      res.redirect('/');
    } catch (e) {
      console.error(
        'Microsoft OAuth error:',
        e
      );

      res
        .status(500)
        .send(
          'Microsoft sign-in failed: ' +
            e.message
        );
    }
  }
);

/*
 * Current user
 */
app.get(
  '/api/me',
  auth,
  async (req, res) => {
    try {
      const user = await getUser(
        req.user.id
      );

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      res.json(safe(user));
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'Could not load user'
      });
    }
  }
);

/*
 * Dashboard
 */
app.get(
  '/api/dashboard',
  auth,
  async (req, res) => {
    try {
      res.json(
        await dashboardData(
          req.user.id
        )
      );
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'Could not load dashboard'
      });
    }
  }
);

/*
 * Clients
 */
app.post(
  '/api/clients',
  auth,
  async (req, res) => {
    try {
      const body = req.body || {};

      const item = {
        id: id('cli'),
        userId: req.user.id,
        name: body.name,
        email: body.email || '',
        company: body.company || '',
        value: +body.value || 0,
        status: 'Active',
        createdAt:
          new Date().toISOString()
      };

      if (usePostgres) {
        await pool.query(
          `
          INSERT INTO clients(
            id,
            user_id,
            name,
            email,
            company,
            value,
            status
          )
          VALUES(
            $1,$2,$3,$4,$5,$6,$7
          )
          `,
          [
            item.id,
            item.userId,
            item.name,
            item.email,
            item.company,
            item.value,
            item.status
          ]
        );

        await pool.query(
          `
          INSERT INTO activities(
            id,
            user_id,
            text,
            type
          )
          VALUES($1,$2,$3,$4)
          `,
          [
            id('act'),
            item.userId,
            'Client created: ' +
              item.name,
            'client'
          ]
        );
      } else {
        const data = readJson();

        data.clients.push(item);

        data.activities.push({
          id: id('act'),
          userId: item.userId,
          text:
            'Client created: ' +
            item.name,
          type: 'client',
          createdAt:
            item.createdAt
        });

        writeJson(data);
      }

      res.json(item);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'Could not create client'
      });
    }
  }
);

/*
 * Projects
 */
app.post(
  '/api/projects',
  auth,
  async (req, res) => {
    try {
      const body = req.body || {};
      const progress =
        +body.progress || 0;

      const item = {
        id: id('prj'),
        userId: req.user.id,
        name: body.name,
        client:
          body.client || 'Internal',
        budget: +body.budget || 0,
        progress,
        status:
          progress >= 100
            ? 'Completed'
            : 'Active',
        createdAt:
          new Date().toISOString()
      };

      if (usePostgres) {
        await pool.query(
          `
          INSERT INTO projects(
            id,
            user_id,
            name,
            client,
            budget,
            progress,
            status
          )
          VALUES(
            $1,$2,$3,$4,$5,$6,$7
          )
          `,
          [
            item.id,
            item.userId,
            item.name,
            item.client,
            item.budget,
            item.progress,
            item.status
          ]
        );

        await pool.query(
          `
          INSERT INTO activities(
            id,
            user_id,
            text,
            type
          )
          VALUES($1,$2,$3,$4)
          `,
          [
            id('act'),
            item.userId,
            'Project created: ' +
              item.name,
            'project'
          ]
        );
      } else {
        const data = readJson();

        data.projects.push(item);

        data.activities.push({
          id: id('act'),
          userId: item.userId,
          text:
            'Project created: ' +
            item.name,
          type: 'project',
          createdAt:
            item.createdAt
        });

        writeJson(data);
      }

      res.json(item);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'Could not create project'
      });
    }
  }
);

/*
 * Invoices
 */
app.post(
  '/api/invoices',
  auth,
  async (req, res) => {
    try {
      const body = req.body || {};

      const item = {
        id: id('inv'),
        userId: req.user.id,
        number:
          'INV-' +
          Math.floor(
            10000 +
              Math.random() *
                81999
          ),
        client: body.client,
        amount: +body.amount || 0,
        due: body.due || '',
        status: 'Pending',
        createdAt:
          new Date().toISOString()
      };

      if (usePostgres) {
        await pool.query(
          `
          INSERT INTO invoices(
            id,
            user_id,
            number,
            client,
            amount,
            due,
            status
          )
          VALUES(
            $1,$2,$3,$4,$5,$6,$7
          )
          `,
          [
            item.id,
            item.userId,
            item.number,
            item.client,
            item.amount,
            item.due,
            item.status
          ]
        );

        await pool.query(
          `
          INSERT INTO activities(
            id,
            user_id,
            text,
            type
          )
          VALUES($1,$2,$3,$4)
          `,
          [
            id('act'),
            item.userId,
            'Invoice created: ' +
              item.number,
            'invoice'
          ]
        );
      } else {
        const data = readJson();

        data.invoices.push(item);

        data.activities.push({
          id: id('act'),
          userId: item.userId,
          text:
            'Invoice created: ' +
            item.number,
          type: 'invoice',
          createdAt:
            item.createdAt
        });

        writeJson(data);
      }

      res.json(item);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error:
          'Could not create invoice'
      });
    }
  }
);

/*
 * Mark invoice paid
 */
app.patch(
  '/api/invoices/:id/pay',
  auth,
  async (req, res) => {
    try {
      if (usePostgres) {
        const result =
          await pool.query(
            `
            UPDATE invoices
            SET status=$1
            WHERE id=$2
              AND user_id=$3
            RETURNING
              id,
              number,
              client,
              amount,
              due,
              status,
              created_at AS "createdAt"
            `,
            [
              'Paid',
              req.params.id,
              req.user.id
            ]
          );

        if (!result.rowCount) {
          return res.status(404).json({
            error:
              'Invoice not found'
          });
        }

        return res.json(
          result.rows[0]
        );
      }

      const data = readJson();

      const item =
        data.invoices.find(
          (i) =>
            i.id === req.params.id &&
            i.userId === req.user.id
        );

      if (!item) {
        return res.status(404).json({
          error:
            'Invoice not found'
        });
      }

      item.status = 'Paid';

      writeJson(data);

      res.json(item);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error:
          'Could not update invoice'
      });
    }
  }
);

/*
 * Profile
 */
app.patch(
  '/api/profile',
  auth,
  async (req, res) => {
    try {
      let user;

      if (usePostgres) {
        const result =
          await pool.query(
            `
            UPDATE users
            SET
              name=COALESCE($1,name),
              plan=COALESCE($2,plan)
            WHERE id=$3
            RETURNING *
            `,
            [
              req.body.name || null,
              req.body.plan || null,
              req.user.id
            ]
          );

        user = result.rows[0];
      } else {
        const data = readJson();

        user = data.users.find(
          (x) =>
            x.id === req.user.id
        );

        if (!user) {
          return res.status(404).json({
            error:
              'User not found'
          });
        }

        if (req.body.name) {
          user.name =
            req.body.name;
        }

        if (req.body.plan) {
          user.plan =
            req.body.plan;
        }

        writeJson(data);
      }

      res.json(safe(user));
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error:
          'Could not update profile'
      });
    }
  }
);

/*
 * Billing / payment request
 */
app.post(
  '/api/billing/payment-request',
  auth,
  async (req, res) => {
    try {
      const plan = String(
        req.body.plan || ''
      );

      const amount = Number(
        req.body.amount
      );

      if (
        !plans[plan] ||
        amount !== plans[plan]
      ) {
        return res.status(400).json({
          error:
            'Invalid plan or amount'
        });
      }

      const item = {
        id: id('pay'),
        userId: req.user.id,
        plan,
        amount,
        currency: 'INR',
        status: 'Pending',
        paymentLink:
          PAYMENT_LINK,
        createdAt:
          new Date().toISOString()
      };

      if (usePostgres) {
        await pool.query(
          `
          INSERT INTO payment_requests(
            id,
            user_id,
            plan,
            amount,
            currency,
            status,
            payment_link
          )
          VALUES(
            $1,$2,$3,$4,$5,$6,$7
          )
          `,
          [
            item.id,
            item.userId,
            item.plan,
            item.amount,
            item.currency,
            item.status,
            item.paymentLink
          ]
        );

        await pool.query(
          `
          INSERT INTO activities(
            id,
            user_id,
            text,
            type
          )
          VALUES($1,$2,$3,$4)
          `,
          [
            id('act'),
            item.userId,
            'Payment request created: ' +
              plan +
              ' · ₹' +
              amount,
            'payment'
          ]
        );
      } else {
        const data = readJson();

        data.paymentRequests =
          data.paymentRequests ||
          [];

        data.paymentRequests.push(
          item
        );

        data.activities.push({
          id: id('act'),
          userId: item.userId,
          text:
            'Payment request created: ' +
            plan +
            ' · ₹' +
            amount,
          type: 'payment',
          createdAt:
            item.createdAt
        });

        writeJson(data);
      }

      res.status(201).json(item);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error:
          'Could not create payment request'
      });
    }
  }
);

/*
 * Payment requests
 */
app.get(
  '/api/billing/payment-requests',
  auth,
  async (req, res) => {
    try {
      if (usePostgres) {
        return res.json(
          (
            await pool.query(
              `
              SELECT
                id,
                plan,
                amount,
                currency,
                status,
                payment_link AS "paymentLink",
                created_at AS "createdAt",
                verified_at AS "verifiedAt"
              FROM payment_requests
              WHERE user_id=$1
              ORDER BY created_at DESC
              `,
              [req.user.id]
            )
          ).rows
        );
      }

      const data = readJson();

      res.json(
        (data.paymentRequests || [])
          .filter(
            (x) =>
              x.userId ===
              req.user.id
          )
          .reverse()
      );
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error:
          'Could not load payments'
      });
    }
  }
);

/*
 * Temporary/manual verification endpoint.
 */
app.patch(
  '/api/billing/payment-requests/:id/activate',
  auth,
  async (req, res) => {
    return res.status(409).json({
      error:
        'Payment verification is required before a plan can be activated. Use the payment provider webhook/verification flow.'
    });
  }
);

/*
 * Database info
 */
app.get(
  '/api/db-info',
  auth,
  async (req, res) => {
    res.json({
      database: usePostgres
        ? 'PostgreSQL'
        : 'Local JSON',

      note: usePostgres
        ? 'User data is stored in the connected PostgreSQL database.'
        : 'Set DATABASE_URL to use PostgreSQL in production.'
    });
  }
);

/*
 * SPA fallback
 */
app.get(
  /.*/,
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);

/*
 * Start server
 */
async function start() {
  try {
    if (
      process.env.NODE_ENV ===
        'production' &&
      !process.env.DATABASE_URL
    ) {
      throw new Error(
        'DATABASE_URL must be set in production'
      );
    }

    if (usePostgres) {
      await initPostgres();

      console.log(
        'PostgreSQL connected and schema ready'
      );
    } else {
      ensureJson();

      console.log(
        'DATABASE_URL not set — using local data/db.json for development'
      );
    }

    app.listen(
      PORT,
      () => {
        console.log(
          'SKYLIGHT running on ' +
            PORT
        );
      }
    );
  } catch (e) {
    console.error(
      'Startup failed:',
      e
    );

    process.exit(1);
  }
}

start();