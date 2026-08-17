const vscode = require('vscode');
const fs = require("fs");
const os = require("os");
const path = require("path");


/**
 *
 * @param {vscode.CancellationToken} token
 * @return {Promise<Array<Array<fs.Dirent>>>}
 */
function getAllWorkspaceFiles(token) {
    /** @type{Array<Promise>} */
    const promises = [];
    for(let d=0;d<vscode.workspace.workspaceFolders.length;d++) {
        const thisDir = vscode.workspace.workspaceFolders[d];
        /** @type {vscode.Uri} */
        var uri = vscode.Uri.parse(thisDir.uri)
        if (uri.scheme != "file") continue;
        //var r = promisify();
        const r = new Promise((res,reject)=>{
            if(token.isCancellationRequested) {
                reject(token);
                return;
            }
            fs.readdir(uri.fsPath, {withFileTypes: true},(err,ff)=>{
                if(token.isCancellationRequested) {
                    reject(token);
                    return;
                }
                res(ff);
            })
        });
        promises.push(r);
    }
    return Promise.all(promises);
}

/**
 * Built-in "DEFAULT <v> := <x> [, <v2> := <x2> ...]" command, always on
 * unless harbour.aliases.customDefault is set to false. Two rules: the base
 * case (a single "<v> := <x>" with nothing left) expands to Default(v, x);
 * the recursive case (one pair followed by ", " and more) peels off the
 * first pair and re-emits "DEFAULT <rest>", which the preprocessor rescans
 * against these same two rules -- so cascades of any length work (tested up
 * to 60 chained pairs against the real xHarbour compiler), not just a fixed
 * number of optional clauses.
 * @type {string}
 */
const DEFAULT_COMMAND_RULES =
    "#command DEFAULT <v1> := <x1> => Default( <v1>, <x1> )\n" +
    "#command DEFAULT <v1> := <x1> , <*rest*> => Default( <v1>, <x1> ) ;; DEFAULT <rest>";

/**
 * Materializes harbour.aliases.commandRules (settings.json) into a generated
 * .ch file with one #command per rule, so the user doesn't have to paste
 * "#command <match> => <replace>" at the top of every .prg. Also always
 * includes the built-in DEFAULT command (see DEFAULT_COMMAND_RULES) unless
 * harbour.aliases.customDefault is false. Returns the extra compiler args
 * needed to pick it up (-u+<file>), or [] if there is nothing to generate.
 *
 * The file is written to the OS temp dir by default. Set
 * harbour.aliases.commandRulesUseFileDir to write it inside fileCwd (the
 * directory of the file being compiled) instead: needed only when
 * harbour.compilerExecutable is a wrapper (e.g. a Docker container) that
 * only mounts/sees that directory, so the OS temp dir may not exist from the
 * compiler's point of view. Most projects don't need this.
 * @param {string} fileCwd
 * @return {Array<string>}
 */
function getAliasCommandArgs(fileCwd) {
    const section = vscode.workspace.getConfiguration('harbour');
    const rules = (section.aliases && section.aliases.commandRules) || [];
    const lines = rules
        .filter(r => r && r.match && r.replace)
        .map(r => "#command " + r.match + " => " + r.replace);
    const customDefault = !section.aliases || section.aliases.customDefault !== false;
    if (customDefault)
        lines.unshift(DEFAULT_COMMAND_RULES);
    if (lines.length == 0)
        return [];
    const useFileDir = section.aliases && section.aliases.commandRulesUseFileDir === true;
    const chDir = useFileDir ? fileCwd : os.tmpdir();
    const chPath = path.join(chDir, ".vscode-xharbour-lang-command-rules.ch");
    fs.writeFileSync(chPath, lines.join("\n") + "\n");
    return ["-u+" + chPath];
}

exports.getAllWorkspaceFiles = getAllWorkspaceFiles;
exports.getAliasCommandArgs = getAliasCommandArgs;