const { spawn } = require('child_process');
const child = spawn('./redis-server', [], { cwd: '/home/cleriston/Documentos/projeto/MM-DIRECT/src' });
child.stdout.on('data', (data) => console.log('STDOUT:', data.toString()));
child.stderr.on('data', (data) => console.log('STDERR:', data.toString()));
child.on('exit', (code) => console.log('EXITED:', code));
setTimeout(() => { child.kill(); process.exit(0); }, 3000);
