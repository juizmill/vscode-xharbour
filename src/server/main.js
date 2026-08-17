const provider = require('./provider.js');
const server = require('vscode-languageserver')
const fs = require("fs");
const path = require("path");
const Uri = require("vscode-uri").URI;
const trueCase = require("true-case-path")
const server_textdocument = require("vscode-languageserver-textdocument");

const connection = server.createConnection(
    new server.IPCMessageReader(process),
    new server.IPCMessageWriter(process));


/** @type {Array<string>} */
let workspaceRoots = [];
/** @type {Array<string>} */
let includeDirs = [];
/** @type {number} */
let workspaceDepth;
/** @type {boolean} */
let wordBasedSuggestions = true;
/** @type {Object.<string, provider.Provider>} */
let files = {};
/** @type {Object.<string, provider.Provider>} */
let includes ={};
/** the list of documentation harbour base functions
 * @type {Array<object>} */
let docs = [];
/** the list of undocumented harbour base functions
 * @type {Array<string>} */
let missing = [];
/** Functions found via "DYNAMIC <name>" declarations in .hbx export files
 * under harbour.extraIncludePaths -- lets a custom/forked compiler's own
 * native functions (baked into the compiler binary, so never seen by the
 * workspace .prg/.ch scan) be recognized for completion, hover and the
 * undefined-function check, the same way standard RTL functions from
 * `missing` are. Only names are available here (a .hbx has no parameter
 * docs), so hover shows a minimal placeholder for these.
 * @type {Array<[string,string]>} [name, .hbx file name] */
let customFunctions = [];
/** Hand-declared functions from harbour.aliases.customFunctions -- for a
 * project-specific/custom-compiler function that has neither a workspace
 * definition nor a .hbx export to discover it from, but where the user
 * still wants full hover/completion/signature-help docs (not just "known to
 * exist" like `customFunctions`/`missing`). Same shape as `docs` entries
 * (see buildCustomFunctionDocs), so every doc-consuming code path that
 * already handles `docs` can treat these identically.
 * @type {Array<object>} */
let customFunctionDocs = [];

/**
 * @typedef dbInfo
 * @property {string} dbInfo.name the name to show
 * @property {fieldInfo[]} dbInfo.fields the fields found for the database
 *
 * @typedef fieldInfo
 * @property {string} fieldInfo.name the name to show
 * @property {string[]} fieldInfo.files the list of files where the field is found
 */
/** @type {Object.<string, dbInfo>} every key is the lowercase name of db */
let databases = {};
/** @type {boolean} */
let canLocationLink;
/** @type {boolean} */
let lineFoldingOnly;
/** @type {object} */
let currStyleConfig;
/** @type {{customKeywords: Array<{word:string,scope:string}>, callSuffixes: Array<string>, callSuffixesRaw: Array<string>}} */
const aliasConfig = { customKeywords: [], callSuffixes: [], callSuffixesRaw: [] };
/** @type {boolean} */
let checkUndefinedFunctionsEnabled = false;
/** "either" | "suffixOnly" | "bareOnly" -- see harbour.aliases.callSuffixMode
 * @type {string} */
let callSuffixMode = "either";

const keywords = provider.keywords

/*
    every database contains a name (the text before the ->)
    and a list of field, objects with name (the text after the ->)
    and a files, array of string with the file where found the db.name->field.name
*/
connection.onInitialize(params => {
    canLocationLink = false;
    if (params.capabilities.textDocument &&
        params.capabilities.textDocument.declaration &&
        params.capabilities.textDocument.declaration.linkSupport)
        canLocationLink = true;
    lineFoldingOnly = true;
    if (params.capabilities.textDocument &&
        params.capabilities.textDocument.foldingRange &&
        lineFoldingOnly in params.capabilities.textDocument.foldingRange)
        lineFoldingOnly = params.capabilities.textDocument.foldingRange.lineFoldingOnly;

    if (params.capabilities.workspace && params.capabilities.workspace.workspaceFolders && params.workspaceFolders) {
        workspaceRoots = [];
        for (let i = 0; i < params.workspaceFolders.length; i++) {
            if (params.workspaceFolders[i].uri)
                workspaceRoots.push(params.workspaceFolders[i].uri)
        }
    } else {
        workspaceRoots = [params.rootUri]; //this deprecation is a false positive because it uses workspaceFolders right above here
        if (!workspaceRoots[0] && params.rootPath) {
            if (path.sep == "\\") //window
                workspaceRoots = ["file://" + encodeURI(params.rootPath.replace(/\\/g, "/"))];
            else
                workspaceRoots = ["file://" + encodeURI(params.rootPath)];
        }
        if (!workspaceRoots[0]) workspaceRoots = [];
    }
    fs.readFile(path.join(__dirname, 'hbdocs.json'), "utf8", (err, data) => {
        if (!err)
            docs = JSON.parse(data);
    });
    fs.readFile(path.join(__dirname, 'hbdocs.missing'), "utf8", (err, data) => {
        if (!err)
            missing = JSON.parse(data);
    });
    return {
        capabilities: {
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            // declarationProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(']
            },
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['>', '<', '"']
            },
            // Tell the client that the server works in FULL text document sync mode
            textDocumentSync: 1,
            workspace: {
                supported: true
            },
            hoverProvider: true,
            foldingRangeProvider: true,
            semanticTokensProvider: {
                legend: {
                    //tokenTypes: [
                    //    server.SemanticTokenTypes.class,
                    //    server.SemanticTokenTypes.method,
                    //    server.SemanticTokenTypes.property,
                    //    server.SemanticTokenTypes.function,
                    //    server.SemanticTokenTypes.parameter,
                    //    server.SemanticTokenTypes.variable,
                    //    server.SemanticTokenTypes.macro],
                    tokenTypes: [
                        server.SemanticTokenTypes.variable,
                        server.SemanticTokenTypes.parameter,
                        server.SemanticTokenTypes.keyword],
                    tokenModifiers: [
                        server.SemanticTokenModifiers.declaration,
                        server.SemanticTokenModifiers.static
                    ]
                },
                full: true
            },
            documentFormattingProvider: true
        }
    }
});
/*
connection.workspace.onDidChangeWorkspaceFolders(params=>{
    var i=0;
})
*/
connection.onDidChangeConfiguration(params => {
    const searchExclude = params.settings.search.exclude;
    // minimatch
    wordBasedSuggestions = params.settings.editor.wordBasedSuggestions
    currStyleConfig = params.settings.harbour.formatter;
    const oldDepth = workspaceDepth;
    includeDirs = params.settings.harbour.extraIncludePaths;
    includeDirs.splice(0, 0, ".")
    scanCustomHbxFunctions();
    workspaceDepth = params.settings.harbour.workspaceDepth;
    const newAliases = params.settings.harbour.aliases || {};
    const customKeywords = (newAliases.customKeywords || []).slice();
    const existingWords = customKeywords.map(k => k.word && k.word.toLowerCase());
    (newAliases.commandRules || []).forEach(rule => {
        if(!rule || !rule.match) return;
        const m = rule.match.match(/^\s*([A-Za-z_]\w*)/);
        if(!m) return;
        if(existingWords.indexOf(m[1].toLowerCase()) < 0) {
            customKeywords.push({word: m[1], scope: "keyword"});
            existingWords.push(m[1].toLowerCase());
        }
    });
    if(newAliases.customDefault !== false && existingWords.indexOf("default") < 0) {
        customKeywords.push({word: "Default", scope: "keyword"});
        existingWords.push("default");
    }
    aliasConfig.customKeywords = customKeywords;
    customFunctionDocs = buildCustomFunctionDocs(newAliases.customFunctions);
    aliasConfig.callSuffixesRaw = (newAliases.callSuffixes || []).slice();
    aliasConfig.callSuffixes = aliasConfig.callSuffixesRaw.map(s => s.toLowerCase());
    connection.languages.semanticTokens.refresh().catch(() => {});
    if(workspaceDepth!=oldDepth)
        parseWorkspace();
    const newCheckUndefinedFunctions = !!params.settings.harbour.checkUndefinedFunctions;
    const checkUndefinedFunctionsChanged = newCheckUndefinedFunctions != checkUndefinedFunctionsEnabled;
    checkUndefinedFunctionsEnabled = newCheckUndefinedFunctions;
    const oldCallSuffixMode = callSuffixMode;
    callSuffixMode = newAliases.callSuffixMode || "either";
    const callSuffixModeChanged = callSuffixMode != oldCallSuffixMode;
    if (checkUndefinedFunctionsChanged || workspaceDepth != oldDepth || callSuffixModeChanged) {
        documents.all().forEach(doc => {
            publishHarbourDiagnostics(getDocumentProvider(doc), doc);
        });
    }
})

/** (Re)builds `customFunctions` by scanning `.hbx` export files under each
 * `harbour.extraIncludePaths` entry (resolved against every workspace root,
 * like `ParseInclude`'s own include-dir lookup) for "DYNAMIC <name>" lines
 * -- the same declaration `.hbx` files use to export a function to the
 * linker. This is a cheap, synchronous, best-effort scan (small "include"
 * style directories, bounded recursion depth) run once per config change,
 * not per keystroke/hover.
 */
function scanCustomHbxFunctions() {
    const found = [];
    const seen = {};
    // anchored to the whole (trimmed) line -- a bare "DYNAMIC <name>" is the
    // real export declaration; matching it unanchored would also catch the
    // word "DYNAMIC" inside comments/prose (e.g. "...EXTERNAL/DYNAMIC list.")
    const dynamicRegEx = /^DYNAMIC\s+([_a-zA-Z][_a-zA-Z0-9]*)$/i;
    function scanDir(dir, depth) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const entry of entries) {
            const p = path.join(dir, entry.name);
            if (entry.isFile() && entry.name.toLowerCase().endsWith(".hbx")) {
                let text;
                try { text = fs.readFileSync(p, "utf8"); } catch (e) { continue; }
                const lines = text.split(/\r?\n/);
                for (const line of lines) {
                    const m = dynamicRegEx.exec(line.trim());
                    if (m && !(m[1].toLowerCase() in seen)) {
                        seen[m[1].toLowerCase()] = true;
                        found.push([m[1], entry.name]);
                    }
                }
            } else if (entry.isDirectory() && depth > 0) {
                scanDir(p, depth - 1);
            }
        }
    }
    for (const dir of includeDirs) {
        if (path.isAbsolute(dir)) {
            scanDir(dir, 5);
        } else {
            for (const root of workspaceRoots) {
                const uri = Uri.parse(root);
                if (uri.scheme != "file") continue;
                scanDir(path.join(uri.fsPath, dir), 5);
            }
        }
    }
    customFunctions = found;
}

/** Converts harbour.aliases.customFunctions entries (settings.json) into
 * the same {name, label, documentation, arguments, return} shape `docs`
 * (hbdocs.json) entries use, so hover/completion/signature-help can treat
 * a hand-declared function (e.g. a native function only your own
 * compiler build has) identically to a documented RTL one.
 * @param {Array<{name:string, params?:string[], documentation?:string, returns?:string}>} entries
 * @returns {Array<object>}
 */
function buildCustomFunctionDocs(entries) {
    return (entries || []).filter(e => e && e.name).map(e => {
        const params = (e.params || []).map(p => "<" + p + ">");
        let label = e.name + "(" + params.join(", ") + ")";
        if (e.returns) label += " --> " + e.returns;
        const doc = {
            name: e.name,
            label: label,
            documentation: e.documentation || "",
            arguments: params.map(p => ({ label: p, documentation: "" }))
        };
        if (e.returns) doc.return = { name: "", help: e.returns };
        return doc;
    });
}

function parseWorkspace() {
    let nOpenend=0, fileQueue = [];
    function appendFile(completePath, cMode) {
        if(nOpenend<1000) {
            const fileUri = Uri.file(completePath);
            const pp = new provider.Provider(true);
            nOpenend++;
            pp.parseFile(completePath, fileUri.toString(), cMode).then(
                prov => {
                    nOpenend--;
                    UpdateFile(prov)
                    if(fileQueue.length>0) {
                        const nextFile = fileQueue.pop()
                        appendFile(nextFile[0],nextFile[1])
                    }
                }
            )
        } else {
            fileQueue.push([completePath,cMode])
        }
    }
    function parseDir(dir, depth, prgFiles) {
        if (!prgFiles) prgFiles = [];
        //fs.readdir(dir,{withFileTypes:true},function(err,ff)
        fs.readdir(dir, function (err, ff) {
            if (ff == undefined) return;
            const files = []; files.length=ff.length;
            for (let i = 0; i < ff.length; i++) {
                const dest = {name: ff[i]}
                dest.completePath = path.join(dir, ff[i]);
                dest.info = fs.statSync(dest.completePath);
                dest.pathParse = path.parse(ff[i]);
                dest.pathParse.ext = dest.pathParse.ext.toLowerCase()
                if(dest.info.isFile()) {
                    dest.prgFile = dest.pathParse.ext == ".prg" || dest.pathParse.ext == ".ch";
                    dest.cFile = !dest.prgFile && (dest.pathParse.ext.startsWith(".c") || dest.pathParse.ext == ".h");
                } else {
                    dest.cFile = false;
                    dest.prgFile = false;
                }
                files[i]=dest;
            }
            // 1st cycle: parse all harbour file
            for (let i = 0; i < files.length; i++) {
                const dest = files[i];
                if(dest.prgFile) {
                    prgFiles.push(dest.completePath);
                    appendFile(dest.completePath, false)
                }
            }
            // 2nd cycle: parse all c file
            for (let i = 0; i < files.length; i++) {
                const dest = files[i];
                if(dest.cMode && (prgFiles.findIndex((v) => v.indexOf(dest.pathParse.name) >= 0) >= 0)) {
                    appendFile(dest.completePath, true)
                }
            }
            if(depth>0) {
                // 1rd cycle: parse all sub dir
                for (let i = 0; i < files.length; i++) {
                    const dest = files[i];
                    if(dest.info.isDirectory()) {
                        parseDir(dest.completePath, depth - 1, prgFiles);
                    }
                }

            }
        });
    }
    databases = {};
    files = {};
    includes = {};
    for (let i = 0; i < workspaceRoots.length; i++) {
        // other scheme of uri unsupported
        if (workspaceRoots[i] == null) continue;
        /** @type {vscode-uri.default} */
        const uri = Uri.parse(workspaceRoots[i]);
        if (uri.scheme != "file") continue;
        parseDir(uri.fsPath, workspaceDepth);
    }
}

/**
 * Update a file in the workspace
 * @param {provider.Provider} pp
 */
function UpdateFile(pp) {
    const doc = pp.currentDocument;
    const ext = path.extname(pp.currentDocument).toLowerCase();
    if (ext != ".prg") {
        files[doc] = pp;
        return;
    }
    if (doc in files)
        for (var db in databases) {
            for (var f in databases[db].fields) {
                var idx = databases[db].fields[f].files.indexOf(doc);
                if (idx >= 0) {
                    databases[db].fields[f].files.splice(idx, 1);
                    if (databases[db].fields[f].files.length == 0) {
                        delete databases[db].fields[f];
                    }
                }
            }
            if (Object.keys(databases[db].fields).length == 0) {
                delete databases[db];
            }
        }
    files[doc] = pp;
    for (var db in pp.databases) {
        const ppDB = pp.databases[db];
        if (!(db in databases)) databases[db] = { name: ppDB.name, fields: {} };
        const gbDB = databases[db];
        for (var f in ppDB.fields) {
            if (!(f in gbDB.fields))
                gbDB.fields[f] = { name: ppDB.fields[f], files: [doc] };
            else {
                var idx = gbDB.fields[f].files.indexOf(doc);
                if (idx < 0) gbDB.fields[f].files.push(doc);
            }
        }
    }
    AddIncludes(path.dirname(doc), pp.includes);
}

function AddIncludes(startPath, includesArray) {
    if (includesArray.length == 0)
        return;
    if (startPath.startsWith("file:///"))
        startPath = Uri.parse(startPath).fsPath;
    function FindInclude(dir, fileName) {
        //var ext= path.extname(ff[fi]).toLowerCase();
        //if( ext != '.ch') return
        if (startPath && !path.isAbsolute(dir))
            dir = path.join(startPath, dir);
        if (!fs.existsSync(dir)) return false;
        if (fileName.length < 1)
            return false;
        const completePath = path.join(dir, fileName);
        if (!fs.existsSync(completePath)) return false;
        const info = fs.statSync(completePath);
        if (!info.isFile()) return false;
        let fileUri = Uri.file(completePath);
        try {
            fileUri = Uri.file(trueCase.trueCasePathSync(completePath));
        } catch(ex) { }
        const pp = new provider.Provider(true);
        includes[fileName] = pp;
        pp.parseFile(completePath, fileUri.toString(), false).then(
            prov => {
                includes[fileName] = prov;
                AddIncludes(dir, prov.includes);
            }
        )
        return true;
    }
    for (let j = 0; j < includesArray.length; j++) {
        const inc = includesArray[j];
        if (inc in includes)
            continue
        let found = false;
        for (var i = 0; i < workspaceRoots.length; i++) {
            // other scheme of uri unsupported
            /** @type {vscode-uri.default} */
            const uri = Uri.parse(workspaceRoots[i]);
            if (uri.scheme != "file") continue;
            found = FindInclude(uri.fsPath, inc);
            if (found) break;
        }
        if (found) continue;
        for (var i = 0; i < includeDirs.length; i++) {
            found = FindInclude(includeDirs[i], inc);
            if (found) break;
        }
    }
}

function ParseInclude(startPath, includeName, addGlobal) {
    if (includeName.length == 0)
        return undefined;
    if (includeName in includes)
        return includes[includeName];
    function FindInclude(dir) {
        if (startPath && !path.isAbsolute(dir))
            dir = path.join(startPath, dir);
        if (!fs.existsSync(dir)) return undefined;
        const test = path.join(dir, includeName);
        if (!fs.existsSync(test)) return undefined;
        const info = fs.statSync(test);
        if (!info.isFile()) return false;
        const pp = new provider.Provider();
        pp.parseString(fs.readFileSync(test).toString(), Uri.file(test).toString());
        if (addGlobal)
            includes[includeName] = pp;
        return pp;
    }
    for (var i = 0; i < workspaceRoots.length; i++) {
        // other scheme of uri unsupported
        /** @type {vscode-uri.default} */
        const uri = Uri.parse(workspaceRoots[i]);
        if (uri.scheme != "file") continue;
        var r = FindInclude(uri.fsPath);
        if (r) return r;
    }
    for (var i = 0; i < includeDirs.length; i++) {
        var r = FindInclude(includeDirs[i]);
        if (r) return r;
    }
}

function kindToVS(kind, sk) {
    if (sk == undefined) sk = true;
    switch (kind) {
        case "class":
            return sk ? server.SymbolKind.Class : server.CompletionItemKind.Class;
        case "method":
            return sk ? server.SymbolKind.Method : server.CompletionItemKind.Method;
        case "data":
            return sk ? server.SymbolKind.Property : server.CompletionItemKind.Property;
        case "function*":
        case "procedure*":
            return sk ? server.SymbolKind.Interface : server.CompletionItemKind.Interface;
        case "function":
        case "procedure":
        case "C-FUNC":
            return sk ? server.SymbolKind.Function : server.CompletionItemKind.Function;
        case "local":
        case "static":
        case "public":
        case "private":
        case "param":
        case "memvar":
            return sk ? server.SymbolKind.Variable : server.CompletionItemKind.Variable;
        case "field":
            return sk ? server.SymbolKind.Field : server.CompletionItemKind.Field;
        case "define":
            return sk ? server.SymbolKind.Constant : server.CompletionItemKind.Constant;
    }
    return 0;
}

connection.onDocumentSymbol((param) => {
    const doc = documents.get(param.textDocument.uri);
    /** @type {provider.Provider} */
    const p = getDocumentProvider(doc);
    /** @type {server.DocumentSymbol[]} */
    const dest = [];
    for (const fn in p.funcList) {
        //if (p.funcList.hasOwnProperty(fn)) {
        /** @type {provider.Info} */
        const info = p.funcList[fn];
        if (info.kind == "field") continue;
        if (info.kind == "memvar") continue;
        if (typeof(info.endLine)!="number") continue;
        const selRange = server.Range.create(info.startLine, info.startCol, info.endLine, info.endCol);
        if (info.endLine != info.startLine)
            selRange.end = server.Position.create(info.startLine, 1e8);
        const docSym = server.DocumentSymbol.create(info.name,
            (info.comment && info.comment.length > 0 ? info.comment.replace(/[\r\n]+/g, " ") : ""),
            kindToVS(info.kind),
            server.Range.create(info.startLine, info.startCol,
                info.endLine, info.endCol), selRange, undefined);
        let parent = dest;
        if (info.parent && info.startLine <= info.parent.endLine) {
            let pp = info.parent;
            const names = [];
            while (pp) {
                if (pp.kind == "method" && pp.foundLike == "definition" && (!pp.parent || pp.startLine > pp.parent.endLine)) {
                    if(pp.parent)
                        names.push(pp.parent.name + ":" + pp.name);

                    else if(pp.parentName)
                        names.push(pp.parentName+"???:" + pp.name);
                    else
                        names.push("???:" + pp.name);
                    break;
                } else
                    names.push(pp.name);
                pp = pp.parent;
            }
            while (names.length > 0) {
                var n = names.pop();
                const i = parent.findIndex((v) => (v.name == n));
                if (i >= 0) {
                    parent = parent[i];
                    if (!parent.children)
                        parent.children = [];
                    parent = parent.children;
                }
            }
        } else
            if (info.kind == "method") {
                if(info.parent)
                    docSym.name = info.parent.name + ":" + info.name
                else if(info.parentName)
                    docSym.name = info.parentName+"???:" + info.name;
                else
                    docSym.name = "???:" + info.name;
            }
        parent.push(docSym);
        //}
    };
    return dest;
});

/**
 * Checks if word1 is contained on word2, return a string with word1 filled with Z where it is not present on word2
 * @param {String} word1 The string to search
 * @param {String} word2 The string where search
 * @returns undefined or the word1 with Z
 * @example IsInside('a',"ciao") -> ZZa
 * @example IsInside('ab',"ciao belli") -> ZZaZZb
 * @example IsInside('ab',"ciao") -> undefined
 */
function IsInside(word1, word2) {
    if(word1.length==0)
        return ""
    let ret = "";
    let i1 = 0;
    let lenMatch = 0, maxLenMatch = 0, minLenMatch = word1.length;
    for (let i2 = 0; i2 < word2.length; i2++) {
        if (word1[i1] == word2[i2]) {
            lenMatch++;
            if (lenMatch > maxLenMatch) maxLenMatch = lenMatch;
            ret += word1[i1];
            i1++;
            if (i1 == word1.length) {
                return ret;
            }
        } else {
            ret += "Z";
            if (lenMatch > 0 && lenMatch < minLenMatch)
                minLenMatch = lenMatch;
            lenMatch = 0;
        }
    }
    return undefined;
}

connection.onWorkspaceSymbol((param) => {
    const dest = [];
    let src = param.query.toLowerCase();
    let parent = undefined;
    const colon = src.indexOf(':');
    if (colon > 0) {
        parent = src.substring(0, colon);
        if (parent.endsWith("()")) parent = parent.substring(0, parent.length - 2);
        src = src.substring(colon + 1);
    }
    for (const file in files) { //if (files.hasOwnProperty(file)) {
        const pp = files[file];
        for (const fn in pp.funcList) { //if (pp.funcList.hasOwnProperty(fn)) {
            /** @type {provider.Info} */
            const info = pp.funcList[fn];
            if (info.kind != "class" && info.kind != "method" &&
                info.kind != "data" && info.kind != "public" &&
                info.kind != "define" &&
                !info.kind.startsWith("procedure") &&
                !info.kind.startsWith("function"))
                continue;
            // workspace symbols takes statics too
            if (src.length > 0 && !IsInside(src, info.nameCmp))
                continue;
            // public has parent, but they are visible everywhere
            if (parent && info.kind != "public" && (!info.parent || !IsInside(parent, info.parent.nameCmp)))
                continue;
            dest.push(server.SymbolInformation.create(
                info.name, kindToVS(info.kind),
                server.Range.create(info.startLine, info.startCol,
                    info.endLine, info.endCol),
                file, info.parent ? info.parent.name : ""));
            if (dest.length == 100)
                return dest;
        }
    }
    return dest;
});

/**
 *
 * @param {server.TextDocumentPositionParams} params
 * @param {Boolean} withPrev
 * @returns
 */
function GetWord(params, withPrev) {
    const doc = documents.get(params.textDocument.uri);
    const pos = doc.offsetAt(params.position);
    let delta = 20;
    let word, prev;
    //var allText = doc.getText();
    const r = /\b[a-z_][a-z0-9_]*\b/gi
    while (true) {
        r.lastIndex = 0;
        //var text = allText.substring(Math.max(pos-delta,0),pos+delta)
        const text = doc.getText(server.Range.create(doc.positionAt(Math.max(pos - delta, 0)), doc.positionAt(pos + delta)));
        const txtPos = pos < delta ? pos : delta;
        while (word = r.exec(text)) {
            if (word.index <= txtPos && word.index + word[0].length >= txtPos)
                break;
        }
        if (!word) return [];
        if (word.index != 0 && (word.index + word[0].length) != (delta + delta)) {
            if(withPrev) {
                let idx = word.index-1;
                prev = text[idx];
                while(idx>=0 && (prev==' ' || prev=='\t')) {
                    prev = text[--idx];
                }
                let canBreak = (prev!=' ' || prev!='\t')
                if(prev==">") {
                    canBreak=idx>0;
                    if(canBreak)
                        prev=text[--idx]+prev; //can become ->
                }
                if(canBreak)
                    break
            } else
                break
        }
        delta += 10;
    }
    const worldPos = pos - delta + word.index;
    word = word[0];
    return withPrev ? [word, prev, worldPos] : word;
}

connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    const line = doc.getText(server.Range.create(params.position.line, 0, params.position.line, 100));
    const include = /^\s*#(?:pragma\s+__(?:c|binary)?stream)?include\s+[<"]([^>"]*)/i.exec(line);
    if (include !== null) {
        let startPath = undefined;
        if (params.textDocument.uri && params.textDocument.uri.startsWith("file")) {
            startPath = path.dirname(Uri.parse(params.textDocument.uri).fsPath);
        }
        var pos = include[0].indexOf(include[1]);
        return definitionFiles(include[1], startPath, server.Range.create(params.position.line, pos, params.position.line, pos + include[1].length));
    }
    let word = GetWord(params, true);
    if (word.length == 0) return undefined;
    const dest = [];
    let thisDone = false;
    const prev = word[1];
    let className;
    var pos = word[2];
    if (prev == ':' && doc.getText(server.Range.create(doc.positionAt(Math.max(pos - 3, 0)), doc.positionAt(pos))) == "():") {
        const tmp = params.position;
        params.position = doc.positionAt(Math.max(pos - 3, 0));
        className = GetWord(params).toLowerCase();
        params.position = tmp;
        let found = false;
        for (var file in files) { //if (files.hasOwnProperty(file)) {
            if (file == doc.uri) thisDone = true;
            pp = files[file];
            for (var fn in pp.funcList) { //if (pp.funcList.hasOwnProperty(fn)) {
                /** @type {provider.Info} */
                var info = pp.funcList[fn];
                if (info.kind != 'class')
                    continue
                if (info.nameCmp == className) {
                    found = true;
                    break;
                }
            }
        }
        var pThis
        if (!thisDone && !found) {
            pThis = getDocumentProvider(doc);
            for (var fn in pThis.funcList) { //if (pp.funcList.hasOwnProperty(fn)) {
                /** @type {provider.Info} */
                var info = pThis.funcList[fn];
                if (info.kind != 'class')
                    continue;
                if (info.nameCmp == className) {
                    found = true;
                    break;
                }
            }

        }
        if (!found) className = undefined;
    }

    word = word[0].toLowerCase();
    function DoProvider(pp, file) {
        for (const fn in pp.funcList) { //if (pp.funcList.hasOwnProperty(fn)) {
            /** @type {provider.Info} */
            const info = pp.funcList[fn];
            if (info.foundLike != "definition")
                continue;
            if (info.nameCmp != word)
                continue;
            if (info.kind.endsWith("*") && file != doc.uri)
                continue;
            if (info.kind == 'static' && file != doc.uri)
                continue;
            if (info.kind == 'data' || info.kind == 'method') {
                //if(prev!=':') continue;
                if (className && className != info.parent.nameCmp)
                    continue;
            }
            //if(info.kind=='field' && prev!='>')
            //    continue;
            if (info.kind == 'local' || info.kind == 'param') {
                if (file != doc.uri)
                    continue;
                const parent = info.parent;
                if (parent) {
                    if (parent.startLine > params.position.line)
                        continue;
                    if (parent.endLine < params.position.line)
                        continue;
                }
            }
            dest.push(server.Location.create(file,
                server.Range.create(info.startLine, info.startCol,
                    info.endLine, info.endCol)));
        }
    }
    for (var file in files) { //if (files.hasOwnProperty(file)) {
        if (file == doc.uri) thisDone = true;
        DoProvider(files[file], file);
    }
    var pThis
    if (!thisDone) {
        pThis = getDocumentProvider(doc);
        DoProvider(pThis, doc.uri);
    } else
        pThis = files[doc.uri];

    const includes = pThis.includes;
    let i = 0;
    const startDir = path.dirname(Uri.parse(doc.uri).fsPath);
    while (i < includes.length) {
        pp = ParseInclude(startDir, includes[i], thisDone);
        if (pp) {
            DoProvider(pp, pp.currentDocument)
            for (let j = 0; j < pp.includes; j++) {
                if (includes.indexOf(pp.includes[j]) < 0)
                    includes.push(pp.includes[j]);
            }
        }
        i++;
    }

    return dest;
})

connection.onSignatureHelp((params) => {
    const doc = documents.get(params.textDocument.uri);
    let pos = doc.offsetAt(params.position) - 1;
    /** @type {string} */
    const text = doc.getText(); //here takes all text because the line can break with ;
    // backwards find (
    pos = findBracket(text, pos, -1, "(")
    if (pos === undefined) return pos;
    // Get parameter position
    const endPos = doc.offsetAt(params.position)
    const nC = CountParameter(text.substring(pos + 1, endPos), doc.offsetAt(params.position) - pos - 1)
    // Get the word
    pos--;
    const rge = /[0-9a-z_]/i;
    let word = "", className = undefined;
    while (rge.test(text[pos])) {
        word = text[pos] + word;
        pos--;
    }
    word = word.toLowerCase();
    // custom call-suffix alias: "receiver:Suffix(" resolves against "receiver" instead of "Suffix"
    if (aliasConfig.callSuffixes.indexOf(word) >= 0 && text[pos] == ':') {
        let aliasPos = pos - 1;
        let receiver = "";
        while (rge.test(text[aliasPos])) {
            receiver = text[aliasPos] + receiver;
            aliasPos--;
        }
        if (receiver.length > 0) {
            word = receiver.toLowerCase();
            pos = aliasPos;
        }
    }
    // special case for new, search the class name
    const prev = text.substring(pos - 2, pos + 1);
    if (prev == "():") // se è un metodo
    {
        pos -= 3;
        className = "";
        while (rge.test(text[pos])) {
            className = text[pos] + className;
            pos--;
        }
        className = className.toLowerCase();
    }
    let signatures = [].concat(getWorkspaceSignatures(word, doc, className, nC));
    if (signatures.length == 0 && className !== undefined) {
        signatures = [].concat(getWorkspaceSignatures(word, doc, undefined, nC));
    }
    signatures = signatures.concat(getStdHelp(word, nC));
    return { signatures: signatures, activeParameter: nC }
})

/**
 *
 * @param {String} text
 * @param {Number} pos
 * @param {Number} dir
 * @param {String} bracket
 */
function findBracket(text, pos, dir, bracket) {
    let nP = 0, str
    while (nP != 0 || text[pos] != bracket || str != undefined) {
        if (pos < 0) return undefined;
        if (pos >= text.length) return undefined;
        if (str) {
            if (text[pos] == str)
                str = undefined;
        } else {
            switch (text[pos]) {
                case '(': nP--; break;
                case ')': nP++; break;
                case '[': if (dir > 0) str = ']'; break
                case ']': if (dir < 0) str = '['; break
                case '{': if (dir > 0) str = '}'; break
                case '}': if (dir < 0) str = '{'; break
                case '"': str = '"'; break
                case "'": str = "'"; break
                case '\n':
                    var nSpace = 1;
                    while((pos - nSpace)>0 && text[pos - nSpace] != '\n') nSpace++;
                    var thisLine = text.substring(pos - nSpace + 1, pos)
                    thisLine = thisLine.replace(/\/\/[^\n]*\n/, "\n")
                    thisLine = thisLine.replace(/&&[^\n]*\n/, "\n")
                    thisLine = thisLine.replace(/\s+\n/, "\n")
                    if (thisLine[thisLine.length - 2] == ';')
                        break;
                    return undefined;
                    break;
            }
        }
        pos += dir;
    }
    return pos
}

/**
 *
 * @param {String} txt The text where count the parameter
 * @param {Number} position Position of cursor
 */
function CountParameter(txt, position) {
    let i = 0;
    while (true) {
        i++;
        let filter = undefined;
        switch (i) {
            case 1: filter = /;\s*\r?\n/g; break;  // new line with ;
            case 2: filter = /'[^']*'/g; break; // ' strings
            case 3: filter = /"[^"]*"/g; break; // " strings
            case 4: filter = /\[[^\[\]]*\]/g; break; // [] strings or array index
            case 5: filter = /{[^{}]*}/g; break; // {} array
            case 6: filter = /\([^\(\)]*\)/g; break; // couple of parenthesis
        }
        if (filter == undefined)
            break;
        do {
            var someChange = false
            txt = txt.replace(filter, function (matchString) {
                someChange = true;
                return Array(matchString.length + 1).join("X");
            })
        } while (someChange)
    }
    return (txt.substring(0, position).match(/,/g) || []).length
}

function getWorkspaceSignatures(word, doc, className, nC) {
    const signatures = [];
    let thisDone = false;
    function GetSignatureFromInfo(pp, info) {
        if ("hDocIdx" in info) return GetHelpFromDoc(pp.harbourDocs[info.hDocIdx]);
        const s = {}
        if (info.kind.startsWith("method"))
            if (info.parent) {
                s["label"] = info.parent.name + ":" + info.name;
                if (className && className != info.parent.nameCmp) return undefined;
            }
            else {
                s["label"] = "??:" + info.name;
                if (className) return undefined;
            }
        else
            s["label"] = info.name;
        s["label"] += "("
        const subParams = [];
        for (let iParam = iSign + 1; iParam < pp.funcList.length; iParam++) {
            /** @type {provider.Info} */
            const subInfo = pp.funcList[iParam];
            if (subInfo.parent == info && subInfo.kind == "param") {
                const pInfo = { "label": subInfo.name }
                if (subInfo.comment && subInfo.comment.trim().length > 0)
                    pInfo["documentation"] = "<" + subInfo.name + "> " + subInfo.comment
                subParams.push(pInfo)
                if (!s.label.endsWith("("))
                    s.label += ", "
                s.label += subInfo.name
            } else
                break;
        }
        s["label"] += ")"
        s["parameters"] = subParams;
        if (info.comment && info.comment.trim().length > 0)
            s["documentation"] = info.comment
        return s;
    }
    for (const file in files) //if (files.hasOwnProperty(file))
    {
        if (file == doc.uri) thisDone = true;
        var pp = files[file];
        for (var iSign = 0; iSign < pp.funcList.length; iSign++) {
            /** @type {provider.Info} */
            var info = pp.funcList[iSign];
            if (!info.kind.startsWith("method") && !info.kind.startsWith("procedure") && !info.kind.startsWith("function"))
                continue;
            if (info.nameCmp != word)
                continue;
            if (info.kind.endsWith("*") && file != doc.uri)
                continue;
            var s = GetSignatureFromInfo(pp, info);
            if (s && s["parameters"].length >= nC)
                signatures.push(s);
        }
    }
    if (!thisDone) {
        var pp = getDocumentProvider(doc);
        for (var iSign = 0; iSign < pp.funcList.length; iSign++) {
            /** @type {provider.Info} */
            var info = pp.funcList[iSign];
            if (!info.kind.startsWith("method") && !info.kind.startsWith("procedure") && !info.kind.startsWith("function"))
                continue;
            if (info.nameCmp != word)
                continue;
            var s = GetSignatureFromInfo(pp, info);
            if (s && s["parameters"].length >= nC)
                signatures.push(s);
        }

    }
    return signatures;
}

function GetHelpFromDoc(doc) {
    const s = {};
    s["label"] = doc.label;
    s["documentation"] = doc.documentation;
    const subParams = [];
    for (let iParam = 0; iParam < doc.arguments.length; iParam++) {
        subParams.push({
            "label": doc.arguments[iParam].label,
            "documentation": doc.arguments[iParam].documentation
        });
    }
    s["parameters"] = subParams;
    return s;
}

function getStdHelp(word, nC) {
    const signatures = [];
    for (let i = 0; i < docs.length; i++) {
        if (docs[i].name.toLowerCase() == word) {
            signatures.push(GetHelpFromDoc(docs[i]));
        }
    }
    for (let i = 0; i < customFunctionDocs.length; i++) {
        if (customFunctionDocs[i].name.toLowerCase() == word) {
            signatures.push(GetHelpFromDoc(customFunctionDocs[i]));
        }
    }
    return signatures;
}

var documents = new server.TextDocuments(server_textdocument.TextDocument);
documents.listen(connection);

const callableKinds = { "function": true, "procedure": true, "function*": true, "procedure*": true, "C-FUNC": true, "method": true };

/** Resolves a document's full `#include` chain (transitively) to an array of
 * parsed Providers, using the same on-demand `ParseInclude` lookup
 * `connection.onHover` uses to find doc-comments in included `.ch` files --
 * independent of `harbour.workspaceDepth`/the directory-scanned `files`
 * index, since a project's shared includes (e.g. a common `.ch` with
 * function definitions) are often outside the scanned tree.
 * @param {provider.Provider} pp
 * @param {string} docUri
 * @returns {Array<provider.Provider>}
 */
function resolveIncludeChain(pp, docUri) {
    const result = [];
    const thisDone = docUri in files;
    const startDir = path.dirname(Uri.parse(docUri).fsPath);
    const pending = pp.includes.slice();
    let i = 0;
    while (i < pending.length) {
        const pInc = ParseInclude(startDir, pending[i], thisDone);
        if (pInc) {
            result.push(pInc);
            for (let j = 0; j < pInc.includes.length; j++) {
                if (pending.indexOf(pInc.includes[j]) < 0)
                    pending.push(pInc.includes[j]);
            }
        }
        i++;
    }
    return result;
}

/** Is `nameCmp` (already lowercased) a known function/procedure defined in
 * `pp` itself, anywhere in the indexed workspace, or in `pp`'s resolved
 * `#include` chain (RTL not included -- see `isKnownFunction` for that).
 * `pp` is checked directly (not just via the global `files` index) because a
 * document's provider may not be registered in `files` yet -- e.g. right
 * after the language server (re)starts and a config change re-runs this
 * check before `documents.onDidChangeContent` has had a chance to register
 * the document.
 * @param {string} nameCmp
 * @param {provider.Provider} [pp]
 * @param {Array<provider.Provider>} [includeChain] see `resolveIncludeChain`
 * @returns {boolean}
 */
function isKnownWorkspaceFunction(nameCmp, pp, includeChain) {
    function hasIt(prov) {
        for (const fn in prov.funcList) {
            const info = prov.funcList[fn];
            if (info.nameCmp == nameCmp && callableKinds[info.kind])
                return true;
        }
        return false;
    }
    if (pp && hasIt(pp)) return true;
    for (const file in files) {
        if (files[file] === pp) continue; // already checked above
        if (hasIt(files[file])) return true;
    }
    if (includeChain) {
        for (let i = 0; i < includeChain.length; i++) {
            if (hasIt(includeChain[i])) return true;
        }
    }
    return false;
}

/** Is `nameCmp` (already lowercased) a known function/procedure -- either
 * defined in `pp` itself, anywhere in the indexed workspace, in `pp`'s
 * resolved `#include` chain, or part of the standard xHarbour/Harbour RTL?
 * @param {string} nameCmp
 * @param {provider.Provider} [pp]
 * @param {Array<provider.Provider>} [includeChain] see `resolveIncludeChain`
 * @returns {boolean}
 */
function isKnownFunction(nameCmp, pp, includeChain) {
    if (isKnownWorkspaceFunction(nameCmp, pp, includeChain)) return true;
    for (var i = 0; i < docs.length; i++) {
        if (docs[i].name && docs[i].name.toLowerCase() == nameCmp)
            return true;
    }
    for (var i = 1; i < missing.length; i++) {
        if (missing[i][0] && missing[i][0].toLowerCase() == nameCmp)
            return true;
    }
    for (var i = 0; i < customFunctions.length; i++) {
        if (customFunctions[i][0] && customFunctions[i][0].toLowerCase() == nameCmp)
            return true;
    }
    for (var i = 0; i < customFunctionDocs.length; i++) {
        if (customFunctionDocs[i].name && customFunctionDocs[i].name.toLowerCase() == nameCmp)
            return true;
    }
    return false;
}

/** Builds "possibly undefined function" hints for one document. Best-effort:
 * only flags bare `name(` calls (never `obj:Method(`), and only when
 * harbour.checkUndefinedFunctions is enabled AND harbour.workspaceDepth is
 * > 0 -- with depth 0 the language server only ever sees the files that
 * happen to be open, so a name "not found" would almost always just mean
 * "defined in a workspace file we never indexed", not "doesn't exist".
 * @param {provider.Provider} pp
 * @param {import("vscode-languageserver-textdocument").TextDocument} doc
 * @returns {Array<object>}
 */
function buildUndefinedFunctionDiagnostics(pp, doc) {
    if (!checkUndefinedFunctionsEnabled || !(workspaceDepth > 0))
        return [];
    const includeChain = resolveIncludeChain(pp, doc.uri);
    const diagnostics = [];
    for (const cmpName in pp.references) {
        const refs = pp.references[cmpName];
        if (!Array.isArray(refs)) continue;
        if (isKnownFunction(cmpName, pp, includeChain)) continue;
        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            if (ref.type != "function") continue;
            diagnostics.push({
                severity: server.DiagnosticSeverity.Information,
                range: server.Range.create(ref.line, ref.col, ref.line, ref.col + ref.howWrite.length),
                message: `Function '${ref.howWrite}' not found in the workspace or in the standard xHarbour/Harbour RTL`,
                source: "harbour"
            });
        }
    }
    return diagnostics;
}

/** `pp.references` includes a function/procedure's own declaration line as
 * a "function"-typed reference (see provider.js's `prevWord.startsWith("func")`
 * handling), not just its call sites. Callers that only care about actual
 * calls (like callSuffixMode) need to filter those out.
 * @param {provider.Provider} pp
 * @param {string} cmpName
 * @param {{line:number}} ref
 * @returns {boolean}
 */
function isDefinitionSite(pp, cmpName, ref) {
    for (const fn in pp.funcList) {
        const info = pp.funcList[fn];
        if (info.nameCmp == cmpName && info.foundLike == "definition" && info.startLine == ref.line)
            return true;
    }
    return false;
}

/** Scans backward from a "method" reference's position (e.g. the "Exec" in
 * `Saudacao:Exec(`) to find the receiver identifier right before the ':'.
 * `pp.references` only records the method name itself, not its receiver, so
 * this reads the raw line text to recover it.
 * @param {import("vscode-languageserver-textdocument").TextDocument} doc
 * @param {{line:number, col:number}} ref
 * @returns {{name:string, start:number, end:number}|null}
 */
function findReceiverBeforeColon(doc, ref) {
    const lineText = doc.getText(server.Range.create(ref.line, 0, ref.line, 1e8));
    let idx = ref.col - 1;
    while (idx >= 0 && /\s/.test(lineText[idx])) idx--;
    if (idx < 0 || lineText[idx] != ':') return null;
    idx--;
    while (idx >= 0 && /\s/.test(lineText[idx])) idx--;
    const identEnd = idx + 1;
    while (idx >= 0 && /[A-Za-z0-9_]/.test(lineText[idx])) idx--;
    const identStart = idx + 1;
    if (identStart >= identEnd) return null;
    return { name: lineText.substring(identStart, identEnd), start: identStart, end: identEnd };
}

/** Builds harbour.aliases.callSuffixMode diagnostics for one document: with
 * "suffixOnly", every bare call to a workspace-known function must use one
 * of harbour.aliases.callSuffixes instead; with "bareOnly", the opposite.
 * RTL functions are never flagged -- there's no reasonable expectation that
 * e.g. `Len:Exec()` should work.
 * @param {provider.Provider} pp
 * @param {import("vscode-languageserver-textdocument").TextDocument} doc
 * @returns {Array<object>}
 */
function buildCallSuffixDiagnostics(pp, doc) {
    if (callSuffixMode == "either" || aliasConfig.callSuffixes.length == 0)
        return [];
    const includeChain = resolveIncludeChain(pp, doc.uri);
    const diagnostics = [];
    if (callSuffixMode == "suffixOnly") {
        const suggestedSuffix = aliasConfig.callSuffixesRaw[0];
        for (var cmpName in pp.references) {
            var refs = pp.references[cmpName];
            if (!Array.isArray(refs)) continue;
            if (!isKnownWorkspaceFunction(cmpName, pp, includeChain)) continue;
            for (var i = 0; i < refs.length; i++) {
                var ref = refs[i];
                if (ref.type != "function") continue;
                if (isDefinitionSite(pp, cmpName, ref)) continue;
                diagnostics.push({
                    severity: server.DiagnosticSeverity.Error,
                    range: server.Range.create(ref.line, ref.col, ref.line, ref.col + ref.howWrite.length),
                    message: `Function '${ref.howWrite}' must be called as ${ref.howWrite}:${suggestedSuffix}(...) (harbour.aliases.callSuffixMode = "suffixOnly")`,
                    source: "harbour"
                });
            }
        }
    } else if (callSuffixMode == "bareOnly") {
        for (var cmpName in pp.references) {
            if (aliasConfig.callSuffixes.indexOf(cmpName) < 0) continue; // cmpName is the suffix word itself here (e.g. "exec")
            var refs = pp.references[cmpName];
            if (!Array.isArray(refs)) continue;
            for (var i = 0; i < refs.length; i++) {
                var ref = refs[i];
                if (ref.type != "method") continue;
                const receiver = findReceiverBeforeColon(doc, ref);
                if (!receiver) continue;
                if (!isKnownWorkspaceFunction(receiver.name.toLowerCase(), pp, includeChain)) continue;
                diagnostics.push({
                    severity: server.DiagnosticSeverity.Error,
                    range: server.Range.create(ref.line, receiver.start, ref.line, ref.col + ref.howWrite.length),
                    message: `Function '${receiver.name}' must be called as ${receiver.name}(...) without the :${ref.howWrite} suffix (harbour.aliases.callSuffixMode = "bareOnly")`,
                    source: "harbour"
                });
            }
        }
    }
    return diagnostics;
}

/** Publishes (or clears) all harbour-tools diagnostics for one document --
 * undefined-function hints and call-suffix-mode errors combined into a
 * single connection.sendDiagnostics call, since LSP diagnostics are a full
 * replace per uri, not additive.
 * @param {provider.Provider} pp
 * @param {import("vscode-languageserver-textdocument").TextDocument} doc
 */
function publishHarbourDiagnostics(pp, doc) {
    const diagnostics = buildUndefinedFunctionDiagnostics(pp, doc).concat(buildCallSuffixDiagnostics(pp, doc));
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: diagnostics });
}

documents.onDidChangeContent((e) => {
    const uri = Uri.parse(e.document.uri);
    if (uri.scheme != "file") return;
    let found = false;
    for (let i = 0; i < workspaceRoots.length; i++)
        if (e.document.uri.startsWith(workspaceRoots[i]))
            found = true;
    if (!found) return; //not include file outside the current workspace
    const ext = path.extname(uri.fsPath).toLowerCase();
    const cMode = (ext.startsWith(".c") && ext != ".ch")
    if (ext == ".prg" || ext == ".ch" || cMode) {
        let doGroups = false;
        if(uri in files) doGroups = files[uri].doGroups;
        const pp = parseDocument(e.document, (p) => { p.cMode = cMode; p.doGroups = doGroups; })
        UpdateFile(pp);
        if (ext == ".prg")
            publishHarbourDiagnostics(pp, e.document);
    }
})

/**
 *
 * @param {server_textdocument.TextDocument} doc
 * @param {boolean} cMode
 * @returns {provider.Provider}
 */
function parseDocument(doc, onInit) {
    const pp = new provider.Provider(false)
    pp.Clear();
    pp.currentDocument = doc.uri;
    if (onInit != undefined) onInit(pp);
    for (let i = 0; i < doc.lineCount; i++) {
        pp.parse(doc.getText(server.Range.create(i, 0, i, 1e8)));
    }
    pp.endParse();
    return pp;
}

/** @type {provider.Provider} */
let lastDocOutsideWorkspaceProvider = { currentDocument: "" };
function getDocumentProvider(doc, checkGroup) {
    let pp;
    if (doc.uri in files) {
        pp = files[doc.uri]
        if (checkGroup && !pp.doGroups)
            pp = files[doc.uri] = parseDocument(doc, (p) => p.doGroups = true);
        return pp;
    }
    if(doc.uri in includes) {
        return includes[doc.uri]
    }
    if (doc.uri == lastDocOutsideWorkspaceProvider.currentDocument) {
        pp = lastDocOutsideWorkspaceProvider;
        if (checkGroup && !pp.doGroups)
            pp = lastDocOutsideWorkspaceProvider = parseDocument(doc, (p) => p.doGroups = true);
        return pp;
    }
    if (checkGroup)
        pp = lastDocOutsideWorkspaceProvider = parseDocument(doc, (p) => p.doGroups = true);
    else
        pp = lastDocOutsideWorkspaceProvider = parseDocument(doc);
    return pp;
}

connection.onCompletion((param, cancelled) => {
    const doc = documents.get(param.textDocument.uri);
    let line = doc.getText(server.Range.create(
        server.Position.create(param.position.line, 0),
        server.Position.create(param.position.line, 1e8)));
    if(param.context?.triggerKind==server.CompletionTriggerKind.TriggerCharacter &&
        line[param.position.character - 1]!=param.context?.triggerCharacter) {
        // somethime the triggerCharacter is not included on the line
        line = line.substring(0,param.position.character-1)+param.context?.triggerCharacter+line.substring(param.position.character-1)
    }
    const include = /^\s*#(pragma\s+__(?:c|binary)?stream)?include\s+[<"]([^>"]*)/i.exec(line);
    let prevLetter = ""
    if(param.position.character>0)
        prevLetter = doc.getText(server.Range.create(server.Position.create(param.position.line, param.position.character - 1), param.position));
    if (include !== null) {
        if (prevLetter == '>') {
            return server.CompletionList.create([], false); // wrong call
        }
        let startPath = undefined;
        if (param.textDocument.uri && param.textDocument.uri.startsWith("file")) {
            startPath = path.dirname(Uri.parse(param.textDocument.uri).fsPath)
        }
        const includePos = line.lastIndexOf(include[2]);
        return completionFiles(include[2], startPath, include[1]!=undefined,
            server.Range.create(server.Position.create(param.position.line, includePos),
                server.Position.create(param.position.line, includePos + include[2].length - 1)));
    }
    let completions = [];
    var pos = param.position.character-1;
    // Get the word
    const rge = /[0-9a-z_]/i;
    let word = "", className = undefined;
    while (pos >= 0 && rge.test(line[pos])) {
        word = line[pos] + word;
        pos--;
    }
    word = word.toLowerCase();
    let pp = getDocumentProvider(doc);
    prevLetter = line[pos];
    if (prevLetter == '>') {
        if (pos>0 && line[pos - 1] == '-') {
            prevLetter = '->';
            completions = CompletionDBFields(word, line, pos, pp)
            if (completions.length > 0)
                return server.CompletionList.create(completions, true); // put true because added all known field of this db
        }
    }
    const done = {}
    function CheckAdd(label, kind, sort) {
        const ll = label.toLowerCase()
        if (ll in done)
            return;
        done[ll] = true;
        const sortLabel = IsInside(word, ll);
        if (sortLabel === undefined)
            return undefined;
        //var c =completions.find( (v) => v.label.toLowerCase() == ll );
        //if(!c)
        {
            c = server.CompletionItem.create(label);
            c.kind = kind
            c.sortText = sort + sortLabel
            completions.push(c);
        }
        return c;
    }
    if (prevLetter != '->' && prevLetter != ':') prevLetter = undefined;
    //if (word.length == 0 && prevLetter == undefined) return server.CompletionList.create(completions, false);
    if (!prevLetter) {
        for (var dbName in databases) {
            CheckAdd(databases[dbName].name, server.CompletionItemKind.Struct, "AAAA")
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, false);
        }
        if (pp) {
            for (var dbName in pp.databases) {
                CheckAdd(pp.databases[dbName].name, server.CompletionItemKind.Struct, "AAAA")
                if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, false);
            }
        }
    }
    function GetCompletions(pp, file) {
        for (let iSign = 0; iSign < pp.funcList.length; iSign++) {
            /** @type {provider.Info} */
            const info = pp.funcList[iSign];
            if (word.length > 0 && !IsInside(word, info.nameCmp))
                continue;
            if (info.endCol == param.position.character && info.endLine == param.position.line && file == doc.uri)
                continue;
            if (prevLetter == '->' && info.kind != "field")
                continue;
            if (prevLetter != '->' && info.kind == "field")
                continue;
            if (prevLetter == ':' && info.kind != "method" && info.kind != "data")
                continue;
            if (prevLetter != ':' && (info.kind == "method" || info.kind == "data"))
                continue;
            if (info.kind == "function*" || info.kind == "procedure*" || info.kind == "static") {
                if (file != doc.uri)
                    continue;
            }
            //if(info.kind == "local" || info.kind == "param")
            if (info.parent && (info.parent.kind.startsWith("function") || info.parent.kind.startsWith("procedure") || info.parent.kind == 'method')) {
                if (file != doc.uri) continue;
                if (param.position.line < info.parent.startLine ||
                    param.position.line > info.parent.endLine)
                    continue;
            }
            const added = CheckAdd(info.name, kindToVS(info.kind, false), "AAA");
            if (added && (info.kind == "method" || info.kind == "data") && info.parent)
                added.documentation = info.parent.name;
            if (cancelled.isCancellationRequested) return
        }
    }
    for (const file in files) // if (files.hasOwnProperty(file)) it is unnecessary
    {
        GetCompletions(files[file], file);
        if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, false);
    }
    if (pp) {
        GetCompletions(pp, doc.uri);
    } else if (doc.uri in files) {
        pp = files[doc.uri]
    }
    if (pp) {
        const thisDone = doc.uri in files;
        const includes = pp.includes;
        var i = 0;
        const startDir = path.dirname(Uri.parse(doc.uri).fsPath);
        while (i < includes.length) {
            pInc = ParseInclude(startDir, includes[i], thisDone);
            if (pInc) {
                GetCompletions(pInc, pInc.currentDocument)
                for (let j = 0; j < pInc.includes; j++) {
                    if (includes.indexOf(pInc.includes[j]) < 0)
                        includes.push(pInc.includes[j]);
                }
            }
            i++;
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, false);
        }
        if (wordBasedSuggestions) {
            for (const ref in pp.references) {
                if (Object.hasOwnProperty.call(pp.references, ref)) {
                    const allRefs = pp.references[ref];
                    const localDone = {}
                    for (let i = 0; i < allRefs.length; i++) {
                        const refObj = allRefs[i];
                        if(refObj.howWrite in localDone) continue
                        localDone[refObj.howWrite] = true
                        CheckAdd(refObj.howWrite,server.CompletionItemKind.Text, "")
                    }

                }
            }
        }
    }
    if (prevLetter != ':' && prevLetter != '->') {
        for (var i = 0; i < docs.length; i++) {
            var c = CheckAdd(docs[i].name, server.CompletionItemKind.Function, "AA")
            if (c) c.documentation = docs[i].documentation;
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, true);
        }
        for (var i = 1; i < keywords.length; i++) {
            CheckAdd(keywords[i], server.CompletionItemKind.Keyword, "AAA")
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, true);
        }
        for (var i = 1; i < missing.length; i++) {
            const c = CheckAdd(missing[i][0], server.CompletionItemKind.Function, "A")
            if(c) c.detail = missing[i][1];
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, true);
        }
        for (var i = 0; i < customFunctions.length; i++) {
            const c = CheckAdd(customFunctions[i][0], server.CompletionItemKind.Function, "A")
            if(c) c.detail = customFunctions[i][1];
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, true);
        }
        for (var i = 0; i < customFunctionDocs.length; i++) {
            const c = CheckAdd(customFunctionDocs[i].name, server.CompletionItemKind.Function, "AA")
            if (c) c.documentation = customFunctionDocs[i].documentation;
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, true);
        }
        //AddCommands(param, completions)
    }
    if (wordBasedSuggestions && !pp) {
        const wordRE = /\b[a-z_][a-z0-9_]*\b/gi
        let foundWord;
        var pos = param.position.character;
        while (foundWord = wordRE.exec(line)) {
            // remove current word
            if (foundWord.index < pos && foundWord.index + foundWord[0].length >= pos)
                continue;
            CheckAdd(foundWord[0], server.CompletionItemKind.Text, "")
            if (cancelled.isCancellationRequested) return server.CompletionList.create(completions, true);
        }
    }
    return server.CompletionList.create(completions, false);
})

/**
 * @param {server.CompletionParams} param
 * @param {server.CompletionItem[]} completions
 * */
function AddCommands(param, completions) {
    const doc = documents.get(param.textDocument.uri);
    let line = doc.getText(server.Range.create(param.position.line,0,param.position.line,1e8));
    let nextLine = line;
    const contTest = /;(\/\*.*\*\/)*((\/\/|&&).*)?[\r\n]{1,2}$/;
    let startLine=param.position.line;
    let endLine=param.position.line;
    var i=1;
    while((param.position.line-i)>0) {
        const prevLine=doc.getText(server.Range.create(param.position.line-i,0,param.position.line-i,1e8));
        if(prevLine.match(contTest)) {
            line = prevLine+line;
            startLine = param.position.line-i;
            i++;
        } else
            break;
    }
    i=1;
    while(nextLine.match(contTest)) {
        nextLine = doc.getText(server.Range.create(param.position.line+i,0,param.position.line+i,1e8));
        line += nextLine;
        endLine = param.position.line+i;
        i++;
    }
    const thisInfo = getDocumentProvider(doc);
    for(var i=0;i<thisInfo.commands.length;i++) {
        const thisCommand = thisInfo.commands[i];
        if(line.match(thisCommand.regEx)) {
            for(let j=0;thisCommand.length; j++) {
                const thisPart = thisCommand[j];
                //completions.
            }
        }
    }
}


/**
 *
 * @param {string} word
 * @param {string} startPath
 * @param {server.Range} includeRange
 */
function completionFiles(word, startPath, allFiles, includeRange) {
    let completions = [], foundSlash=path.sep;
    word = word.replace("\r", "").replace("\n", "");
    let startDone = false;
    let deltaPath = ""
    const lastSlash = Math.max(word.lastIndexOf("\\"), word.lastIndexOf("/"))
    if (lastSlash > 0) {
        foundSlash = word.substring(lastSlash,lastSlash+1)
        deltaPath = word.substring(0, lastSlash);
        word = word.substring(lastSlash + 1);
    }
    if (process.platform.startsWith("win")) {
        word = word.toLowerCase();
        if (startPath) startPath = startPath.toLowerCase();
    }
    const dirDone = [];
    function CheckDir(dir) {
        if (startPath && !path.isAbsolute(dir))
            dir = path.join(startPath, dir);
        dir = path.join(dir, deltaPath);
        if (process.platform.startsWith("win")) {
            if (dirDone.indexOf(dir.toLowerCase()) >= 0)
                return;
            dirDone.push(dir.toLowerCase());
        } else {
            if (dirDone.indexOf(dir) >= 0)
                return;
            dirDone.push(dir);
        }
        if (!fs.existsSync(dir)) return;

        if (startPath && dir.toLowerCase() == startPath) startDone = true;
        const ff = fs.readdirSync(dir)
        /** @type {Array<String>} */
        let subFiles;
        const extRE = /\.c?h$/i;
        for (let fi = 0; fi < ff.length; fi++) {
            let fileName = ff[fi];
            if (process.platform.startsWith("win"))
                fileName = fileName.toLowerCase();
            const completePath = path.join(dir, ff[fi]);
            const info = fs.statSync(completePath);
            if (info.isDirectory()) {
                subFiles = fs.readdirSync(completePath);
                if (!allFiles && subFiles.findIndex((v) => extRE.test(v)) == -1)
                    continue;
            } else if (!allFiles && !extRE.test(ff[fi]))
                continue;
            let sortText = undefined;
            if (word.length != 0) {
                sortText = IsInside(word, fileName);
                if (!sortText)
                    continue;
            }
            const result = path.join(deltaPath, ff[fi]).replace(new RegExp("\\"+path.sep,"g"),foundSlash);
            const c = server.CompletionItem.create(result);
            c.kind = info.isDirectory() ? server.CompletionItemKind.Folder : server.CompletionItemKind.File;
            c.sortText = sortText ? sortText : ff[fi];
            c.detail = dir;
            c.textEdit = server.TextEdit.replace(includeRange, result);
            completions.push(c);
        }
    }

    for (var i = 0; i < workspaceRoots.length; i++) {
        // other scheme of uri unsupported
        /** @type {vscode-uri.default} */
        const uri = Uri.parse(workspaceRoots[i]);
        if (uri.scheme != "file") continue;
        CheckDir(uri.fsPath);
    }
    for (var i = 0; i < includeDirs.length; i++) {
        CheckDir(includeDirs[i]);
    }
    if (startPath && !startDone) {
        CheckDir(startPath);
    }
    return server.CompletionList.create(completions, false);
}

function definitionFiles(fileName, startPath, origin) {
    const dest = [];
    fileName = fileName.toLowerCase();
    let startDone = false;
    if (startPath) startPath = startPath.toLowerCase();
    const emptyRange = server.Range.create(0, 0, 0, 0);
    function DefDir(dir) {
        if (startPath && !path.isAbsolute(dir))
            dir = path.join(startPath, dir);
        if (!fs.existsSync(dir)) return;
        if (startPath && dir.toLowerCase() == startPath) startDone = true;
        if(fs.existsSync(path.join(dir, fileName))) {
            let fileUri = path.join(dir, fileName);
            try {
                fileUri = trueCase.trueCasePathSync(fileUri);
            } catch(ex) {}
            fileUri = Uri.file(fileUri);
            fileUri = fileUri.toString();
            if (canLocationLink)
                dest.push(server.LocationLink.create(fileUri, emptyRange, emptyRange, origin));
            else
                dest.push(server.Location.create(fileUri, emptyRange));
        }
    }
    for (var i = 0; i < workspaceRoots.length; i++) {
        // other scheme of uri unsupported
        /** @type {vscode-uri.default} */
        const uri = Uri.parse(workspaceRoots[i]);
        if (uri.scheme != "file") continue;
        DefDir(uri.fsPath);
    }
    for (var i = 0; i < includeDirs.length; i++) {
        DefDir(includeDirs[i]);
    }
    if (startPath && !startDone) {
        DefDir(startPath);
    }
    return dest;
}

function CompletionDBFields(word, allText, pos, pp) {
    //prevLetter = '->';
    let pdb = pos - 2;
    let dbName = "";
    let nBracket = 0;
    while ((allText[pdb] != ' ' && allText[pdb] != '\t') || nBracket > 0) {
        const c = allText[pdb];
        pdb--;
        if (c == ')') nBracket++;
        if (c == '(') nBracket--;
        //dbName = c + dbName;
    }
    dbName = allText.substring(pdb+1,pos-1).replace(/\s+/g,"")
    const competitions = [];
    function AddDB(db) {
        for (const f in db.fields) {
            var name = db.fields[f];
            if (typeof (name) != "string") name = name.name;
            let sortText = name;
            if (word.length > 0) {
                sortText = IsInside(word, f);
            }
            if (!sortText) continue;
            if (!competitions.find((v) => v.label.toLowerCase() == name.toLowerCase())) {
                const c = server.CompletionItem.create(name);
                c.kind = server.CompletionItemKind.Field;
                c.documentation = db.name;
                c.sortText = "AAAA" + sortText;
                competitions.push(c);
            }
        }
    }
    function CheckDB(databases) {
        if (!(dbName in databases)) {
            // check if pick too much text
            for (db in databases) {
                if (dbName.endsWith(db)) {
                    dbName = db;
                    break
                }
            }
        }
        if (dbName in databases) {
            AddDB(databases[dbName]);
        }
    }
    dbName = dbName.toLowerCase().replace(" ", "").replace("\t", "");
    if (dbName.toLowerCase() == "field") {
        for (db in databases) AddDB(databases[db]);
        if (pp) for (db in pp.databases) AddDB(pp.databases[db]);
    } else {
        CheckDB(databases);
        if (pp && dbName in pp.databases) {
            CheckDB(pp.databases);
        }
    }
    return competitions;
}

const FUNC_HOVER_KINDS = ["class", "method", "function", "procedure", "function*", "procedure*"];

/** @param {Array<provider.Info>} list @param {string} wordCmp */
function findFuncCommentInfo(list, wordCmp) {
    let best;
    for (let k = 0; k < list.length; k++) {
        const info = list[k];
        if (info.nameCmp == wordCmp && FUNC_HOVER_KINDS.indexOf(info.kind) >= 0 && info.comment) {
            if (info.foundLike == "definition") return info;
            if (!best) best = info;
        }
    }
    return best;
}

const CALLABLE_KINDS_FOR_FIRST_CHECK = { "function": true, "procedure": true, "function*": true, "procedure*": true };

/** Whether `info` is the first function/procedure *definition* in `list`
 * (a file's own `funcList`, in source order) -- used to keep the very
 * first function of a file (which some shops' custom compilers require a
 * fixed banner-style header comment on) always shown as-is, never
 * DocBlock-parsed, regardless of what its comment looks like.
 * @param {provider.Info} info
 * @param {Array<provider.Info>} list
 * @returns {boolean}
 */
function isFirstFunctionInFile(info, list) {
    if (!CALLABLE_KINDS_FOR_FIRST_CHECK[info.kind]) return false;
    for (let i = 0; i < list.length; i++) {
        const other = list[i];
        if (other.foundLike != "definition") continue;
        if (!CALLABLE_KINDS_FOR_FIRST_CHECK[other.kind]) continue;
        if (other.startLine < info.startLine) return false;
    }
    return true;
}

/** Parses a "/** ... *\/"-style doc-comment into structured fields if it
 * looks like a DocBlock (JSDoc/PHPDoc-style, at least one "@tag" line) --
 * returns undefined otherwise, so the caller falls back to showing the
 * comment verbatim (unchanged behavior for free-form prose or a banner
 * like the one some shops require on a file's first function).
 * @param {string} comment
 * @returns {{description:string, params:Array<{name:string,doc:string}>, returns:string, example:string, extra:Array<{tag:string,text:string}>}|undefined}
 */
function parseDocBlock(comment) {
    const rawLines = comment.replace(/\r\n/g, "\n").split("\n");
    // strip a leading docblock "gutter" ("/**", " * ", "*/") from each line
    const lines = rawLines.map(l => l
        .replace(/^\s*\/\*\*?\s?/, "")
        .replace(/\*\/\s*$/, "")
        .replace(/^\s*\*\s?/, ""));
    if (!lines.some(l => /^\s*@[A-Za-z]+\b/.test(l))) return undefined;

    const result = { description: "", params: [], returns: "", example: "", extra: [] };
    let mode = "description", currentParam, currentExtra;
    for (const rawLine of lines) {
        const tagMatch = /^\s*@([A-Za-z]+)\b\s*(.*)$/.exec(rawLine);
        if (tagMatch) {
            const tag = tagMatch[1].toLowerCase();
            const rest = tagMatch[2];
            if (tag == "param") {
                const pm = /^<?([A-Za-z_]\w*)>?\s*(.*)$/.exec(rest);
                currentParam = { name: pm ? pm[1] : rest.trim(), doc: pm ? pm[2].trim() : "" };
                result.params.push(currentParam);
                mode = "param";
            } else if (tag == "return" || tag == "returns") {
                result.returns = rest.trim();
                mode = "returns";
            } else if (tag == "example") {
                result.example = rest.trim();
                mode = "example";
            } else if (tag == "description") {
                result.description = (result.description ? result.description + " " : "") + rest.trim();
                mode = "description";
            } else {
                currentExtra = { tag: tag, text: rest.trim() };
                result.extra.push(currentExtra);
                mode = "extra";
            }
            continue;
        }
        const trimmed = rawLine.trim();
        if (trimmed.length == 0) continue;
        if (mode == "description") result.description += (result.description ? " " : "") + trimmed;
        else if (mode == "param" && currentParam) currentParam.doc += (currentParam.doc ? " " : "") + trimmed;
        else if (mode == "returns") result.returns += (result.returns ? " " : "") + trimmed;
        else if (mode == "example") result.example += (result.example ? "\n" : "") + rawLine;
        else if (mode == "extra" && currentExtra) currentExtra.text += (currentExtra.text ? " " : "") + trimmed;
    }
    return result;
}

/** Builds a hover for a parsed DocBlock (see `parseDocBlock`), in the same
 * visual style `rtlHoverContent` uses for standard RTL functions.
 * @param {ReturnType<typeof parseDocBlock>} parsed
 * @param {provider.Info} info
 * @returns {{contents: {kind: string, value: string}}}
 */
function docBlockHoverContent(parsed, info) {
    const label = info.name + "(" + parsed.params.map(p => "<" + p.name + ">").join(", ") + ")";
    let value = "```harbour\n" + label + "\n```";
    if (parsed.description) value += "\n\n" + parsed.description;
    if (parsed.params.length > 0) {
        value += "\n\n**Parameters**";
        for (const p of parsed.params) {
            value += "\n- `<" + p.name + ">`";
            if (p.doc) value += " — " + p.doc;
        }
    }
    if (parsed.returns) value += "\n\n**Returns**: " + parsed.returns;
    if (parsed.example) value += "\n\n**Example**\n```harbour\n" + parsed.example + "\n```";
    for (const e of parsed.extra) {
        value += "\n\n**" + e.tag.charAt(0).toUpperCase() + e.tag.slice(1) + "**: " + e.text;
    }
    return { contents: { kind: 'markdown', value: value } };
}

/**
 * @param {provider.Info} info
 * @param {Array<provider.Info>} [list] the file's own funcList `info` came
 * from, used to detect/exempt the file's first function -- omit only when
 * that check isn't meaningful (there isn't currently such a caller).
 */
function commentHoverContent(info, list) {
    if (!(list && isFirstFunctionInFile(info, list))) {
        const parsed = parseDocBlock(info.comment);
        if (parsed) return docBlockHoverContent(parsed, info);
    }
    return { contents: { kind: 'plaintext', value: info.comment.replace(/\r\n/g, '\n').trim() } };
}

/** Builds a hover for a standard xHarbour/Harbour RTL function from its
 * `hbdocs.json` entry -- the same shape `GetHelpFromDoc`/`getStdHelp` use to
 * build signature help -- so hovering a call to e.g. `Len()` shows its
 * parameters and behavior, the same way hovering a workspace-defined
 * function shows its doc-comment.
 * @param {object} doc entry from `docs` (hbdocs.json)
 * @returns {{contents: {kind: string, value: string}}}
 */
function rtlHoverContent(doc) {
    let value = "```harbour\n" + doc.label + "\n```";
    if (doc.documentation)
        value += "\n\n" + doc.documentation;
    if (doc.arguments && doc.arguments.length > 0) {
        value += "\n\n**Parameters**";
        for (let i = 0; i < doc.arguments.length; i++) {
            const arg = doc.arguments[i];
            value += "\n- `" + arg.label + "`";
            if (arg.documentation) value += " — " + arg.documentation;
        }
    }
    if (doc.return && doc.return.help)
        value += "\n\n**Returns**: " + doc.return.help;
    return { contents: { kind: 'markdown', value: value } };
}

/** Builds a minimal hover for an RTL function that's known to exist (from
 * `hbdocs.missing`) but has no parsed documentation, so hovering it still
 * confirms it's a recognized RTL function instead of showing nothing.
 * @param {string} name
 * @param {string} library
 * @returns {{contents: {kind: string, value: string}}}
 */
function rtlMissingHoverContent(name, library) {
    return { contents: { kind: 'markdown', value: `xHarbour/Harbour RTL function (library \`${library}\`).\n\nNo documentation available.` } };
}

/** Builds a minimal hover for a function found via a "DYNAMIC <name>" export
 * in a `.hbx` file under `harbour.extraIncludePaths` (see
 * `scanCustomHbxFunctions`) -- a custom/forked compiler's own native
 * function, which only has a name available, no parameter docs.
 * @param {string} name
 * @param {string} hbxFile
 * @returns {{contents: {kind: string, value: string}}}
 */
function customFunctionHoverContent(name, hbxFile) {
    return { contents: { kind: 'markdown', value: `Custom function exported by \`${hbxFile}\`.\n\nNo documentation available.` } };
}

connection.onHover((params, cancelled) => {
    const w = GetWord(params);
    if(w.length==0) return undefined;
    const wordCmp = w.toLowerCase();
    const doc = documents.get(params.textDocument.uri);
    const pp = getDocumentProvider(doc);
    if (pp) {
        var result = pp.funcList.filter((v)=> v.kind=='define' && v.name==w);
        if(result.length>0) {
            return { contents: { language: 'harbour', value: result[0].body } };
        }
        const funcInfo = findFuncCommentInfo(pp.funcList, wordCmp);
        if (funcInfo) {
            return commentHoverContent(funcInfo, pp.funcList);
        }
        const thisDone = doc.uri in files;
        const includes = pp.includes;
        let i = 0;
        const startDir = path.dirname(Uri.parse(doc.uri).fsPath);
        while (i < includes.length) {
            const pInc = ParseInclude(startDir, includes[i], thisDone);
            if (pInc) {
                var result = pInc.funcList.filter((v)=> v.kind=='define' && v.name==w);
                if(result.length>0) {
                    return { contents: { language: 'harbour', value: result[0].body } };
                }
                const incFuncInfo = findFuncCommentInfo(pInc.funcList, wordCmp);
                if (incFuncInfo) {
                    return commentHoverContent(incFuncInfo, pInc.funcList);
                }
                for (let j = 0; j < pInc.includes.length; j++) {
                    if (includes.indexOf(pInc.includes[j]) < 0)
                        includes.push(pInc.includes[j]);
                }
            }
            i++;
            if (cancelled.isCancellationRequested) return undefined;
        }
    }
    // Not found in this document or its own #include chain -- look across the
    // rest of the indexed workspace (same "files" index Go to Definition uses),
    // so hovering a call to a function defined in another workspace file still
    // shows its doc-comment.
    for (const file in files) {
        if (file == doc.uri) continue;
        if (cancelled.isCancellationRequested) return undefined;
        const otherPp = files[file];
        var result = otherPp.funcList.filter((v)=> v.kind=='define' && v.name==w);
        if(result.length>0) {
            return { contents: { language: 'harbour', value: result[0].body } };
        }
        const otherFuncInfo = findFuncCommentInfo(otherPp.funcList, wordCmp);
        if (otherFuncInfo) {
            return commentHoverContent(otherFuncInfo, otherPp.funcList);
        }
    }
    // Not defined anywhere in the workspace -- fall back to a hand-declared
    // harbour.aliases.customFunctions entry first (lets a project-specific
    // function's docs take precedence over a same-named RTL one, however
    // unlikely), then the standard xHarbour/Harbour RTL (the same
    // `docs`/`missing` data isKnownFunction and signature help already
    // use), so e.g. Len() shows its parameters and behavior too, not just
    // workspace-defined functions.
    for (let i = 0; i < customFunctionDocs.length; i++) {
        if (customFunctionDocs[i].name && customFunctionDocs[i].name.toLowerCase() == wordCmp) {
            return rtlHoverContent(customFunctionDocs[i]);
        }
    }
    for (let i = 0; i < docs.length; i++) {
        if (docs[i].name && docs[i].name.toLowerCase() == wordCmp) {
            return rtlHoverContent(docs[i]);
        }
    }
    for (let i = 1; i < missing.length; i++) {
        if (missing[i][0] && missing[i][0].toLowerCase() == wordCmp) {
            return rtlMissingHoverContent(missing[i][0], missing[i][1]);
        }
    }
    for (let i = 0; i < customFunctions.length; i++) {
        if (customFunctions[i][0] && customFunctions[i][0].toLowerCase() == wordCmp) {
            return customFunctionHoverContent(customFunctions[i][0], customFunctions[i][1]);
        }
    }
    return undefined;
})

connection.onFoldingRanges((params) => {
    const ranges = [];
    const doc = documents.get(params.textDocument.uri);
    const pp = getDocumentProvider(doc, true);
    for (let iSign = 0; iSign < pp.funcList.length; iSign++) {
        /** @type {provider.Info} */
        const info = pp.funcList[iSign];
        if (info.startLine != info.endLine) {
            var rr = {};
            rr.startLine = info.startLine;
            rr.endLine = info.endLine;
            ranges.push(rr);
        }
    }
    let deltaLine = 0;
    if (lineFoldingOnly) deltaLine = 1;
    for (let iGroup = 0; iGroup < pp.groups.length; iGroup++) {
        /** @type {provider.KeywordPos[]} */
        var poss = pp.groups[iGroup].positions;
        if (["if", "try", "sequence", "case"].indexOf(pp.groups[iGroup].type) < 0) {
            var rr = {};
            var i = poss.length - 1;
            rr.startLine = poss[0].line;
            rr.endLine = poss[i].line - deltaLine;
            rr.startCharacter = poss[0].endCol;
            rr.endCharacter = poss[i].startCol;
            ranges.push(rr);
        } else {
            let prev = 0;
            for (let i = 1; i < poss.length; i++) {
                if (poss[i].text != "exit") {
                    var rr = {};
                    rr.startLine = poss[prev].line;
                    rr.endLine = poss[i].line - deltaLine;
                    rr.startCharacter = poss[prev].endCol;
                    rr.endCharacter = poss[i].startCol;
                    ranges.push(rr);
                    prev = i;
                }
            }
        }
    }
    for (let iGroup = 0; iGroup < pp.preprocGroups.length; iGroup++) {
        /** @type {provider.KeywordPos[]} */
        var poss = pp.preprocGroups[iGroup].positions;
        var rr = {};
        var i = poss.length - 1;
        rr.startLine = poss[0].line;
        rr.endLine = poss[i].line - deltaLine;
        rr.startCharacter = poss[0].endCol;
        rr.endCharacter = poss[i].startCol;
        ranges.push(rr);
    }
    for (let iComment = 0; iComment < pp.multilineComments.length; iComment++) {
        const cc = pp.multilineComments[iComment];
        var rr = {};
        rr.king = "comment"
        rr.startLine = cc[0];
        rr.endLine = cc[1];
        ranges.push(rr);
    }
    for (let iCFolder = 0; iCFolder < pp.cCodeFolder.length; iCFolder++) {
        const folder = pp.cCodeFolder[iCFolder];
        var rr = {};
        rr.startLine = folder[0]
        rr.endLine = folder[2] - deltaLine;
        rr.startCharacter = folder[1];
        rr.endCharacter = folder[3];
        ranges.push(rr);

    }

    return ranges;
})

/** Used by the compiler-backed validator (src/client/validation.js) to
 * scope harbour.aliases.allowBareCalls: the compiler's "Ambiguous
 * reference" warning fires for any identifier not immediately followed by
 * "(", which could be a real bare function call OR a genuinely
 * undeclared/misspelled variable -- the compiler itself can't tell them
 * apart. This runs the exact same `isKnownFunction` check
 * harbour.checkUndefinedFunctions uses (workspace, RTL, .hbx exports,
 * harbour.aliases.customFunctions) so "allow bare calls" only ever
 * suppresses the warning for names that really are known functions,
 * leaving a real undeclared-variable warning alone.
 * @param {{textDocument:{uri:string}, names:string[]}} params
 * @returns {Object.<string, boolean>} same names as keys, whether each is known
 */
connection.onRequest("harbour/isKnownFunction", (params) => {
    const doc = documents.get(params.textDocument.uri);
    const pp = doc ? getDocumentProvider(doc) : undefined;
    const includeChain = (pp && doc) ? resolveIncludeChain(pp, doc.uri) : undefined;
    const result = {};
    for (const name of (params.names || [])) {
        result[name] = isKnownFunction(name.toLowerCase(), pp, includeChain);
    }
    return result;
})

connection.onRequest("harbour/groupAtPosition", (params) => {
    const doc = documents.get(params.textDocument.uri);
    if(!doc) return [];
    const pp = getDocumentProvider(doc, true);
    for (let iGroup = 0; iGroup < pp.groups.length; iGroup++) {
        /** @type {Array<provider.KeywordPos>} */
        const poss = pp.groups[iGroup].positions;
        for (let i = 0; i < poss.length; i++) {
            if (params.sel.active.line == poss[i].line &&
                params.sel.active.character >= poss[i].startCol &&
                params.sel.active.character <= poss[i].endCol) {
                return poss;
            }
        }
    }
    return [];
})

connection.onRequest("harbour/docSnippet", (params) => {
    const doc = documents.get(params.textDocument.uri);
    const pp = getDocumentProvider(doc);
    /** @type{provider.Info} */
    let funcInfo, iSign;
    for (let i = 0; i < pp.funcList.length; i++) {
        /** @type{provider.Info} */
        const info = pp.funcList[i];
        if (!info.kind.startsWith("procedure") &&
            !info.kind.startsWith("function"))
            continue;
        if (info.startLine > params.sel[0].line) {
            funcInfo = info;
            iSign = i;
            break;
        }
    }
    if (!funcInfo) return undefined;
    if ("hDocIdx" in funcInfo) return undefined;
    const subParams = [];
    for (let iParam = iSign + 1; iParam < pp.funcList.length; iParam++) {
        /** @type {provider.Info} */
        const subInfo = pp.funcList[iParam];
        if (subInfo.parent == funcInfo && subInfo.kind == "param") {
            subParams.push(subInfo);
        } else
            break;
    }

    let snippet = "/* \\$DOC\\$\r\n";
    snippet += "\t\\$TEMPLATE\\$\r\n\t\t" + funcInfo.kind + "\r\n";
    snippet += "\t\\$ONELINER\\$\r\n\t\t$1\r\n"
    snippet += "\t\\$SYNTAX\\$\r\n\t\t" + funcInfo.name + "("
    for (let iParam = 0; iParam < subParams.length; iParam++) {
        const param = subParams[iParam];
        snippet += "<" + param.name + ">";
        if (iParam != subParams.length - 1) snippet += ", "
    }
    if (funcInfo.kind.startsWith("function"))
        snippet += ") --> ${2:retValue}\r\n"
    else
        snippet += ")\r\n"
    snippet += "\t\\$ARGUMENTS\\$\r\n"
    let nTab = 3;
    for (let iParam = 0; iParam < subParams.length; iParam++) {
        const param = subParams[iParam];
        snippet += "\t\t<" + param.name + "> $" + nTab + "\r\n";
        nTab++;
    }
    if (funcInfo.kind.startsWith("function")) {
        snippet += "\t\\$RETURNS\\$\r\n"
        snippet += "\t\t${2:retValue} $" + nTab + "\r\n"
    }
    snippet += "\t\\$END\\$ */"
    return snippet;
    })

connection.onRequest(server.SemanticTokensRequest.method, (param) => {
    const doc = documents.get(param.textDocument.uri);
    if(!doc) return [];
    let ret = [];
    let pp// = getDocumentProvider(doc);
    if (doc.uri in files)
        pp = files[doc.uri]
    else
        return [] // does not parse unknown files
    for (let i = 0; i < pp.funcList.length; i++) {
        /** @type{provider.Info} */
        const info = pp.funcList[i];
        if((info.kind=="local" || info.kind=="param")&&(info.nameCmp in pp.references)) {
            const id = info.kind=="local"? 0 : 1;
            const p = info.parent;
            for (let ri = 0; ri < pp.references[info.nameCmp].length; ri++) {
                const ref = pp.references[info.nameCmp][ri];
                if(ref.type == "variable" &&
                    ref.line>=p.startLine &&
                    ref.line<=p.endLine) {
                        var mod = 0;
                        if(ref.line == info.startLine) mod+=1;
                        ret.push([ref.line,ref.col,info.nameCmp.length,id,mod])
                    }
            }
        }
        if (info.kind=="static" && info.nameCmp in pp.references) {
            const id = 0;
            for (let ri = 0; ri < pp.references[info.nameCmp].length; ri++) {
                const ref = pp.references[info.nameCmp][ri];
                if(ref.type == "variable") {
                    var mod = 2; //static
                    if(ref.line == info.startLine) mod+=1;
                    ret.push([ref.line,ref.col,info.nameCmp.length,id,mod])
                }
            }
        }
    }
    if (aliasConfig.customKeywords.length > 0) {
        for (let i = 0; i < doc.lineCount; i++) {
            const state = pp.lineStates[i];
            const precState = i == 0 ? state : pp.lineStates[i - 1];
            const rawLine = doc.getText(server.Range.create(i, 0, i, 1e8));
            const clean = getCleanline(rawLine, state, precState);
            const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/.exec(clean);
            if (!m) continue;
            const wordCmp = m[2].toLowerCase();
            const isAlias = aliasConfig.customKeywords.some(k => k.word && k.word.toLowerCase() === wordCmp);
            if (isAlias) {
                ret.push([i, m[1].length, m[2].length, 2, 0]);
            }
        }
    }
    ret = ret.sort((a,b) => a[0]!=b[0] ? a[0]-b[0] : a[1]-b[1])
    for(let i=ret.length-1;i>0;--i) {
        if(ret[i][0]!=ret[i-1][0]) {
            //different lines
            ret[i][0] -= ret[i-1][0];
        } else {
            ret[i][0] = 0;
            ret[i][1] -= ret[i-1][1]
        }
    }
    ret=ret.flat()
    return { "data": ret}
});

/**
 *
 * @param {server_textdocument.TextDocument} doc
 * @param {number} startPos
 */
function getNextNotSpace(doc,startPos) {

    let p;
    const currPos = doc.positionAt(startPos);
    const endPos = doc.positionAt(startPos);
    endPos.line+=1
    endPos.character=0;
    p = doc.getText(server.Range.create(currPos,endPos)).trimStart();
    return p[0];
}

connection.onReferences( (params) => {
    let word = GetWord(params, true);
    if (word.length == 0) return undefined;
    const doc = documents.get(params.textDocument.uri);
    const prev = word[1]
    const next = getNextNotSpace(doc,word[2]+word[0].length)
    let kind = "variable"
    if(prev==':') kind= next=="("? "method" : "data";
             else  kind= next=="("? "function" : "variable";
    if(prev=="->") kind="field" //
    const ret = [];
    word = word[0].toLowerCase()
    let pThis;
    if(doc.uri in files)
        pThis = files[doc.uri];
    else
        pThis = getDocumentProvider(doc);
    const reqLine = params.position.line
    const def = pThis.funcList.find((v)=>
        v.nameCmp==word &&
        (v.parent==undefined || (v.parent.startLine<=reqLine && v.parent.endLine>=reqLine)));
    let onlyThis = false;
    if(def) {
        kind = def.kind
        if(def.kind.endsWith("*")) {
            onlyThis = true;
            kind = kind.substring(0,kind.length-1)
        }
        if(def.kind == "local") onlyThis = true;
        if(def.kind == "static") onlyThis = true;
        if(def.kind == "param") onlyThis = true;
    }
    if(word in pThis.references) { //always
        for (let i = 0; i < pThis.references[word].length; i++) {
            /** @type {provider.reference} */
            const ref = pThis.references[word][i];
            if(ref.type!=kind) continue;
            if(def && def.parent && onlyThis) {
                if(ref.line<def.parent.startLine) continue;
                if(ref.line>def.parent.endLine) continue;
            }
            ret.push(server.Location.create(doc.uri,
                server.Range.create(ref.line,ref.col,ref.line,ref.col+word.length)))
        }
    }

    if(!onlyThis) for (const file in files) { //if (files.hasOwnProperty(file)) {
        if (file == doc.uri) continue;
        const pp = files[file];
        if(word in pp.references) {
            for (let i = 0; i < pp.references[word].length; i++) {
                /** @type {provider.reference} */
                const ref = pp.references[word][i];
                if(ref.type==kind) {
                    ret.push(server.Location.create(file,
                        server.Range.create(ref.line,ref.col,ref.line,ref.col+word.length)))
                }
            }
        }
    }
    return ret;
})

/**
 * Removes comment block and empties strings
 * @param {String} _line
 * @param {LineState} lineState
 * @param {LineState} precLineState
 * @returns String
 * @note merge this wit linePP
 */
function getCleanline(_line, lineState, precLineState) {
    let line = _line;
    let i=0;
    if(line.trim().length==0) return ""
    if(lineState && lineState.type!=0) return "";
    if(precLineState && precLineState.state==1) {
        const endComment = line.indexOf("*/");
        if (endComment == -1) {
            return "";
        }
        line = " ".repeat(endComment+2) + line.substring(endComment + 2);
        i = endComment+2;
    }
    const precCont = precLineState && precLineState.state==2
    if((!precCont) && line.trimStart().startsWith("#")) {
        return "";
    }
    let justStart = !precCont;
    let prevC = " ", c = " ", prevCNoSpace="";
    for (; i < line.length; i++) {
        prevC = c;
        prevCNoSpace = (c == " " || c == '\t') ? prevCNoSpace : c;
        prevJustStart = justStart;
        c = line[i];
        if (justStart) {
            justStart = (prevC == " " || prevC == '\t');
            lineStart = i;
        }
        // check code
        if (justStart && (c=='n' || c=='N') && line.substring(i,i+4).toLowerCase()=='note') {
            return "";
        }
        if (c == "*") {
            if (justStart) {
                // commented line: skip
                return "";
            }
            if (prevC == "/") {
                const endComment = line.indexOf("*/", i + 1)
                if (endComment > 0) {
                    line = line.substring(0, i - 1) + " ".repeat(endComment - i + 3) + line.substring(endComment + 2);
                    c=" ";
                    i=endComment;
                    continue;
                } else {
                    line = line.substring(0, i - 1)
                    break;
                }
            }
        }
        if ((c == "/" && prevC == "/") || (c == "&" && prevC == "&")) {
            //line = line.substring(0, i - 1)
            break;
        }
        if (c == '"' || c=="'" || (c == "[" && /[^a-zA-Z0-9_\[\]]/.test(prevCNoSpace) && !/^\s*#/.test(line))) {
            let endString = line.indexOf(c=="["? "]" : c, i+1);
            if (c=='"' && (prevC == "e")) {
                while(endString>0 && line[endString-1]=="\\") {
                    endString = line.indexOf('"', endString+1);
                }
            }
            if(endString<0) {
                //error
                line = line.substring(0, i - 1)
                break;
            }
            line = line.substring(0, i+1) + " ".repeat(endString - i-1) + line.substring(endString);
            i = endString+1;
            c=" ";
            continue;
        }
    }
    return line;
}

connection.onDocumentFormatting( (params) => {
    const ret = [];
    const doc = documents.get(params.textDocument.uri);
    let pThis;
    if(doc.uri in files)
        pThis = files[doc.uri];
    else
        pThis = getDocumentProvider(doc);
    const tabs=Array(doc.lineCount);
    tabs.fill(0);
    for (let iSign = 0; iSign < pThis.funcList.length; iSign++) {
        /** @type {provider.Info} */
        const info = pThis.funcList[iSign];
        if (info.startLine != info.endLine) {
            let doTab = false;
            if(currStyleConfig.indent.funcBody && ["class", "method", "function","procedure", "function*","procedure*"].indexOf(info.kind) >= 0)
                doTab = true;
            if(doTab) {
                for(let l=info.startLine+1;l<info.endLine;++l) {
                    tabs[l]+=1;
                }
                let doLast = false;
                if((info.kind.startsWith("func") || info.kind.startsWith("proc")) && info.foundLike=="definition") {
                    const line = doc.getText(server.Range.create(info.endLine, 0, info.endLine, 1e8));
                    //doLast = !/^\s*ret(u(r(n?)?)?)?/i.test(line);
                    doLast = !(line.trimStart().toLowerCase().startsWith("ret"))
                }
                if(doLast) tabs[info.endLine]+=1
            }
        }
    }
    for(let i=0;i<pThis.groups.length;++i) {
        const group = pThis.groups[i];
        let doTab = false;
        let checkInside = false;
        switch(group.type) {
            case "if": case "try": case "sequence":
                doTab = currStyleConfig.indent.logical;
                checkInside = true;
                break;
            case "for": case "while":
                doTab = currStyleConfig.indent.cycle;
                break;
            case "case":
                // simple "case" case,
                doTab = currStyleConfig.indent.switch && !currStyleConfig.indent.case;
                break;
        }
        if(doTab) {
            const startLine = group.positions[0].line+1;
            const endLine = group.positions[group.positions.length-1].line;
            for(let l=startLine;l<endLine;++l) {
                tabs[l]+=1;
            }
            if(checkInside) {
                for(let p=1;p<group.positions.length-1;++p) {
                    tabs[group.positions[p].line]-=1;
                }
            }

        }
        if(currStyleConfig.indent.switch && currStyleConfig.indent.case &&
                group.type=="case") {
            // complex "case" case,
            const startLine = group.positions[0].line+1;
            const endLine = group.positions[group.positions.length-1].line;
            for(let l=startLine;l<endLine;++l) {
                tabs[l]+=2;
            }
            for(let p=1;p<group.positions.length;++p) {
                if(group.positions[p].text[0].startsWith('case'))
                    tabs[group.positions[p].line]-=1;
            }
        }
    }
    for(let i=0;i<doc.lineCount;++i) {
        const state = pThis.lineStates[i];
        const precState = i==0? state : pThis.lineStates[i-1]
        if(state.type==0 && precState.state!=1) {
            let t = tabs[i];
            const precCont = precState.state==2
            if(i>0 && precCont) t++;
            const line = doc.getText(server.Range.create(i, 0, i, 1e8));
            let firstNoSpace=0;
            while(line[firstNoSpace]==" " || line[firstNoSpace]=="\t") firstNoSpace++;
            const line2 = getCleanline(line, state, precState);
            if(currStyleConfig.replace.not!="ignore") {
                if(currStyleConfig.replace.not=="use .not.") {
                    let p = line2.lastIndexOf("!")
                    while(p>0) {
                        const currRange = server.Range.create(i, p, i, p+1);
                        ret.push(server.TextEdit.replace(currRange, ".not."));
                        p = line2.lastIndexOf("!",p-1)
                    }
                }
                if(currStyleConfig.replace.not=="use !") {
                    let p = line2.lastIndexOf(".not.")
                    while(p>0) {
                        const currRange = server.Range.create(i, p, i, p+5);
                        ret.push(server.TextEdit.replace(currRange, "!"));
                        p = line2.lastIndexOf(".not.",p-1)
                    }
                }
            }
            let commentReplaced = false
            if(precState.state==0 && currStyleConfig.replace.asterisk!="ignore") {
                if(/^\s*(\*|\/\/|&&|note)/i.test(line)) {
                    commentReplaced = true
                    const firstChar = line.substring(firstNoSpace,firstNoSpace+1);//line2.trimStart().substring(0,1);
                    let commentLen = 2;
                    if(firstChar=="*") commentLen = 1;
                    if(firstChar=="n") commentLen = 4;
                    if(firstChar=="N") commentLen = 4;
                    if(currStyleConfig.replace.asterisk=="use //" && firstChar!="/") {
                        const currRange = server.Range.create(i, firstNoSpace, i, firstNoSpace+commentLen);
                        ret.push(server.TextEdit.replace(currRange, "//"));
                    }
                    if(currStyleConfig.replace.asterisk=="use &&" && firstChar!="&") {
                        const currRange = server.Range.create(i, firstNoSpace, i, firstNoSpace+commentLen);
                        ret.push(server.TextEdit.replace(currRange, "&&"));
                    }
                    if(currStyleConfig.replace.asterisk=="use *" && firstChar!="*") {
                        const currRange = server.Range.create(i, firstNoSpace, i, firstNoSpace+commentLen);
                        ret.push(server.TextEdit.replace(currRange, "*"));
                    }
                }
            }
            if(!commentReplaced && currStyleConfig.replace.amp!="ignore") {
                if(currStyleConfig.replace.asterisk=="use //") {
                    const pAmp = line2.indexOf("&&");
                    if(pAmp>0) {
                        const currRange = server.Range.create(i, pAmp, i, pAmp+2);
                        ret.push(server.TextEdit.replace(currRange, "//"));
                    }
                }
                if(currStyleConfig.replace.asterisk=="use &&") {
                    const pAmp = line2.indexOf("//");
                    if(pAmp>0) {
                        const currRange = server.Range.create(i, pAmp, i, pAmp+2);
                        ret.push(server.TextEdit.replace(currRange, "&&"));
                    }
                }
            }
            const unspaced = line.trimStart();
            if(unspaced.length>0) {
                let space = "";
                if(params.options.insertSpaces)
                    space = " ".repeat(params.options.tabSize * t);
                else
                    space = "\t".repeat(t);
                if(!line.startsWith(space) || line[space.length]==" " || line[space.length]=="\t") {
                    const currRange = server.Range.create(i, 0, i, firstNoSpace);
                    ret.push(server.TextEdit.replace(currRange, space));
                }
            }
        }
    }
    return ret;
})

connection.listen();