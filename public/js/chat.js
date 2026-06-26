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

  // Media Input Elements
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');
  const mediaPreviewContainer = document.getElementById('mediaPreviewContainer');
  const mediaPreviewWrapper = document.getElementById('mediaPreviewWrapper');
  const mediaPreviewName = document.getElementById('mediaPreviewName');
  const mediaPreviewSize = document.getElementById('mediaPreviewSize');
  const cancelMediaBtn = document.getElementById('cancelMediaBtn');

  // Modal Elements
  const createGroupBtn = document.getElementById('createGroupBtn');
  const groupModal = document.getElementById('groupModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelGroupBtn = document.getElementById('cancelGroupBtn');
  const submitGroupBtn = document.getElementById('submitGroupBtn');
  const groupNameInput = document.getElementById('groupNameInput');
  const memberSelectList = document.getElementById('memberSelectList');

  // Calling Elements
  const audioCallBtn = document.getElementById('audioCallBtn');
  const videoCallBtn = document.getElementById('videoCallBtn');
  const callOverlay = document.getElementById('callOverlay');
  const callScreenAvatar = document.getElementById('callScreenAvatar');
  const callScreenName = document.getElementById('callScreenName');
  const callScreenStatus = document.getElementById('callScreenStatus');
  const callVideoGrid = document.getElementById('callVideoGrid');
  const localVideo = document.getElementById('localVideo');
  const toggleAudioBtn = document.getElementById('toggleAudioBtn');
  const toggleVideoBtn = document.getElementById('toggleVideoBtn');
  const hangupCallBtn = document.getElementById('hangupCallBtn');

  const incomingCallBanner = document.getElementById('incomingCallBanner');
  const incomingCallAvatar = document.getElementById('incomingCallAvatar');
  const incomingCallName = document.getElementById('incomingCallName');
  const incomingCallType = document.getElementById('incomingCallType');
  const acceptCallBtn = document.getElementById('acceptCallBtn');
  const declineCallBtn = document.getElementById('declineCallBtn');
  const ringtoneSound = document.getElementById('ringtoneSound');

  // App State
  let socket = null;
  let me = null;
  let allUsers = [];
  let allGroups = [];
  let chatHistory = [];
  let activeTarget = null; // can be a user object (direct) or group object (group)
  let typingTimeout = null;
  let isTyping = false;
  let pendingFile = null; // { url, name, type }

  // WebRTC State Variables
  let localStream = null;
  let peerConnections = {}; // username -> RTCPeerConnection
  let activeCall = null; // { targetId, isGroup, isVideo, role: 'caller'|'callee' }
  let callTimerInterval = null;
  let callStartTime = null;

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
    const parts = name.trim().split(' ');
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  function setupSocketListeners() {
    // Initial data load
    socket.on('initChat', (data) => {
      allUsers = data.users.filter(u => u.username !== me.username);
      allGroups = data.groups || [];
      chatHistory = data.history;
      renderUsersList();
      
      // If we already have an active chat target, refresh message view
      if (activeTarget) {
        if (activeTarget.isGroup) {
          const found = allGroups.find(g => g.id === activeTarget.id);
          if (found) {
            activeTarget = { ...found, isGroup: true };
            updateActiveHeader();
          }
        } else {
          const found = allUsers.find(u => u.username === activeTarget.username);
          if (found) {
            activeTarget = found;
            updateActiveHeader();
          }
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
        if (activeTarget && !activeTarget.isGroup && activeTarget.username === username) {
          activeTarget.online = true;
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
        if (activeTarget && !activeTarget.isGroup && activeTarget.username === username) {
          activeTarget.online = false;
          updateActiveHeader();
        }
      }
    });

    // Incoming private message
    socket.on('privateMessage', (message) => {
      chatHistory.push(message);
      
      if (activeTarget && !activeTarget.isGroup && message.from === activeTarget.username) {
        renderMessages();
        socket.emit('messageSeen', { messageIds: [message.id], from: activeTarget.username });
      } else {
        playNotificationSound();
        renderUsersList();
      }
    });

    // Message sent confirmation (Direct message)
    socket.on('messageReceived', (message) => {
      chatHistory.push(message);
      if (activeTarget && !activeTarget.isGroup && (message.to === activeTarget.username || message.from === activeTarget.username)) {
        renderMessages();
      }
      renderUsersList();
    });

    // Incoming group message
    socket.on('groupMessage', (message) => {
      chatHistory.push(message);
      
      if (activeTarget && activeTarget.isGroup && message.to === activeTarget.id) {
        renderMessages();
      } else {
        playNotificationSound();
        renderUsersList();
      }
    });

    // Group created confirmation
    socket.on('groupCreated', (newGroup) => {
      // Add group if it doesn't already exist
      if (!allGroups.some(g => g.id === newGroup.id)) {
        allGroups.push(newGroup);
        renderUsersList();
      }
    });

    // Message deleted confirmation
    socket.on('messageDeleted', ({ messageId }) => {
      const msg = chatHistory.find(m => m.id === messageId);
      if (msg) {
        msg.text = '🚫 This message was deleted';
        msg.isDeleted = true;
        renderMessages();
        renderUsersList();
      }
    });

    // Messages status updated to "seen" or "delivered" (Direct only)
    socket.on('messagesStatusUpdated', ({ messageIds, status, to }) => {
      chatHistory.forEach(msg => {
        if (messageIds.includes(msg.id)) {
          msg.status = status;
        }
      });
      if (activeTarget && !activeTarget.isGroup && activeTarget.username === to) {
        renderMessages();
      }
    });

    // Typing Status Listeners
    socket.on('typing', (data) => {
      if (data.isGroup) {
        if (activeTarget && activeTarget.isGroup && activeTarget.id === data.to) {
          typingIndicatorText.textContent = `${data.name} is typing...`;
          typingIndicatorWrapper.classList.remove('hidden');
          scrollToBottom();
        }
      } else {
        if (activeTarget && !activeTarget.isGroup && activeTarget.username === data.from) {
          typingIndicatorText.textContent = `${activeTarget.name} is typing...`;
          typingIndicatorWrapper.classList.remove('hidden');
          scrollToBottom();
        }
      }
    });

    socket.on('stopTyping', (data) => {
      if (data.isGroup) {
        if (activeTarget && activeTarget.isGroup && activeTarget.id === data.to) {
          typingIndicatorWrapper.classList.add('hidden');
        }
      } else {
        if (activeTarget && !activeTarget.isGroup && activeTarget.username === data.from) {
          typingIndicatorWrapper.classList.add('hidden');
        }
      }
    });

    // --- WebRTC Socket Listeners ---

    // Incoming Call
    socket.on('incomingCall', (data) => {
      // If already in a call, auto-reject
      if (activeCall) {
        socket.emit('rejectCall', { to: data.from, isGroup: data.isGroup });
        return;
      }

      activeCall = {
        targetId: data.from,
        targetName: data.fromName,
        isGroup: data.isGroup,
        isVideo: data.isVideo,
        role: 'callee',
        callRoom: data.to // For groups, this will be the groupId. For direct, this will be the recipient's username.
      };

      // Update Incoming Banner UI
      incomingCallName.textContent = data.fromName;
      incomingCallAvatar.textContent = getInitials(data.fromName);
      incomingCallType.textContent = `incoming ${data.isVideo ? 'video' : 'voice'} call...`;
      incomingCallBanner.classList.remove('hidden');

      // Play Ringtone
      ringtoneSound.currentTime = 0;
      ringtoneSound.play().catch(err => console.log("Ringtone play blocked:", err));
    });

    // Call Accepted by Callee
    socket.on('callAccepted', async (data) => {
      stopRingtone();
      if (!activeCall) return;

      callScreenStatus.textContent = 'Connecting...';

      // If we are the caller, we initiate the peer connection offer
      if (activeCall.role === 'caller') {
        // Start WebRTC connection for this participant
        await initPeerConnection(data.from);
      }
    });

    // Call Rejected by Callee
    socket.on('callRejected', (data) => {
      stopRingtone();
      if (!activeCall) return;

      callScreenStatus.textContent = 'Call Declined';
      setTimeout(() => {
        closeCallUI();
      }, 2000);
    });

    // WebRTC Signaling Relay (SDP & ICE Candidates)
    socket.on('signal', async (data) => {
      if (!activeCall) return;

      const fromUser = data.from;
      let pc = peerConnections[fromUser];

      // If connection doesn't exist yet, create it (mainly for callee receiving offer)
      if (!pc) {
        pc = await initPeerConnection(fromUser, false);
      }

      try {
        if (data.signalData.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signalData.sdp));
          
          if (pc.remoteDescription.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', {
              to: fromUser,
              signalData: { sdp: pc.localDescription },
              isGroup: activeCall.isGroup
            });
          }
        } else if (data.signalData.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.signalData.candidate));
        }
      } catch (err) {
        console.error("Error processing signaling data:", err);
      }
    });

    // Call Ended
    socket.on('callEnded', (data) => {
      // In group calls, a member leaving just closes their peer connection.
      // In direct calls, the call ends.
      if (activeCall && activeCall.isGroup) {
        closePeerConnection(data.from);
      } else {
        closeCallUI();
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
      activeTarget = null;
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
      // Close message dropdowns when clicking outside
      if (!e.target.classList.contains('msg-menu-btn')) {
        document.querySelectorAll('.msg-menu-dropdown').forEach(d => d.classList.add('hidden'));
      }
    });

    // Modal Events
    createGroupBtn.addEventListener('click', openGroupModal);
    closeModalBtn.addEventListener('click', closeGroupModal);
    cancelGroupBtn.addEventListener('click', closeGroupModal);
    submitGroupBtn.addEventListener('click', submitCreateGroup);

    // Attachment Events
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    cancelMediaBtn.addEventListener('click', clearPendingFile);

    // Call Events
    audioCallBtn.addEventListener('click', () => placeCall(false));
    videoCallBtn.addEventListener('click', () => placeCall(true));
    acceptCallBtn.addEventListener('click', acceptCallRequest);
    declineCallBtn.addEventListener('click', declineCallRequest);
    toggleAudioBtn.addEventListener('click', toggleMute);
    toggleVideoBtn.addEventListener('click', toggleCamera);
    hangupCallBtn.addEventListener('click', hangupCall);
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Limit to 10MB
    if (file.size > 10 * 1024 * 1024) {
      alert('File size exceeds the 10MB limit.');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
      pendingFile = {
        url: evt.target.result,
        name: file.name,
        type: file.type
      };

      // Render Preview
      mediaPreviewWrapper.innerHTML = '';
      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = evt.target.result;
        mediaPreviewWrapper.appendChild(img);
      } else if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = evt.target.result;
        video.muted = true;
        mediaPreviewWrapper.appendChild(video);
      } else {
        mediaPreviewWrapper.textContent = '📄';
      }

      mediaPreviewName.textContent = file.name;
      mediaPreviewSize.textContent = formatBytes(file.size);
      mediaPreviewContainer.classList.remove('hidden');
      messageInput.focus();
    };
    reader.readAsDataURL(file);
  }

  function clearPendingFile() {
    pendingFile = null;
    fileInput.value = '';
    mediaPreviewContainer.classList.add('hidden');
    mediaPreviewWrapper.innerHTML = '';
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function openGroupModal() {
    groupNameInput.value = '';
    
    // Populate checklist with users
    memberSelectList.innerHTML = '';
    allUsers.forEach(user => {
      const item = document.createElement('div');
      item.className = 'member-select-item';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `member-${user.username}`;
      checkbox.value = user.username;
      
      const label = document.createElement('label');
      label.htmlFor = `member-${user.username}`;
      label.innerHTML = `
        <span class="user-avatar" style="width: 24px; height: 24px; font-size: 0.7rem; font-weight: 600;">${getInitials(user.name)}</span>
        <span>${user.name}</span>
      `;
      
      item.appendChild(checkbox);
      item.appendChild(label);
      memberSelectList.appendChild(item);
    });
    
    groupModal.classList.remove('hidden');
    groupNameInput.focus();
  }

  function closeGroupModal() {
    groupModal.classList.add('hidden');
  }

  function submitCreateGroup() {
    const groupName = groupNameInput.value.trim();
    if (!groupName) {
      alert('Please enter a group name.');
      return;
    }

    const selectedCheckboxes = memberSelectList.querySelectorAll('input[type="checkbox"]:checked');
    const selectedMembers = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (selectedMembers.length === 0) {
      alert('Please select at least one other member.');
      return;
    }

    // Include current user in group
    selectedMembers.push(me.username);

    // Send to server
    socket.emit('createGroup', {
      name: groupName,
      members: selectedMembers
    });

    closeGroupModal();
  }

  function sendTypingStatus() {
    if (!activeTarget || !socket) return;

    if (!isTyping) {
      isTyping = true;
      socket.emit('typing', { to: activeTarget.isGroup ? activeTarget.id : activeTarget.username, isGroup: !!activeTarget.isGroup });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      socket.emit('stopTyping', { to: activeTarget.isGroup ? activeTarget.id : activeTarget.username, isGroup: !!activeTarget.isGroup });
    }, 2000);
  }

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text && !pendingFile) return;
    if (!activeTarget || !socket) return;

    const payload = {
      text: text,
      fileUrl: pendingFile ? pendingFile.url : null,
      fileName: pendingFile ? pendingFile.name : null,
      fileType: pendingFile ? pendingFile.type : null
    };

    // Send over socket
    if (activeTarget.isGroup) {
      socket.emit('groupMessage', { groupId: activeTarget.id, ...payload });
    } else {
      socket.emit('privateMessage', { to: activeTarget.username, ...payload });
    }

    // Stop typing
    isTyping = false;
    socket.emit('stopTyping', { to: activeTarget.isGroup ? activeTarget.id : activeTarget.username, isGroup: !!activeTarget.isGroup });
    clearTimeout(typingTimeout);

    // Clear UI
    messageInput.value = '';
    clearPendingFile();
    messageInput.focus();
  }

  function renderUsersList() {
    const searchVal = userSearch.value.toLowerCase().trim();
    usersList.innerHTML = '';

    // Filter Groups
    const filteredGroups = allGroups.filter(g => 
      g.name.toLowerCase().includes(searchVal)
    );

    // Filter Users
    const filteredUsers = allUsers.filter(u => 
      u.name.toLowerCase().includes(searchVal) || 
      u.username.toLowerCase().includes(searchVal)
    );

    if (filteredGroups.length === 0 && filteredUsers.length === 0) {
      usersList.innerHTML = `
        <div class="no-users">
          <p>No contacts or groups found</p>
        </div>
      `;
      return;
    }

    // Render Groups first
    filteredGroups.forEach(group => {
      const groupHistory = chatHistory.filter(m => m.isGroup && m.to === group.id);
      const lastMsg = groupHistory[groupHistory.length - 1];
      const card = document.createElement('div');
      card.className = `user-card ${activeTarget && activeTarget.isGroup && activeTarget.id === group.id ? 'active' : ''}`;

      let lastMsgText = 'No messages yet';
      let lastMsgTimeStr = '';
      if (lastMsg) {
        const sender = lastMsg.from === me.username ? 'You' : lastMsg.fromName || lastMsg.from;
        lastMsgText = `${sender}: ${lastMsg.text}`;
        const date = new Date(lastMsg.timestamp);
        lastMsgTimeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      card.innerHTML = `
        <div class="avatar-wrapper">
          <div class="list-avatar" style="background-color: #673ab7;">👥</div>
        </div>
        <div class="card-details">
          <div class="card-header-row">
            <h4>${group.name} <span class="group-tag">Group</span></h4>
            <span class="last-msg-time">${lastMsgTimeStr}</span>
          </div>
          <div class="card-header-row">
            <span class="last-msg-preview">${escapeHTML(lastMsgText)}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => selectTarget({ ...group, isGroup: true }));
      usersList.appendChild(card);
    });

    // Render Users
    filteredUsers.forEach(user => {
      // Calculate unread count & last message details
      const conversation = chatHistory.filter(m => 
        !m.isGroup && (
          (m.from === user.username && m.to === me.username) || 
          (m.from === me.username && m.to === user.username)
        )
      );

      const unreadCount = conversation.filter(m => m.from === user.username && m.status !== 'seen').length;
      const lastMsg = conversation[conversation.length - 1];

      const card = document.createElement('div');
      card.className = `user-card ${activeTarget && !activeTarget.isGroup && activeTarget.username === user.username ? 'active' : ''}`;
      
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

      card.addEventListener('click', () => selectTarget(user));
      usersList.appendChild(card);
    });
  }

  function selectTarget(target) {
    activeTarget = target;
    
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

    // Mark direct unread messages as seen
    if (!target.isGroup) {
      const unseenMessageIds = chatHistory
        .filter(m => !m.isGroup && m.from === target.username && m.to === me.username && m.status !== 'seen')
        .map(m => m.id);

      if (unseenMessageIds.length > 0) {
        socket.emit('messageSeen', { messageIds: unseenMessageIds, from: target.username });
        chatHistory.forEach(m => {
          if (unseenMessageIds.includes(m.id)) m.status = 'seen';
        });
        renderUsersList();
      }
    }

    messageInput.focus();
  }

  function updateActiveHeader() {
    if (!activeTarget) return;

    activeUserName.textContent = activeTarget.name;
    
    if (activeTarget.isGroup) {
      activeUserAvatar.textContent = '👥';
      activeUserAvatar.style.backgroundColor = '#673ab7';
      activeUserStatus.textContent = `${activeTarget.members.length} members`;
      activeUserStatus.className = 'active-user-status';
    } else {
      activeUserAvatar.textContent = getInitials(activeTarget.name);
      activeUserAvatar.style.backgroundColor = ''; // default theme color
      
      if (activeTarget.online) {
        activeUserStatus.textContent = 'online';
        activeUserStatus.className = 'active-user-status online';
      } else {
        activeUserStatus.textContent = 'offline';
        activeUserStatus.className = 'active-user-status';
      }
    }
  }

  function renderMessages() {
    messagesContainer.innerHTML = '';
    
    if (!activeTarget) return;

    let conversation = [];
    if (activeTarget.isGroup) {
      conversation = chatHistory.filter(m => m.isGroup && m.to === activeTarget.id);
    } else {
      conversation = chatHistory.filter(m => 
        !m.isGroup && (
          (m.from === activeTarget.username && m.to === me.username) || 
          (m.from === me.username && m.to === activeTarget.username)
        )
      );
    }

    conversation.forEach(msg => {
      const bubble = document.createElement('div');
      const isSent = msg.from === me.username;
      bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
      if (msg.isDeleted) {
        bubble.classList.add('deleted-msg');
      }

      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Build double tick read-receipt markers (only for private chats)
      let ticksHTML = '';
      if (isSent && !activeTarget.isGroup && !msg.isDeleted) {
        if (msg.status === 'seen') {
          ticksHTML = `
            <div class="status-ticks seen">
              <svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M15.01 3.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0L6.3 9.9 3.1 6.7a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l3.9 3.9a.5.5 0 0 0 .7 0l8.36-8.35zm-3.25.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0l-5.7 5.7L3.9 7.15a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l4.6 4.6a.5.5 0 0 0 .7 0l6.71-6.7z"></path></svg>
            </div>`;
        } else if (msg.status === 'delivered') {
          ticksHTML = `
            <div class="status-ticks">
              <svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M15.01 3.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0L6.3 9.9 3.1 6.7a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l3.9 3.9a.5.5 0 0 0 .7 0l8.36-8.35zm-3.25.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0l-5.7 5.7L3.9 7.15a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l4.6 4.6a.5.5 0 0 0 .7 0l6.71-6.7z"></path></svg>
            </div>`;
        } else {
          ticksHTML = `
            <div class="status-ticks">
              <svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M10.91 3.3a.5.5 0 0 0-.01-.7l-.35-.35a.5.5 0 0 0-.71 0L4.3 9.9 1.1 6.7a.5.5 0 0 0-.7 0l-.35.35a.5.5 0 0 0 0 .7l3.9 3.9a.5.5 0 0 0 .7 0l6.36-6.35z"></path></svg>
            </div>`;
        }
      }

      // If it's a received group message, prepend the sender's name
      let senderNameHTML = '';
      if (activeTarget.isGroup && !isSent) {
        senderNameHTML = `<span class="msg-sender-name">${escapeHTML(msg.fromName || msg.from)}</span>`;
      }

      // Option menu HTML for sender's non-deleted messages (3 dots)
      let menuHTML = '';
      if (isSent && !msg.isDeleted) {
        menuHTML = `
          <div class="msg-menu-container">
            <button class="msg-menu-btn" title="Options">⋮</button>
            <div class="msg-menu-dropdown hidden">
              <button class="msg-delete-btn" data-id="${msg.id}">Delete</button>
            </div>
          </div>`;
      }

      // Render media attachment if present and message is not deleted
      let mediaHTML = '';
      if (msg.fileUrl && !msg.isDeleted) {
        if (msg.fileType && msg.fileType.startsWith('image/')) {
          mediaHTML = `
            <div class="message-media-wrapper">
              <img src="${msg.fileUrl}" alt="${escapeHTML(msg.fileName || 'Image')}" class="message-media-image" onclick="window.open('${msg.fileUrl}', '_blank')">
            </div>`;
        } else if (msg.fileType && msg.fileType.startsWith('video/')) {
          mediaHTML = `
            <div class="message-media-wrapper">
              <video src="${msg.fileUrl}" controls class="message-media-video"></video>
            </div>`;
        } else {
          // General file download link fallback
          mediaHTML = `
            <div class="message-media-wrapper" style="padding: 8px 12px; display: flex; align-items: center; gap: 8px;">
              <span>📄</span>
              <a href="${msg.fileUrl}" download="${escapeHTML(msg.fileName || 'file')}" style="color: var(--primary-light); font-weight: 500; font-size: 0.85rem; word-break: break-all;">
                Download ${escapeHTML(msg.fileName || 'File')}
              </a>
            </div>`;
        }
      }

      // If there is text, show it
      let textHTML = '';
      if (msg.text && msg.text.trim() !== '') {
        textHTML = `<span class="msg-text">${escapeHTML(msg.text)}</span>`;
      }

      bubble.innerHTML = `
        ${senderNameHTML}
        ${menuHTML}
        ${mediaHTML}
        ${textHTML}
        <div class="msg-meta">
          <span class="msg-time">${time}</span>
          ${ticksHTML}
        </div>
      `;

      // Attach click handlers for options menu
      if (isSent && !msg.isDeleted) {
        const menuBtn = bubble.querySelector('.msg-menu-btn');
        const dropdown = bubble.querySelector('.msg-menu-dropdown');
        const delBtn = bubble.querySelector('.msg-delete-btn');

        if (menuBtn && dropdown) {
          menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close any other open dropdowns first
            document.querySelectorAll('.msg-menu-dropdown').forEach(d => {
              if (d !== dropdown) d.classList.add('hidden');
            });
            dropdown.classList.toggle('hidden');
          });
        }

        if (delBtn) {
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown) dropdown.classList.add('hidden');
            if (confirm('Are you sure you want to delete this message?')) {
              socket.emit('deleteMessage', { messageId: msg.id });
            }
          });
        }
      }

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

  // --- WebRTC Calling Logic ---

  async function placeCall(isVideo) {
    if (!activeTarget) return;

    activeCall = {
      targetId: activeTarget.id || activeTarget.username,
      targetName: activeTarget.name,
      isGroup: !!activeTarget.isGroup,
      isVideo: isVideo,
      role: 'caller'
    };

    // Update Call UI Screen details
    callScreenName.textContent = activeCall.targetName;
    callScreenAvatar.textContent = activeCall.isGroup ? '👥' : getInitials(activeCall.targetName);
    callScreenStatus.textContent = 'Ringing...';
    callOverlay.classList.remove('hidden');

    try {
      // Capture local stream
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo ? { width: 640, height: 480 } : false
      });
      localVideo.srcObject = localStream;
      localVideo.classList.toggle('hidden', !isVideo);
    } catch (err) {
      console.error("Error accessing media devices:", err);
      alert("Could not access camera or microphone. Calling anyway with audio fallback, or please check permissions.");
      // Try audio only
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localVideo.srcObject = localStream;
        localVideo.classList.add('hidden');
      } catch (e) {
        alert("Failed to access microphone. Call terminated.");
        closeCallUI();
        return;
      }
    }

    // Emit call notification over socket
    socket.emit('callUser', {
      to: activeCall.targetId,
      isGroup: activeCall.isGroup,
      isVideo: isVideo
    });
  }

  async function acceptCallRequest() {
    incomingCallBanner.classList.add('hidden');
    stopRingtone();
    if (!activeCall) return;

    // Show Call Overlay
    callScreenName.textContent = activeCall.targetName;
    callScreenAvatar.textContent = activeCall.isGroup ? '👥' : getInitials(activeCall.targetName);
    callScreenStatus.textContent = 'Connecting...';
    callOverlay.classList.remove('hidden');

    try {
      // Capture local stream
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: activeCall.isVideo ? { width: 640, height: 480 } : false
      });
      localVideo.srcObject = localStream;
      localVideo.classList.toggle('hidden', !activeCall.isVideo);
    } catch (err) {
      console.error("Error accessing media devices:", err);
      // Fallback
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localVideo.srcObject = localStream;
        localVideo.classList.add('hidden');
      } catch (e) {
        alert("Could not access microphone. Call terminated.");
        socket.emit('rejectCall', { to: activeCall.targetId, isGroup: activeCall.isGroup });
        closeCallUI();
        return;
      }
    }

    // Accept call socket event
    socket.emit('acceptCall', {
      to: activeCall.targetId,
      isGroup: activeCall.isGroup
    });
  }

  function declineCallRequest() {
    incomingCallBanner.classList.add('hidden');
    stopRingtone();
    if (!activeCall) return;

    socket.emit('rejectCall', {
      to: activeCall.targetId,
      isGroup: activeCall.isGroup
    });
    activeCall = null;
  }

  async function initPeerConnection(participantId, isInitiator = true) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnections[participantId] = pc;

    // Add local tracks to peer connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle incoming stream tracks from this peer
    pc.ontrack = (event) => {
      let remoteVideo = document.getElementById(`video-${participantId}`);
      if (!remoteVideo) {
        remoteVideo = document.createElement('video');
        remoteVideo.id = `video-${participantId}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        callVideoGrid.appendChild(remoteVideo);
      }
      remoteVideo.srcObject = event.streams[0];
      
      // Update call status once remote stream is received
      callScreenStatus.textContent = 'Connected';
      startCallTimer();
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', {
          to: participantId,
          signalData: { candidate: event.candidate },
          isGroup: activeCall.isGroup
        });
      }
    };

    // If initiator, create Offer
    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal', {
          to: participantId,
          signalData: { sdp: pc.localDescription },
          isGroup: activeCall.isGroup
        });
      } catch (err) {
        console.error("Failed to create WebRTC offer:", err);
      }
    }

    return pc;
  }

  function closePeerConnection(participantId) {
    const pc = peerConnections[participantId];
    if (pc) {
      pc.close();
      delete peerConnections[participantId];
    }
    const remoteVideo = document.getElementById(`video-${participantId}`);
    if (remoteVideo) {
      remoteVideo.remove();
    }
    
    // If no peers are left, reset status
    if (Object.keys(peerConnections).length === 0) {
      callScreenStatus.textContent = 'Ringing...';
      stopCallTimer();
    }
  }

  function toggleMute() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      toggleAudioBtn.classList.toggle('active', audioTrack.enabled);
      toggleAudioBtn.title = audioTrack.enabled ? "Mute Microphone" : "Unmute Microphone";
    }
  }

  function toggleCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      toggleVideoBtn.classList.toggle('active', videoTrack.enabled);
      toggleVideoBtn.title = videoTrack.enabled ? "Turn Off Camera" : "Turn On Camera";
      localVideo.classList.toggle('hidden', !videoTrack.enabled);
    }
  }

  function hangupCall() {
    if (!activeCall) return;

    socket.emit('endCall', {
      to: activeCall.targetId,
      isGroup: activeCall.isGroup
    });

    closeCallUI();
  }

  function closeCallUI() {
    stopRingtone();
    stopCallTimer();

    // Stop media tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    // Close all peer connections
    Object.keys(peerConnections).forEach(pId => {
      peerConnections[pId].close();
      const remoteVideo = document.getElementById(`video-${pId}`);
      if (remoteVideo) remoteVideo.remove();
    });
    peerConnections = {};

    // Reset controls UI classes
    toggleAudioBtn.classList.add('active');
    toggleVideoBtn.classList.add('active');

    // Hide screen
    callOverlay.classList.add('hidden');
    incomingCallBanner.classList.add('hidden');
    activeCall = null;
  }

  function stopRingtone() {
    ringtoneSound.pause();
    ringtoneSound.currentTime = 0;
  }

  function startCallTimer() {
    if (callTimerInterval) return;

    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
      const elapsed = Date.now() - callStartTime;
      const seconds = Math.floor((elapsed / 1000) % 60);
      const minutes = Math.floor((elapsed / (1000 * 60)) % 60);
      
      const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      callScreenStatus.textContent = timeString;
    }, 1000);
  }

  function stopCallTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
  }
});
