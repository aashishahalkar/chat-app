const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Static user list
const users = [
  { username: "jenish", password: "123456", name: "Jenish" },
  { username: "Sanket", password: "123456", name: "Sanket" },
  { username: "sk", password: "sk@123", name: "SK" },
  { username: "aashish", password: "123456", name: "Aashish" },
  { username: "admin", password: "admin123", name: "Administrator" },
  { username: "adminsaleseasy@yopmail.com", password: "password123", name: "Admin Sales Easy" }
];

// In-memory stores
const onlineUsers = new Map(); // username -> socketId
const chatHistory = [];       // array of { id, from, to, text, timestamp, status: 'delivered' | 'seen', isGroup }
const groups = [];            // array of { id, name, members: [...usernames], createdBy, createdAt }

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(cookieParser('chat-app-secret-key'));

// Auth middleware for HTML pages
const checkAuth = (req, res, next) => {
  const username = req.cookies.username;
  const userExists = username && users.some(u => u.username.toLowerCase() === username.toLowerCase().trim());
  if (!username || !userExists) {
    if (req.path === '/login.html') {
      return next();
    }
    return res.redirect('/login.html');
  }
  if (req.path === '/login.html') {
    return res.redirect('/chat.html');
  }
  next();
};

// Root route
app.get('/', (req, res) => {
  res.redirect('/chat.html');
});

// Protect HTML files
app.get('/chat.html', checkAuth);
app.get('/login.html', checkAuth);

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim() && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Prevent duplicate logins (case-insensitive check)
  if (onlineUsers.has(user.username.toLowerCase())) {
    return res.status(409).json({ error: 'User is already logged in elsewhere' });
  }

  res.cookie('username', user.username, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
  res.json({ success: true, username: user.username, name: user.name });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  const username = req.cookies.username;
  if (username) {
    onlineUsers.delete(username.toLowerCase());
    res.clearCookie('username');
  }
  res.json({ success: true });
});

// Get user profile endpoint
app.get('/api/me', (req, res) => {
  const username = req.cookies.username;
  const user = username ? users.find(u => u.username.toLowerCase() === username.toLowerCase().trim()) : null;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ username: user.username, name: user.name });
});

// Get users list (indicating online/offline)
app.get('/api/users', (req, res) => {
  const username = req.cookies.username;
  if (!username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const userList = users.map(u => ({
    username: u.username,
    name: u.name,
    online: onlineUsers.has(u.username.toLowerCase())
  }));
  res.json(userList);
});

// Socket.IO Logic
io.on('connection', (socket) => {
  let socketUsername = null;

  // Retrieve username from cookie
  const cookieString = socket.handshake.headers.cookie;
  if (cookieString) {
    const cookies = require('cookie').parse(cookieString);
    socketUsername = cookies.username;
  }

  if (!socketUsername || !users.some(u => u.username.toLowerCase() === socketUsername.toLowerCase().trim())) {
    socket.disconnect(true);
    return;
  }

  // Bind username to socket map (store lowercase for consistency)
  onlineUsers.set(socketUsername.toLowerCase(), socket.id);
  
  // Join rooms for all groups this user belongs to
  groups.forEach(group => {
    if (group.members.includes(socketUsername)) {
      socket.join(group.id);
    }
  });
  
  // Notify everyone that user is online
  io.emit('userOnline', { username: socketUsername });

  // Send undelivered/unseen status updates, message history, and user's groups
  const userGroups = groups.filter(g => g.members.includes(socketUsername));
  const visibleHistory = chatHistory.filter(msg => {
    if (msg.isGroup) {
      const targetGroup = groups.find(g => g.id === msg.to);
      return targetGroup && targetGroup.members.includes(socketUsername);
    }
    return msg.from === socketUsername || msg.to === socketUsername;
  });

  socket.emit('initChat', {
    history: visibleHistory,
    users: users.map(u => ({
      username: u.username,
      name: u.name,
      online: onlineUsers.has(u.username.toLowerCase())
    })),
    groups: userGroups
  });

  // Handle incoming private message
  socket.on('privateMessage', ({ to, text, fileUrl, fileName, fileType }) => {
    if (!to) return;
    if ((!text || text.trim() === '') && !fileUrl) return;

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: socketUsername,
      to: to,
      text: text || '',
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      fileType: fileType || null,
      timestamp: new Date().toISOString(),
      status: onlineUsers.has(to.toLowerCase()) ? 'delivered' : 'sent',
      isGroup: false
    };

    chatHistory.push(message);

    // Send to sender
    socket.emit('messageReceived', message);

    // Send to recipient if online
    const recipientSocketId = onlineUsers.get(to.toLowerCase());
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('privateMessage', message);
    }
  });

  // Handle incoming group message
  socket.on('groupMessage', ({ groupId, text, fileUrl, fileName, fileType }) => {
    if (!groupId) return;
    if ((!text || text.trim() === '') && !fileUrl) return;

    const group = groups.find(g => g.id === groupId);
    if (!group || !group.members.includes(socketUsername)) return;

    const senderUser = users.find(u => u.username === socketUsername);

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: socketUsername,
      fromName: senderUser ? senderUser.name : socketUsername,
      to: groupId,
      text: text || '',
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      fileType: fileType || null,
      timestamp: new Date().toISOString(),
      isGroup: true
    };

    chatHistory.push(message);

    // Broadcast to everyone in group room
    io.to(groupId).emit('groupMessage', message);
  });

  // Handle group creation
  socket.on('createGroup', ({ name, members }) => {
    if (!name || !name.trim() || !members || !Array.isArray(members)) return;

    // Ensure the creator is in the members list
    if (!members.includes(socketUsername)) {
      members.push(socketUsername);
    }

    // Filter to valid users only
    const validMembers = members.filter(username => users.some(u => u.username === username));

    const newGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      members: validMembers,
      createdBy: socketUsername,
      createdAt: new Date().toISOString()
    };

    groups.push(newGroup);

    // Make all online members join the socket.io room for this group
    validMembers.forEach(member => {
      const memberSocketId = onlineUsers.get(member.toLowerCase());
      if (memberSocketId) {
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if (memberSocket) {
          memberSocket.join(newGroup.id);
        }
      }
    });

    // Notify all members about the group creation
    io.to(newGroup.id).emit('groupCreated', newGroup);
  });

  // Handle message deletion
  socket.on('deleteMessage', ({ messageId }) => {
    if (!messageId) return;

    const msgIndex = chatHistory.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const msg = chatHistory[msgIndex];
    // Check if the user trying to delete is the sender
    if (msg.from !== socketUsername) return;

    // Update message to deleted state
    msg.text = '🚫 This message was deleted';
    msg.isDeleted = true;

    if (msg.isGroup) {
      // Broadcast to the entire group room
      io.to(msg.to).emit('messageDeleted', { messageId });
    } else {
      // Send to sender
      socket.emit('messageDeleted', { messageId });
      // Send to recipient if online
      const recipientSocketId = onlineUsers.get(msg.to.toLowerCase());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('messageDeleted', { messageId });
      }
    }
  });

  // Handle typing indicator
  socket.on('typing', ({ to, isGroup }) => {
    if (isGroup) {
      const senderUser = users.find(u => u.username === socketUsername);
      socket.to(to).emit('typing', { from: socketUsername, name: senderUser ? senderUser.name : socketUsername, to, isGroup: true });
    } else {
      const recipientSocketId = onlineUsers.get(to.toLowerCase());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('typing', { from: socketUsername });
      }
    }
  });

  socket.on('stopTyping', ({ to, isGroup }) => {
    if (isGroup) {
      socket.to(to).emit('stopTyping', { from: socketUsername, to, isGroup: true });
    } else {
      const recipientSocketId = onlineUsers.get(to.toLowerCase());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('stopTyping', { from: socketUsername });
      }
    }
  });

  // Handle message status updates (Delivered / Seen)
  socket.on('messageSeen', ({ messageIds, from }) => {
    // messageIds is an array of message IDs sent by `from` to `socketUsername`
    messageIds.forEach(id => {
      const msg = chatHistory.find(m => m.id === id);
      if (msg && msg.to === socketUsername && msg.from === from) {
        msg.status = 'seen';
      }
    });

    const senderSocketId = onlineUsers.get(from.toLowerCase());
    if (senderSocketId) {
      io.to(senderSocketId).emit('messagesStatusUpdated', { messageIds, status: 'seen', to: socketUsername });
    }
  });

  // --- WebRTC Calling Signaling ---
  
  // Initiating call
  socket.on('callUser', ({ to, isGroup, isVideo }) => {
    const senderUser = users.find(u => u.username.toLowerCase() === socketUsername.toLowerCase());
    const payload = {
      from: socketUsername,
      fromName: senderUser ? senderUser.name : socketUsername,
      to,
      isGroup,
      isVideo
    };
    
    if (isGroup) {
      // Broadcast call request to all room members (excluding sender)
      socket.to(to).emit('incomingCall', payload);
    } else {
      // Send to recipient
      const recipientSocketId = onlineUsers.get(to.toLowerCase());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('incomingCall', payload);
      }
    }
  });

  // Call Accepted
  socket.on('acceptCall', ({ to, isGroup }) => {
    const payload = { from: socketUsername, to, isGroup };
    if (isGroup) {
      socket.to(to).emit('callAccepted', payload);
    } else {
      const recipientSocketId = onlineUsers.get(to.toLowerCase());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('callAccepted', payload);
      }
    }
  });

  // Call Rejected
  socket.on('rejectCall', ({ to, isGroup }) => {
    const payload = { from: socketUsername, to, isGroup };
    if (isGroup) {
      socket.to(to).emit('callRejected', payload);
    } else {
      const recipientSocketId = onlineUsers.get(to.toLowerCase());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('callRejected', payload);
      }
    }
  });

  // Relay WebRTC Signal (SDP Offers/Answers, ICE candidates)
  socket.on('signal', ({ to, signalData, isGroup }) => {
    const payload = {
      from: socketUsername,
      signalData,
      isGroup
    };
    
    // In WebRTC calls (especially group), 'to' is the target username
    const targetSocketId = onlineUsers.get(to.toLowerCase());
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', payload);
    }
  });

  // End Call / Hang Up
  socket.on('endCall', ({ to, isGroup }) => {
    const payload = { from: socketUsername, to, isGroup };
    if (isGroup) {
      socket.to(to).emit('callEnded', payload);
    } else {
      const recipientSocketId = onlineUsers.get(to.toLowerCase());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('callEnded', payload);
      }
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (socketUsername) {
      onlineUsers.delete(socketUsername.toLowerCase());
      io.emit('userOffline', { username: socketUsername });
    }
  });
});

// Start Server listening on 0.0.0.0 for external network access
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`To connect from mobile devices on the same Wi-Fi, use your PC's IP address (e.g. http://192.168.X.X:${PORT})`);
});
