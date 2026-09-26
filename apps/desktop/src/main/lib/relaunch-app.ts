export interface RelaunchAppDeps {
	isUpdateReadyToInstall: () => boolean;
	installUpdate: () => void;
	relaunch: () => void;
	quit: () => void;
}

/**
 * With an update staged, Squirrel.Mac installs it once this process exits.
 * `app.relaunch()` would start the old bundle in that same second, so the
 * user comes back on the old version while ShipIt swaps the bundle beneath
 * it. The updater's own install restarts into the new version instead.
 */
export function relaunchApp(deps: RelaunchAppDeps): void {
	if (deps.isUpdateReadyToInstall()) {
		deps.installUpdate();
		return;
	}
	deps.relaunch();
	deps.quit();
}
