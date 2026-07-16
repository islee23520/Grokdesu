# Security policy

Omonative is private-by-default. The application binds exclusively to loopback and relies on Tailscale Serve for remote reachability. Pairing codes are one-use and expire in five minutes. Tokens are returned once, hashed with SHA-256 at rest, scoped, and revocable. Transcript content is never stored in the control database.

Report vulnerabilities privately to the deployment owner. Do not include credentials, provider transcripts, pairing codes, or signed replay cursors in reports.
