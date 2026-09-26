import { describe, expect, mock, test } from "bun:test";
import { type RelaunchAppDeps, relaunchApp } from "./relaunch-app";

function createDeps(updateReady: boolean) {
	const calls: string[] = [];
	const deps: RelaunchAppDeps = {
		isUpdateReadyToInstall: () => updateReady,
		installUpdate: mock(() => calls.push("installUpdate")),
		relaunch: mock(() => calls.push("relaunch")),
		quit: mock(() => calls.push("quit")),
	};
	return { deps, calls };
}

describe("relaunchApp", () => {
	test("without a staged update, relaunches and then quits through the normal path", () => {
		const { deps, calls } = createDeps(false);

		relaunchApp(deps);

		expect(calls).toEqual(["relaunch", "quit"]);
	});

	test("with a staged update, hands off to the updater and never relaunches the old bundle", () => {
		const { deps, calls } = createDeps(true);

		relaunchApp(deps);

		expect(calls).toEqual(["installUpdate"]);
		expect(deps.relaunch).not.toHaveBeenCalled();
		expect(deps.quit).not.toHaveBeenCalled();
	});
});
