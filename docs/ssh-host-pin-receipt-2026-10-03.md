# VPS SSH host pin receipt — 3 October 2026

The retained VPS preload path uses the Ed25519 host key already present in the operator's trusted known_hosts. Its public fingerprint is `SHA256:jqrn83QeSlKz9fTXj9Tilyjn7m5Dy8IGx+slNFpn8ow`.

Through the established `Racknerd-Deploy` connection, the server's `/etc/ssh/ssh_host_ed25519_key.pub` produced the same fingerprint. A separate connection with the extracted exact-host pin, `StrictHostKeyChecking=yes`, explicit dedicated key, `IdentitiesOnly=yes`, and `IdentityAgent=none` succeeded as deploy on racknerd-2d09df5. A randomly generated wrong Ed25519 pin returned exit 255 with host-key verification failure before authentication.

The previously absent protected repository secret `RACKNERD_KNOWN_HOSTS` was set from that trusted public record and its existence read back. No private key, credential, or secret value is included in this receipt. No server SSH/firewall configuration was changed, and no GHCR token was transmitted in the verification handshake.

This reuses prior operator trust and confirms the server key through the established trusted connection; it does not claim a newly obtained provider-console fingerprint. Planned rotation requires independent operator verification before replacing the protected pin. The workflow now fails closed if the pin is absent or malformed, and must not use an unauthenticated live scan as its trust root.
