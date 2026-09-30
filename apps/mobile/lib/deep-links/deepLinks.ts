import { pageSlugFromUrl } from "../page-links";

interface DeepLinkTargets {
	webUrl: string;
	scheme: string;
}

export function appPathFromSystemUrl(
	url: string,
	{ webUrl, scheme }: DeepLinkTargets,
): string | null {
	const slug = pageSlugFromUrl(url, webUrl);
	if (slug !== null) return `/pages/${slug}`;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== `${scheme}:` || !parsed.hostname) return null;
	return `/${parsed.hostname}${parsed.pathname}${parsed.search}`;
}
