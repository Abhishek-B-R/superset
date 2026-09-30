import { appPathFromSystemUrl } from "@/lib/deep-links";
import { env } from "@/lib/env";

export function redirectSystemPath({
	path,
}: {
	path: string;
	initial: boolean;
}): string {
	return (
		appPathFromSystemUrl(path, {
			webUrl: env.EXPO_PUBLIC_WEB_URL,
			scheme: env.EXPO_PUBLIC_DEEP_LINK_SCHEME,
		}) ?? path
	);
}
