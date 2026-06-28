// =================================================================
// 1. IMPORT ALL NECESSARY PACKAGES
// =================================================================
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const session = require('express-session');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const multer = require('multer'); // Import multer for file uploads
require('dotenv').config();

const connectDB = require('./db');
const Message = require('./models/Message');
const User = require('./models/User');
const Project = require('./models/Project');
const auth = require('./middleware/auth');
const projectRoutes = require('./routes');
const userRoutes = require('./routes/userRoutes');

const JWT_SECRET = process.env.JWT_SECRET || 'a_super_secret_jwt_key_that_is_long_and_random';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';

// =================================================================
// 2. INITIALIZE APP & CONNECT TO DATABASE
// =================================================================
const app = express();
const port = process.env.PORT || 5000;

connectDB();

// =================================================================
// 3. SETUP MIDDLEWARE
// =================================================================
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        const allowedOrigins = [
            FRONTEND_URL,
            'http://localhost:5500',
            'http://127.0.0.1:5500',
            'http://localhost:3000',
            'http://127.0.0.1:3000'
        ];
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json());
// Serve uploaded files from Backend/uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount project routes
app.use('/api/projects', projectRoutes);

app.use(session({
    secret: process.env.SESSION_SECRET || 'a_default_session_secret',
    resave: false,
    saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

// =================================================================
// 4. CONFIGURE MULTER FOR FILE UPLOADS
// =================================================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // The folder where files will be stored
    },
    filename: function (req, file, cb) {
        // Create a unique filename to avoid overwriting existing files
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// =================================================================
// 5. CONFIGURE PASSPORT STRATEGIES
// =================================================================
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:5000/auth/google/callback"
},
    async (accessToken, refreshToken, profile, done) => {
        const { displayName, emails, photos } = profile;
        const email = emails?.[0]?.value;
        const profilePictureUrl = photos?.[0]?.value;
        try {
            let user = await User.findOne({ email: email });
            if (user) {
                user.name = displayName;
                user.profilePictureUrl = profilePictureUrl;
                await user.save();
                return done(null, user);
            }
            const randomPassword = Math.random().toString(36).slice(-8);
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(randomPassword, salt);
            user = new User({
                name: displayName,
                email: email,
                profilePictureUrl: profilePictureUrl,
                password: hashedPassword,
            });
            await user.save();
            done(null, user);
        } catch (err) {
            console.error(err);
            return done(err, null);
        }
    }
));

// =================================================================
// 6. DEFINE API ROUTES
// =================================================================
// Duplicate route mounting removed (already mounted on line 41)

// Mount User Routes
app.use('/', userRoutes);

// =================================================================
// 6. MESSAGING ROUTES
// =================================================================

// @route   POST /api/messages
// @desc    Send a message (teacher → student)
app.post('/api/messages', auth, async (req, res) => {
    try {
        const { to, text } = req.body;
        if (!to || !text) {
            return res.status(400).json({ message: 'Recipient and message text are required' });
        }
        const message = new Message({ from: req.user.id, to, text });
        await message.save();
        const populated = await Message.findById(message._id)
            .populate('from', 'name email profilePictureUrl')
            .populate('to', 'name email profilePictureUrl');
        res.status(201).json(populated);
    } catch (err) {
        console.error('Send message error:', err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   GET /api/messages/unread
// @desc    Get unread message count + latest 5 unread
app.get('/api/messages/unread', auth, async (req, res) => {
    try {
        const messages = await Message.find({ to: req.user.id, read: false })
            .populate('from', 'name email profilePictureUrl')
            .sort({ createdAt: -1 })
            .limit(5);
        const count = await Message.countDocuments({ to: req.user.id, read: false });
        res.json({ count, messages });
    } catch (err) {
        console.error('Get unread messages error:', err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   GET /api/messages
// @desc    Get all messages for the current user
app.get('/api/messages', auth, async (req, res) => {
    try {
        const messages = await Message.find({
            $or: [{ to: req.user.id }, { from: req.user.id }]
        })
            .populate('from', 'name email profilePictureUrl role')
            .populate('to', 'name email profilePictureUrl role')
            .sort({ createdAt: -1 });
        res.json(messages);
    } catch (err) {
        console.error('Get messages error:', err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   PUT /api/messages/:id/read
// @desc    Mark a message as read
app.put('/api/messages/:id/read', auth, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Message not found' });
        if (message.to.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        message.read = true;
        await message.save();
        res.json(message);
    } catch (err) {
        console.error('Mark read error:', err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// --- GOOGLE AUTH ROUTES ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}/login.html`, session: false }),
    (req, res) => {
        const payload = { user: { id: req.user.id, role: req.user.role } };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
        res.redirect(`${FRONTEND_URL}/dashboard.html?token=${token}`);
    });

// =================================================================
// 7. START THE SERVER
// =================================================================
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
});
