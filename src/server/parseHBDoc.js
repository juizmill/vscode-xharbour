/**
 * Dev-only tool (not bundled into the extension) that (re)generates
 * hbdocs.json/hbdocs.missing from a Harbour/xHarbour source checkout's
 * "$DOC$" documentation blocks (the *.txt files under doc/, e.g.
 * doc/en/array.txt), the same format the upstream Harbour project uses.
 *
 * Usage:
 *   node src/server/parseHBDoc.js <sourceDir>
 *
 * <sourceDir> is any directory containing such *.txt files -- for this
 * fork, the natural source is the actual xHarbour checkout already used to
 * build harbour.compilerExecutable's Docker image (see ../../Dockerfile):
 *   docker run --rm -v /tmp/xh-doc:/out xharbour-linux:latest \
 *       bash -c "cp -r /opt/xharbour/doc /out/"
 *   node src/server/parseHBDoc.js /tmp/xh-doc/doc
 *
 * Unlike a from-scratch regeneration, this MERGES into the existing
 * hbdocs.json/hbdocs.missing instead of replacing them:
 *  - a name already documented in hbdocs.json is left untouched (so this
 *    can be re-run against a different/newer checkout without regressing
 *    already-reviewed entries);
 *  - a name newly found here that was previously in hbdocs.missing (known
 *    to exist, no docs) is promoted into hbdocs.json and removed from
 *    hbdocs.missing;
 *  - a name found here that wasn't tracked at all (missing its own
 *    "DYNAMIC" line in whatever .hbx export list originally seeded
 *    hbdocs.missing -- this xHarbour checkout doesn't ship a comprehensive
 *    one) is simply added to hbdocs.json.
 * This also means hbdocs.missing's own completeness isn't derived here --
 * it's inherited as-is from whatever generated the current hbdocs.missing.
 */
const fs = require("fs");
const path = require("path");

const sourceDir = process.argv[2];
if (!sourceDir) {
	console.error("Usage: node src/server/parseHBDoc.js <sourceDir>");
	process.exit(1);
}

const jsonPath = path.join(__dirname, "hbdocs.json");
const missingPath = path.join(__dirname, "hbdocs.missing");

const newDocs = [];

walk(sourceDir);
merge();

function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(p);
		else if (entry.name.toLowerCase().endsWith(".txt")) parseFile(p);
	}
}

/**
 * Parses every "/* $DOC$ ... $END$ *\/" block in one .txt file.
 * Each line inside the block may optionally be prefixed with a "*"
 * comment-continuation marker (this xHarbour checkout's doc/ files use
 * that C-comment style; plain Harbour doc files usually don't -- both are
 * handled the same way here since the marker is just stripped if present).
 * @param {string} file
 */
function parseFile(file) {
	const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
	let inDoc = false, doc, lastSpecify = "";
	for (const raw of lines) {
		let line = raw.trim();
		if (!inDoc) {
			inDoc = /^\/\*\s*\$DOC\$\s*$/.test(line);
			if (inDoc) doc = { label: undefined, documentation: undefined, arguments: [] };
			continue;
		}
		if (line === "*/") {
			if (doc && doc.label) newDocs.push(doc);
			doc = undefined; inDoc = false;
			continue;
		}
		if (line.startsWith("*")) line = line.substring(1).trim();
		if (line === "$END$") {
			if (doc && doc.label) newDocs.push(doc);
			doc = undefined; inDoc = false;
			continue;
		}
		if (line.startsWith("$")) { lastSpecify = line; continue; }
		switch (lastSpecify) {
			case "$ONELINER$":
				if (doc) doc.documentation = doc.documentation ? doc.documentation + " " + line : line;
				break;
			case "$SYNTAX$":
				if (doc) {
					// A "C Prototype" syntax block documents the C-level API
					// (e.g. hb_setInitialize() for C extension authors), not a
					// callable Harbour/xHarbour function -- skip the whole entry.
					if (line === "C Prototype") { doc = undefined; inDoc = false; break; }
					if (doc.label) doc.label += " " + line;
					else {
						const p = line.indexOf("(");
						if (p < 0) { doc = undefined; inDoc = false; break; }
						// trim: some syntax lines have a space before "(", e.g.
						// "ADDASCII (<cString>, ...)" -- without trimming, the
						// trailing space would make this look like a multi-word
						// command syntax and get rejected below.
						const name = line.substring(0, p).trim();
						if (name.indexOf(" ") > 0) { doc = undefined; inDoc = false; break; } // multi-word: a command/class syntax, not a function
						doc.name = name; doc.label = line;
					}
				}
				break;
			case "$ARGUMENTS$":
				if (doc && line.length > 0) {
					const mm = line.match(/^\s*<[^>]+>/);
					if (mm) doc.arguments.push({ label: mm[0], documentation: line.replace(mm[0], "").trim() });
					else if (doc.arguments.length > 0) doc.arguments[doc.arguments.length - 1].documentation += " " + line;
				}
				break;
			case "$RETURNS$":
				if (doc && line.length > 0) {
					const mm = line.match(/^\s*<[^>]+>/);
					if (mm) {
						if (doc.return) doc.return.help += " " + line;
						else doc.return = { name: mm[0], help: line.replace(mm[0], "").trim() };
					} else {
						if (doc.return) doc.return.help += " " + line;
						else doc.return = { name: "", help: line };
					}
				}
				break;
		}
	}
}

function merge() {
	const oldDocs = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
	const oldMissing = JSON.parse(fs.readFileSync(missingPath, "utf8"));
	const oldNames = new Set(oldDocs.map(d => d.name.toLowerCase()));

	const seen = new Set();
	const added = [];
	for (const d of newDocs) {
		const k = d.name.toLowerCase();
		if (seen.has(k) || oldNames.has(k)) continue; // first occurrence wins; never overwrite an existing entry
		seen.add(k);
		added.push(d);
	}

	const finalDocs = oldDocs.concat(added);
	finalDocs.sort((a, b) => a.name.localeCompare(b.name));
	const finalMissing = oldMissing.filter(m => !seen.has((m[0] || "").toLowerCase()));

	fs.writeFileSync(jsonPath, JSON.stringify(finalDocs, undefined, 1));
	// one compact ["name","lib"] pair per line -- matches the original
	// generator's format; JSON.stringify(arr, undefined, N) would instead
	// indent every nested array onto its own lines, ~3x the file size for
	// no benefit (it's not meant to be hand-edited).
	fs.writeFileSync(missingPath, "[\n" + finalMissing.map(m => " " + JSON.stringify(m)).join(",\n") + "\n]");

	console.log(`Added ${added.length} newly documented functions (hbdocs.json: ${oldDocs.length} -> ${finalDocs.length}).`);
	console.log(`hbdocs.missing: ${oldMissing.length} -> ${finalMissing.length}.`);
}
