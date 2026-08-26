# End-to-end run (real Chrome, real extension, live services)

Exercises the built extension the way a user does — not the demo stub:
loads `dist/` as an unpacked extension, serves fixture pages from a real
`https://*.myworkday.com` origin, and (optionally) hits the live billing
server and AI relay.

```bash
# once: Chrome for Testing (system Chrome ≥137 refuses --load-extension)
npx @puppeteer/browsers install chrome@stable

npm run build
node e2e/tenant-server.mjs &          # fixture tenant on https://127.0.0.1:8443
node e2e/run.mjs [adm_owner_token]    # token optional; enables the live checks
```

`--host-resolver-rules` maps `*.myworkday.com` to the local fixture server and
`--ignore-certificate-errors` accepts its self-signed cert, so the content
script runs under its real match pattern. Regenerate the cert with:

```bash
openssl req -x509 -newkey rsa:2048 -keyout e2e/key.pem -out e2e/cert.pem \
  -days 365 -nodes -subj "/CN=*.myworkday.com" \
  -addext "subjectAltName=DNS:*.myworkday.com"
```

Passing the owner token also makes a real (sub-cent) Anthropic call through
the relay, which is the only way to prove the deployed key works.
