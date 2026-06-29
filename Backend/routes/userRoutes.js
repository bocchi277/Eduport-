const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'a_super_secret_jwt_key_that_is_long_and_random';

// --- Configure Multer for Profile Uploads ---
const profileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath;
        if (file.fieldname === 'profilePicture' || file.fieldname === 'profileImage') {
            uploadPath = path.join(__dirname, '../uploads/profiles');
        } else if (file.fieldname === 'resume') {
            uploadPath = path.join(__dirname, '../uploads/resumes');
        } else {
            uploadPath = path.join(__dirname, '../uploads/misc');
        }

        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        let prefix = file.fieldname === 'resume' ? 'resume' : 'profile';
        cb(null, `${prefix}-${uniqueSuffix}${extension}`);
    }
});

const profileUpload = multer({
    storage: profileStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'profilePicture' || file.fieldname === 'profileImage') {
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Profile picture must be an image!'), false);
            }
        } else if (file.fieldname === 'resume') {
            if (file.mimetype === 'application/pdf' || file.mimetype === 'application/msword' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                cb(null, true);
            } else {
                cb(new Error('Resume must be a PDF, DOC, or DOCX file!'), false);
            }
        } else {
            cb(null, true);
        }
    }
});

// @route   POST api/users/register
router.post('/api/users/register', async (req, res) => {
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

// @route   POST api/users/login
router.post('/api/users/login', async (req, res) => {
    const { email, password, role } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials.' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });

        if (role && ['student', 'teacher'].includes(role)) {
            user.role = role;
            await user.save();
        }
        if (!user.role || !['student', 'teacher'].includes(user.role)) {
            user.role = 'student';
            await user.save();
        }

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

// @route   GET api/users/me
router.get('/api/users/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/students/:userId/profile
router.get('/api/students/:userId/profile', auth, async (req, res) => {
    try {
        const student = await User.findById(req.params.userId).select('-password');
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        res.json(student);
    } catch (err) {
        console.error('Get student profile error:', err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   PUT api/users/update-profile
router.put('/api/users/update-profile', auth, profileUpload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'resume', maxCount: 1 }
]), async (req, res) => {
    try {
        const { name, username, bio } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (name) user.name = name;
        if (username) user.username = username;
        if (bio) user.bio = bio;

        if (req.body.socialLinks) {
            try {
                user.socialLinks = typeof req.body.socialLinks === 'string' ? JSON.parse(req.body.socialLinks) : req.body.socialLinks;
            } catch (e) {
                console.error('Error parsing social links:', e);
            }
        }

        if (req.files) {
            if (req.files.profileImage && req.files.profileImage[0]) {
                user.profileImage = `/uploads/profiles/${req.files.profileImage[0].filename}`;
            }
            if (req.files.resume && req.files.resume[0]) {
                user.resume = `/uploads/resumes/${req.files.resume[0].filename}`;
            }
        }

        await user.save();
        const updatedUser = await User.findById(user._id).select('-password');
        res.json(updatedUser);
    } catch (err) {
        console.error('Profile update error:', err.message);
        res.status(500).json({ message: 'Server error updating profile' });
    }
});

module.exports = router;

