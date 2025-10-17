#!/usr/bin/env node
import { Command } from "commander";
import process from "process";
import { Client, prettyPrint } from "./client.js";
import { ProtoType, version } from "./proto/proto.js";
import figlet from "figlet";

const program = new Command();

program
  .name("wormhole")
  .description("wormhole client for NodeJS")
  .version(version)
  .action(async (opts) => {
    console.log(
      figlet.textSync("wormhole-client-js", {
        horizontalLayout: "default",
      })
    )
    console.log()
    program.outputHelp()
  });

function baseClientFlags(cmd: Command) {
  return cmd
    .requiredOption("-n, --name <name>", "set your tunnel domain")
    .requiredOption(
      "-t, --targetAddress <target>",
      "set the target address (eg. :3000)"
    )
    .option(
      "-a, --address <address>",
      "wormhole server address",
      "wormhole.dyastin.dev:443"
    )
    .option("-m, --metrics", "enable metrics", false);
}

baseClientFlags(
  program
    .command("http")
    .description("Start a wormhole HTTP reverse tunnel client")
).action(async (opts) => {
  const abortController = new AbortController();

  process.on("SIGINT", () => abortController.abort());

  try {
    const client = new Client({
      proto: ProtoType.HTTP,
      addr: opts.address,
      targetAddr: opts.targetAddress,
      name: opts.name,
      metrics: opts.metrics,
      withTLS: false,
    });

    await client.run(abortController);
  } catch (err) {
    if (err) {
      prettyPrint("err", String(err))
    }
    process.exit(1);
  }
});

baseClientFlags(
  program
    .command("tcp")
    .description("Start a wormhole TCP reverse tunnel client")
).action(async (opts) => {
  const abortController = new AbortController();

  process.on("SIGINT", () => abortController.abort());

  try {
    const client = new Client({
      proto: ProtoType.TCP,
      addr: opts.address,
      targetAddr: opts.targetAddress,
      name: opts.name,
      metrics: opts.metrics,
      withTLS: false,
    });

    await client.run(abortController);
  } catch (err) {
    if (err) {
      prettyPrint("err", String(err))
    }
    process.exit(1);
  }
});

program.parse(process.argv);
