import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(import.meta.dirname, 'tenant');
https.createServer(
  { key: fs.readFileSync(path.join(import.meta.dirname, 'key.pem')), cert: fs.readFileSync(path.join(import.meta.dirname, 'cert.pem')) },
  (req, res) => {
    if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
    const name = (req.url.split('?')[0] || '/').replace(/^\//, '') || 'sections.html';
    const file = path.join(dir, path.basename(name));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  },
).listen(8443, () => console.log('fake tenant on https://127.0.0.1:8443'));
