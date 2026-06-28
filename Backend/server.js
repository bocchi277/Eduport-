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
        const email = emails[0].value;
        const profilePictureUrl = photos[0].value;
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

// --- AUTHENTICATION ROUTES ---
app.post('/register', async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email, and password are required.' });
    }
    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'Email already exists.' });
        }
        user = new User({
            name,
            email,
            password,
            role: role && ['student', 'teacher'].includes(role) ? role : 'student'
        });
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server error');
    }
});

app.post('/login', async (req, res) => {
    const { email, password, role } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials.' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });

        // CRITICAL FIX: Always update user role based on login selection
        // This ensures the database role matches what the user selected
        if (role && ['student', 'teacher'].includes(role)) {
            console.log(`Updating user ${user.email} role from ${user.role} to ${role}`);
            user.role = role;
            await user.save();
        }

        // Ensure user has a valid role, default to student if not set
        if (!user.role || !['student', 'teacher'].includes(user.role)) {
            user.role = 'student';
            await user.save();
        }

        console.log(`User ${user.email} logged in as ${user.role}`);

        const payload = { user: { id: user.id, role: user.role } };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
        res.json({
            token,
            role: user.role,
            message: `Login successful as ${user.role}`,
            redirectTo: user.role === 'teacher' ? 'teacher-dashboard.html' : 'student-dashboard.html'
        });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// --- GET CURRENT USER'S DETAILS ---
app.get('/api/users/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- UPDATE CURRENT USER'S DETAILS ---
// Configure multer for profile uploads
const profileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath;
        if (file.fieldname === 'profilePicture' || file.fieldname === 'profileImage') {
            uploadPath = path.join(__dirname, './uploads/profiles');
        } else if (file.fieldname === 'resume') {
            uploadPath = path.join(__dirname, './uploads/resumes');
        } else {
            uploadPath = path.join(__dirname, './uploads/misc');
        }

        // Create directory if it doesn't exist
        const fs = require('fs');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        let prefix;

        if (file.fieldname === 'profilePicture' || file.fieldname === 'profileImage') {
            prefix = 'profile';
        } else if (file.fieldname === 'resume') {
            prefix = 'resume';
        } else {
            prefix = 'file';
        }

        cb(null, `${prefix}-${uniqueSuffix}${extension}`);
    }
});

const profileUpload = multer({
    storage: profileStorage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'profilePicture' || file.fieldname === 'profileImage') {
            // Check if file is an image
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Profile picture must be an image file!'), false);
            }
        } else if (file.fieldname === 'resume') {
            // Check if file is a document
            const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
            if (allowedTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Resume must be a PDF, DOC, or DOCX file!'), false);
            }
        } else {
            cb(null, true);
        }
    }
});

app.put('/api/users/update-profile', auth, profileUpload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'resume', maxCount: 1 }
]), async (req, res) => {
    try {
        const { name, username, bio, linkedin, github, portfolio, twitter } = req.body;

        // Find the user
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update basic fields
        if (name) user.name = name;
        if (username) user.username = username;
        if (bio) user.bio = bio;

        // Handle socialLinks
        if (req.body.socialLinks) {
            try {
                const parsedLinks = typeof req.body.socialLinks === 'string' ? JSON.parse(req.body.socialLinks) : req.body.socialLinks;
                user.socialLinks = parsedLinks;
            } catch (e) {
                console.error('Error parsing social links:', e);
            }
        }

        // Handle file uploads
        if (req.files) {
            if (req.files.profileImage && req.files.profileImage[0]) {
                user.profileImage = `/uploads/profiles/${req.files.profileImage[0].filename}`;
            }
            if (req.files.resume && req.files.resume[0]) {
                user.resume = `/uploads/resumes/${req.files.resume[0].filename}`;
            }
        }

        await user.save();

        // Return updated user (without password)
        const updatedUser = await User.findById(user._id).select('-password');
        res.json(updatedUser);

    } catch (err) {
        console.error('Profile update error:', err.message);
        res.status(500).json({ message: 'Server error updating profile' });
    }
});

app.put('/api/users/me', auth, profileUpload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'profileImage', maxCount: 1 },
    { name: 'resume', maxCount: 1 }
]), async (req, res) => {
    try {
        const { name, fullName, username, bio, socialLinks } = req.body;
        const updatedFields = {};

        // Parse socialLinks if it's a string (from FormData)
        let parsedSocialLinks = {};
        if (socialLinks) {
            try {
                parsedSocialLinks = typeof socialLinks === 'string' ? JSON.parse(socialLinks) : socialLinks;
            } catch (e) {
                console.error('Error parsing social links:', e);
                parsedSocialLinks = {};
            }
        }

        // Check if username is unique (if provided and different from current)
        if (username) {
            const existingUser = await User.findOne({ username, _id: { $ne: req.user.id } });
            if (existingUser) {
                return res.status(400).json({ message: 'Username already exists' });
            }
            updatedFields.username = username;
        }

        // Update basic fields
        if (name) updatedFields.name = name;
        if (fullName) updatedFields.fullName = fullName;
        if (bio !== undefined) updatedFields.bio = bio;
        if (parsedSocialLinks && Object.keys(parsedSocialLinks).length > 0) {
            updatedFields.socialLinks = parsedSocialLinks;
        }

        // Handle file uploads
        if (req.files) {
            const fs = require('fs');
            const currentUser = await User.findById(req.user.id);

            if (req.files.profilePicture || req.files.profileImage) {
                const profileFile = req.files.profilePicture?.[0] || req.files.profileImage?.[0];
                if (profileFile) {
                    // Delete old profile image if exists
                    if (currentUser.profileImage && fs.existsSync(currentUser.profileImage)) {
                        fs.unlinkSync(currentUser.profileImage);
                    }
                    if (currentUser.profilePictureUrl && currentUser.profilePictureUrl.startsWith('/uploads/')) {
                        const oldPath = path.join(__dirname, '..', currentUser.profilePictureUrl);
                        if (fs.existsSync(oldPath)) {
                            fs.unlinkSync(oldPath);
                        }
                    }
                    updatedFields.profileImage = `/uploads/profiles/${profileFile.filename}`;
                    updatedFields.profilePictureUrl = `/uploads/profiles/${profileFile.filename}`;
                }
            }

            if (req.files.resume) {
                const resumeFile = req.files.resume[0];
                // Delete old resume if exists
                if (currentUser.resumeUrl && fs.existsSync(currentUser.resumeUrl)) {
                    fs.unlinkSync(currentUser.resumeUrl);
                }
                updatedFields.resumeUrl = `/uploads/resumes/${resumeFile.filename}`;
            }
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updatedFields },
            { new: true }
        ).select('-password');

        res.json(user);
    } catch (err) {
        console.error('Profile update error:', err.message);
        if (err.name === 'ValidationError') {
            return res.status(400).json({ message: err.message });
        }
        res.status(500).json({ message: 'Server Error' });
    }
});

// --- COMMENT FUNCTIONALITY ---
// Add comment to a project (Teachers only)
app.post('/api/projects/:id/comments', auth, async (req, res) => {
    try {
        console.log('Comment route hit:', req.params.id);
        console.log('Request body:', req.body);
        console.log('User ID:', req.user.id);

        const { text } = req.body;

        // Validate comment text first
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            console.log('Invalid text provided:', text);
            return res.status(400).json({ message: 'Comment text is required' });
        }

        if (text.trim().length > 1000) {
            return res.status(400).json({ message: 'Comment must be less than 1000 characters' });
        }

        // Check if user exists and is a teacher
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            console.log('User not found:', req.user.id);
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.role !== 'teacher') {
            console.log('User is not a teacher:', user.role);
            return res.status(403).json({ message: 'Only teachers can add comments' });
        }

        // Find the project
        const project = await Project.findById(req.params.id);
        if (!project) {
            console.log('Project not found:', req.params.id);
            return res.status(404).json({ message: 'Project not found' });
        }

        console.log('Project found:', project.projectName);

        // Create new comment
        const newComment = {
            user: req.user.id,
            text: text.trim(),
            createdAt: new Date()
        };

        // Add comment to project
        if (!project.comments) {
            project.comments = [];
        }

        project.comments.push(newComment);

        // Save the project
        const savedProject = await project.save();
        console.log('Project saved with comment');

        // Return success response
        res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            comment: newComment,
            commentCount: savedProject.comments.length
        });

    } catch (err) {
        console.error('Add comment error:', err);
        res.status(500).json({
            message: 'Server Error',
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// Get comments for a project
app.get('/api/projects/:projectId/comments', auth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.projectId)
            .populate('comments.user', 'name email')
            .select('comments');

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        res.json(project.comments);
    } catch (err) {
        console.error('Get comments error:', err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// --- STUDENT PROFILE VIEWING ---
// Get student profile by user ID (for teachers to view)
app.get('/api/students/:userId/profile', auth, async (req, res) => {
    try {
        // Check if requesting user is a teacher
        const requestingUser = await User.findById(req.user.id).select('-password');
        if (requestingUser.role !== 'teacher') {
            return res.status(403).json({ message: 'Only teachers can view student profiles' });
        }

        // Find the student
        const student = await User.findById(req.params.userId).select('-password');
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        // Only return student profiles
        if (student.role !== 'student') {
            return res.status(403).json({ message: 'Profile not accessible' });
        }

        res.json(student);
    } catch (err) {
        console.error('Get student profile error:', err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});


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
