import { describe, expect, test } from "bun:test";
import { appPathFromSystemUrl } from "./deepLinks";

const webUrl = "https://app.superset.sh";

describe("appPathFromSystemUrl", () => {
	test("maps a shared page URL to the pages route", () => {
		expect(
			appPathFromSystemUrl("https://app.superset.sh/page/my-slug", webUrl),
		).toBe("/pages/my-slug");
	});

	test("leaves other web URLs alone", () => {
		expect(
			appPathFromSystemUrl("https://app.superset.sh/tasks/t-1", webUrl),
		).toBeNull();
	});

	test("rejects lookalike hosts", () => {
		expect(
			appPathFromSystemUrl(
				"https://app.superset.sh.evil.example/page/my-slug",
				webUrl,
			),
		).toBeNull();
	});

	test("leaves custom-scheme URLs to expo-router", () => {
		expect(appPathFromSystemUrl("superset://pages/my-slug", webUrl)).toBeNull();
		expect(
			appPathFromSystemUrl("superset:///workspace/ws-1?tab=t-1", webUrl),
		).toBeNull();
	});

	test("leaves the dev-client launch URL untouched", () => {
		expect(
			appPathFromSystemUrl(
				"superset://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081",
				webUrl,
			),
		).toBeNull();
	});

	test("ignores invalid URLs", () => {
		expect(appPathFromSystemUrl("not a url", webUrl)).toBeNull();
	});
});
