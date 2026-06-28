const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');

function replaceUrls(dir) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            replaceUrls(fullPath);
        } else if (fullPath.endsWith('.js') || fullPath.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let original = content;
            
            // Replace localhost:3000
            content = content.replace(/http:\/\/localhost:3000/g, 'https://eduport-1.onrender.com');
            
            // Replace localhost:5000
            content = content.replace(/http:\/\/localhost:5000/g, 'https://eduport-1.onrender.com');
            
            // Replace old render URL
            content = content.replace(/https:\/\/eduport-backend-6uib\.onrender\.com/g, 'https://eduport-1.onrender.com');
            
            if (content !== original) {
                fs.writeFileSync(fullPath, content);
                console.log(`Updated ${file}`);
            }
        }
    }
}

replaceUrls(publicDir);
console.log('Done!');
