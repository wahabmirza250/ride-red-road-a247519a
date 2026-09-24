# Railway camera service

The production `nemt-camera` service uses `livekit/livekit-server:v1.13.7` in the existing Railway project. Signaling uses HTTPS/WSS on the Railway domain, targeting 7880. The app's server-only LIVEKIT_API_KEY and LIVEKIT_API_SECRET reference this service's variables; never add these values to source control or VITE variables.

Railway's TCP proxy currently routes iriguchi.proxy.rlwy.net:24836 to container port 7881. LiveKit advertises its listening port, so rtc.tcp_port is 24836 and socat forwards internal 7881 to 127.0.0.1:24836. The service start command is:

```sh
/bin/sh -c 'apk add --no-cache socat >/dev/null || exit 1; socat TCP-LISTEN:7881,fork,reuseaddr TCP:127.0.0.1:24836 & exec /livekit-server'
```

LIVEKIT_CONFIG is stored only in Railway, with the API key pair and these non-secret settings:

```yaml
port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  tcp_port: 24836
  node_ip: 66.33.22.219
  use_external_ip: false
  force_tcp: true
  enable_loopback_candidate: true
room:
  empty_timeout: 120
  departure_timeout: 20
  max_participants: 6
logging:
  level: warn
```

Loopback candidates are required by the local TCP forwarder. Disabling them caused the media connection to fail even though authentication and signaling succeeded. A two-participant browser test with a generated canvas video confirmed a decoded video frame on 2026-09-24. It did not access any physical camera or patient data.

If the Railway proxy changes, resolve its IPv4 again and update node_ip, tcp_port, and forwarding target together. Keep one replica: this setup uses single-node routing. This TCP-only service does not include TURN/TLS on 443, so networks blocking the media port still need an additional TURN service. The driver must enable the camera in the foreground; the application does not record audio or video.
