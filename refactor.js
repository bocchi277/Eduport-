const fs = require('fs');
const path = require('path');

const serverJsPath = path.join(__dirname, 'Backend/server.js');
const routesJsPath = path.join(__dirname, 'Backend/routes.js');
const userRoutesJsPath = path.join(__dirname, 'Backend/routes/userRoutes.js');

let serverContent = fs.readFileSync(serverJsPath, 'utf8');
let routesContent = fs.readFileSync(routesJsPath, 'utf8');

// 1. Move comments logic to routes.js
// Extract from server.js
const commentsStart = serverContent.indexOf('// Add comment to a project');
const commentsEnd = serverContent.indexOf('// --- STUDENT PROFILE VIEWING ---');
const commentsLogic = serverContent.substring(commentsStart, commentsEnd);

// In routes.js, replace the old POST /:id/comment (lines 225-259) with the new logic
const oldCommentStart = routesContent.indexOf('// @route   POST api/projects/:id/comment');
const oldCommentEnd = routesContent.indexOf('module.exports = router;');
const beforeOldComment = routesContent.substring(0, oldCommentStart);

// Clean up commentsLogic (replace app.post/app.get with router.post/router.get, remove /api/projects)
let newCommentsLogic = commentsLogic
    .replace(/app\.post\('\/api\/projects\//g, "router.post('/")
    .replace(/app\.get\('\/api\/projects\//g, "router.get('/");

routesContent = beforeOldComment + newCommentsLogic + '\nmodule.exports = router;\n';
fs.writeFileSync(routesJsPath, routesContent);


// 2. Add /api/students/:userId/profile to userRoutes.js
let userRoutesContent = fs.readFileSync(userRoutesJsPath, 'utf8');
const studentStart = serverContent.indexOf('// --- STUDENT PROFILE VIEWING ---');
const studentEnd = serverContent.indexOf('// =================================================================\n// 7. MESSAGE SYSTEM API ROUTES');
let studentLogic = serverContent.substring(studentStart, studentEnd);
studentLogic = studentLogic.replace(/app\.get\('/g, "router.get('");

userRoutesContent = userRoutesContent.replace('module.exports = router;', studentLogic + '\nmodule.exports = router;');
fs.writeFileSync(userRoutesJsPath, userRoutesContent);


// 3. Clean up server.js
const authRoutesStart = serverContent.indexOf('// --- AUTHENTICATION ROUTES ---');
const beforeAuth = serverContent.substring(0, authRoutesStart);

const afterStudent = serverContent.substring(studentEnd);

// Add the userRoutes require at the top
let newServerContent = beforeAuth.replace("const projectRoutes = require('./routes');", "const projectRoutes = require('./routes');\nconst userRoutes = require('./routes/userRoutes');");

newServerContent = newServerContent + '// Mount User Routes\napp.use(\'/\', userRoutes);\n\n' + afterStudent;

fs.writeFileSync(serverJsPath, newServerContent);

console.log("Refactoring complete");
