const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');

// Initialize database schema/defaults
let data = {
  users: [],
  musics: [],
  music_likes: [], // { music_id, user_discord_id }
  tickets: [],
  ticket_messages: [],
  socio_chat: [],
  discord_cache: {}, // { channel_id: { messages_json, updated_at } }
  announcements: []
};

// Load existing database if file exists
if (fs.existsSync(dbPath)) {
  try {
    const raw = fs.readFileSync(dbPath, 'utf-8');
    if (raw.trim()) {
      data = JSON.parse(raw);
    }
  } catch (error) {
    console.error('Falha ao ler db.json, inicializando com valores padrão:', error.message);
  }
} else {
  save();
}

// Persist helper
function save() {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Falha ao persistir dados no db.json:', error.message);
  }
}

// Database query helpers
const query = {
  // Users APIs
  async getUserById(id) {
    return data.users.find(u => u.id === id) || null;
  },

  async getUserByDiscordId(discordId) {
    return data.users.find(u => u.discord_id === discordId) || null;
  },

  async getUserByGoogleId(googleId) {
    return data.users.find(u => u.google_id === googleId) || null;
  },

  async getUserByGoogleEmail(email) {
    return data.users.find(u => u.google_email === email) || null;
  },

  async createUser(userObj) {
    const nextId = data.users.length > 0 ? Math.max(...data.users.map(u => u.id)) + 1 : 1;
    const newUser = {
      id: nextId,
      discord_id: userObj.discord_id || null,
      discord_username: userObj.discord_username || null,
      discord_avatar: userObj.discord_avatar || null,
      google_id: userObj.google_id || null,
      google_email: userObj.google_email || null,
      google_name: userObj.google_name || null,
      google_picture: userObj.google_picture || null,
      is_admin: userObj.is_admin || 0,
      is_socio: userObj.is_socio || 0,
      xp: userObj.xp !== undefined ? userObj.xp : 100,
      level: userObj.level !== undefined ? userObj.level : 1,
      last_sync: new Date().toISOString()
    };
    data.users.push(newUser);
    save();
    return newUser;
  },

  async updateUser(id, updateObj) {
    const idx = data.users.findIndex(u => u.id === id);
    if (idx !== -1) {
      data.users[idx] = { ...data.users[idx], ...updateObj };
      save();
      return data.users[idx];
    }
    return null;
  },

  async getAllUsers() {
    return [...data.users];
  },

  // Music APIs
  async getAllMusics() {
    return [...data.musics].sort((a, b) => b.likes - a.likes || b.id - a.id);
  },

  async createMusic(title, artist, url, submittedById, submittedByUsername) {
    const nextId = data.musics.length > 0 ? Math.max(...data.musics.map(m => m.id)) + 1 : 1;
    const newMusic = {
      id: nextId,
      title,
      artist,
      url,
      submitted_by_discord_id: submittedById,
      submitted_by_username: submittedByUsername,
      submitted_at: new Date().toISOString(),
      likes: 0
    };
    data.musics.push(newMusic);
    save();
    return newMusic;
  },

  async toggleMusicLike(musicId, userDiscordId) {
    const mId = parseInt(musicId);
    const likeIndex = data.music_likes.findIndex(l => l.music_id === mId && l.user_discord_id === userDiscordId);
    const music = data.musics.find(m => m.id === mId);
    
    if (!music) return { success: false, error: 'Música não encontrada' };

    let liked = false;
    if (likeIndex !== -1) {
      // Remove like
      data.music_likes.splice(likeIndex, 1);
      music.likes = Math.max(0, music.likes - 1);
    } else {
      // Add like
      data.music_likes.push({ music_id: mId, user_discord_id: userDiscordId });
      music.likes = (music.likes || 0) + 1;
      liked = true;
    }
    save();
    return { success: true, liked };
  },

  async deleteMusic(musicId) {
    const mId = parseInt(musicId);
    data.musics = data.musics.filter(m => m.id !== mId);
    data.music_likes = data.music_likes.filter(l => l.music_id !== mId);
    save();
    return true;
  },

  // Ticket APIs
  async getTicketsByCreator(creatorId) {
    return data.tickets.filter(t => t.created_by_discord_id === creatorId);
  },

  async getAllTickets() {
    return [...data.tickets];
  },

  async getTicketById(id) {
    return data.tickets.find(t => t.id === id) || null;
  },

  async createTicket(ticketId, title, description, category, createdByDiscordId, createdByUsername) {
    const newTicket = {
      id: ticketId,
      title,
      description,
      category,
      status: 'open',
      created_by_discord_id: createdByDiscordId,
      created_by_username: createdByUsername,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.tickets.push(newTicket);
    save();
    return newTicket;
  },

  async updateTicketStatus(id, status) {
    const t = data.tickets.find(t => t.id === id);
    if (t) {
      t.status = status;
      t.updated_at = new Date().toISOString();
      save();
      return t;
    }
    return null;
  },

  async getTicketMessages(ticketId) {
    return data.ticket_messages.filter(m => m.ticket_id === ticketId);
  },

  async createTicketMessage(ticketId, senderId, senderName, senderAvatar, message, isAdmin) {
    const newMessage = {
      id: data.ticket_messages.length + 1,
      ticket_id: ticketId,
      sender_discord_id: senderId,
      sender_username: senderName,
      sender_avatar: senderAvatar,
      message,
      created_at: new Date().toISOString(),
      is_admin: isAdmin ? 1 : 0
    };
    data.ticket_messages.push(newMessage);
    
    // Update ticket modified time
    const t = data.tickets.find(t => t.id === ticketId);
    if (t) {
      t.updated_at = new Date().toISOString();
    }
    
    save();
    return newMessage;
  },

  // Sócio Chat APIs
  async getSocioChatMessages() {
    return [...data.socio_chat];
  },

  async createSocioChatMessage(senderId, senderName, senderAvatar, message) {
    const nextId = data.socio_chat.length > 0 ? Math.max(...data.socio_chat.map(m => m.id)) + 1 : 1;
    const newMsg = {
      id: nextId,
      sender_discord_id: senderId,
      sender_username: senderName,
      sender_avatar: senderAvatar,
      message,
      created_at: new Date().toISOString()
    };
    data.socio_chat.push(newMsg);
    // Limit log to 100 messages
    if (data.socio_chat.length > 100) {
      data.socio_chat.shift();
    }
    save();
    return newMsg;
  },

  // Discord Feeds Cache APIs
  async getDiscordCache(channelId) {
    return data.discord_cache[channelId] || null;
  },

  async setDiscordCache(channelId, messagesJson) {
    data.discord_cache[channelId] = {
      messages_json: messagesJson,
      updated_at: new Date().toISOString()
    };
    save();
    return true;
  },

  // Announcements APIs
  async getAllAnnouncements() {
    if (!data.announcements) data.announcements = [];
    return [...data.announcements].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  async createAnnouncement(channelId, title, content, authorName, authorAvatar) {
    if (!data.announcements) data.announcements = [];
    const nextId = data.announcements.length > 0 ? Math.max(...data.announcements.map(a => a.id)) + 1 : 1;
    const newAnnouncement = {
      id: nextId,
      channel_id: channelId,
      title,
      content,
      author: authorName,
      avatar: authorAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
      timestamp: new Date().toISOString()
    };
    data.announcements.push(newAnnouncement);
    save();
    return newAnnouncement;
  },

  async deleteAnnouncement(announcementId) {
    if (!data.announcements) return true;
    const aId = parseInt(announcementId);
    data.announcements = data.announcements.filter(a => a.id !== aId);
    save();
    return true;
  }
};

module.exports = query;
