const WebSocket = require('ws');

async function testChannel(channel) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:8081/${channel}`);

    ws.on('open', () => {
      console.log(`WS_CONNECTION_ACCEPTED path=/${channel}`);
      
      // Send a synthetic packet
      const diagnosticPacket = {
        type: "TELEMETRY",
        channel: channel,
        runId: "diagnostic",
        timestampUs: 1000000,
        value: 25
      };
      ws.send(JSON.stringify(diagnosticPacket));

      // Close after 2 seconds
      setTimeout(() => {
        ws.close();
        resolve();
      }, 2000);
    });

    ws.on('message', (data) => {
      console.log(`[${channel}] RECEIVED:`, data.toString().substring(0, 200));
    });

    ws.on('close', () => {
      console.log(`[${channel}] Connection closed.`);
    });

    ws.on('error', (err) => {
      console.log(`WS_CONNECTION_REJECTED path=/${channel} reason=${err.message}`);
      resolve(); // resolve anyway to continue to the next one
    });
  });
}

async function runAll() {
  await testChannel('data');
  await testChannel('cpu');
  await testChannel('memory');
  await testChannel('latencia');
  console.log("All tests finished.");
  process.exit(0);
}

runAll();
