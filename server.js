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
const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'skylight-development-only-secret-change-me');
if (process.env.NODE_ENV === 'production' && (!SECRET || SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a strong 32+ character secret in production');
}
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PAYMENT_LINK = 'https://razorpay.me/@imperialaura6959';
const usePostgres = !!process.env.DATABASE_URL;
const jsonFile = path.join(__dirname, 'data', 'db.json');

app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function parseCookies(req){
  const out={};
  const raw=req.headers.cookie||'';
  raw.split(';').forEach(part=>{const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())});
  return out;
}
function appendCookie(res, value){res.append('Set-Cookie', value)}
function setAuthCookie(res, token){
  appendCookie(res, `skylight_token=${encodeURIComponent(token)}; Max-Age=${Math.floor(COOKIE_MAX_AGE/1000)}; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE?'; Secure':''}`);
}
function clearCookie(res,name){appendCookie(res, `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE?'; Secure':''}`)}
function validOAuthState(expected, actual){
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
function setOAuthState(res,state){appendCookie(res, `skylight_oauth_state=${encodeURIComponent(state)}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE?'; Secure':''}`)}

const rateBuckets = new Map();
function rateLimit(max, windowMs){
  return (req,res,next)=>{
    const key=req.ip+'|'+req.path; const now=Date.now(); let b=rateBuckets.get(key);
    if(!b || now-b.start>=windowMs) b={start:now,count:0}; b.count++; rateBuckets.set(key,b);
    if(b.count>max) return res.status(429).json({error:'Too many requests. Please try again later.'});
    next();
  };
}
const authRateLimit=rateLimit(10,15*60*1000);
const oauthRateLimit=rateLimit(20,15*60*1000);

let pool;
if (usePostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000
  });
}

const id = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const safe = u => ({ id: u.id, name: u.name, email: u.email, plan: u.plan, createdAt: u.created_at || u.createdAt });
const plans = { Starter: 599, Growth: 999, Pro: 1299, Business: 1599, Scale: 1799, Agency: 1899, Enterprise: 1999, Premium: 2000, Ultimate: 2000, Elite: 2000 };

function auth(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || cookies.skylight_token;
    if (!token) throw new Error('missing token');
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (_) {
    res.status(401).json({ error: 'Login required' });
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'local';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id) WHERE provider_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
    CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payment_requests(user_id);
  `);
}

// Local fallback keeps VS Code development working when DATABASE_URL is not set.
function ensureJson() {
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  if (!fs.existsSync(jsonFile)) fs.writeFileSync(jsonFile, JSON.stringify({ users: [], clients: [], projects: [], invoices: [], activities: [], paymentRequests: [] }, null, 2));
}
function readJson() { ensureJson(); return JSON.parse(fs.readFileSync(jsonFile, 'utf8')); }
function writeJson(d) { fs.writeFileSync(jsonFile, JSON.stringify(d, null, 2)); }

async function getUser(id) {
  if (usePostgres) return (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  return readJson().users.find(u => u.id === id);
}

async function dashboardData(userId) {
  if (usePostgres) {
    const [c, p, i, a] = await Promise.all([
      pool.query('SELECT id,name,email,company,value,status,created_at AS "createdAt" FROM clients WHERE user_id=$1 ORDER BY created_at DESC', [userId]),
      pool.query('SELECT id,name,client,budget,progress,status,created_at AS "createdAt" FROM projects WHERE user_id=$1 ORDER BY created_at DESC', [userId]),
      pool.query('SELECT id,number,client,amount,due,status,created_at AS "createdAt" FROM invoices WHERE user_id=$1 ORDER BY created_at DESC', [userId]),
      pool.query('SELECT id,text,type,created_at AS "createdAt" FROM activities WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId])
    ]);
    const clients = c.rows, projects = p.rows, invoices = i.rows;
    return { stats: { revenue: invoices.filter(x => x.status === 'Paid').reduce((n, x) => n + Number(x.amount), 0), pending: invoices.filter(x => x.status === 'Pending').reduce((n, x) => n + Number(x.amount), 0), clients: clients.length, projects: projects.length }, clients, projects, invoices, activities: a.rows };
  }
  const d = readJson();
  const clients = d.clients.filter(x => x.userId === userId), projects = d.projects.filter(x => x.userId === userId), invoices = d.invoices.filter(x => x.userId === userId);
  return { stats: { revenue: invoices.filter(x => x.status === 'Paid').reduce((n,x)=>n+x.amount,0), pending: invoices.filter(x=>x.status==='Pending').reduce((n,x)=>n+x.amount,0), clients: clients.length, projects: projects.length }, clients, projects, invoices, activities: d.activities.filter(x=>x.userId===userId).slice(-10).reverse() };
}
app.post('/api/auth/logout', (req, res) => {
  clearCookie(res, 'skylight_token');
  clearCookie(res, 'skylight_oauth_state');
  res.json({ ok: true });
});

app.get('/api/health', async (req, res) => res.json({ ok: true, app: 'SKYLIGHT SaaS v4', database: usePostgres ? 'postgresql' : 'local-json' }));

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  try {
    let { name, email, password } = req.body || {};
    if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Name, email and 6+ character password required' });
    email = email.toLowerCase().trim();
    const hash = await bcrypt.hash(password, 10);
    const userId = id('usr');
    if (usePostgres) {
      const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (exists.rowCount) return res.status(409).json({ error: 'Email already registered' });
      const r = await pool.query('INSERT INTO users(id,name,email,password,plan) VALUES($1,$2,$3,$4,$5) RETURNING *', [userId,name.trim(),email,hash,'Starter']);
      const u = r.rows[0];
      const token = jwt.sign({ id: u.id, email: u.email }, SECRET, { expiresIn: '30d' });
      setAuthCookie(res, token);
      return res.json({ user: safe(u) });
    }
    const d = readJson(); if (d.users.some(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });
    const u = { id:userId,name:name.trim(),email,password:hash,plan:'Starter',createdAt:new Date().toISOString() }; d.users.push(u); writeJson(d);
    const token = jwt.sign({id:u.id,email:u.email},SECRET,{expiresIn:'7d'});
    setAuthCookie(res, token);
    res.json({ user:safe(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    let u = usePostgres ? (await pool.query('SELECT * FROM users WHERE email=$1',[email])).rows[0] : readJson().users.find(x=>x.email===email);
    if (!u || !(await bcrypt.compare(req.body.password || '', u.password))) return res.status(401).json({ error:'Invalid email or password' });
    const token = jwt.sign({id:u.id,email:u.email},SECRET,{expiresIn:'7d'});
    setAuthCookie(res, token);
    res.json({ user:safe(u) });
  } catch (e) { console.error(e); res.status(500).json({ error:'Login failed' }); }
});

app.get('/api/auth/google', oauthRateLimit, (req,res)=>{
  if(!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) return res.status(503).json({error:'Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI in Render Environment.'});
  const state=crypto.randomBytes(32).toString('hex');
  setOAuthState(res,state);
  const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:process.env.GOOGLE_REDIRECT_URI,response_type:'code',scope:'openid email profile',access_type:'offline',prompt:'select_account',state});
  res.json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString()});
});

app.get('/api/auth/microsoft', oauthRateLimit, (req,res)=>{
  if(!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET || !process.env.MICROSOFT_REDIRECT_URI) return res.status(503).json({error:'Microsoft sign-in is not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_REDIRECT_URI in Render Environment.'});
  const state=crypto.randomBytes(32).toString('hex');
  setOAuthState(res,state);
  const params=new URLSearchParams({client_id:process.env.MICROSOFT_CLIENT_ID,response_type:'code',redirect_uri:process.env.MICROSOFT_REDIRECT_URI,response_mode:'query',scope:'openid profile email User.Read',state});
  res.json({url:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?'+params.toString()});
});


async function oauthLoginOrCreate({ provider, providerId, email, name }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || email.split('@')[0] || 'User').trim();
  if (!email) throw new Error('OAuth provider did not return an email address');

  let u = usePostgres
    ? (await pool.query('SELECT * FROM users WHERE provider=$1 AND provider_id=$2', [provider, providerId])).rows[0]
    : readJson().users.find(x => x.provider === provider && x.providerId === providerId);

  if (!u) {
    u = usePostgres
      ? (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0]
      : readJson().users.find(x => x.email === email);

    if (u) {
      if (usePostgres) {
        u = (await pool.query(
          "UPDATE users SET provider=$1, provider_id=$2, name=COALESCE(NULLIF($3,''),name) WHERE id=$4 RETURNING *",
          [provider, providerId, name, u.id]
        )).rows[0];
      } else {
        const d = readJson();
        u.provider = provider; u.providerId = providerId; if (name) u.name = name;
        writeJson(d);
      }
    } else {
      const userId = id('usr');
      if (usePostgres) {
        u = (await pool.query(
          'INSERT INTO users(id,name,email,password,provider,provider_id,plan) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [userId, name, email, '', provider, providerId, 'Starter']
        )).rows[0];
      } else {
        const d = readJson();
        u = { id:userId, name, email, password:'', provider, providerId, plan:'Starter', createdAt:new Date().toISOString() };
        d.users.push(u); writeJson(d);
      }
    }
  }

  return {
    token: jwt.sign({ id: u.id, email: u.email }, SECRET, { expiresIn: '30d' }),
    user: safe(u)
  };
}

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (req.query.error) return res.status(400).send('Google sign-in cancelled or denied.');
    const cookies=parseCookies(req);
    if (!req.query.state || !cookies.skylight_oauth_state || !validOAuthState(String(cookies.skylight_oauth_state), String(req.query.state))) return res.status(400).send('Invalid OAuth state. Please try again.');
    clearCookie(res,'skylight_oauth_state');
    const code = String(req.query.code || '');
    if (!code) return res.status(400).send('Missing Google authorization code.');
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
      return res.status(503).send('Google OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        code,
        client_id:process.env.GOOGLE_CLIENT_ID,
        client_secret:process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:process.env.GOOGLE_REDIRECT_URI,
        grant_type:'authorization_code'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || tokens.error || 'Google token exchange failed');

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers:{Authorization:'Bearer '+tokens.access_token}
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error(profile.error_description || 'Could not read Google profile');

    const result = await oauthLoginOrCreate({
      provider:'google',
      providerId:profile.sub,
      email:profile.email,
      name:profile.name || profile.email
    });
    setAuthCookie(res, result.token);
    res.redirect('/');
  } catch (e) {
    console.error('Google OAuth error:', e);
    res.status(500).send('Google sign-in failed: '+e.message);
  }
});

app.get('/auth/microsoft/callback', async (req, res) => {
  try {
    if (req.query.error) return res.status(400).send('Microsoft sign-in cancelled or denied.');
    const cookies=parseCookies(req);
    if (!req.query.state || !cookies.skylight_oauth_state || !validOAuthState(String(cookies.skylight_oauth_state), String(req.query.state))) return res.status(400).send('Invalid OAuth state. Please try again.');
    clearCookie(res,'skylight_oauth_state');
    const code = String(req.query.code || '');
    if (!code) return res.status(400).send('Missing Microsoft authorization code.');
    if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET || !process.env.MICROSOFT_REDIRECT_URI) {
      return res.status(503).send('Microsoft OAuth is not configured. Add MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_REDIRECT_URI.');
    }

    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        client_id:process.env.MICROSOFT_CLIENT_ID,
        client_secret:process.env.MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri:process.env.MICROSOFT_REDIRECT_URI,
        grant_type:'authorization_code',
        scope:'openid profile email User.Read'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || tokens.error || 'Microsoft token exchange failed');

    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
      headers:{Authorization:'Bearer '+tokens.access_token}
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error(profile.error?.message || 'Could not read Microsoft profile');

    const result = await oauthLoginOrCreate({
      provider:'microsoft',
      providerId:profile.id,
      email:profile.mail || profile.userPrincipalName,
      name:profile.displayName || profile.mail || profile.userPrincipalName
    });
    setAuthCookie(res, result.token);
    res.redirect('/');
  } catch (e) {
    console.error('Microsoft OAuth error:', e);
    res.status(500).send('Microsoft sign-in failed: '+e.message);
  }
});

app.get('/api/me', auth, async (req,res)=>{ const u=await getUser(req.user.id); u?res.json(safe(u)):res.status(404).json({error:'User not found'}); });
app.get('/api/dashboard', auth, async (req,res)=>{ try{res.json(await dashboardData(req.user.id));}catch(e){console.error(e);res.status(500).json({error:'Could not load dashboard'});} });

app.post('/api/clients', auth, async (req,res)=>{ try{const b=req.body||{}, x={id:id('cli'),userId:req.user.id,name:b.name,email:b.email||'',company:b.company||'',value:+b.value||0,status:'Active',createdAt:new Date().toISOString()}; if(usePostgres){await pool.query('INSERT INTO clients(id,user_id,name,email,company,value,status) VALUES($1,$2,$3,$4,$5,$6,$7)',[x.id,x.userId,x.name,x.email,x.company,x.value,x.status]);await pool.query('INSERT INTO activities(id,user_id,text,type) VALUES($1,$2,$3,$4)',[id('act'),x.userId,'Client created: '+x.name,'client']);}else{const d=readJson();d.clients.push(x);d.activities.push({id:id('act'),userId:x.userId,text:'Client created: '+x.name,type:'client',createdAt:x.createdAt});writeJson(d);}res.json(x);}catch(e){console.error(e);res.status(500).json({error:'Could not create client'});} });

app.post('/api/projects', auth, async (req,res)=>{ try{const b=req.body||{}, progress=+b.progress||0, x={id:id('prj'),userId:req.user.id,name:b.name,client:b.client||'Internal',budget:+b.budget||0,progress,status:progress>=100?'Completed':'Active',createdAt:new Date().toISOString()}; if(usePostgres){await pool.query('INSERT INTO projects(id,user_id,name,client,budget,progress,status) VALUES($1,$2,$3,$4,$5,$6,$7)',[x.id,x.userId,x.name,x.client,x.budget,x.progress,x.status]);await pool.query('INSERT INTO activities(id,user_id,text,type) VALUES($1,$2,$3,$4)',[id('act'),x.userId,'Project created: '+x.name,'project']);}else{const d=readJson();d.projects.push(x);d.activities.push({id:id('act'),userId:x.userId,text:'Project created: '+x.name,type:'project',createdAt:x.createdAt});writeJson(d);}res.json(x);}catch(e){console.error(e);res.status(500).json({error:'Could not create project'});} });

app.post('/api/invoices', auth, async (req,res)=>{ try{const b=req.body||{}, x={id:id('inv'),userId:req.user.id,number:'INV-'+Math.floor(10000+Math.random()*81999),client:b.client,amount:+b.amount||0,due:b.due||'',status:'Pending',createdAt:new Date().toISOString()}; if(usePostgres){await pool.query('INSERT INTO invoices(id,user_id,number,client,amount,due,status) VALUES($1,$2,$3,$4,$5,$6,$7)',[x.id,x.userId,x.number,x.client,x.amount,x.due,x.status]);await pool.query('INSERT INTO activities(id,user_id,text,type) VALUES($1,$2,$3,$4)',[id('act'),x.userId,'Invoice created: '+x.number,'invoice']);}else{const d=readJson();d.invoices.push(x);d.activities.push({id:id('act'),userId:x.userId,text:'Invoice created: '+x.number,type:'invoice',createdAt:x.createdAt});writeJson(d);}res.json(x);}catch(e){console.error(e);res.status(500).json({error:'Could not create invoice'});} });

app.patch('/api/invoices/:id/pay', auth, async (req,res)=>{try{if(usePostgres){const r=await pool.query('UPDATE invoices SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING id,number,client,amount,due,status,created_at AS "createdAt"',['Paid',req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Invoice not found'});return res.json(r.rows[0]);}const d=readJson(),x=d.invoices.find(i=>i.id===req.params.id&&i.userId===req.user.id);if(!x)return res.status(404).json({error:'Invoice not found'});x.status='Paid';writeJson(d);res.json(x);}catch(e){res.status(500).json({error:'Could not update invoice'});}});

app.patch('/api/profile', auth, async (req,res)=>{try{let u;if(usePostgres){const r=await pool.query('UPDATE users SET name=COALESCE($1,name), plan=COALESCE($2,plan) WHERE id=$3 RETURNING *',[req.body.name||null,req.body.plan||null,req.user.id]);u=r.rows[0];}else{const d=readJson();u=d.users.find(x=>x.id===req.user.id);if(req.body.name)u.name=req.body.name;if(req.body.plan)u.plan=req.body.plan;writeJson(d);}res.json(safe(u));}catch(e){res.status(500).json({error:'Could not update profile'});}});

app.post('/api/billing/payment-request', auth, async (req,res)=>{try{const plan=String(req.body.plan||''), amount=Number(req.body.amount);if(!plans[plan]||amount!==plans[plan])return res.status(400).json({error:'Invalid plan or amount'});const x={id:id('pay'),userId:req.user.id,plan,amount,currency:'INR',status:'Pending',paymentLink:PAYMENT_LINK,createdAt:new Date().toISOString()};if(usePostgres){await pool.query('INSERT INTO payment_requests(id,user_id,plan,amount,currency,status,payment_link) VALUES($1,$2,$3,$4,$5,$6,$7)',[x.id,x.userId,x.plan,x.amount,x.currency,x.status,x.paymentLink]);await pool.query('INSERT INTO activities(id,user_id,text,type) VALUES($1,$2,$3,$4)',[id('act'),x.userId,'Payment request created: '+plan+' · ₹'+amount,'payment']);}else{const d=readJson();d.paymentRequests=d.paymentRequests||[];d.paymentRequests.push(x);d.activities.push({id:id('act'),userId:x.userId,text:'Payment request created: '+plan+' · ₹'+amount,type:'payment',createdAt:x.createdAt});writeJson(d);}res.status(201).json(x);}catch(e){console.error(e);res.status(500).json({error:'Could not create payment request'});}});

app.get('/api/billing/payment-requests', auth, async (req,res)=>{try{if(usePostgres)return res.json((await pool.query('SELECT id,plan,amount,currency,status,payment_link AS "paymentLink",created_at AS "createdAt",verified_at AS "verifiedAt" FROM payment_requests WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id])).rows);const d=readJson();res.json((d.paymentRequests||[]).filter(x=>x.userId===req.user.id).reverse());}catch(e){res.status(500).json({error:'Could not load payments'});}});

// Temporary/manual verification endpoint. Replace with Razorpay webhook verification when API credentials are configured.
app.patch('/api/billing/payment-requests/:id/activate', auth, async (req,res)=>{
  return res.status(409).json({error:'Payment verification is required before a plan can be activated. Use the payment provider webhook/verification flow.'});
});

app.get('/api/db-info', auth, async (req,res)=>res.json({database:usePostgres?'PostgreSQL':'Local JSON', note:usePostgres?'User data is stored in the connected PostgreSQL database.':'Set DATABASE_URL to use PostgreSQL in production.'}));

app.get(/.*/, (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

async function start(){
  try {
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set in production');
    if(usePostgres){ await initPostgres(); console.log('PostgreSQL connected and schema ready'); } else { ensureJson(); console.log('DATABASE_URL not set — using local data/db.json for development'); } app.listen(PORT,()=>console.log('SKYLIGHT running on '+PORT)); }
  catch(e){ console.error('Startup failed:',e); process.exit(1); }
}
start();
