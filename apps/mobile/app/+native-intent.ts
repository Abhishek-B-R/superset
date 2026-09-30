import { appPathFromSystemUrl } from "@/lib/deep-links";
import { env } from "@/lib/env";

export function redirectSystemPath({
	path,
}: {
	path: string;
	initial: boolean;
}): string {
	return appPathFromSystemUrl(path, env.EXPO_PUBLIC_WEB_URL) ?? path;
}
