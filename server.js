const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const query = require('./database');

// ----------------------------------------------------
// READ AND PARSE ENVIRONMENT VARIABLES
// ----------------------------------------------------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    process.env[key] = value;
  });
}

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'nexus_cyberpunk_fallback_secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const ROLE_ADMIN = process.env.ROLE_ADMIN;
const ROLE_SOCIO = process.env.ROLE_SOCIO;

// ----------------------------------------------------
// IN-MEMORY SESSION STORE & HELPERS
// ----------------------------------------------------
const sessions = {}; // sessionId -> { user, expires }

function cleanExpiredSessions() {
  const now = Date.now();
  for (const sid in sessions) {
    if (sessions[sid].expires < now) {
      delete sessions[sid];
    }
  }
}
setInterval(cleanExpiredSessions, 10 * 60 * 1000); // Clean every 10 min

function getOrCreateSession(req, res) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const parts = c.split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });

  let sessionId = cookies.session_id;
  const now = Date.now();
  const sessionAge = 24 * 60 * 60 * 1000; // 24 hours

  if (sessionId && sessions[sessionId] && sessions[sessionId].expires > now) {
    // Session is valid, extend lifetime
    sessions[sessionId].expires = now + sessionAge;
    req.session = sessions[sessionId];
  } else {
    // Create new session
    sessionId = crypto.randomBytes(16).toString('hex');
    sessions[sessionId] = {
      user: null,
      expires: now + sessionAge
    };
    req.session = sessions[sessionId];
    
    // Set cookie
    res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=${24 * 60 * 60}; SameSite=Lax`);
  }
  return sessionId;
}

// Read body helper
function getRequestBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
  });
}

// Response helpers
function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { 'Location': location });
  res.end();
}

// Role validators
function checkAuth(req, res) {
  if (!req.session.user) {
    sendJSON(res, { error: 'Não autenticado' }, 401);
    return false;
  }
  return true;
}

function checkSocio(req, res) {
  if (!checkAuth(req, res)) return false;
  if (!req.session.user.is_socio && !req.session.user.is_admin) {
    sendJSON(res, { error: 'Acesso restrito a Sócios Nexus.' }, 403);
    return false;
  }
  return true;
}

function checkAdmin(req, res) {
  if (!checkAuth(req, res)) return false;
  if (!req.session.user.is_admin) {
    sendJSON(res, { error: 'Acesso restrito a Administradores.' }, 403);
    return false;
  }
  return true;
}

// ----------------------------------------------------
// DISCORD ROLE SYNC METHOD
// ----------------------------------------------------
async function syncDiscordRoles(discordId) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !ROLE_ADMIN || !ROLE_SOCIO) {
    console.log('Sincronização de cargos indisponível (credenciais em falta).');
    return { is_admin: 0, is_socio: 0 };
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`, {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Utilizador ${discordId} não pertence ao servidor Discord.`);
        return { is_admin: 0, is_socio: 0 };
      }
      throw new Error(`Erro na API Discord: ${response.statusText}`);
    }

    const memberData = await response.json();
    const roles = memberData.roles || [];
    
    const is_admin = roles.includes(ROLE_ADMIN) ? 1 : 0;
    const is_socio = roles.includes(ROLE_SOCIO) ? 1 : 0;

    return { is_admin, is_socio };
  } catch (error) {
    console.error('Erro ao ler cargos do Discord:', error.message);
    return null;
  }
}

// ----------------------------------------------------
// DISCORD CHANNEL MESSAGES fallbacks
// ----------------------------------------------------
const MOCK_MESSAGES = {
  '1157363514629955585': [ // Notícias
    { id: '1', author: 'André Alves', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', content: '🔥 Grande Lançamento do novo Portal Nexus! Agora com sincronização direta no Discord e Google. Explora a tua área de sócio!', timestamp: new Date(Date.now() - 3600000).toISOString() },
    { id: '2', author: 'André Alves', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', content: '📢 Abertura das candidaturas para o staff do nosso próximo torneio de Valorant. Visita o canal de candidaturas ou submete ticket!', timestamp: new Date(Date.now() - 86400000).toISOString() }
  ],
  '1450873051842478131': [ // Questionários
    { id: '1', author: 'Nexus Bot', avatar: 'https://cdn.discordapp.com/embed/avatars/2.png', content: '📊 Qual o vosso jogo preferido para este fim de semana?\n1️⃣ Counter-Strike 2\n2️⃣ Valorant\n3️⃣ League of Legends\n4️⃣ Outro (comenta no chat)', timestamp: new Date(Date.now() - 18000000).toISOString() },
    { id: '2', author: 'Nexus Bot', avatar: 'https://cdn.discordapp.com/embed/avatars/2.png', content: '📊 Preferem competições à sexta-feira à noite ou ao sábado à tarde? Vota com reações no Discord!', timestamp: new Date(Date.now() - 172800000).toISOString() }
  ],
  '1157693965605281895': [ // Competições
    { id: '1', author: 'Staff Torneios', avatar: 'https://cdn.discordapp.com/embed/avatars/1.png', content: '🏆 **NEXUS CUP VALORANT #4**\nInscrições abertas! Total de prémios: 100€ + Drops exclusivos de Sócio. Inscreve a tua equipa no canal #competições.', timestamp: new Date(Date.now() - 72000000).toISOString() },
    { id: '2', author: 'Staff Torneios', avatar: 'https://cdn.discordapp.com/embed/avatars/1.png', content: '🎮 Torneio 1v1 de CS2 em modo Aim Map a realizar-se no dia 15 de Junho. Prémios neon para o 1º lugar!', timestamp: new Date(Date.now() - 259200000).toISOString() }
  ],
  '1157693356160336046': [ // Eventos
    { id: '1', author: 'André Alves', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', content: '🎪 **Nexus Gaming Night & Q&A**\nData: 5 de Junho às 21h30.\nConversa aberta sobre o futuro da Nexus e mini-jogos com a comunidade. Não percas!', timestamp: new Date(Date.now() - 43200000).toISOString() },
    { id: '2', author: 'André Alves', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', content: '🍿 Sessão de Cinema Comunitário no Discord: Vamos assistir ao novo filme de animação gamer. Vota no canal exclusivo!', timestamp: new Date(Date.now() - 345600000).toISOString() }
  ],
  '1178797044538810398': [ // Jogos Grátis
    { id: '1', author: 'Epic Bot', avatar: 'https://cdn.discordapp.com/embed/avatars/3.png', content: '🎁 **JOGO GRÁTIS DA SEMANA**\nObtém gratuitamente o jogo *Chivalry 2* na Epic Games Store até à próxima quinta-feira! Corre para resgatar!', timestamp: new Date(Date.now() - 14400000).toISOString() },
    { id: '2', author: 'Steam Bot', avatar: 'https://cdn.discordapp.com/embed/avatars/3.png', content: '🎁 Jogo clássico gratuito para sempre na Steam: *Tomb Raider (2013)*. Adiciona à tua biblioteca esta semana.', timestamp: new Date(Date.now() - 200000000).toISOString() }
  ],
  '1157441147514388490': [ // Giveaways
    { id: '1', author: 'Giveaway Bot', avatar: 'https://cdn.discordapp.com/embed/avatars/4.png', content: '🎉 **SUPER GIVEAWAY NEXUS**\nPremios: 1x Tapete de Rato Gamer XXL RGB da Nexus!\nClica na reação 🎉 no Discord para participar! Sorteio em 48h.', timestamp: new Date(Date.now() - 28800000).toISOString() },
    { id: '2', author: 'Giveaway Bot', avatar: 'https://cdn.discordapp.com/embed/avatars/4.png', content: '🎉 Cartão de Oferta Steam de 20€ oferecido pelo patrocinador principal. Canal exclusivo de drops para sócios.', timestamp: new Date(Date.now() - 432000000).toISOString() }
  ]
};

// ----------------------------------------------------
// THE MAIN WEB SERVER HTTP HANDLER
// ----------------------------------------------------
const server = http.createServer(async (req, res) => {
  const sessionId = getOrCreateSession(req, res);
  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
  const parsedUrl = new URL(req.url, `${proto}://${host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Decorate API route helpers
  const pathParts = pathname.split('/').filter(p => p);

  // ----------------------------------------------------
  // OAuth Routes
  // ----------------------------------------------------
  if (pathname === '/auth/discord' && method === 'GET') {
    const redirectUri = `${parsedUrl.protocol}//${host}/auth/discord/callback`;
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
    redirect(res, discordAuthUrl);
    return;
  }

  if (pathname === '/auth/discord/callback' && method === 'GET') {
    const code = parsedUrl.searchParams.get('code');
    if (!code) return redirect(res, '/?error=discord_auth_failed');
    
    const redirectUri = `${parsedUrl.protocol}//${host}/auth/discord/callback`;

    try {
      // Exchange Code for Access Token
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri
        }).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Falha na troca de código do Discord. Resposta da API:', errorText);
        throw new Error('Falha ao obter tokens.');
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // Fetch Profile
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!userResponse.ok) {
        throw new Error('Falha ao ler perfil Discord.');
      }

      const userData = await userResponse.json();
      const discordId = userData.id;
      const discordUsername = userData.global_name || userData.username;
      const discordAvatar = userData.avatar 
        ? `https://cdn.discordapp.com/avatars/${discordId}/${userData.avatar}.png` 
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(userData.discriminator || '0') % 5}.png`;

      // Fetch Roles via Discord Bot API
      const rolesInfo = await syncDiscordRoles(discordId) || { is_admin: 0, is_socio: 0 };

      let user;
      if (req.session.user) {
        // Linked Account
        user = req.session.user;
        user = await query.updateUser(user.id, {
          discord_id: discordId,
          discord_username: discordUsername,
          discord_avatar: discordAvatar,
          is_admin: rolesInfo.is_admin,
          is_socio: rolesInfo.is_socio,
          last_sync: new Date().toISOString()
        });
      } else {
        // Sign-in
        user = await query.getUserByDiscordId(discordId);
        if (!user) {
          user = await query.createUser({
            discord_id: discordId,
            discord_username: discordUsername,
            discord_avatar: discordAvatar,
            is_admin: rolesInfo.is_admin,
            is_socio: rolesInfo.is_socio,
            xp: 100,
            level: 1
          });
        } else {
          user = await query.updateUser(user.id, {
            discord_username: discordUsername,
            discord_avatar: discordAvatar,
            is_admin: rolesInfo.is_admin,
            is_socio: rolesInfo.is_socio,
            last_sync: new Date().toISOString()
          });
        }
      }

      req.session.user = user;
      redirect(res, '/?sync=success');
    } catch (error) {
      console.error(error);
      redirect(res, '/?error=discord_auth_failed');
    }
    return;
  }

  if (pathname === '/auth/google' && method === 'GET') {
    const redirectUri = `${parsedUrl.protocol}//${host}/auth/google/callback`;
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('profile email')}`;
    redirect(res, googleAuthUrl);
    return;
  }

  if (pathname === '/auth/google/callback' && method === 'GET') {
    const code = parsedUrl.searchParams.get('code');
    if (!code) return redirect(res, '/?error=google_auth_failed');

    const redirectUri = `${parsedUrl.protocol}//${host}/auth/google/callback`;

    try {
      // Exchange Code for Access Token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!tokenResponse.ok) {
        throw new Error('Falha ao obter tokens Google.');
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // Fetch User Info
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!profileResponse.ok) {
        throw new Error('Falha ao obter perfil Google.');
      }

      const profileData = await profileResponse.json();
      const googleId = profileData.id;
      const googleEmail = profileData.email;
      const googleName = profileData.name;
      const googlePicture = profileData.picture;

      let user;
      if (req.session.user) {
        // Linked Google account
        user = req.session.user;
        user = await query.updateUser(user.id, {
          google_id: googleId,
          google_email: googleEmail,
          google_name: googleName,
          google_picture: googlePicture
        });
      } else {
        // Sign-in
        user = await query.getUserByGoogleId(googleId);
        if (!user) {
          // Merge by Email check
          user = await query.getUserByGoogleEmail(googleEmail);
          if (user) {
            user = await query.updateUser(user.id, {
              google_id: googleId,
              google_name: googleName,
              google_picture: googlePicture
            });
          } else {
            user = await query.createUser({
              google_id: googleId,
              google_email: googleEmail,
              google_name: googleName,
              google_picture: googlePicture,
              xp: 100,
              level: 1
            });
          }
        }
      }

      req.session.user = user;
      redirect(res, '/?sync=success');
    } catch (error) {
      console.error(error);
      redirect(res, '/?error=google_auth_failed');
    }
    return;
  }

  // ----------------------------------------------------
  // API Routes
  // ----------------------------------------------------

  // GET User Profiles
  if (pathname === '/api/user/me' && method === 'GET') {
    if (req.session.user) {
      const user = await query.getUserById(req.session.user.id);
      if (user) {
        req.session.user = user;
      }
      return sendJSON(res, { loggedIn: true, user: req.session.user });
    }
    return sendJSON(res, { loggedIn: false });
  }

  // POST Logout
  if (pathname === '/api/logout' && method === 'POST') {
    req.session.user = null;
    return sendJSON(res, { success: true });
  }

  // POST Developer mock login backdoor
  if (pathname === '/api/auth/mock' && method === 'POST') {
    const rawBody = await getRequestBody(req);
    const body = JSON.parse(rawBody || '{}');
    const role = body.role;

    if (role === 'logout') {
      req.session.user = null;
      return sendJSON(res, { success: true });
    }

    let mockUser = {
      discord_id: '9999999999999999',
      discord_username: 'Nexus Tester',
      discord_avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
      google_id: '8888888888888888',
      google_email: 'tester@nexus.pt',
      google_name: 'Nexus Tester',
      google_picture: 'https://cdn.discordapp.com/embed/avatars/1.png',
      is_admin: 0,
      is_socio: 0,
      xp: 580,
      level: 3
    };

    if (role === 'admin') {
      mockUser.is_admin = 1;
      mockUser.is_socio = 1;
      mockUser.discord_username = 'Nexus Admin 👑';
    } else if (role === 'socio') {
      mockUser.is_socio = 1;
      mockUser.discord_username = 'Nexus Sócio 💎';
    }

    let dbUser = await query.getUserByDiscordId(mockUser.discord_id);
    if (!dbUser) {
      dbUser = await query.createUser(mockUser);
    } else {
      dbUser = await query.updateUser(dbUser.id, {
        discord_username: mockUser.discord_username,
        is_admin: mockUser.is_admin,
        is_socio: mockUser.is_socio
      });
    }

    req.session.user = dbUser;
    return sendJSON(res, { success: true, user: dbUser });
  }

  // GET Discord Channel Feeds
  if (pathname === '/api/discord/messages' && method === 'GET') {
    const channelId = parsedUrl.searchParams.get('channelId');
    if (!channelId) return sendJSON(res, { error: 'Falta o parâmetro channelId' }, 400);

    try {
      const cached = await query.getDiscordCache(channelId);
      const now = Date.now();
      const cacheWindow = 5 * 60 * 1000; // 5 mins

      if (cached && (now - new Date(cached.updated_at).getTime() < cacheWindow)) {
        return sendJSON(res, JSON.parse(cached.messages_json));
      }

      if (!DISCORD_BOT_TOKEN) {
        throw new Error('Sem bot token');
      }

      // Fetch fresh messages
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=25`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });

      if (!response.ok) {
        throw new Error(`Erro na API Discord: ${response.statusText}`);
      }

      const discordMsgs = await response.json();
      const formatted = discordMsgs.map(msg => ({
        id: msg.id,
        author: msg.author.global_name || msg.author.username,
        avatar: msg.author.avatar 
          ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` 
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(msg.author.discriminator || '0') % 5}.png`,
        content: msg.content,
        timestamp: msg.timestamp
      }));

      await query.setDiscordCache(channelId, JSON.stringify(formatted));

      // Blend in local real announcements
      const localAnnouncements = await query.getAllAnnouncements();
      const localFiltered = localAnnouncements.filter(a => a.channel_id === channelId);

      return sendJSON(res, [...localFiltered, ...formatted]);
    } catch (err) {
      console.warn(`Feeds Discord para o canal ${channelId} falharam: ${err.message}. Carregando local e cache.`);
      
      const localAnnouncements = await query.getAllAnnouncements();
      const localFiltered = localAnnouncements.filter(a => a.channel_id === channelId);

      const cached = await query.getDiscordCache(channelId);
      if (cached) {
        const cachedMsgs = JSON.parse(cached.messages_json);
        return sendJSON(res, [...localFiltered, ...cachedMsgs]);
      }
      return sendJSON(res, localFiltered);
    }
  }

  // GET / POST Musics suggestions
  if (pathname === '/api/musics' && method === 'GET') {
    const list = await query.getAllMusics();
    return sendJSON(res, list);
  }

  if (pathname === '/api/musics' && method === 'POST') {
    if (!checkAuth(req, res)) return;
    const rawBody = await getRequestBody(req);
    const body = JSON.parse(rawBody || '{}');
    const { title, artist, url } = body;

    if (!title || !url) {
      return sendJSON(res, { error: 'Título e URL são obrigatórios' }, 400);
    }

    const validUrl = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('spotify.com') || url.includes('soundcloud.com');
    if (!validUrl) {
      return sendJSON(res, { error: 'URL do Spotify, YouTube ou SoundCloud inválido.' }, 400);
    }

    const u = req.session.user;
    const username = u.discord_username || u.google_name || 'Membro';
    const authorId = u.discord_id || 'google_' + u.google_id;

    const result = await query.createMusic(title, artist || 'Desconhecido', url, authorId, username);
    
    // Give +10 XP
    const newXp = (u.xp || 0) + 10;
    const newLvl = Math.floor(newXp / 100) + 1;
    await query.updateUser(u.id, { xp: newXp, level: newLvl });

    return sendJSON(res, { success: true, id: result.id });
  }

  // POST Music Like upvotes: /api/musics/:id/like
  if (pathParts[0] === 'api' && pathParts[1] === 'musics' && pathParts[3] === 'like' && method === 'POST') {
    if (!checkAuth(req, res)) return;
    const musicId = pathParts[2];
    const u = req.session.user;
    const userDiscordId = u.discord_id || 'google_' + u.google_id;

    const result = await query.toggleMusicLike(musicId, userDiscordId);
    if (!result.success) {
      return sendJSON(res, { error: result.error }, 400);
    }
    return sendJSON(res, result);
  }

  // DELETE Music (Admin Moderation): /api/admin/musics/:id
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'musics' && method === 'DELETE') {
    if (!checkAdmin(req, res)) return;
    const musicId = pathParts[3];
    await query.deleteMusic(musicId);
    return sendJSON(res, { success: true });
  }

  // GET / POST Support Tickets
  if (pathname === '/api/tickets' && method === 'GET') {
    if (!checkAuth(req, res)) return;
    const u = req.session.user;
    let list;
    if (u.is_admin) {
      list = await query.getAllTickets();
    } else {
      const creatorId = u.discord_id || 'google_' + u.google_id;
      list = await query.getTicketsByCreator(creatorId);
    }
    // Sort tickets descending by updated_at time
    list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return sendJSON(res, list);
  }

  if (pathname === '/api/tickets' && method === 'POST') {
    if (!checkAuth(req, res)) return;
    const rawBody = await getRequestBody(req);
    const body = JSON.parse(rawBody || '{}');
    const { title, description, category } = body;

    if (!title || !description || !category) {
      return sendJSON(res, { error: 'Faltam campos obrigatórios' }, 400);
    }

    const u = req.session.user;
    const username = u.discord_username || u.google_name;
    const creatorId = u.discord_id || 'google_' + u.google_id;
    const ticketId = 'TICKET-' + Math.floor(1000 + Math.random() * 9000);

    await query.createTicket(ticketId, title, description, category, creatorId, username);
    
    // Set first message inside ticket log
    const pic = u.discord_avatar || u.google_picture || 'https://cdn.discordapp.com/embed/avatars/0.png';
    await query.createTicketMessage(ticketId, creatorId, username, pic, description, u.is_admin === 1);

    return sendJSON(res, { success: true, ticketId });
  }

  // GET / POST messages in Support Tickets: /api/tickets/:id/messages
  if (pathParts[0] === 'api' && pathParts[1] === 'tickets' && pathParts[3] === 'messages') {
    if (!checkAuth(req, res)) return;
    const ticketId = pathParts[2];
    const u = req.session.user;
    const creatorId = u.discord_id || 'google_' + u.google_id;

    const ticket = await query.getTicketById(ticketId);
    if (!ticket) return sendJSON(res, { error: 'Ticket não encontrado' }, 404);

    // Gate check
    if (!u.is_admin && ticket.created_by_discord_id !== creatorId) {
      return sendJSON(res, { error: 'Acesso Proibido' }, 403);
    }

    if (method === 'GET') {
      const messages = await query.getTicketMessages(ticketId);
      return sendJSON(res, { ticket, messages });
    }

    if (method === 'POST') {
      if (ticket.status === 'closed') return sendJSON(res, { error: 'Ticket está fechado' }, 400);

      const rawBody = await getRequestBody(req);
      const body = JSON.parse(rawBody || '{}');
      const { message } = body;

      if (!message) return sendJSON(res, { error: 'Mensagem vazia' }, 400);

      const username = u.discord_username || u.google_name;
      const pic = u.discord_avatar || u.google_picture || 'https://cdn.discordapp.com/embed/avatars/0.png';

      await query.createTicketMessage(ticketId, creatorId, username, pic, message, u.is_admin === 1);
      return sendJSON(res, { success: true });
    }
  }

  // POST Close support Ticket: /api/tickets/:id/close
  if (pathParts[0] === 'api' && pathParts[1] === 'tickets' && pathParts[3] === 'close' && method === 'POST') {
    if (!checkAuth(req, res)) return;
    const ticketId = pathParts[2];
    const u = req.session.user;
    const creatorId = u.discord_id || 'google_' + u.google_id;

    const ticket = await query.getTicketById(ticketId);
    if (!ticket) return sendJSON(res, { error: 'Ticket não encontrado' }, 404);

    if (!u.is_admin && ticket.created_by_discord_id !== creatorId) {
      return sendJSON(res, { error: 'Acesso Proibido' }, 403);
    }

    await query.updateTicketStatus(ticketId, 'closed');
    await query.createTicketMessage(ticketId, 'system', 'Sistema Nexus', 'https://cdn.discordapp.com/embed/avatars/4.png', '🔒 Ticket fechado pelo utilizador/administrador.', false);

    return sendJSON(res, { success: true });
  }

  // GET / POST Member exclusive chat logs
  if (pathname === '/api/socio/chat') {
    if (!checkSocio(req, res)) return;

    if (method === 'GET') {
      const messages = await query.getSocioChatMessages();
      return sendJSON(res, messages);
    }

    if (method === 'POST') {
      const rawBody = await getRequestBody(req);
      const body = JSON.parse(rawBody || '{}');
      const { message } = body;

      if (!message) return sendJSON(res, { error: 'Mensagem vazia' }, 400);

      const u = req.session.user;
      const username = u.discord_username || u.google_name;
      const senderId = u.discord_id || 'google_' + u.google_id;
      const pic = u.discord_avatar || u.google_picture || 'https://cdn.discordapp.com/embed/avatars/0.png';

      await query.createSocioChatMessage(senderId, username, pic, message);
      
      // Award +5 XP
      const newXp = (u.xp || 0) + 5;
      const newLvl = Math.floor(newXp / 100) + 1;
      await query.updateUser(u.id, { xp: newXp, level: newLvl });

      return sendJSON(res, { success: true });
    }
  }

  // GET Global Ranking (Leaderboard)
  if (pathname === '/api/ranking' && method === 'GET') {
    const list = await query.getAllUsers();
    // Sort descending by XP, then levels
    list.sort((a, b) => b.xp - a.xp || b.level - a.level);
    
    // Pick relevant public columns only
    const publicList = list.slice(0, 25).map(u => ({
      discord_username: u.discord_username,
      google_name: u.google_name,
      discord_avatar: u.discord_avatar,
      google_picture: u.google_picture,
      is_socio: u.is_socio,
      is_admin: u.is_admin,
      xp: u.xp,
      level: u.level
    }));
    return sendJSON(res, publicList);
  }

  // POST Adjust XP (Admin Controls)
  if (pathname === '/api/admin/set-xp' && method === 'POST') {
    if (!checkAdmin(req, res)) return;

    const rawBody = await getRequestBody(req);
    const body = JSON.parse(rawBody || '{}');
    const { username, xpAmount } = body;

    if (!username || xpAmount === undefined) {
      return sendJSON(res, { error: 'Especifica o nome de utilizador e quantidade de XP' }, 400);
    }

    const allUsers = await query.getAllUsers();
    const uObj = allUsers.find(u => u.discord_username === username || u.google_name === username);

    if (!uObj) return sendJSON(res, { error: 'Utilizador não encontrado no site.' }, 404);

    const targetXp = Math.max(0, parseInt(xpAmount));
    const targetLvl = Math.floor(targetXp / 100) + 1;

    await query.updateUser(uObj.id, { xp: targetXp, level: targetLvl });

    return sendJSON(res, { success: true, message: `O XP de ${username} foi redefinido para ${targetXp} (Nível ${targetLvl})` });
  }

  // GET Online Member Count
  if (pathname === '/api/online-count' && method === 'GET') {
    try {
      const response = await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/widget.json`);
      if (response.ok) {
        const widgetData = await response.json();
        return sendJSON(res, { online: widgetData.presence_count || 42 });
      }
    } catch (e) {
      // Fallback
    }
    const activeSessions = Object.keys(sessions).length;
    const baseOnline = 28 + (activeSessions * 2) + Math.floor(Math.random() * 8);
    return sendJSON(res, { online: baseOnline });
  }

  // GET Announcements
  if (pathname === '/api/announcements' && method === 'GET') {
    const list = await query.getAllAnnouncements();
    return sendJSON(res, list);
  }

  // POST Create Announcement (Admin Only)
  if (pathname === '/api/announcements' && method === 'POST') {
    if (!checkAdmin(req, res)) return;
    const rawBody = await getRequestBody(req);
    const body = JSON.parse(rawBody || '{}');
    const { channelId, title, content } = body;

    if (!channelId || !title || !content) {
      return sendJSON(res, { error: 'Preencha todos os campos obrigatórios' }, 400);
    }

    const u = req.session.user;
    const authorName = u.discord_username || u.google_name || 'Admin';
    const authorAvatar = u.discord_avatar || u.google_picture || 'https://cdn.discordapp.com/embed/avatars/0.png';

    const result = await query.createAnnouncement(channelId, title, content, authorName, authorAvatar);
    return sendJSON(res, { success: true, announcement: result });
  }

  // DELETE Announcement (Admin Only): /api/announcements/:id
  if (pathParts[0] === 'api' && pathParts[1] === 'announcements' && method === 'DELETE') {
    if (!checkAdmin(req, res)) return;
    const announcementId = pathParts[2];
    await query.deleteAnnouncement(announcementId);
    return sendJSON(res, { success: true });
  }

  // ----------------------------------------------------
  // Static Files Server (Fallthrough)
  // ----------------------------------------------------
  if (method === 'GET') {
    const fileUrl = pathname === '/' ? 'index.html' : pathname;
    const staticFilePath = path.join(__dirname, fileUrl);
    const normalizedPath = path.normalize(staticFilePath);

    // Block path traversals
    if (!normalizedPath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Acesso Proibido');
      return;
    }

    fs.stat(normalizedPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Página não encontrada');
        return;
      }

      // Map matching content mime types
      const ext = path.extname(normalizedPath).toLowerCase();
      let contentType = 'text/plain; charset=utf-8';
      if (ext === '.html') contentType = 'text/html; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css; charset=utf-8';
      else if (ext === '.js') contentType = 'application/javascript; charset=utf-8';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.svg') contentType = 'image/svg+xml';
      else if (ext === '.ico') contentType = 'image/x-icon';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(normalizedPath).pipe(res);
    });
    return;
  }

  // Not Found fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Rota não encontrada');
});

// Launch server listen listener
server.listen(PORT, () => {
  console.log(`⚡ Servidor Nexus a correr na porta ${PORT} (Sem dependências NPM!)`);
  console.log(`👑 Sandbox Dev Bypass ativo: usa o painel no canto inferior do site para testar perfis!`);
});
