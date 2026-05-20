import http from 'node:http';
import https from 'node:https';

const PORT = 3001;

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const imageUrl = parsed.searchParams.get('url');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!imageUrl) {
    res.writeHead(400);
    res.end('Missing url parameter');
    return;
  }

  const client = imageUrl.startsWith('https') ? https : http;
  client.get(imageUrl, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      // Follow redirect
      const redirectClient = proxyRes.headers.location.startsWith('https') ? https : http;
      redirectClient.get(proxyRes.headers.location, (redirectRes) => {
        res.writeHead(redirectRes.statusCode, {
          'Content-Type': redirectRes.headers['content-type'] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        redirectRes.pipe(res);
      }).on('error', () => { res.writeHead(502); res.end('Redirect failed'); });
      return;
    }
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  }).on('error', (err) => {
    res.writeHead(502);
    res.end('Proxy error: ' + err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Image proxy running on http://localhost:${PORT}`);
});
