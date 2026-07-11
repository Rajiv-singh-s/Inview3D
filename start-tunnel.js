const ngrok = require('ngrok');

(async function() {
  try {
    await ngrok.kill();
    const url = await ngrok.connect({
      authtoken: '3GKk4VAhzPdtqX6qeHJJYX1nk1t_3kcdSTcMqEZfYWvvAM88r',
      addr: 4000
    });
    console.log("PUBLIC_URL=" + url);
  } catch (err) {
    console.error(err);
  }
})();
