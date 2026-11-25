import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { boardPort, defaultBoardPort, renderServicePlist, serviceLabel } from "./service";

test("renderServicePlist runs the server under tsx in production from the app dir", () => {
  const plist = renderServicePlist({
    nodePath: "/opt/node/bin/node",
    appDir: "/apps/devcenter",
    pathEnv: "/opt/node/bin:/usr/bin",
    logFile: "/logs/board.log"
  });

  assert.match(plist, new RegExp(`<string>${serviceLabel.replaceAll(".", "\\.")}</string>`));
  assert.match(plist, /<string>\/opt\/node\/bin\/node<\/string>\n {4}<string>--import<\/string>\n {4}<string>tsx<\/string>\n {4}<string>server\/index\.ts<\/string>/);
  assert.match(plist, /<key>WorkingDirectory<\/key>\n {2}<string>\/apps\/devcenter<\/string>/);
  assert.match(plist, /<key>NODE_ENV<\/key>\n {4}<string>production<\/string>/);
  assert.match(plist, /<key>PATH<\/key>\n {4}<string>\/opt\/node\/bin:\/usr\/bin<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\n {2}<true\/>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n {2}<true\/>/);
});

test("renderServicePlist escapes XML in paths", () => {
  const plist = renderServicePlist({
    nodePath: "/node",
    appDir: "/Users/me/R&D <apps>",
    pathEnv: "/usr/bin",
    logFile: "/logs/a.log"
  });

  assert.match(plist, /<string>\/Users\/me\/R&amp;D &lt;apps&gt;<\/string>/);
});

test("boardPort reads devcenter.config.json and falls back to the default", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-service-"));
  assert.equal(await boardPort(dir), defaultBoardPort);

  await fs.writeFile(path.join(dir, "devcenter.config.json"), JSON.stringify({ port: 4999 }), "utf8");
  assert.equal(await boardPort(dir), 4999);

  await fs.writeFile(path.join(dir, "devcenter.config.json"), JSON.stringify({ port: "nope" }), "utf8");
  assert.equal(await boardPort(dir), defaultBoardPort);
});
