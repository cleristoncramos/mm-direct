const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// Fix processaCSV
content = content.replace(
  /if \(ctx\.total === 1\) \{[\s\S]*?\} else if \(ctx\.total >= 3\) \{/,
  `if (!ctx.database_startup_time && row.key === 'Database startup') {
          ctx.database_startup_time = parseInt(row.startTime);
        } else if (ctx.database_startup_time && row.type !== '0' && row.key !== 'Recovery' && row.key !== 'key') {`
);

// Fix processaLatencia
content = content.replace(
  /if \(ctx\.totalLatencia === 1\) \{[\s\S]*?\} else if \(ctx\.totalLatencia >= 3\) \{/,
  `if (!ctx.database_startup_time_latencia && row.key === 'Database startup') {
          ctx.database_startup_time_latencia = parseInt(row.startTime);
        } else if (ctx.database_startup_time_latencia && row.type !== '0' && row.key !== 'Recovery' && row.key !== 'key') {`
);

fs.writeFileSync('server.js', content);
console.log('robust parsers patched');
