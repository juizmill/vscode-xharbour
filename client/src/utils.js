const vscode = require('vscode');
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");


/**
 *
 * @param {vscode.CancellationToken} token
 * @return {Promise<Array<Array<fs.Dirent>>>}
 */
function getAllWorkspaceFiles(token) {
    /** @type{Array<Promise>} */
    var promises = [];
    for(let d=0;d<vscode.workspace.workspaceFolders.length;d++) {
        let thisDir = vscode.workspace.workspaceFolders[d];
        /** @type {vscode.Uri} */
        var uri = vscode.Uri.parse(thisDir.uri)
        if (uri.scheme != "file") continue;
        //var r = promisify();
        var r = new Promise((res,reject)=>{
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
 * @return {Array<string>}
 */
function getAliasCommandArgs() {
    var section = vscode.workspace.getConfiguration('harbour');
    var rules = (section.aliases && section.aliases.commandRules) || [];
    var lines = rules
        .filter(r => r && r.match && r.replace)
        .map(r => "#command " + r.match + " => " + r.replace);
    if (lines.length == 0)
        return [];
    var workspaceKey = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : "default";
    var hash = crypto.createHash("md5").update(workspaceKey).digest("hex").slice(0, 12);
    var chPath = path.join(os.tmpdir(), "xharbour-tools-alias-" + hash + ".ch");
    fs.writeFileSync(chPath, lines.join("\n") + "\n");
    return ["-u+" + chPath];
}

exports.getAllWorkspaceFiles = getAllWorkspaceFiles;
exports.getAliasCommandArgs = getAliasCommandArgs;