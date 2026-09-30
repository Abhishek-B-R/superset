import { pageSlugFromUrl } from "../page-links";

export function appPathFromSystemUrl(
	url: string,
	webUrl: string,
): string | null {
	const slug = pageSlugFromUrl(url, webUrl);
	return slug === null ? null : `/pages/${slug}`;
}
