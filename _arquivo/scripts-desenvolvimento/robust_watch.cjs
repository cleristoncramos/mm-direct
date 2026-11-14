const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// For /data route
content = content.replace(
  /watcher = fs\.watch\(path\.dirname\(inputPath\), \(eventType, filename\) => \{[\s\S]*?\}\);/g,
  `
  let checkInterval = null;
  let lastSize = -1;
  watcher = fs.watch(path.dirname(inputPath), (eventType, filename) => {
    if (filename === path.basename(inputPath)) {
      if (!checkInterval) {
        checkInterval = setInterval(() => {
          try {
            const currentSize = fs.statSync(inputPath).size;
            if (currentSize === lastSize && currentSize > 0) {
              clearInterval(checkInterval);
              checkInterval = null;
              lerTudo();
            }
            lastSize = currentSize;
          } catch(e) {}
        }, 500);
      }
    }
  });
  `
);

fs.writeFileSync('server.js', content);
console.log('Robust watch applied!');
