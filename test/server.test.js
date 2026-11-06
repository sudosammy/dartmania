const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const test = require("node:test");

test("HTTP routes and SQLite game lifecycle", { timeout: 30000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dartmania-test-"));
  let server;
  t.after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const serverOptions = {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(directory, "test.sqlite")
    },
    stdio: ["ignore", "pipe", "pipe"]
  };
  server = spawn(process.execPath, ["server/index.js"], serverOptions);
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  const request = (route, options) => fetch(`http://127.0.0.1:${port}${route}`, options);
  const json = async (route, options) => {
    const response = await request(route, options);
    assert.equal(response.status, 200, `${route}: ${await response.clone().text()}`);
    return response.json();
  };
  const post = (route, body) => json(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(server.exitCode, null, output);
    try {
      const response = await request("/api/state");
      ready = response.ok;
      await response.arrayBuffer();
      if (ready) break;
    } catch (error) {
      if (error.cause?.code !== "ECONNREFUSED") throw error;
    }
    await delay(50);
  }
  assert.ok(ready, `Server did not become ready: ${output}`);

  await t.test("fails startup when the port is already in use", () => {
    const duplicate = spawnSync(process.execPath, ["server/index.js"], {
      ...serverOptions,
      env: { ...serverOptions.env, DB_PATH: path.join(directory, "duplicate.sqlite") },
      encoding: "utf8",
      timeout: 5000
    });
    assert.equal(duplicate.status, 1, duplicate.stderr);
    assert.match(duplicate.stderr, /EADDRINUSE/);
    assert.doesNotMatch(duplicate.stdout, /Dartmania running/);
  });

  await t.test("serves the UI, static assets and nested fallback routes", async () => {
    for (const route of ["/", "/scoreboard", "/games/example"]) {
      const response = await request(route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.match(await response.text(), /Dartmania/);
    }
    for (const route of ["/app.js", "/styles.css"]) {
      const response = await request(route);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).length > 0);
    }
  });

  await t.test("keeps validation responses for empty and unparsed bodies", async () => {
    for (const route of ["/api/game", "/api/throw", "/api/undo", "/api/end"]) {
      for (const options of [
        { method: "POST" },
        { method: "POST", body: "unparsed" },
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      ]) {
        const response = await request(route, options);
        assert.equal(response.status, 400, route);
        assert.equal(typeof (await response.json()).error, "string");
      }
    }
  });

  for (const mode of ["countdown", "countup", "cricket"]) {
    await t.test(`${mode}: creates, scores, undoes, ends and deletes a game`, async () => {
      const initial = await post("/api/game", {
        players: ["Player One"], mode, format: "301", rounds: 10, doubleOut: false
      });
      const gameId = initial.game.id;
      assert.equal(initial.players.length, 1);
      assert.equal(initial.game.status, "in_progress");
      assert.equal((await json("/api/state")).game.id, gameId);
      assert.deepEqual(await json(`/api/game/${gameId}`), initial);

      const scored = await post("/api/throw", { gameId, segment: "T20" });
      assert.equal(scored.turns.length, 1);
      assert.equal(scored.turns[0].segment, "T20");
      if (mode === "cricket") {
        assert.equal(scored.players[0].cricket["20"].marks, 3);
      } else {
        assert.equal(scored.players[0].score, mode === "countdown" ? 241 : 60);
      }

      const undone = await post("/api/undo", { gameId });
      assert.equal(undone.turns.length, 0);
      assert.deepEqual(undone.players, initial.players);
      assert.equal((await post("/api/end", { gameId })).game.status, "completed");
      const history = (await json("/api/history")).history;
      assert.equal(history.length, 1);
      assert.equal(history[0].game_id, gameId);
      assert.deepEqual(await json(`/api/history/${gameId}`, { method: "DELETE" }), { ok: true });
      assert.deepEqual(await json("/api/history"), { history: [] });
      assert.deepEqual(await json(`/api/game/${gameId}`), { game: null });
    });
  }
});
