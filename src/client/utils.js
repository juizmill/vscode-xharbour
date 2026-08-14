const vscode = require('vscode');
const fs = require("fs");
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
 * Materializes harbour.aliases.commandRules (settings.json) into a generated
 * .ch file with one #command per rule, so the user doesn't have to paste
 * "#command <match> => <replace>" at the top of every .prg. Returns the
 * extra compiler args needed to pick it up (-u+<file>), or [] if there are
 * no rules configured.
 *
 * The file is written inside fileCwd (the directory of the file being
 * compiled) rather than the OS temp dir: harbour.compilerExecutable can be a
 * wrapper (e.g. a Docker container) that only mounts/sees that directory, so
 * anything outside it -- like /tmp -- may not exist from the compiler's
 * point of view.
 * @param {string} fileCwd
 * @return {Array<string>}
 */
function getAliasCommandArgs(fileCwd) {
    const section = vscode.workspace.getConfiguration('harbour');
    const rules = (section.aliases && section.aliases.commandRules) || [];
    const lines = rules
        .filter(r => r && r.match && r.replace)
        .map(r => "#command " + r.match + " => " + r.replace);
    if (lines.length == 0)
        return [];
    const chPath = path.join(fileCwd, ".xharbour-tools-command-rules.ch");
    fs.writeFileSync(chPath, lines.join("\n") + "\n");
    return ["-u+" + chPath];
}

exports.getAllWorkspaceFiles = getAllWorkspaceFiles;
exports.getAliasCommandArgs = getAliasCommandArgs;