import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	accumulatedOutputAsString,
	connectAndHello,
} from "../../test/helpers/client.ts";
import type { Pty, PtyOnData, PtyOnExit } from "../Pty/index.ts";
import type { SessionMeta } from "../protocol/index.ts";
import { Server } from "./Server.ts";

class QueryPty implements Pty {
	pid = 12345;
	meta: SessionMeta;
	writes: Buffer[] = [];
	failWrites = false;
	onOutput: PtyOnData = () => {};
	onEnd: PtyOnExit = () => {};
	constructor(meta: SessionMeta) {
		this.meta = meta;
	}
	write(bytes: Buffer) {
		if (this.failWrites) throw new Error("exited");
		this.writes.push(bytes);
	}
	onData(cb: PtyOnData) {
		this.onOutput = cb;
	}
	onExit(cb: PtyOnExit) {
		this.onEnd = cb;
	}
	resize() {}
	kill() {}
	pause() {}
	resume() {}
	dispose() {}
	getMasterFd() {
		return -1;
	}
}

let server: Server | undefined;
afterEach(async () => {
	await server?.close();
	server = undefined;
});

test("responds before attachment, strips replay, and responds once with multiple observers", async () => {
	const socketPath = join(tmpdir(), `colors-${crypto.randomUUID()}.sock`);
	let pty: QueryPty | undefined;
	server = new Server({
		socketPath,
		daemonVersion: "test",
		spawnPty: ({ meta }) => {
			pty = new QueryPty(meta);
			return pty;
		},
	});
	await server.listen();
	const first = await connectAndHello(socketPath);
	const second = await connectAndHello(socketPath);
	try {
		first.send({
			type: "open",
			id: "t",
			meta: {
				shell: "/bin/sh",
				argv: [],
				cols: 80,
				rows: 24,
				colors: {
					foreground: "#eeeeee",
					background: "#151110",
					cursor: "#ffffff",
				},
			},
		});
		await first.waitFor((m) => m.type === "open-ok");
		if (!pty) throw new Error("missing pty");
		const queryPty = pty;
		queryPty.onOutput(Buffer.from("before\x1b]11;?\x07after"));
		expect(queryPty.writes.map(String)).toEqual([
			"\x1b]11;rgb:1515/1111/1010\x1b\\",
		]);
		for (const client of [first, second]) {
			client.send({
				type: "subscribe",
				id: "t",
				replay: true,
				modeSnapshot: true,
			});
			await client.waitFor((m) => m.type === "replay-complete");
			expect(accumulatedOutputAsString(client, "t")).toBe("beforeafter");
		}
		expect(queryPty.writes).toHaveLength(1);
		const waits = [first, second].map((client) =>
			client.waitForNext((m) => m.type === "output"),
		);
		queryPty.onOutput(Buffer.from("live\x1b]11;?\x1b\\tail"));
		await Promise.all(waits);
		expect(queryPty.writes).toHaveLength(2);
		for (const client of [first, second])
			expect(accumulatedOutputAsString(client, "t")).toBe(
				"beforeafterlivetail",
			);
		await second.close();
		const reattached = await connectAndHello(socketPath);
		try {
			reattached.send({
				type: "subscribe",
				id: "t",
				replay: true,
				modeSnapshot: true,
			});
			await reattached.waitFor((m) => m.type === "replay-complete");
			expect(accumulatedOutputAsString(reattached, "t")).toBe(
				"beforeafterlivetail",
			);
			expect(queryPty.writes).toHaveLength(2);
		} finally {
			await reattached.close();
		}
		first.send({
			type: "colors",
			id: "t",
			colors: {
				foreground: "#000000",
				background: "#ffffff",
				cursor: "#000000",
			},
		});
		first.send({ type: "list" });
		await first.waitFor((m) => m.type === "list-reply");
		queryPty.onOutput(Buffer.from("\x1b]11;?\x07"));
		expect(queryPty.writes.at(-1)?.toString()).toBe(
			"\x1b]11;rgb:ffff/ffff/ffff\x1b\\",
		);
		queryPty.failWrites = true;
		expect(() => queryPty.onOutput(Buffer.from("\x1b]11;?\x07"))).not.toThrow();
	} finally {
		await first.close();
		await second.close();
	}
});
