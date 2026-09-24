# NEMT live camera server

No LiveKit Cloud account is required. Users sign into the existing NEMT app.
The app uses LiveKit's open-source JavaScript and server SDKs, not a custom video transport.

## Hosting

Use a Linux host with a public IP and Docker. A normal HTTPS-only app service is insufficient for WebRTC media networking.

1. Copy `livekit.example.yaml` to `livekit.yaml`, replace both key placeholders with unique random values, and restrict file access.
2. Point a chosen video subdomain to the host and terminate trusted HTTPS/WSS with a reverse proxy to port 7880. Do not expose port 7880 directly to the public internet.
3. Allow incoming media TCP 7881 and UDP 50000–50100. The host must advertise its reachable public IP.
4. Run `docker compose up -d`. The supplied single-node configuration is a starting point; verify network reachability before rollout.
5. Set these **server-only** variables on the NEMT web service: `LIVEKIT_URL=wss://<video-host>`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. The key and secret must match `livekit.yaml`. Never use `VITE_` prefixes.
6. For mobile carriers/restrictive networks, configure LiveKit's authenticated TURN/TLS service with its own domain/certificate following the official guide. Test on cellular and Wi-Fi. The starter configuration does not include TURN, so it cannot guarantee connectivity on every network.

Official deployment guide: https://docs.livekit.io/transport/self-hosting/deployment/
Source/license: https://github.com/livekit/livekit (Apache-2.0).

## Operation and limits

- Driver enables camera availability on the tablet once per app session and grants camera permission. Administrators in the same company select **Drivers → View camera**.
- The camera publishes only while at least one authorized viewer is present and the driver app is visible. Closing all viewers stops capture. The driver can turn it off at any time.
- Video only; audio and recording are not enabled. No passenger camera is exposed.
- Moving to another app pauses capture. This version is not an Android background camera service.
- Access is checked against database roles, active company, and driver ownership before issuing a five-minute join token. Server logs record access issuance without tokens or patient data.
- A disconnected, powered-off, sleeping, or offline tablet cannot provide live video. Test permissions, switching apps, loss/recovery of connectivity, and concurrent viewers on actual tablets before fleet use.

The server has not been provisioned by adding these files. Live viewing remains unavailable until hosting and web deployment are completed.
