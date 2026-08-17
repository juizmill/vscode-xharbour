const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const localize = require('./myLocalize.js').localize;

const OUR_ICON_DEF = "harbour_file";
const XHARBOUR_EXTENSIONS = ["prg", "ch", "hbx", "hb"];
const GENERATED_THEME_PATH = ["fileicons", "xharbour-icon-theme.json"];

/**
 * Finds an installed extension contributing a File Icon Theme with the
 * given id, and returns where its theme JSON lives on disk.
 * @param {string} themeId
 * @returns {{extensionPath:string, themeAbsPath:string}|undefined}
 */
function findBaseIconTheme(themeId) {
	if (!themeId) return undefined;
	for (const ext of vscode.extensions.all) {
		const themes = ext.packageJSON && ext.packageJSON.contributes && ext.packageJSON.contributes.iconThemes;
		if (!Array.isArray(themes)) continue;
		const found = themes.find(t => t.id === themeId);
		if (found) return { extensionPath: ext.extensionPath, themeAbsPath: path.join(ext.extensionPath, found.path) };
	}
	return undefined;
}

/**
 * Rewrites an icon/font asset path from a base theme's JSON (relative to
 * that theme file, or occasionally already absolute) into a path relative
 * to OUR generated theme file, using path.relative so it resolves
 * correctly regardless of the two themes' install locations -- an OS
 * absolute path here would NOT reliably resolve the same way (icon theme
 * asset paths are joined onto the theme file's own directory, and
 * path.join doesn't discard an already-absolute base the way path.resolve
 * would).
 * @param {string} baseThemeDir
 * @param {string} ourThemeDir
 * @param {string} assetPath
 */
function rewriteAssetPath(baseThemeDir, ourThemeDir, assetPath) {
	if (!assetPath) return assetPath;
	const abs = path.isAbsolute(assetPath) ? assetPath : path.join(baseThemeDir, assetPath);
	let rel = path.relative(ourThemeDir, abs).split(path.sep).join("/");
	if (!rel.startsWith(".")) rel = "./" + rel;
	return rel;
}

/**
 * Adds the harbour_file icon definition + .prg/.ch/.hbx/.hb/harbour
 * mappings to a (already-loaded, possibly base-theme-derived) icon theme
 * object, including its optional "light" override block.
 * @param {object} theme
 * @param {string} ourThemeDir
 * @param {string} extensionPath
 */
function addHarbourMappings(theme, ourThemeDir, extensionPath) {
	const iconPath = rewriteAssetPath(extensionPath, ourThemeDir, path.join(extensionPath, "harbour.svg"));
	function apply(t) {
		t.iconDefinitions = t.iconDefinitions || {};
		t.iconDefinitions[OUR_ICON_DEF] = { iconPath };
		t.fileExtensions = t.fileExtensions || {};
		t.languageIds = t.languageIds || {};
		for (const ext of XHARBOUR_EXTENSIONS) t.fileExtensions[ext] = OUR_ICON_DEF;
		t.languageIds["harbour"] = OUR_ICON_DEF;
	}
	apply(theme);
	if (theme.light) apply(theme.light);
}

/**
 * Builds the plain fallback theme (generic file/folder icons + our
 * xHarbour mapping) used when no `harbour.iconTheme.baseIconTheme` is
 * configured, or the configured one can't be found/read.
 * @param {string} ourThemeDir
 * @param {string} extensionPath
 */
function buildFallbackTheme(ourThemeDir, extensionPath) {
	const theme = {
		iconDefinitions: {
			"_file": { iconPath: "./generic-file.svg" },
			"_folder": { iconPath: "./generic-folder.svg" },
			"_folder_open": { iconPath: "./generic-folder-open.svg" }
		},
		file: "_file",
		folder: "_folder",
		folderExpanded: "_folder_open",
		fileExtensions: {},
		languageIds: {}
	};
	addHarbourMappings(theme, ourThemeDir, extensionPath);
	return theme;
}

/**
 * (Re)writes fileicons/xharbour-icon-theme.json -- either a clone of the
 * `harbour.iconTheme.baseIconTheme` icon theme (every other file/folder
 * icon it defines, verbatim) plus our xHarbour mapping added on top, or
 * the plain generic fallback theme if no base theme is configured or it
 * can't be read. This never modifies the base theme's own files -- only a
 * derived copy inside this extension's own folder, generated locally, not
 * redistributed.
 * @param {vscode.ExtensionContext} context
 */
function regenerate(context) {
	const section = vscode.workspace.getConfiguration('harbour');
	const baseThemeId = (section.iconTheme && section.iconTheme.baseIconTheme) || "";
	const ourThemeDir = path.join(context.extensionPath, "fileicons");
	const outputPath = path.join(context.extensionPath, ...GENERATED_THEME_PATH);

	let theme;
	const base = findBaseIconTheme(baseThemeId);
	if (base) {
		try {
			const raw = fs.readFileSync(base.themeAbsPath, "utf8");
			theme = JSON.parse(raw);
			const baseThemeDir = path.dirname(base.themeAbsPath);
			for (const key in theme.iconDefinitions || {}) {
				const def = theme.iconDefinitions[key];
				if (def && def.iconPath) def.iconPath = rewriteAssetPath(baseThemeDir, ourThemeDir, def.iconPath);
			}
			if (theme.light && theme.light.iconDefinitions) {
				for (const key in theme.light.iconDefinitions) {
					const def = theme.light.iconDefinitions[key];
					if (def && def.iconPath) def.iconPath = rewriteAssetPath(baseThemeDir, ourThemeDir, def.iconPath);
				}
			}
			if (Array.isArray(theme.fonts)) {
				for (const font of theme.fonts) {
					if (Array.isArray(font.src)) {
						for (const s of font.src) {
							if (s.path) s.path = rewriteAssetPath(baseThemeDir, ourThemeDir, s.path);
						}
					}
				}
			}
			addHarbourMappings(theme, ourThemeDir, context.extensionPath);
		} catch (e) {
			theme = undefined;
		}
	}
	if (!theme) theme = buildFallbackTheme(ourThemeDir, context.extensionPath);

	try {
		fs.writeFileSync(outputPath, JSON.stringify(theme));
	} catch (e) {
		// extension folder not writable (e.g. a read-only/managed install) --
		// not fatal, whatever was last written (the shipped fallback, at
		// minimum) keeps working.
	}
}

function activate(context) {
	regenerate(context);
	vscode.workspace.onDidChangeConfiguration(e => {
		if (!e.affectsConfiguration('harbour.iconTheme')) return;
		regenerate(context);
		vscode.window.showInformationMessage(
			localize("harbour.iconTheme.reloadPrompt"),
			localize("harbour.iconTheme.reloadButton")
		).then(choice => {
			if (choice) vscode.commands.executeCommand("workbench.action.reloadWindow");
		});
	}, undefined, context.subscriptions);
}

exports.activate = activate;
