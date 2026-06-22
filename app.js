/* ====================================================
   NEXUS COMMUNITY PORTAL - FRONTEND CONTROLLER
   ==================================================== */

// Global App State
let appState = {
    user: null,
    loggedIn: false,
    activeTab: 'home',
    activeFeedChannel: '1157363514629955585', // News channel default
    activeTicketId: null,
    ticketPollInterval: null,
    socioChatPollInterval: null
};

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    // Check initial route hash
    const hash = window.location.hash.substring(1);
    const validTabs = ['home', 'feed', 'musicas', 'ranking', 'tickets', 'socio', 'admin'];
    if (hash && validTabs.includes(hash)) {
        appState.activeTab = hash;
    }

    // Initialize UI Elements
    initNavbarEffects();
    initMobileMenu();
    checkAuthStatus();
    switchTab(appState.activeTab);
    initParallaxEffects();

    // Initial Feeds and List loading
    loadDiscordFeed(appState.activeFeedChannel);
    loadMusicList();
    loadRankingList();

    // Start online count polling
    updateOnlineMemberCount();
    setInterval(updateOnlineMemberCount, 15000); // Poll every 15 seconds

    // Check URL parameters for search parameters (OAuth outcomes)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('sync') === 'success') {
        notify('Sincronização de conta efetuada com sucesso!', 'success');
        // Clean URL history
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    } else if (urlParams.get('error')) {
        notify('Erro ao sincronizar conta. Tenta novamente.', 'error');
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
});

// Create and trigger alert notification toasts
function notify(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.innerHTML = `
        <div class="toast-content">
            <span class="toast-msg">${message}</span>
        </div>
    `;
    
    // Add toast stylesheet styling on the fly if needed
    if (!document.getElementById('toast-styles')) {
        const styles = document.createElement('style');
        styles.id = 'toast-styles';
        styles.textContent = `
            .toast-notification {
                position: fixed;
                bottom: 24px;
                left: 24px;
                z-index: 1000;
                background: var(--bg-card);
                border: 1px solid rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(16px);
                padding: 14px 20px;
                border-radius: 6px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                animation: toastSlideIn 0.3s ease-out;
            }
            .toast-notification.success { border-left: 3px solid var(--neon-cyan); }
            .toast-notification.error { border-left: 3px solid var(--neon-magenta); }
            .toast-content { display: flex; align-items: center; }
            .toast-msg { font-size: 0.9rem; font-weight: 600; color: #fff; }
            @keyframes toastSlideIn {
                from { transform: translateX(-100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(styles);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s ease-in reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ----------------------------------------------------
// UI TABS & NAVBAR CONTROLLER
// ----------------------------------------------------
function initNavbarEffects() {
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 30) {
            navbar.style.background = 'rgba(4, 3, 8, 0.95)';
            navbar.style.padding = '12px 0';
        } else {
            navbar.style.background = 'rgba(7, 5, 13, 0.8)';
            navbar.style.padding = '16px 0';
        }
    });
}

function initMobileMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            const icon = menuToggle.querySelector('i');
            if (icon) {
                if (navMenu.classList.contains('active')) {
                    icon.setAttribute('data-lucide', 'x');
                } else {
                    icon.setAttribute('data-lucide', 'menu');
                }
                lucide.createIcons();
            }
        });
    }
}

function switchTab(tabId) {
    appState.activeTab = tabId;
    window.location.hash = tabId;

    // Toggle active sections in document
    document.querySelectorAll('.tab-section').forEach(sec => {
        sec.classList.remove('active');
    });
    const targetSection = document.getElementById(`tab-${tabId}`);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // Toggle active nav menu items
    document.querySelectorAll('.nav-menu .nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${tabId}`) {
            link.classList.add('active');
        }
    });

    // Close mobile menu if active
    const navMenu = document.getElementById('nav-menu');
    if (navMenu && navMenu.classList.contains('active')) {
        navMenu.classList.remove('active');
        const menuToggle = document.getElementById('menu-toggle');
        const icon = menuToggle.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', 'menu');
            lucide.createIcons();
        }
    }

    // Specific tab triggers
    if (tabId === 'tickets') {
        loadUserTickets();
    } else if (tabId === 'socio') {
        checkSocioAccess();
    } else if (tabId === 'ranking') {
        loadRankingList();
    } else if (tabId === 'musicas') {
        loadMusicList();
    }

    // Clear loops on page shifts
    if (tabId !== 'tickets') {
        clearInterval(appState.ticketPollInterval);
    }
    if (tabId !== 'socio') {
        clearInterval(appState.socioChatPollInterval);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    lucide.createIcons();
}

// ----------------------------------------------------
// AUTHENTICATION MANAGEMENT
// ----------------------------------------------------
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/user/me');
        const data = await response.json();
        
        if (data.loggedIn) {
            appState.user = data.user;
            appState.loggedIn = true;
            renderAuthUserWidget();
            
            // Adjust layouts for logged in state
            document.getElementById('music-auth-block').style.display = 'none';
            document.getElementById('add-music-form').style.display = 'flex';
            
            document.getElementById('ticket-auth-block').style.display = 'none';
            document.getElementById('new-ticket-form').style.display = 'flex';

            // Show admin panel navigation option if applicable
            if (appState.user.is_admin) {
                document.getElementById('nav-admin-btn').style.display = 'block';
                document.getElementById('admin-announcement-form-container').style.display = 'block';
            } else {
                document.getElementById('nav-admin-btn').style.display = 'none';
                document.getElementById('admin-announcement-form-container').style.display = 'none';
            }
            
        } else {
            appState.user = null;
            appState.loggedIn = false;
            renderAuthSyncButton();
            
            document.getElementById('music-auth-block').style.display = 'block';
            document.getElementById('add-music-form').style.display = 'none';
            
            document.getElementById('ticket-auth-block').style.display = 'block';
            document.getElementById('new-ticket-form').style.display = 'none';
            
            document.getElementById('nav-admin-btn').style.display = 'none';
            document.getElementById('admin-announcement-form-container').style.display = 'none';
            
        }
    } catch (error) {
        console.error('Falha ao obter estado de login:', error);
    }
}

function renderAuthUserWidget() {
    const container = document.getElementById('nav-auth-container');
    const u = appState.user;
    
    // Pick active username and avatar representation
    const name = u.discord_username || u.google_name || 'Comunidade';
    const pic = u.discord_avatar || u.google_picture || 'https://cdn.discordapp.com/embed/avatars/0.png';
    
    let roleBadge = '';
    if (u.is_admin) {
        roleBadge = `<span class="badge-admin-mini">Admin</span>`;
    } else if (u.is_socio) {
        roleBadge = `<span class="badge-socio-mini">Sócio</span>`;
    }

    container.innerHTML = `
        <div class="user-profile-widget">
            <img src="${pic}" alt="${name}" class="user-avatar-mini">
            <div class="user-details-mini">
                <span class="user-name-mini">${name}</span>
                <span class="user-lvl-mini">Lvl ${u.level} ${roleBadge}</span>
            </div>
            <button class="btn-logout-mini" onclick="logoutUser()" title="Terminar Sessão">
                <i data-lucide="log-out" style="width: 16px; height: 16px;"></i>
            </button>
        </div>
    `;
    lucide.createIcons();
}

function renderAuthSyncButton() {
    const container = document.getElementById('nav-auth-container');
    container.innerHTML = `
        <button class="btn btn-outline-cyan btn-sm" onclick="showSyncModal()">
            <i data-lucide="link"></i> Sincronizar Conta
        </button>
    `;
    lucide.createIcons();
}

async function logoutUser() {
    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            notify('Sessão terminada com sucesso!', 'info');
            checkAuthStatus();
            switchTab('home');
        }
    } catch (err) {
        console.error(err);
    }
}

// ----------------------------------------------------
// SYNC MODAL VISIBILITY
// ----------------------------------------------------
function showSyncModal() {
    document.getElementById('sync-modal').style.display = 'flex';
}

function closeSyncModal() {
    document.getElementById('sync-modal').style.display = 'none';
}

// ----------------------------------------------------
// DISCORD SYNCHRONIZED FEEDS
// ----------------------------------------------------
async function loadDiscordFeed(channelId, tabBtn = null) {
    appState.activeFeedChannel = channelId;
    
    // Toggle active selection styling in buttons
    if (tabBtn) {
        document.querySelectorAll('.feed-tab-btn').forEach(btn => btn.classList.remove('active'));
        tabBtn.classList.add('active');
    }

    const container = document.getElementById('feed-messages-list');
    container.innerHTML = `
        <div class="feed-loading">
            <div class="spinner"></div>
            <p>A sincronizar com os canais do Discord...</p>
        </div>
    `;

    try {
        const response = await fetch(`/api/discord/messages?channelId=${channelId}`);
        const messages = await response.json();

        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-feed">
                    <i data-lucide="inbox" style="width:48px; height:48px; opacity:0.3;"></i>
                    <p>Nenhuma publicação encontrada neste canal do Discord.</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        container.innerHTML = '';
        messages.forEach(msg => {
            const date = new Date(msg.timestamp).toLocaleString('pt-PT', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            // Convert Discord markdowns to clean HTML format
            let contentHtml = msg.content
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`(.*?)`/g, '<code>$1</code>')
                .replace(/\n/g, '<br>');

            const card = document.createElement('div');
            card.className = 'feed-message-card';
            
            const isLocalAnnounce = msg.title !== undefined;
            if (isLocalAnnounce) {
                card.style.borderLeft = '3px solid var(--neon-magenta)';
                card.style.background = 'rgba(255, 0, 127, 0.03)';
            }
            
            const titleHtml = isLocalAnnounce ? `<h4 style="color:var(--neon-magenta); margin-bottom:6px;"><i data-lucide="megaphone" style="width:14px; height:14px; display:inline-block; vertical-align:middle; margin-right:4px;"></i> ${escapeHtml(msg.title)}</h4>` : '';
            
            const adminDelBtn = appState.loggedIn && appState.user.is_admin && isLocalAnnounce
                ? `<button class="btn btn-outline-magenta btn-xs" style="padding: 2px 6px; font-size: 0.65rem; margin-top: 8px;" onclick="deleteAnnouncement(${msg.id}, '${channelId}')"><i data-lucide="trash-2"></i> Apagar Anúncio</button>`
                : '';

            card.innerHTML = `
                <img src="${msg.avatar}" alt="${msg.author}" class="feed-avatar">
                <div class="feed-msg-body">
                    <div class="feed-msg-header">
                        <span class="feed-author-name">${msg.author} ${isLocalAnnounce ? '<span class="badge-admin-mini" style="margin-left:6px; background:var(--neon-magenta-20); color:#fda4af; border:1px solid rgba(255,0,127,0.4);">Anúncio Oficial</span>' : ''}</span>
                        <span class="feed-msg-date">${date}</span>
                    </div>
                    ${titleHtml}
                    <div class="feed-msg-content">${contentHtml}</div>
                    ${adminDelBtn}
                </div>
            `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Erro a carregar feeds:', error);
        container.innerHTML = `
            <div class="empty-feed">
                <i data-lucide="alert-triangle" style="width:48px; height:48px; color:var(--neon-magenta);"></i>
                <p>Ocorreu um erro ao sincronizar com o Discord.</p>
            </div>
        `;
        lucide.createIcons();
    }
}

// ----------------------------------------------------
// SERVER MUSIC (MÚSICAS DO SERVIDOR)
// ----------------------------------------------------
async function loadMusicList() {
    const list = document.getElementById('music-list');
    try {
        const response = await fetch('/api/musics');
        const musics = await response.json();

        if (musics.length === 0) {
            list.innerHTML = `
                <div class="empty-feed">
                    <i data-lucide="music-4" style="width:40px; height:40px; opacity:0.3;"></i>
                    <p>Nenhuma música partilhada ainda. Sê o primeiro!</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        list.innerHTML = '';
        musics.forEach(item => {
            const card = document.createElement('div');
            card.className = 'music-item-card';
            
            // Format submission details
            const dateStr = item.submitted_at 
                ? new Date(item.submitted_at).toLocaleDateString('pt-PT') 
                : 'Recente';

            // Show admin delete controls
            const adminDelBtn = appState.loggedIn && appState.user.is_admin
                ? `<button class="btn-music-delete" onclick="deleteMusic(${item.id})" title="Apagar música"><i data-lucide="trash-2"></i></button>`
                : '';

            card.innerHTML = `
                <div class="music-details">
                    <div class="music-icon-wrap">
                        <i data-lucide="music"></i>
                    </div>
                    <div class="music-meta">
                        <span class="music-title-text">${escapeHtml(item.title)}</span>
                        <span class="music-artist-text">${escapeHtml(item.artist)}</span>
                        <span class="music-submitted-by">Sugerido por <strong>${escapeHtml(item.submitted_by_username)}</strong> em ${dateStr}</span>
                    </div>
                </div>
                <div class="music-actions">
                    <button class="btn-music-play" onclick="window.open('${item.url}', '_blank')" title="Ouvir música">
                        <i data-lucide="play"></i>
                    </button>
                    <button class="btn-music-like" id="music-like-${item.id}" onclick="likeMusic(${item.id})">
                        <i data-lucide="thumbs-up"></i> <span class="like-counter">${item.likes}</span>
                    </button>
                    ${adminDelBtn}
                </div>
            `;
            list.appendChild(card);
        });
        lucide.createIcons();
    } catch (err) {
        console.error(err);
    }
}

async function submitMusic(e) {
    e.preventDefault();
    if (!appState.loggedIn) return showSyncModal();

    const title = document.getElementById('music-title').value;
    const artist = document.getElementById('music-artist').value;
    const url = document.getElementById('music-url').value;

    try {
        const response = await fetch('/api/musics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, artist, url })
        });
        const data = await response.json();

        if (response.ok) {
            notify('Música submetida com sucesso! Ganhaste +10 XP!', 'success');
            document.getElementById('add-music-form').reset();
            loadMusicList();
            checkAuthStatus(); // Update level / stats widget
        } else {
            notify(data.error || 'Erro ao submeter música.', 'error');
        }
    } catch (err) {
        console.error(err);
        notify('Erro de ligação ao servidor.', 'error');
    }
}

async function likeMusic(musicId) {
    if (!appState.loggedIn) return showSyncModal();
    try {
        const response = await fetch(`/api/musics/${musicId}/like`, { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            const btn = document.getElementById(`music-like-${musicId}`);
            if (data.liked) {
                btn.classList.add('liked');
            } else {
                btn.classList.remove('liked');
            }
            loadMusicList();
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteMusic(musicId) {
    if (!confirm('Tens a certeza que desejas apagar esta música?')) return;
    try {
        const response = await fetch(`/api/admin/musics/${musicId}`, { method: 'DELETE' });
        if (response.ok) {
            notify('Música removida pelos administradores.', 'info');
            loadMusicList();
        }
    } catch (err) {
        console.error(err);
    }
}

// ----------------------------------------------------
// LEADERBOARD (RANKING)
// ----------------------------------------------------
async function loadRankingList() {
    const list = document.getElementById('leaderboard-tbody');
    const podiumList = document.getElementById('podium-list');
    try {
        const response = await fetch('/api/ranking');
        const leaderboard = await response.json();

        if (leaderboard.length === 0) {
            list.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum membro no ranking ainda.</td></tr>';
            podiumList.innerHTML = '';
            return;
        }

        // Render Podium Block Elements (Top 3)
        podiumList.innerHTML = '';
        
        // Second Place Podium (Render on left)
        if (leaderboard[1]) {
            podiumList.appendChild(createPodiumItemHTML(leaderboard[1], 2, 'second'));
        }
        
        // First Place Podium (Render in center)
        if (leaderboard[0]) {
            podiumList.appendChild(createPodiumItemHTML(leaderboard[0], 1, 'first'));
        }
        
        // Third Place Podium (Render on right)
        if (leaderboard[2]) {
            podiumList.appendChild(createPodiumItemHTML(leaderboard[2], 3, 'third'));
        }

        // Render Table list (Rest of rank listings)
        list.innerHTML = '';
        leaderboard.forEach((member, index) => {
            const row = document.createElement('tr');
            
            const pic = member.discord_avatar || member.google_picture || 'https://cdn.discordapp.com/embed/avatars/0.png';
            const name = member.discord_username || member.google_name || 'Comunidade Nexus';

            let roleBadge = '';
            if (member.is_admin) {
                roleBadge = `<span class="badge-admin-mini">Admin</span>`;
            } else if (member.is_socio) {
                roleBadge = `<span class="badge-socio-mini">Sócio</span>`;
            }

            row.innerHTML = `
                <td><span class="rank-number">#${index + 1}</span></td>
                <td>
                    <div class="rank-user-cell">
                        <img src="${pic}" alt="${name}" class="rank-avatar">
                        <span class="rank-username">${escapeHtml(name)}</span>
                    </div>
                </td>
                <td><span class="rank-level-val">${member.level}</span></td>
                <td>${roleBadge}</td>
                <td><span class="rank-xp-val">${member.xp} XP</span></td>
            `;
            list.appendChild(row);
        });
        lucide.createIcons();
    } catch (err) {
        console.error(err);
    }
}

function createPodiumItemHTML(member, rank, classStyle) {
    const item = document.createElement('div');
    item.className = `podium-item ${classStyle}`;
    
    const pic = member.discord_avatar || member.google_picture || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const name = member.discord_username || member.google_name || 'Membro';
    
    let badgeText = '';
    if (member.is_admin) badgeText = '<span class="badge-admin-mini">Admin</span>';
    else if (member.is_socio) badgeText = '<span class="badge-socio-mini">Sócio</span>';

    item.innerHTML = `
        <div class="podium-badge">${rank}</div>
        <img src="${pic}" alt="${name}" class="podium-avatar">
        <span class="podium-name">${escapeHtml(name)}</span>
        <span class="podium-level">Nível ${member.level}</span>
        <span class="podium-xp">${member.xp} XP</span>
        <div class="podium-role">${badgeText}</div>
    `;
    return item;
}

// ----------------------------------------------------
// SUPPORT TICKETS CLIENT SYSTEM
// ----------------------------------------------------
function showTicketForm() {
    document.getElementById('ticket-empty-view').style.display = 'none';
    document.getElementById('ticket-thread-view').style.display = 'none';
    document.getElementById('ticket-create-view').style.display = 'flex';
}

function cancelTicketCreate() {
    document.getElementById('ticket-create-view').style.display = 'none';
    document.getElementById('ticket-empty-view').style.display = 'flex';
}

async function loadUserTickets() {
    if (!appState.loggedIn) return;
    const container = document.getElementById('tickets-list-container');
    container.innerHTML = '<p style="text-align:center; padding: 20px;">Carregando...</p>';

    try {
        const response = await fetch('/api/tickets');
        const tickets = await response.json();

        if (tickets.length === 0) {
            container.innerHTML = '<p class="empty-summary-text" style="padding:20px; text-align:center;">Não tens tickets abertos.</p>';
            return;
        }

        container.innerHTML = '';
        tickets.forEach(ticket => {
            const item = document.createElement('div');
            item.className = `ticket-nav-item ${appState.activeTicketId === ticket.id ? 'active' : ''}`;
            item.onclick = () => openTicketThread(ticket.id);
            
            const dateStr = new Date(ticket.updated_at).toLocaleDateString('pt-PT');
            const statusLabel = ticket.status === 'open' ? 'Aberto' : 'Fechado';

            item.innerHTML = `
                <div class="ticket-nav-header">
                    <span class="ticket-nav-id">${ticket.id}</span>
                    <span class="ticket-nav-status ${ticket.status}">${statusLabel}</span>
                </div>
                <div class="ticket-nav-title">${escapeHtml(ticket.title)}</div>
                <div class="ticket-nav-date">Última atualização: ${dateStr}</div>
            `;
            container.appendChild(item);
        });
    } catch (err) {
        console.error(err);
    }
}

async function submitTicket(e) {
    e.preventDefault();
    if (!appState.loggedIn) return;

    const category = document.getElementById('ticket-category').value;
    const title = document.getElementById('ticket-title').value;
    const description = document.getElementById('ticket-desc').value;

    try {
        const response = await fetch('/api/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, title, description })
        });
        const data = await response.json();

        if (response.ok) {
            notify(`Ticket ${data.ticketId} aberto com sucesso!`, 'success');
            document.getElementById('new-ticket-form').reset();
            document.getElementById('ticket-create-view').style.display = 'none';
            loadUserTickets();
            openTicketThread(data.ticketId);
        } else {
            notify(data.error || 'Erro ao abrir ticket.', 'error');
        }
    } catch (err) {
        console.error(err);
    }
}

async function openTicketThread(ticketId) {
    appState.activeTicketId = ticketId;
    
    // UI Panels toggle
    document.getElementById('ticket-empty-view').style.display = 'none';
    document.getElementById('ticket-create-view').style.display = 'none';
    document.getElementById('ticket-thread-view').style.display = 'flex';

    // Highlight selected in sidebar
    document.querySelectorAll('.ticket-nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.querySelector('.ticket-nav-id').textContent === ticketId) {
            item.classList.add('active');
        }
    });

    // Start Chat Polling Loops
    clearInterval(appState.ticketPollInterval);
    fetchTicketMessages(); // Load immediately
    appState.ticketPollInterval = setInterval(fetchTicketMessages, 5000); // Check every 5s
}

async function fetchTicketMessages() {
    if (!appState.activeTicketId) return;
    const threadContainer = document.getElementById('ticket-messages-thread');

    try {
        const response = await fetch(`/api/tickets/${appState.activeTicketId}/messages`);
        
        if (!response.ok) {
            clearInterval(appState.ticketPollInterval);
            return;
        }

        const data = await response.json();
        const t = data.ticket;
        const messages = data.messages;

        // Render meta tags header
        document.getElementById('thread-ticket-id').textContent = t.id;
        document.getElementById('thread-ticket-title').textContent = t.title;
        document.getElementById('thread-ticket-category').textContent = t.category;

        // Show/Hide ticket inputs based on open/closed state
        const closeBtn = document.getElementById('btn-close-ticket');
        const chatInputArea = document.getElementById('ticket-input-area');
        if (t.status === 'closed') {
            closeBtn.style.display = 'none';
            chatInputArea.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.9rem;">🔒 Este ticket foi fechado pelos administradores ou utilizador.</p>';
        } else {
            closeBtn.style.display = 'block';
            chatInputArea.innerHTML = `
                <form onsubmit="sendTicketReply(event)" class="chat-input-form">
                    <input type="text" id="ticket-reply-msg" placeholder="Escreve uma resposta para a equipa..." required>
                    <button type="submit" class="btn btn-neon-cyan"><i data-lucide="send"></i></button>
                </form>
            `;
            lucide.createIcons();
        }

        // Render message speech bubbles
        const scrollAtBottom = threadContainer.scrollHeight - threadContainer.scrollTop === threadContainer.clientHeight;
        threadContainer.innerHTML = '';

        messages.forEach(msg => {
            const timeStr = new Date(msg.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
            const bubble = document.createElement('div');
            
            // Check if sender is system or administrator
            const isAdminMsg = msg.is_admin === 1;
            bubble.className = `ticket-msg-bubble ${isAdminMsg ? 'admin-msg' : ''}`;
            
            bubble.innerHTML = `
                <img src="${msg.sender_avatar}" alt="${msg.sender_username}" class="chat-avatar">
                <div class="msg-bubble-content">
                    <div class="msg-info">
                        <span class="msg-sender">${escapeHtml(msg.sender_username)}</span>
                        <span class="msg-time">${timeStr}</span>
                    </div>
                    <div class="msg-text">${escapeHtml(msg.message)}</div>
                </div>
            `;
            threadContainer.appendChild(bubble);
        });

        // Scroll down if user was already at the bottom
        if (scrollAtBottom || threadContainer.scrollTop === 0) {
            threadContainer.scrollTop = threadContainer.scrollHeight;
        }
    } catch (err) {
        console.error(err);
    }
}

async function sendTicketReply(e) {
    e.preventDefault();
    const input = document.getElementById('ticket-reply-msg');
    const message = input.value;
    if (!message || !appState.activeTicketId) return;

    try {
        const response = await fetch(`/api/tickets/${appState.activeTicketId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        if (response.ok) {
            input.value = '';
            fetchTicketMessages();
        }
    } catch (err) {
        console.error(err);
    }
}

async function closeActiveTicket() {
    if (!confirm('Desejas realmente fechar este ticket de suporte?')) return;
    try {
        const response = await fetch(`/api/tickets/${appState.activeTicketId}/close`, { method: 'POST' });
        if (response.ok) {
            notify('Ticket fechado com sucesso.', 'info');
            loadUserTickets();
            fetchTicketMessages();
        }
    } catch (err) {
        console.error(err);
    }
}

// ----------------------------------------------------
// EXCLUSIVE ZONE DE SÓCIOS (MEMBERS ONLY)
// ----------------------------------------------------
function checkSocioAccess() {
    const lockedView = document.getElementById('socio-locked-view');
    const unlockedView = document.getElementById('socio-unlocked-view');

    if (appState.loggedIn && (appState.user.is_socio || appState.user.is_admin)) {
        lockedView.style.display = 'none';
        unlockedView.style.display = 'block';
        
        // Start Member Exclusive Live Chat Loops
        clearInterval(appState.socioChatPollInterval);
        loadSocioChatLogs();
        appState.socioChatPollInterval = setInterval(loadSocioChatLogs, 3000); // Poll every 3 seconds
    } else {
        lockedView.style.display = 'block';
        unlockedView.style.display = 'none';
        clearInterval(appState.socioChatPollInterval);
        
        const statusText = document.getElementById('socio-status-text');
        const unlockBtn = document.getElementById('btn-socio-unlock-action');
        
        if (appState.loggedIn) {
            statusText.innerHTML = `Sessão iniciada como <strong>${escapeHtml(appState.user.discord_username || appState.user.google_name)}</strong>.<br>Contudo, não possuis o cargo de <strong>Sócio</strong> no Discord.`;
            unlockBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Sincronizar Cargos';
            unlockBtn.onclick = () => {
                // If logged in via Discord, we can just trigger a profile sync callback/refresh
                window.location.href = '/auth/discord';
            };
        } else {
            statusText.textContent = 'Não tens sessão iniciada com o Discord.';
            unlockBtn.innerHTML = '<i data-lucide="link"></i> Sincronizar Discord';
            unlockBtn.onclick = () => showSyncModal();
        }
        lucide.createIcons();
    }
}

async function loadSocioChatLogs() {
    const logs = document.getElementById('socio-chat-logs');
    if (!logs) return;
    
    try {
        const response = await fetch('/api/socio/chat');
        if (!response.ok) return;

        const messages = await response.json();
        
        const isAtBottom = logs.scrollHeight - logs.scrollTop === logs.clientHeight;
        logs.innerHTML = '';

        if (messages.length === 0) {
            logs.innerHTML = '<p class="empty-summary-text" style="padding:30px; text-align:center;">O chat está calmo. Inicia a conversa!</p>';
            return;
        }

        messages.forEach(msg => {
            const timeStr = new Date(msg.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
            
            // Build visual styling categories
            const isSystem = msg.sender_discord_id === 'system';
            const bubble = document.createElement('div');
            bubble.className = `socio-chat-bubble ${isSystem ? 'system-sender' : 'socio-sender'}`;

            bubble.innerHTML = `
                <img src="${msg.sender_avatar}" alt="${msg.sender_username}" class="chat-avatar">
                <div class="msg-bubble-content">
                    <div class="msg-info">
                        <span class="msg-sender">${escapeHtml(msg.sender_username)}</span>
                        <span class="msg-time">${timeStr}</span>
                    </div>
                    <div class="msg-text">${escapeHtml(msg.message)}</div>
                </div>
            `;
            logs.appendChild(bubble);
        });

        if (isAtBottom || logs.scrollTop === 0) {
            logs.scrollTop = logs.scrollHeight;
        }
    } catch (err) {
        console.error(err);
    }
}

async function sendSocioChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('socio-chat-input');
    const message = input.value;
    if (!message) return;

    try {
        const response = await fetch('/api/socio/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        if (response.ok) {
            input.value = '';
            loadSocioChatLogs();
            checkAuthStatus(); // Update user XP / Level dashboard
        }
    } catch (err) {
        console.error(err);
    }
}

// ----------------------------------------------------
// ADMINISTRATIVE DASHBOARD CONTROLS
// ----------------------------------------------------
async function adjustUserXP(e) {
    e.preventDefault();
    const username = document.getElementById('admin-xp-username').value;
    const xpAmount = document.getElementById('admin-xp-amount').value;

    try {
        const response = await fetch('/api/admin/set-xp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, xpAmount })
        });
        const data = await response.json();

        if (response.ok) {
            notify(data.message, 'success');
            document.getElementById('admin-xp-username').value = '';
            document.getElementById('admin-xp-amount').value = '';
            loadRankingList();
        } else {
            notify(data.error || 'Erro ao ajustar XP.', 'error');
        }
    } catch (err) {
        console.error(err);
    }
}

async function refreshSystemFeeds() {
    notify('A limpar feeds do Discord cache. A recarregar...', 'info');
    try {
        // Clear caches and reload current feed active
        await loadDiscordFeed(appState.activeFeedChannel);
        notify('Cache limpa com sucesso!', 'success');
    } catch (err) {
        console.error(err);
    }
}



// Online counter fetcher
async function updateOnlineMemberCount() {
    try {
        const res = await fetch('/api/online-count');
        const data = await res.json();
        const el = document.getElementById('header-online-count');
        if (el && data.online !== undefined) {
            el.textContent = data.online;
        }
    } catch (e) {
        console.error(e);
    }
}

// Admin announcements publisher
async function submitAnnouncement(e) {
    e.preventDefault();
    if (!appState.loggedIn || !appState.user.is_admin) return;

    const channelId = document.getElementById('announce-channel').value;
    const title = document.getElementById('announce-title').value;
    const content = document.getElementById('announce-content').value;

    try {
        const response = await fetch('/api/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId, title, content })
        });

        if (response.ok) {
            notify('Anúncio oficial publicado com sucesso!', 'success');
            document.getElementById('admin-announcement-form').reset();
            loadDiscordFeed(channelId);
        } else {
            const data = await response.json();
            notify(data.error || 'Erro ao publicar anúncio.', 'error');
        }
    } catch (err) {
        console.error(err);
        notify('Erro de ligação ao servidor.', 'error');
    }
}

// Admin announcements delete upvotes
async function deleteAnnouncement(announcementId, channelId) {
    if (!confirm('Desejas realmente remover este anúncio oficial?')) return;
    try {
        const response = await fetch(`/api/announcements/${announcementId}`, { method: 'DELETE' });
        if (response.ok) {
            notify('Anúncio oficial removido.', 'info');
            loadDiscordFeed(channelId);
        }
    } catch (err) {
        console.error(err);
    }
}

// Helper: Escape user input HTML
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ----------------------------------------------------
// PARALLAX SCROLLING, MOUSE TILT, AND THREE.JS WebGL 3D ENGINE
// ----------------------------------------------------
function initParallaxEffects() {
    // Check if user prefers reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const fallback = document.querySelector('.logo-fallback-glow');
        if (fallback) fallback.style.display = 'block';
        return;
    }

    // 1. Three.js 3D Canvas initialization
    initThreeJSViewport();

    // 2. Performant Scroll Parallax
    let scrollY = window.scrollY;
    let ticking = false;

    window.addEventListener('scroll', () => {
        scrollY = window.scrollY;
        if (!ticking) {
            window.requestAnimationFrame(() => {
                // Background elements translation
                const grid = document.querySelector('.cyber-grid-overlay');
                if (grid) grid.style.transform = `translate3d(0, ${scrollY * 0.12}px, 0)`;

                const glowPurple = document.querySelector('.cyber-glow-purple');
                if (glowPurple) glowPurple.style.transform = `translate3d(0, ${scrollY * -0.04}px, 0)`;

                const glowCyan = document.querySelector('.cyber-glow-cyan');
                if (glowCyan) glowCyan.style.transform = `translate3d(0, ${scrollY * 0.08}px, 0)`;

                const glowMagenta = document.querySelector('.cyber-glow-magenta');
                if (glowMagenta) glowMagenta.style.transform = `translate3d(-50%, calc(-50% + ${scrollY * 0.03}px), 0)`;

                // Floating landing page shapes translation
                const shapes = document.querySelectorAll('.parallax-shape');
                shapes.forEach(shape => {
                    const speed = parseFloat(shape.getAttribute('data-speed')) || 0.1;
                    shape.style.transform = `translate3d(0, ${scrollY * speed}px, 0) rotate(${scrollY * 0.03}deg)`;
                });

                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });

    // 3. Mouse Tilt Effect for Cards
    const tiltElements = document.querySelectorAll('.benefit-card, .rules-card, .logo-box, .glass-panel, .portfolio-card');
    
    tiltElements.forEach(el => {
        el.addEventListener('mousemove', e => {
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Tilt limit to 5 degrees for premium feel
            const rotateX = ((centerY - y) / centerY) * 5;
            const rotateY = ((x - centerX) / centerX) * 5;

            el.style.transition = 'transform 0.05s ease-out, box-shadow 0.1s ease-out';
            el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
            
            if (el.classList.contains('benefit-card') || el.classList.contains('logo-box') || el.classList.contains('portfolio-card')) {
                const glowX = rotateY * -1.5;
                const glowY = rotateX * 1.5;
                el.style.boxShadow = `0 15px 35px rgba(0, 0, 0, 0.4), ${glowX}px ${glowY}px 20px rgba(0, 243, 255, 0.08)`;
            }
        });

        el.addEventListener('mouseleave', () => {
            el.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.4s ease-out';
            el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)';
            el.style.boxShadow = '';
        });
    });
}

// ----------------------------------------------------
// THREE.JS 3D CANVAS VIEWPORT GENERATOR
// ----------------------------------------------------
let threeScene, threeCamera, threeRenderer, threeMesh, threeWireframeLine, threeParticles;
let target3DRotationX = 0;
let target3DRotationY = 0;

function initThreeJSViewport() {
    const container = document.getElementById('canvas-3d-container');
    const fallback = document.querySelector('.logo-fallback-glow');
    if (!container) return;

    // Detect if WebGL is supported
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) throw new Error('WebGL não suportado');
    } catch (err) {
        console.warn('WebGL não está disponível. Mostrando logótipo fallback.');
        if (fallback) fallback.style.display = 'block';
        return;
    }

    // Hide fallback if WebGL succeeds
    if (fallback) fallback.style.display = 'none';

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 320;

    // 1. Create Scene, Camera, and Renderer
    threeScene = new THREE.Scene();
    threeCamera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    threeCamera.position.z = 150;

    threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeRenderer.setSize(width, height);
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(threeRenderer.domElement);

    // 2. Add Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    threeScene.add(ambientLight);

    const cyanLight = new THREE.PointLight(0x00f3ff, 2, 200);
    cyanLight.position.set(-50, 50, 50);
    threeScene.add(cyanLight);

    const goldLight = new THREE.PointLight(0xffaa00, 2.5, 200);
    goldLight.position.set(50, -50, 50);
    threeScene.add(goldLight);

    // 3. Create blocky N 3D Shape
    const shape = new THREE.Shape();
    shape.moveTo(-18, -25);
    shape.lineTo(-18, 25);
    shape.lineTo(-7, 25);
    shape.lineTo(7, -10);
    shape.lineTo(7, 25);
    shape.lineTo(18, 25);
    shape.lineTo(18, -25);
    shape.lineTo(7, -25);
    shape.lineTo(-7, 10);
    shape.lineTo(-7, -25);
    shape.closePath();

    const extrudeSettings = {
        depth: 6,
        bevelEnabled: true,
        bevelSegments: 4,
        steps: 1,
        bevelSize: 1.5,
        bevelThickness: 1.5
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center(); // Center geometry about origin

    // 4. Create Material representing refracting glass
    const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffaa00,
        metalness: 0.1,
        roughness: 0.15,
        transmission: 0.9,
        thickness: 4,
        opacity: 0.5,
        transparent: true,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        side: THREE.DoubleSide
    });

    threeMesh = new THREE.Mesh(geometry, glassMaterial);
    threeScene.add(threeMesh);

    // 5. Create Holographic wireframe outline
    const edges = new THREE.EdgesGeometry(geometry);
    threeWireframeLine = new THREE.LineSegments(
        edges, 
        new THREE.LineBasicMaterial({ 
            color: 0x00f3ff,
            linewidth: 2 
        })
    );
    threeScene.add(threeWireframeLine);

    // 6. Grid Ground plane
    const gridHelper = new THREE.GridHelper(160, 16, 0x00f3ff, 0x221a35);
    gridHelper.position.y = -40;
    gridHelper.rotation.x = Math.PI / 16;
    gridHelper.opacity = 0.3;
    gridHelper.transparent = true;
    threeScene.add(gridHelper);

    // 7. Ambient Sparkles Particle Field
    const particleCount = 60;
    const particlesGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 120;
        positions[i + 1] = (Math.random() - 0.5) * 120;
        positions[i + 2] = (Math.random() - 0.5) * 120;
    }
    particlesGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
        color: 0x00f3ff,
        size: 1.5,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending
    });
    threeParticles = new THREE.Points(particlesGeom, particleMat);
    threeScene.add(threeParticles);

    // 8. Track cursor coordinates relative to canvas center
    container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        target3DRotationY = ((e.clientX - centerX) / (rect.width / 2)) * 0.4;
        target3DRotationX = ((e.clientY - centerY) / (rect.height / 2)) * 0.4;
    });

    container.addEventListener('mouseleave', () => {
        target3DRotationX = 0;
        target3DRotationY = 0;
    });

    // 9. Resize Listener
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        threeCamera.aspect = w / h;
        threeCamera.updateProjectionMatrix();
        threeRenderer.setSize(w, h);
    });

    // 10. Start Animation Loop
    animateThreeJSScene();
}

function animateThreeJSScene() {
    requestAnimationFrame(animateThreeJSScene);

    // Smooth Lerp tracking
    if (threeMesh) {
        threeMesh.rotation.y += (target3DRotationY - threeMesh.rotation.y) * 0.08 + 0.005;
        threeMesh.rotation.x += (target3DRotationX - threeMesh.rotation.x) * 0.08;
    }
    if (threeWireframeLine) {
        threeWireframeLine.rotation.y = threeMesh.rotation.y;
        threeWireframeLine.rotation.x = threeMesh.rotation.x;
    }

    // Animate Particles
    if (threeParticles) {
        threeParticles.rotation.y += 0.001;
        threeParticles.rotation.x += 0.0005;
    }

    // Subtle camera floating effect
    const time = Date.now() * 0.001;
    threeCamera.position.y = Math.sin(time) * 3;

    threeRenderer.render(threeScene, threeCamera);
}

// ----------------------------------------------------
// ACCORDION TOGGLER & CONTACT FORM
// ----------------------------------------------------
function toggleRulesAccordion() {
    const body = document.getElementById('rules-accordion-body');
    const arrow = document.getElementById('rules-accordion-arrow');
    if (!body || !arrow) return;

    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

async function submitCorporateContact(e) {
    e.preventDefault();
    
    const name = document.getElementById('contact-name').value;
    const email = document.getElementById('contact-email').value;
    const subject = document.getElementById('contact-subject').value;
    const message = document.getElementById('contact-message').value;

    try {
        const response = await fetch('/api/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: `Pedido de Parceria: ${subject}`,
                description: message,
                category: 'Parceria/Empresa',
                email: email,
                name: name
            })
        });

        if (response.ok) {
            notify('Proposta enviada! Responderemos em breve.', 'success');
            document.getElementById('corporate-contact-form').reset();
        } else {
            const data = await response.json();
            notify(data.error || 'Erro ao enviar proposta.', 'error');
        }
    } catch (err) {
        console.error(err);
        notify('Erro de ligação ao servidor.', 'error');
    }
}
