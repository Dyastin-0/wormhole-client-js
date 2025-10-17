# Wormhole Client
Wormhole client for `NodeJS`.

## How to Install

### npm

```bash
npm install -g @dyastin-0/wormhole-client-js
```

## How to Use

### Running a Tunnel

Creating a tunnel is fairly simple, you just need to specify your desired and valid sub-domain, target address, and the wormhole server address. If you don't specify the `--address`, by default, it will connect to my self-hosted Wormhole server.

```bash
wormhole-js http --name <desired-subdomain-name> --targetAddr <:port-number> --address <wormhole.server.address:443>
```

You can use both `tcp` and `http` command to tunnel an `HTTP` server. And optionally, you can run it with `-m` flag to see a live metrics of your tunnel.

## Demo

![Demo](snapshots/demo.gif)
