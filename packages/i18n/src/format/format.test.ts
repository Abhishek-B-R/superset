import { describe, expect, test } from "bun:test";
import { i18n, initI18n } from "../index";
import {
	formatCompactNumber,
	formatCompactRelativeTime,
	formatCurrency,
	formatDate,
	formatNumber,
	formatPercent,
	formatPrice,
	formatRelativeTime,
	getActiveLocale,
} from "./index";

initI18n();

describe("format helpers (en)", () => {
	test("active locale defaults to en", () => {
		expect(getActiveLocale()).toBe("en");
	});

	test("formatNumber groups digits", () => {
		expect(formatNumber(1234567)).toBe("1,234,567");
	});

	test("formatPercent renders one fractional digit by default", () => {
		expect(formatPercent(0.123)).toBe("12.3%");
		expect(formatPercent(1)).toBe("100%");
	});

	test("formatCompactNumber matches the previous en-US output", () => {
		expect(formatCompactNumber(123400)).toBe("123K");
		expect(formatCompactNumber(1500000)).toBe("1.5M");
	});

	test("formatCurrency renders major units", () => {
		expect(formatCurrency(12.5)).toBe("$12.50");
		expect(formatCurrency(19211, "USD", { maximumFractionDigits: 0 })).toBe(
			"$19,211",
		);
	});

	test("formatPrice renders Stripe minor units and uppercases currency", () => {
		expect(formatPrice(1250, "usd")).toBe("$12.50");
		expect(formatPrice(0, "USD")).toBe("$0.00");
	});

	test("formatDate default matches the settings-page shape", () => {
		expect(formatDate(new Date(2026, 0, 15))).toBe("Jan 15, 2026");
	});
});

describe("formatRelativeTime", () => {
	const NOW = new Date("2026-08-28T12:00:00Z");

	test("formats past times", () => {
		expect(formatRelativeTime(new Date("2026-08-28T09:00:00Z"), NOW)).toBe(
			"3 hours ago",
		);
	});

	test("uses idiomatic wording where the locale has one", () => {
		expect(formatRelativeTime(new Date("2026-08-27T12:00:00Z"), NOW)).toBe(
			"yesterday",
		);
	});

	test("formats future times", () => {
		expect(formatRelativeTime(new Date("2026-08-30T12:00:00Z"), NOW)).toBe(
			"in 2 days",
		);
	});

	test("falls back to seconds below a minute", () => {
		expect(formatRelativeTime(new Date("2026-08-28T11:59:59Z"), NOW)).toBe(
			"1 second ago",
		);
	});

	test("compact form uses the narrow style", () => {
		expect(
			formatCompactRelativeTime(new Date("2026-08-25T12:00:00Z"), NOW),
		).toBe("3d ago");
	});

	test("a timestamp that leads the clock still reads as the past", () => {
		// A comment's createdAt comes from the server, so it can sit a few
		// hundred ms ahead of the device; "in 0s" is the wrong tense for it.
		const justPosted = new Date(NOW.getTime() + 400);
		expect(formatCompactRelativeTime(justPosted, NOW)).toBe("0s ago");
		expect(formatCompactRelativeTime(NOW, NOW)).toBe("0s ago");
	});

	test("a real future time keeps the future tense", () => {
		expect(
			formatCompactRelativeTime(new Date(NOW.getTime() + 2 * 3600 * 1000), NOW),
		).toBe("in 2h");
	});

	test("follows the active locale", () => {
		i18n.activate("ja");
		try {
			expect(formatRelativeTime(new Date("2026-08-25T12:00:00Z"), NOW)).toBe(
				"3 日前",
			);
		} finally {
			i18n.activate("en");
		}
	});
});
