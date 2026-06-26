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
  { username: "aashish", password: "123456", name: "Aashish" },
  { username: "admin", password: "admin123", name: "Administrator" }
];

// In-memory stores
const onlineUsers = new Map(); // username -> socketId
const chatHistory = [];       // array of { id, from, to, text, timestamp, status: 'delivered' | 'seen' }

app.use(express.json());
app.use(cookieParser('chat-app-secret-key'));

// Auth middleware for HTML pages
const checkAuth = (req, res, next) => {
  const username = req.cookies.username;
  const userExists = users.some(u => u.username === username);
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

  // Prevent duplicate logins
  if (onlineUsers.has(user.username)) {
    return res.status(409).json({ error: 'User is already logged in elsewhere' });
  }

  res.cookie('username', user.username, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
  res.json({ success: true, username: user.username, name: user.name });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  const username = req.cookies.username;
  if (username) {
    onlineUsers.delete(username);
    res.clearCookie('username');
  }
  res.json({ success: true });
});

// Get user profile endpoint
app.get('/api/me', (req, res) => {
  const username = req.cookies.username;
  const user = users.find(u => u.username === username);
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
    online: onlineUsers.has(u.username)
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

  if (!socketUsername || !users.some(u => u.username === socketUsername)) {
    socket.disconnect(true);
    return;
  }

  // Bind username to socket map
  onlineUsers.set(socketUsername, socket.id);
  
  // Notify everyone that user is online
  io.emit('userOnline', { username: socketUsername });

  // Send undelivered/unseen status updates or message history
  // For simplicity, client will request messages on load, or we can push
  socket.emit('initChat', {
    history: chatHistory.filter(msg => msg.from === socketUsername || msg.to === socketUsername),
    users: users.map(u => ({
      username: u.username,
      name: u.name,
      online: onlineUsers.has(u.username)
    }))
  });

  // Handle incoming private message
  socket.on('privateMessage', ({ to, text }) => {
    if (!to || !text || text.trim() === '') return;

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: socketUsername,
      to: to,
      text: text,
      timestamp: new Date().toISOString(),
      status: onlineUsers.has(to) ? 'delivered' : 'sent'
    };

    chatHistory.push(message);

    // Send to sender
    socket.emit('messageReceived', message);

    // Send to recipient if online
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('privateMessage', message);
    }
  });

  // Handle typing indicator
  socket.on('typing', ({ to }) => {
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('typing', { from: socketUsername });
    }
  });

  socket.on('stopTyping', ({ to }) => {
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('stopTyping', { from: socketUsername });
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

    const senderSocketId = onlineUsers.get(from);
    if (senderSocketId) {
      io.to(senderSocketId).emit('messagesStatusUpdated', { messageIds, status: 'seen', to: socketUsername });
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (socketUsername) {
      onlineUsers.delete(socketUsername);
      io.emit('userOffline', { username: socketUsername });
    }
  });
});

// Start Server listening on 0.0.0.0 for external network access
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`To connect from mobile devices on the same Wi-Fi, use your PC's IP address (e.g. http://192.168.X.X:${PORT})`);
});
