const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
// Ensure the path to your middleware is correct relative to routes.js
const auth = require('./middleware/auth');
const Project = require('./models/Project');
const User = require('./models/User');

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Note: This path assumes your server is run from the 'backend' directory.
    const uploadPath = path.join(__dirname, './uploads/projects');
    // Create the directory if it doesn't exist
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate a unique filename to prevent conflicts
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'project-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});


// --- Project Routes ---

// @route   GET api/projects
// @desc    Get all projects for the current user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const projects = await Project.find({ user: req.user.id })
      .populate('user', ['name', 'profilePictureUrl'])
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});
// @route   POST api/projects
// @desc    Create a project
// @access  Private
router.post('/', auth, upload.single('projectImage'), async (req, res) => {
  const { projectName, projectDescription, techUsed, projectUrl, githubUrl } = req.body;

  if (!projectName || !projectDescription || !techUsed) {
    return res.status(400).json({ message: 'Project Name, Description, and Tech Used are required.' });
  }

  if (!req.file) {
    return res.status(400).json({ message: 'Project image is required.' });
  }

  try {
    // The URL path should be relative to the server's public folder for client access
    const imageUrl = `/uploads/projects/${req.file.filename}`;

    const newProject = new Project({
      user: req.user.id,
      projectName,
      projectDescription,
      techUsed,
      projectUrl: projectUrl || '',
      githubUrl: githubUrl || '',
      screenshotUrl: imageUrl
      // Removed userName and userAvatar as they are not in the Project schema.
      // This data should be populated on the frontend via the 'user' ref.
    });

    const project = await newProject.save();
    res.status(201).json(project);
  } catch (err) {
    console.error('Project creation error:', err.message);
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route   GET api/projects/community
// @desc    Get all projects from all users (for community feed)
// @access  Private
router.get('/community', auth, async (req, res) => {
  try {
    // Populate user data to get name and avatar for each project
    const projects = await Project.find({})
      .populate('user', ['name', 'profilePictureUrl'])
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/projects/:id
// @desc    Get a single project by its ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).populate('user', ['name', 'profilePictureUrl']);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE api/projects/:id
// @desc    Delete a project
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (project.user.toString() !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized' });
    }

    // Delete the image file from the server if it exists
    if (project.screenshotUrl) {
      const imagePath = path.join(__dirname, project.screenshotUrl);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    // FIX: Replaced deprecated .remove() with the modern .deleteOne()
    await Project.deleteOne({ _id: req.params.id });

    res.json({ message: 'Project removed successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// --- Voting Routes ---

// @route   PUT api/projects/:id/upvote
// @desc    Upvote a project
// @access  Private
router.put('/:id/upvote', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Initialize arrays for legacy projects
    if (!project.upvotedBy) {
      project.upvotedBy = [];
    }
    if (!project.downvotedBy) {
      project.downvotedBy = [];
    }

    if (project.upvotedBy.some(userId => userId.toString() === req.user.id)) {
      project.upvotedBy = project.upvotedBy.filter(
        userId => userId.toString() !== req.user.id
      );
    } else {
      project.upvotedBy.push(req.user.id);
      project.downvotedBy = project.downvotedBy.filter(
        userId => userId.toString() !== req.user.id
      );
    }

    project.upvotes = project.upvotedBy.length;
    await project.save();
    res.json(project);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/projects/:id/downvote
// @desc    Downvote a project
// @access  Private
router.put('/:id/downvote', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Initialize arrays for legacy projects
    if (!project.upvotedBy) {
      project.upvotedBy = [];
    }
    if (!project.downvotedBy) {
      project.downvotedBy = [];
    }

    if (project.downvotedBy.some(userId => userId.toString() === req.user.id)) {
      project.downvotedBy = project.downvotedBy.filter(
        userId => userId.toString() !== req.user.id
      );
    } else {
      project.downvotedBy.push(req.user.id);
      project.upvotedBy = project.upvotedBy.filter(
        userId => userId.toString() !== req.user.id
      );
    }

    await project.save();
    res.json(project);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// --- Comment Routes ---

// Add comment to a project (Teachers only)
router.post('/:id/comments', auth, async (req, res) => {
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
router.get('/:projectId/comments', auth, async (req, res) => {
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


module.exports = router;
