const http = require('http');

http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const tunnels = JSON.parse(data).tunnels;
      if (tunnels && tunnels.length > 0) {
        console.log(tunnels[0].public_url);
      } else {
        console.log("No tunnels found");
      }
    } catch (e) {
      console.log("Error parsing:", e.message);
    }
  });
}).on('error', (e) => {
  console.log("Error fetching:", e.message);
});
