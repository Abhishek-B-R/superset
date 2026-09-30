import { describe, expect, test } from "bun:test";
import { appPathFromSystemUrl } from "./deepLinks";

const targets = { webUrl: "https://app.superset.sh", scheme: "superset" };

describe("appPathFromSystemUrl", () => {
	test("maps a shared page URL to the pages route", () => {
		expect(
			appPathFromSystemUrl("https://app.superset.sh/page/my-slug", targets),
		).toBe("/pages/my-slug");
	});

	test("leaves other web URLs alone", () => {
		expect(
			appPathFromSystemUrl("https://app.superset.sh/tasks/t-1", targets),
		).toBeNull();
	});

	test("rejects lookalike hosts", () => {
		expect(
			appPathFromSystemUrl(
				"https://app.superset.sh.evil.example/page/my-slug",
				targets,
			),
		).toBeNull();
	});

	test("folds a scheme URL host back into the path", () => {
		expect(appPathFromSystemUrl("superset://pages/my-slug", targets)).toBe(
			"/pages/my-slug",
		);
	});

	test("keeps query params when folding the host", () => {
		expect(
			appPathFromSystemUrl("superset://workspace/ws-1?tab=t-1", targets),
		).toBe("/workspace/ws-1?tab=t-1");
	});

	test("leaves empty-host scheme URLs alone", () => {
		expect(
			appPathFromSystemUrl("superset:///workspace/ws-1", targets),
		).toBeNull();
	});

	test("ignores other schemes and invalid URLs", () => {
		expect(appPathFromSystemUrl("mailto:team@superset.sh", targets)).toBeNull();
		expect(appPathFromSystemUrl("not a url", targets)).toBeNull();
	});
});
