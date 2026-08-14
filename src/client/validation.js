const vscode = require('vscode');
const cp = require("child_process");
const path = require("path");
const localize = require("./myLocalize.js").localize;
const readline = require("readline");
const getAliasCommandArgs = require("./utils.js").getAliasCommandArgs;

let diagnosticCollection;

function activate(context)
{
    diagnosticCollection = vscode.languages.createDiagnosticCollection('harbour');
	context.subscriptions.push(diagnosticCollection);

	vscode.workspace.onDidOpenTextDocument(validate,undefined, context.subscriptions);
	vscode.workspace.onDidSaveTextDocument(validate,undefined, context.subscriptions);
	vscode.workspace.onDidCloseTextDocument(removeValidation,undefined, context.subscriptions);
	if(vscode.window.activeTextEditor && vscode.window.activeTextEditor.document)
		validate(vscode.window.activeTextEditor.document);
}

function deactivate()
{
	 diagnosticCollection.dispose();
}

const valRegEx = /^\r?(?:([^\(]*)\((\d+)\)\s+)?(Warning|Error)\s+([^\r\n]*)/
const lineContRegEx = /;(\s*(\/\/|&&|\/\*))?/
/**
 * Whether the text right after a matched identifier is ":<suffix>(", where
 * <suffix> is one of harbour.aliases.callSuffixes -- i.e. the identifier is
 * being called through our own editor-only "Foo:Exec()" convention, not
 * used as an actual undeclared variable/ambiguous 0-arg call.
 * @param {string} lineText
 * @param {number} afterIndex
 * @param {string[]} callSuffixesLower
 */
function isCallSuffixUsage(lineText, afterIndex, callSuffixesLower)
{
	if(callSuffixesLower.length == 0) return false;
	const m = /^\s*:\s*([A-Za-z_]\w*)\s*\(/.exec(lineText.substring(afterIndex));
	return m ? callSuffixesLower.indexOf(m[1].toLowerCase()) >= 0 : false;
}
function validate(textDocument)
{
	if(textDocument.languageId !== 'harbour' )
		return;
	const section = vscode.workspace.getConfiguration('harbour');
	if(!section.validating)
		return;
	const callSuffixesLower = ((section.aliases && section.aliases.callSuffixes) || []).map(function(s) {return s.toLowerCase();});
	let args = ["-s", "-q0", "-m", "-n0", "-w"+section.warningLevel, textDocument.fileName ];
	const file_cwd = path.dirname(textDocument.fileName);
	for (let i = 0; i < section.extraIncludePaths.length; i++) {
		let pathVal = section.extraIncludePaths[i];
		if(pathVal.indexOf("${workspaceFolder}")>=0) {
			pathVal=pathVal.replace("${workspaceFolder}",file_cwd)
		}
		args.push("-I"+pathVal);
	}
	args = args.concat(section.extraOptions.split(" ").filter(function(el) {return el.length != 0 || el=="-ge1"}));
	args = args.concat(getAliasCommandArgs(file_cwd));
	const diagnostics = {};
	diagnostics[textDocument.fileName] = [];
	const doneSubjects = {};
	function parseLine(subLine)
	{
		const r = valRegEx.exec(subLine);
		if(r)
		{
			if(!r[1]) r[1]=textDocument.fileName;
			let lineNr = r[2]? parseInt(r[2])-1 : 0;
			const subject = r[4].match(/'([^']+)'/g);
			if(subject && subject.length>1 && subject[1].indexOf("(")>=0)
			{
				const nSub = subject[1].match(/\(([0-9]+)\)/);
				if(nSub)
				{
					lineNr = parseInt(nSub[1])-1;
				}
			}
			if(subject && subject.length>0) {
				if(lineNr in doneSubjects && doneSubjects[lineNr].indexOf(subject[0])>=0) return
				if(!(lineNr in doneSubjects)) doneSubjects[lineNr]=[];
				doneSubjects[lineNr].push(subject[0]);
			}
			const line = textDocument.lineAt(lineNr)
			if(!(r[1] in diagnostics))
			{
				diagnostics[r[1]] = [];
			}
			let putAll = true;
			if(subject)
			{
				let m;
				subject[0] = subject[0].substring(1,subject[0].length-1)
				const rr = new RegExp('\\b'+subject[0].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")+'\\b',"ig")
				let testLine = line;
				do {
					while(m=rr.exec(testLine.text))
					{
						putAll = false;
						if(r[4].indexOf("Ambiguous reference")>=0 &&
							isCallSuffixUsage(testLine.text, m.index+subject[0].length, callSuffixesLower)) {
							continue;
						}
						const diag = new vscode.Diagnostic(new vscode.Range(lineNr,m.index,lineNr,m.index+subject[0].length), r[4],
							r[3]=="Warning"? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error)
						if(r[4].indexOf("not used")>0) {
							diag.tags = [vscode.DiagnosticTag.Unnecessary];
						}
						diagnostics[r[1]].push(diag)
					}
					if(lineNr==0) break;
					testLine = textDocument.lineAt(--lineNr);
				} while(lineContRegEx.test(testLine.text))
			}
			if(putAll)
				diagnostics[r[1]].push(new vscode.Diagnostic(line.range, r[4], r[3]=="Warning"? 1 : 0))
		}
	}
	const process = cp.spawn(section.compilerExecutable,args, { cwd: file_cwd });
	process.on("error", e=>
	{
		vscode.window.showWarningMessage(localize("harbour.validation.NoExe",section.compilerExecutable));
	});
	const reader = readline.createInterface({ input: process.stderr})
	reader.on("line",d=>parseLine(d));
	//process.stderr.on('data', (v) => parseData(v,true));
	//process.stdout.on('data', (v) => parseData(v,false));
	process.on("exit",function(code)
	{
		for (const file in diagnostics) {
			if (diagnostics.hasOwnProperty(file)) {
				const infos = diagnostics[file];
				diagnosticCollection.set(vscode.Uri.file(file), infos);
			}
		}
	});
}

function removeValidation(textDocument)
{
	diagnosticCollection.delete(textDocument.uri);
}

exports.activate = activate;
exports.deactivate = deactivate;
