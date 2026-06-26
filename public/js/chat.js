document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const logoutBtn = document.getElementById('logoutBtn');
  const currentUserName = document.getElementById('currentUserName');
  const currentUserAvatar = document.getElementById('currentUserAvatar');
  const usersList = document.getElementById('usersList');
  const userSearch = document.getElementById('userSearch');
  
  const chatWindow = document.getElementById('chatWindow');
  const emptyState = document.getElementById('emptyState');
  const activeChat = document.getElementById('activeChat');
  const activeUserName = document.getElementById('activeUserName');
  const activeUserAvatar = document.getElementById('activeUserAvatar');
  const activeUserStatus = document.getElementById('activeUserStatus');
  const messagesContainer = document.getElementById('messagesContainer');
  const backBtn = document.getElementById('backBtn');
  
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const emojiBtn = document.getElementById('emojiBtn');
  const emojiPicker = document.getElementById('emojiPicker');
  const typingIndicatorWrapper = document.getElementById('typingIndicatorWrapper');
  const typingIndicatorText = document.getElementById('typingIndicatorText');
  const incomingSound = document.getElementById('incomingSound');

  // App State
  let socket = null;
  let me = null;
  let allUsers = [];
  let chatHistory = [];
  let activeUser = null;
  let typingTimeout = null;
  let isTyping = false;

  // Initialize App
  init();

  async function init() {
    try {
      // 1. Fetch current user session
      const meRes = await fetch('/api/me');
      if (!meRes.ok) {
        window.location.href = '/login.html';
        return;
      }
      me = await meRes.json();
      currentUserName.textContent = me.name;
      currentUserAvatar.textContent = getInitials(me.name);

      // 2. Initialize Socket.IO
      socket = io();

      // 3. Setup Socket Listeners
      setupSocketListeners();

      // 4. Setup Event Listeners
      setupEventListeners();
    } catch (err) {
      console.error('Error during initialization:', err);
      window.location.href = '/login.html';
    }
  }

  function getInitials(name) {
    if (!name) return '--';
    const parts = name.split(' ');
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  function setupSocketListeners() {
    // Initial data load
    socket.on('initChat', (data) => {
      allUsers = data.users.filter(u => u.username !== me.username);
      chatHistory = data.history;
      renderUsersList();
      
      // If we already have an active chat, refresh message view
      if (activeUser) {
        const found = allUsers.find(u => u.username === activeUser.username);
        if (found) {
          activeUser = found;
          updateActiveHeader();
        }
        renderMessages();
      }
    });

    // When a user goes online
    socket.on('userOnline', ({ username }) => {
      const user = allUsers.find(u => u.username === username);
      if (user) {
        user.online = true;
        renderUsersList();
        if (activeUser && activeUser.username === username) {
          activeUser.online = true;
          updateActiveHeader();
        }
      }
    });

    // When a user goes offline
    socket.on('userOffline', ({ username }) => {
      const user = allUsers.find(u => u.username === username);
      if (user) {
        user.online = false;
        renderUsersList();
        if (activeUser && activeUser.username === username) {
          activeUser.online = false;
          updateActiveHeader();
        }
      }
    });

    // Incoming private message
    socket.on('privateMessage', (message) => {
      chatHistory.push(message);
      
      if (activeUser && message.from === activeUser.username) {
        // Render it
        renderMessages();
        // Emit seen status back
        socket.emit('messageSeen', { messageIds: [message.id], from: activeUser.username });
      } else {
        // Background message alert
        playNotificationSound();
        renderUsersList();
      }
    });

    // Message sent confirmation
    socket.on('messageReceived', (message) => {
      chatHistory.push(message);
      if (activeUser && (message.to === activeUser.username || message.from === activeUser.username)) {
        renderMessages();
      }
      renderUsersList();
    });

    // Messages status updated to "seen" or "delivered"
    socket.on('messagesStatusUpdated', ({ messageIds, status, to }) => {
      chatHistory.forEach(msg => {
        if (messageIds.includes(msg.id)) {
          msg.status = status;
        }
      });
      if (activeUser && activeUser.username === to) {
        renderMessages();
      }
    });

    // Typing Status Listeners
    socket.on('typing', ({ from }) => {
      if (activeUser && activeUser.username === from) {
        typingIndicatorText.textContent = `${activeUser.name} is typing...`;
        typingIndicatorWrapper.classList.remove('hidden');
        scrollToBottom();
      }
    });

    socket.on('stopTyping', ({ from }) => {
      if (activeUser && activeUser.username === from) {
        typingIndicatorWrapper.classList.add('hidden');
      }
    });
  }

  function setupEventListeners() {
    // Logout
    logoutBtn.addEventListener('click', async () => {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/login.html';
      }
    });

    // Search filter
    userSearch.addEventListener('input', () => {
      renderUsersList();
    });

    // Send button click
    sendBtn.addEventListener('click', sendMessage);

    // Enter Key Send / Typing indicator trigger
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      } else {
        sendTypingStatus();
      }
    });

    // Back Button (Mobile layout toggle)
    backBtn.addEventListener('click', () => {
      chatWindow.classList.remove('chat-active');
      activeUser = null;
      renderUsersList();
    });

    // Emoji Picker toggler
    emojiBtn.addEventListener('click', () => {
      emojiPicker.classList.toggle('hidden');
    });

    // Select emoji
    emojiPicker.addEventListener('click', (e) => {
      if (e.target.tagName === 'SPAN') {
        messageInput.value += e.target.textContent;
        messageInput.focus();
        emojiPicker.classList.add('hidden');
      }
    });

    // Close emoji picker if clicked outside
    document.addEventListener('click', (e) => {
      if (!emojiBtn.contains(e.target) && !emojiPicker.contains(e.target)) {
        emojiPicker.classList.add('hidden');
      }
    });
  }

  function sendTypingStatus() {
    if (!activeUser || !socket) return;

    if (!isTyping) {
      isTyping = true;
      socket.emit('typing', { to: activeUser.username });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      socket.emit('stopTyping', { to: activeUser.username });
    }, 2000);
  }

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activeUser || !socket) return;

    // Send over socket
    socket.emit('privateMessage', { to: activeUser.username, text });

    // Stop typing
    isTyping = false;
    socket.emit('stopTyping', { to: activeUser.username });
    clearTimeout(typingTimeout);

    // Clear UI
    messageInput.value = '';
    messageInput.focus();
  }

  function renderUsersList() {
    const searchVal = userSearch.value.toLowerCase().trim();
    usersList.innerHTML = '';

    const filtered = allUsers.filter(u => 
      u.name.toLowerCase().includes(searchVal) || 
      u.username.toLowerCase().includes(searchVal)
    );

    if (filtered.length === 0) {
      usersList.innerHTML = `
        <div class="no-users">
          <p>No contacts found</p>
        </div>
      `;
      return;
    }

    filtered.forEach(user => {
      // Calculate unread count & last message details
      const conversation = chatHistory.filter(m => 
        (m.from === user.username && m.to === me.username) || 
        (m.from === me.username && m.to === user.username)
      );

      const unreadCount = conversation.filter(m => m.from === user.username && m.status !== 'seen').length;
      const lastMsg = conversation[conversation.length - 1];

      const card = document.createElement('div');
      card.className = `user-card ${activeUser && activeUser.username === user.username ? 'active' : ''}`;
      
      let lastMsgText = 'No messages yet';
      let lastMsgTimeStr = '';
      if (lastMsg) {
        lastMsgText = lastMsg.from === me.username ? `You: ${lastMsg.text}` : lastMsg.text;
        const date = new Date(lastMsg.timestamp);
        lastMsgTimeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      card.innerHTML = `
        <div class="avatar-wrapper">
          <div class="list-avatar">${getInitials(user.name)}</div>
          <div class="status-indicator ${user.online ? 'online' : 'offline'}"></div>
        </div>
        <div class="card-details">
          <div class="card-header-row">
            <h4>${user.name}</h4>
            <span class="last-msg-time">${lastMsgTimeStr}</span>
          </div>
          <div class="card-header-row">
            <span class="last-msg-preview">${escapeHTML(lastMsgText)}</span>
            ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
          </div>
        </div>
      `;

      card.addEventListener('click', () => selectUser(user));
      usersList.appendChild(card);
    });
  }

  function selectUser(user) {
    activeUser = user;
    
    // Clear empty state and reveal UI
    emptyState.classList.add('hidden');
    chatWindow.classList.remove('empty');
    activeChat.classList.remove('hidden');

    // Trigger mobile active view
    chatWindow.classList.add('chat-active');

    // Update Header
    updateActiveHeader();
    
    // Render existing chat history
    renderMessages();

    // Mark unread messages as seen
    const unseenMessageIds = chatHistory
      .filter(m => m.from === user.username && m.to === me.username && m.status !== 'seen')
      .map(m => m.id);

    if (unseenMessageIds.length > 0) {
      socket.emit('messageSeen', { messageIds: unseenMessageIds, from: user.username });
      chatHistory.forEach(m => {
        if (unseenMessageIds.includes(m.id)) m.status = 'seen';
      });
      renderUsersList();
    }

    messageInput.focus();
  }

  function updateActiveHeader() {
    activeUserName.textContent = activeUser.name;
    activeUserAvatar.textContent = getInitials(activeUser.name);
    
    if (activeUser.online) {
      activeUserStatus.textContent = 'online';
      activeUserStatus.className = 'active-user-status online';
    } else {
      activeUserStatus.textContent = 'offline';
      activeUserStatus.className = 'active-user-status';
    }
  }

  function renderMessages() {
    messagesContainer.innerHTML = '';
    
    if (!activeUser) return;

    const conversation = chatHistory.filter(m => 
      (m.from === activeUser.username && m.to === me.username) || 
      (m.from === me.username && m.to === activeUser.username)
    );

    conversation.forEach(msg => {
      const bubble = document.createElement('div');
      const isSent = msg.from === me.username;
      bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;

      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Build double tick read-receipt markers
      let ticksHTML = '';
      if (isSent) {
        if (msg.status === 'seen') {
          // Double blue ticks
          ticksHTML = `
            <div class="status-ticks seen">
              <svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M15.01 3.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0L6.3 9.9 3.1 6.7a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l3.9 3.9a.5.5 0 0 0 .7 0l8.36-8.35zm-3.25.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0l-5.7 5.7L3.9 7.15a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l4.6 4.6a.5.5 0 0 0 .7 0l6.71-6.7z"></path></svg>
            </div>`;
        } else if (msg.status === 'delivered') {
          // Double grey ticks
          ticksHTML = `
            <div class="status-ticks">
              <svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M15.01 3.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0L6.3 9.9 3.1 6.7a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l3.9 3.9a.5.5 0 0 0 .7 0l8.36-8.35zm-3.25.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0l-5.7 5.7L3.9 7.15a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l4.6 4.6a.5.5 0 0 0 .7 0l6.71-6.7z"></path></svg>
            </div>`;
        } else {
          // Single grey tick (Sent)
          ticksHTML = `
            <div class="status-ticks">
              <svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M10.91 3.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0L4.3 9.9 1.1 6.7a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l3.9 3.9a.5.5 0 0 0 .7 0l6.36-6.35z"></path></svg>
            </div>`;
        }
      }

      bubble.innerHTML = `
        <span class="msg-text">${escapeHTML(msg.text)}</span>
        <div class="msg-meta">
          <span class="msg-time">${time}</span>
          ${ticksHTML}
        </div>
      `;

      messagesContainer.appendChild(bubble);
    });

    scrollToBottom();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function playNotificationSound() {
    incomingSound.currentTime = 0;
    incomingSound.play().catch(e => console.log('Audio playback blocked: ', e));
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
